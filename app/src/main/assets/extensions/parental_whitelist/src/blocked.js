// Apply theme immediately
(async function() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getSettings' });
    const theme = response?.settings?.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {}
})();

// Parse URL parameters
const params = new URLSearchParams(window.location.search);
const blockedUrl = params.get('url');
const reason = params.get('reason');

// Variables for quick-add
let decodedUrl = null;
let cleanDomain = null;

// Show blocked URL if available
if (blockedUrl) {
  decodedUrl = decodeURIComponent(blockedUrl);
  document.getElementById('blockedUrlContainer').style.display = 'block';
  document.getElementById('blockedUrl').textContent = decodedUrl;

  // Extract clean domain for adding to whitelist
  try {
    const urlObj = new URL(decodedUrl);
    cleanDomain = urlObj.hostname.replace(/^www\./, '');
  } catch {
    cleanDomain = decodedUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  // Show "Add Site" and "Allow Temporarily" buttons only for whitelist blocks (not protected/private/timelimit)
  if (!reason || reason === 'whitelist') {
    document.getElementById('addSiteBtn').style.display = 'inline-flex';
    document.getElementById('tempAccessBtn').style.display = 'inline-flex';
  }
}

// Handle different block reasons
if (reason === 'protected' || reason === 'bypass') {
  document.getElementById('normalMessage').style.display = 'none';
  document.getElementById('protectedMessage').style.display = 'flex';
  document.getElementById('shieldIcon').classList.add('protected');
  document.getElementById('title').textContent = 'Access Denied';
  document.getElementById('subtitle').textContent = 'This page is protected by parental controls';
} else if (reason === 'private') {
  document.getElementById('normalMessage').style.display = 'none';
  document.getElementById('privateMessage').style.display = 'flex';
  document.getElementById('shieldIcon').classList.add('private');
  document.getElementById('title').textContent = 'Private Browsing Blocked';
  document.getElementById('subtitle').textContent = 'This feature is disabled by parental controls';
} else if (reason === 'timelimit') {
  document.getElementById('normalMessage').style.display = 'none';
  document.getElementById('timelimitMessage').style.display = 'flex';
  document.getElementById('shieldIcon').classList.add('timelimit');
  document.getElementById('title').textContent = 'Daily Time Used Up';
  document.getElementById('subtitle').textContent = 'Your daily browsing time has been used';
  document.getElementById('addSiteBtn').style.display = 'none';
  document.getElementById('tempAccessBtn').style.display = 'none';
}

// Go Back button
document.getElementById('goBackBtn').addEventListener('click', () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.close();
  }
});

// Load and display safe links from whitelist
async function loadSafeLinks() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getSettings' });
    const whitelist = response?.settings?.whitelist || [];

    if (whitelist.length > 0) {
      const container = document.getElementById('safeLinks');

      // Show up to 6 links
      const linksToShow = whitelist.slice(0, 6);

      linksToShow.forEach(site => {
        const link = document.createElement('a');
        link.href = 'https://' + site;
        link.className = 'safe-link';

        // Create SVG safely
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6');

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '15,3 21,3 21,9');

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '10');
        line.setAttribute('y1', '14');
        line.setAttribute('x2', '21');
        line.setAttribute('y2', '3');

        svg.appendChild(path);
        svg.appendChild(polyline);
        svg.appendChild(line);

        // Create text node for site name
        const textNode = document.createTextNode(formatSiteName(site));

        link.appendChild(svg);
        link.appendChild(textNode);
        container.appendChild(link);
      });

      document.getElementById('safeLinksSection').style.display = 'block';
    }
  } catch {
    // Whitelist unavailable
  }
}

// Format site name for display
function formatSiteName(site) {
  // Remove path and just show domain
  const domain = site.split('/')[0];
  // Capitalize first letter
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// Load safe links on page load
loadSafeLinks();

// ---- Dynamic PIN inputs ----

// Helper: create PIN input elements in a container
function buildPinInputs(container, count, cssClass) {
  // Clear existing inputs
  while (container.firstChild) container.removeChild(container.firstChild);
  for (let i = 0; i < count; i++) {
    const input = document.createElement('input');
    input.type = 'password';
    input.maxLength = 1;
    input.className = cssClass;
    input.setAttribute('data-index', String(i));
    input.setAttribute('inputmode', 'numeric');
    container.appendChild(input);
  }
}

// Helper: attach PIN input event listeners to a set of inputs
function attachPinListeners(inputs, pinLength, onComplete) {
  inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');

      if (e.target.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      // Check if all digits entered
      const pin = Array.from(inputs).map(i => i.value).join('');
      if (pin.length === pinLength) {
        onComplete(pin);
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
        inputs[index - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const paste = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, pinLength);
      paste.split('').forEach((char, i) => {
        if (inputs[i]) inputs[i].value = char;
      });
      if (paste.length === pinLength) onComplete(paste);
    });
  });
}

// Query PIN length and rebuild inputs
let currentPinLength = 4; // default

async function initDynamicPins() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getPinLength' });
    if (response && response.pinLength) {
      currentPinLength = response.pinLength;
    }
  } catch {
    // Fallback to 4
  }

  // Rebuild quick-add PIN inputs
  const quickAddPinContainer = document.querySelector('.quick-add-pin');
  if (quickAddPinContainer) {
    buildPinInputs(quickAddPinContainer, currentPinLength, 'quick-pin');
    const newQuickPinInputs = quickAddPinContainer.querySelectorAll('.quick-pin');
    attachPinListeners(Array.from(newQuickPinInputs), currentPinLength, verifyAndAddSite);
  }

  // Rebuild temp-access PIN inputs
  const tempAccessPinContainer = document.querySelector('.temp-access-pin');
  if (tempAccessPinContainer) {
    buildPinInputs(tempAccessPinContainer, currentPinLength, 'quick-pin-temp');
    const newTempPinInputs = tempAccessPinContainer.querySelectorAll('.quick-pin-temp');
    attachPinListeners(Array.from(newTempPinInputs), currentPinLength, verifyAndGrantTempAccess);
  }
}

initDynamicPins();

// Quick-Add Site functionality
const addSiteBtn = document.getElementById('addSiteBtn');
const quickAddSection = document.getElementById('quickAddSection');
const quickAddError = document.getElementById('quickAddError');
const quickAddSuccess = document.getElementById('quickAddSuccess');

// Toggle quick-add section
addSiteBtn.addEventListener('click', () => {
  // Close temp access section if open
  const tempSection = document.getElementById('tempAccessSection');
  if (tempSection.classList.contains('show')) {
    tempSection.classList.remove('show');
    resetTempAccessBtn();
  }

  quickAddSection.classList.toggle('show');
  if (quickAddSection.classList.contains('show')) {
    const firstInput = quickAddSection.querySelector('.quick-pin');
    if (firstInput) firstInput.focus();
    addSiteBtn.textContent = 'Cancel';
  } else {
    // Rebuild button content safely using DOM APIs
    rebuildAddSiteBtnContent();
    clearQuickPinInputs();
  }
});

function rebuildAddSiteBtnContent() {
  while (addSiteBtn.firstChild) addSiteBtn.removeChild(addSiteBtn.firstChild);
  const svgNS = 'http://www.w3.org/2000/svg';
  const btnSvg = document.createElementNS(svgNS, 'svg');
  btnSvg.setAttribute('viewBox', '0 0 24 24');
  btnSvg.setAttribute('width', '18');
  btnSvg.setAttribute('height', '18');
  btnSvg.setAttribute('fill', 'none');
  btnSvg.setAttribute('stroke', 'currentColor');
  btnSvg.setAttribute('stroke-width', '2');
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  const line1 = document.createElementNS(svgNS, 'line');
  line1.setAttribute('x1', '12'); line1.setAttribute('y1', '8');
  line1.setAttribute('x2', '12'); line1.setAttribute('y2', '16');
  const line2 = document.createElementNS(svgNS, 'line');
  line2.setAttribute('x1', '8'); line2.setAttribute('y1', '12');
  line2.setAttribute('x2', '16'); line2.setAttribute('y2', '12');
  btnSvg.appendChild(circle);
  btnSvg.appendChild(line1);
  btnSvg.appendChild(line2);
  addSiteBtn.appendChild(btnSvg);
  addSiteBtn.appendChild(document.createTextNode(' Parent? Add This Site'));
}

// Verify PIN and add site
async function verifyAndAddSite(pin) {
  try {
    const verifyResponse = await browser.runtime.sendMessage({ type: 'verifyPin', pin: pin });

    if (verifyResponse.valid) {
      quickAddError.classList.remove('show');

      // Add site to whitelist
      if (cleanDomain) {
        const addResponse = await browser.runtime.sendMessage({
          type: 'addToWhitelist',
          url: cleanDomain
        });

        if (addResponse && addResponse.error) {
          quickAddError.textContent = 'Failed to add site';
          quickAddError.classList.add('show');
          clearQuickPinInputs();
          return;
        }

        // Show success
        quickAddSuccess.classList.add('show');
        const inputs = quickAddSection.querySelectorAll('.quick-pin');
        inputs.forEach(input => input.disabled = true);

        // Redirect to the site (validate protocol)
        setTimeout(() => {
          if (decodedUrl && /^https?:\/\//i.test(decodedUrl)) {
            window.location.href = decodedUrl;
          }
        }, 1500);
      }
    } else {
      quickAddError.classList.add('show');
      clearQuickPinInputs();
      const firstInput = quickAddSection.querySelector('.quick-pin');
      if (firstInput) firstInput.focus();
    }
  } catch {
    quickAddError.textContent = 'Error verifying PIN';
    quickAddError.classList.add('show');
  }
}

function clearQuickPinInputs() {
  const inputs = quickAddSection.querySelectorAll('.quick-pin');
  inputs.forEach(input => {
    input.value = '';
    input.disabled = false;
  });
  quickAddError.classList.remove('show');
  quickAddSuccess.classList.remove('show');
}

// ---- Temporary Access functionality ----

const tempAccessBtn = document.getElementById('tempAccessBtn');
const tempAccessSection = document.getElementById('tempAccessSection');
const tempAccessError = document.getElementById('tempAccessError');
const tempAccessSuccess = document.getElementById('tempAccessSuccess');

// Toggle temp access section
tempAccessBtn.addEventListener('click', () => {
  // Close quick-add section if open
  if (quickAddSection.classList.contains('show')) {
    quickAddSection.classList.remove('show');
    rebuildAddSiteBtnContent();
    clearQuickPinInputs();
  }

  tempAccessSection.classList.toggle('show');
  if (tempAccessSection.classList.contains('show')) {
    const firstInput = tempAccessSection.querySelector('.quick-pin-temp');
    if (firstInput) firstInput.focus();
    tempAccessBtn.textContent = 'Cancel';
  } else {
    resetTempAccessBtn();
    clearTempPinInputs();
  }
});

function resetTempAccessBtn() {
  while (tempAccessBtn.firstChild) tempAccessBtn.removeChild(tempAccessBtn.firstChild);
  const svgNS = 'http://www.w3.org/2000/svg';
  const btnSvg = document.createElementNS(svgNS, 'svg');
  btnSvg.setAttribute('viewBox', '0 0 24 24');
  btnSvg.setAttribute('width', '18');
  btnSvg.setAttribute('height', '18');
  btnSvg.setAttribute('fill', 'none');
  btnSvg.setAttribute('stroke', 'currentColor');
  btnSvg.setAttribute('stroke-width', '2');
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  const polyline = document.createElementNS(svgNS, 'polyline');
  polyline.setAttribute('points', '12,6 12,12 16,14');
  btnSvg.appendChild(circle);
  btnSvg.appendChild(polyline);
  tempAccessBtn.appendChild(btnSvg);
  tempAccessBtn.appendChild(document.createTextNode(' Allow Temporarily'));
}

function getSelectedDuration() {
  const checked = document.querySelector('input[name="tempDuration"]:checked');
  return checked ? parseInt(checked.value, 10) : 30;
}

async function verifyAndGrantTempAccess(pin) {
  try {
    const duration = getSelectedDuration();
    const response = await browser.runtime.sendMessage({
      type: 'grantTemporaryAccess',
      pin: pin,
      domain: cleanDomain,
      duration: duration
    });

    if (response && response.success) {
      tempAccessError.classList.remove('show');
      tempAccessSuccess.classList.add('show');
      const inputs = tempAccessSection.querySelectorAll('.quick-pin-temp');
      inputs.forEach(input => input.disabled = true);

      // Redirect to the site (validate protocol)
      setTimeout(() => {
        if (decodedUrl && /^https?:\/\//i.test(decodedUrl)) {
          window.location.href = decodedUrl;
        }
      }, 1500);
    } else {
      tempAccessError.textContent = (response && response.error) || 'Incorrect PIN';
      tempAccessError.classList.add('show');
      clearTempPinInputs();
      const firstInput = tempAccessSection.querySelector('.quick-pin-temp');
      if (firstInput) firstInput.focus();
    }
  } catch {
    tempAccessError.textContent = 'Error granting temporary access';
    tempAccessError.classList.add('show');
  }
}

function clearTempPinInputs() {
  const inputs = tempAccessSection.querySelectorAll('.quick-pin-temp');
  inputs.forEach(input => {
    input.value = '';
    input.disabled = false;
  });
  tempAccessError.classList.remove('show');
  tempAccessSuccess.classList.remove('show');
}
