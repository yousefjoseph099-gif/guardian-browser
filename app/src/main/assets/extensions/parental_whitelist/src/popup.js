// Popup Script for Parental Whitelist Control

// Apply theme immediately on load
(async function() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getSettings' });
    const theme = response?.settings?.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Default to light if can't get settings
  }
})();

let currentSettings = null;
let confirmCallback = null;
let pinLength = 4; // Default, updated dynamically on load

// DOM Elements
const setupScreen = document.getElementById('setupScreen');
const pinScreen = document.getElementById('pinScreen');
const mainPanel = document.getElementById('mainPanel');
const pinError = document.getElementById('pinError');
const setupError = document.getElementById('setupError');
const lockoutMessage = document.getElementById('lockoutMessage');
const enableToggle = document.getElementById('enableToggle');
const newSiteInput = document.getElementById('newSite');
const whitelistContainer = document.getElementById('whitelist');
const siteCount = document.getElementById('siteCount');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if PIN is set
  const response = await browser.runtime.sendMessage({ type: 'isPinSet' });

  // Update pinLength from response
  if (response.pinLength) {
    pinLength = response.pinLength;
  }

  // Rebuild PIN digit inputs to match pinLength
  rebuildAllPinInputs();

  // Update setup subtitle to reflect PIN length
  const setupSubtitle = document.querySelector('.setup-subtitle');
  if (setupSubtitle) {
    setupSubtitle.textContent = `Create a ${pinLength}-digit PIN to protect settings`;
  }

  // Update PIN entry title
  const pinTitle = document.querySelector('.pin-title');
  if (pinTitle) {
    pinTitle.textContent = `Enter your ${pinLength}-digit PIN`;
  }

  if (!response.pinSet) {
    showSetupScreen();
  } else {
    showPinScreen();
    checkLockout();
  }

  setupEventListeners();
});

// Helper: create PIN digit inputs dynamically
function createPinDigits(container, count, className) {
  // Clear existing children
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  for (let i = 0; i < count; i++) {
    const input = document.createElement('input');
    input.type = 'password';
    input.maxLength = 1;
    input.className = `pin-digit ${className}`;
    input.setAttribute('data-index', i);
    input.setAttribute('inputmode', 'numeric');
    container.appendChild(input);
  }
}

// Rebuild all PIN input groups to match pinLength
function rebuildAllPinInputs() {
  // Setup digits
  const setupContainer = document.querySelector('#setupScreen .pin-input');
  if (setupContainer) {
    createPinDigits(setupContainer, pinLength, 'setup-digit');
  }

  // Confirm digits
  const confirmContainer = document.querySelector('.confirm-pin .pin-input');
  if (confirmContainer) {
    createPinDigits(confirmContainer, pinLength, 'confirm-digit');
  }

  // Entry digits
  const entryContainer = document.querySelector('#pinScreen .pin-input');
  if (entryContainer) {
    createPinDigits(entryContainer, pinLength, 'entry-digit');
  }

}

function showSetupScreen() {
  setupScreen.style.display = 'block';
  setupScreen.classList.add('show');
  pinScreen.style.display = 'none';
  mainPanel.style.display = 'none';
  const firstSetup = document.querySelector('.setup-digit[data-index="0"]');
  if (firstSetup) firstSetup.focus();
}

function showPinScreen() {
  setupScreen.style.display = 'none';
  pinScreen.style.display = 'block';
  mainPanel.style.display = 'none';
  const firstEntry = document.querySelector('.entry-digit[data-index="0"]');
  if (firstEntry) firstEntry.focus();
}

function showMainPanel() {
  setupScreen.style.display = 'none';
  pinScreen.style.display = 'none';
  mainPanel.style.display = 'block';
  loadSettings();
  loadStats();
}

async function checkLockout() {
  const response = await browser.runtime.sendMessage({ type: 'checkLockout' });
  if (response.lockedOut) {
    const remaining = Math.ceil((response.until - Date.now()) / 1000);
    lockoutMessage.textContent = `Too many failed attempts. Try again in ${remaining} seconds.`;
    lockoutMessage.style.display = 'block';

    // Disable PIN inputs
    document.querySelectorAll('.entry-digit').forEach(input => {
      input.disabled = true;
    });

    // Check again in 1 second
    setTimeout(checkLockout, 1000);
  } else {
    lockoutMessage.style.display = 'none';
    document.querySelectorAll('.entry-digit').forEach(input => {
      input.disabled = false;
    });
  }
}

function setupEventListeners() {
  // Setup PIN digit inputs
  setupPinInputs('.setup-digit', async () => {
    const pin = getPinValue('.setup-digit');
    const confirmPin = getPinValue('.confirm-digit');

    if (pin.length === pinLength && confirmPin.length === pinLength) {
      if (pin === confirmPin) {
        await browser.runtime.sendMessage({ type: 'setPin', pin: pin });
        showMainPanel();
      } else {
        setupError.classList.add('show');
        clearPinInputs('.confirm-digit');
        document.querySelector('.confirm-digit[data-index="0"]').focus();
      }
    }
  });

  setupPinInputs('.confirm-digit', async () => {
    const pin = getPinValue('.setup-digit');
    const confirmPin = getPinValue('.confirm-digit');

    if (pin.length === pinLength && confirmPin.length === pinLength) {
      if (pin === confirmPin) {
        setupError.classList.remove('show');
        await browser.runtime.sendMessage({ type: 'setPin', pin: pin });
        showMainPanel();
      } else {
        setupError.classList.add('show');
        clearPinInputs('.confirm-digit');
        document.querySelector('.confirm-digit[data-index="0"]').focus();
      }
    }
  });

  // Entry PIN digit inputs
  setupPinInputs('.entry-digit', async () => {
    const pin = getPinValue('.entry-digit');
    if (pin.length === pinLength) {
      const response = await browser.runtime.sendMessage({ type: 'verifyPin', pin: pin });
      if (response.valid) {
        pinError.classList.remove('show');
        showMainPanel();
      } else {
        pinError.classList.add('show');
        clearPinInputs('.entry-digit');
        document.querySelector('.entry-digit[data-index="0"]').focus();

        if (response.lockoutUntil) {
          checkLockout();
        }
      }
    }
  });

  // Setup button
  document.getElementById('setupBtn').addEventListener('click', async () => {
    const pin = getPinValue('.setup-digit');
    const confirmPin = getPinValue('.confirm-digit');

    if (pin.length !== pinLength) {
      setupError.textContent = `Please enter a ${pinLength}-digit PIN`;
      setupError.classList.add('show');
      return;
    }

    if (confirmPin.length !== pinLength) {
      setupError.textContent = 'Please confirm your PIN';
      setupError.classList.add('show');
      return;
    }

    if (pin !== confirmPin) {
      setupError.textContent = 'PINs do not match';
      setupError.classList.add('show');
      clearPinInputs('.confirm-digit');
      document.querySelector('.confirm-digit[data-index="0"]').focus();
      return;
    }

    await browser.runtime.sendMessage({ type: 'setPin', pin: pin });
    showMainPanel();
  });

  // Enable/Disable toggle
  enableToggle.addEventListener('change', async (e) => {
    if (!e.target.checked) {
      // Show confirmation when disabling
      showConfirm(
        'Disable Protection?',
        'This will allow access to ALL websites. Are you sure?',
        async () => {
          await browser.runtime.sendMessage({
            type: 'toggleEnabled',
            enabled: false
          });
          showToast('Protection disabled', 'error');
        }
      );
      // Revert checkbox until confirmed
      e.target.checked = true;
      const onOk = () => {
        enableToggle.checked = false;
        document.getElementById('confirmCancel').removeEventListener('click', onCancel);
      };
      const onCancel = () => {
        enableToggle.checked = true;
        document.getElementById('confirmOk').removeEventListener('click', onOk);
      };
      document.getElementById('confirmOk').addEventListener('click', onOk, { once: true });
      document.getElementById('confirmCancel').addEventListener('click', onCancel, { once: true });
    } else {
      await browser.runtime.sendMessage({
        type: 'toggleEnabled',
        enabled: true
      });
      showToast('Protection enabled', 'success');
    }
  });

  // Add site button
  document.getElementById('addSiteBtn').addEventListener('click', addSite);
  newSiteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSite();
  });

  // Change PIN button
  document.getElementById('changePinBtn').addEventListener('click', () => {
    clearPinInputs('.setup-digit');
    clearPinInputs('.confirm-digit');
    showSetupScreen();
  });

  // Lock button
  document.getElementById('lockBtn').addEventListener('click', () => {
    clearPinInputs('.entry-digit');
    showPinScreen();
  });

  // Settings button - opens full options page
  document.getElementById('settingsBtn').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

}

function setupPinInputs(selector, onComplete) {
  const inputs = document.querySelectorAll(selector);

  inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      // Only allow digits
      e.target.value = e.target.value.replace(/[^0-9]/g, '');

      if (e.target.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      onComplete();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
        inputs[index - 1].focus();
      }
    });

    // Handle paste
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const paste = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, inputs.length);
      paste.split('').forEach((char, i) => {
        if (inputs[i]) {
          inputs[i].value = char;
        }
      });
      if (paste.length > 0) {
        inputs[Math.min(paste.length, inputs.length - 1)].focus();
      }
      onComplete();
    });
  });
}

function getPinValue(selector) {
  return Array.from(document.querySelectorAll(selector))
    .map(input => input.value)
    .join('');
}

function clearPinInputs(selector) {
  document.querySelectorAll(selector).forEach(input => {
    input.value = '';
  });
}

async function loadSettings() {
  const response = await browser.runtime.sendMessage({ type: 'getSettings' });
  currentSettings = response.settings;

  enableToggle.checked = currentSettings.enabled;
  renderWhitelist();
}

function renderWhitelist() {
  // Clear existing content
  while (whitelistContainer.firstChild) {
    whitelistContainer.removeChild(whitelistContainer.firstChild);
  }

  if (!currentSettings || currentSettings.whitelist.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-list';
    emptyDiv.textContent = 'No websites added yet';
    whitelistContainer.appendChild(emptyDiv);
    siteCount.textContent = '(0)';
    return;
  }

  siteCount.textContent = `(${currentSettings.whitelist.length})`;

  [...currentSettings.whitelist].sort().forEach(url => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'whitelist-item';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'whitelist-url';
    urlSpan.textContent = url;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      showConfirm(
        'Remove Site',
        `Remove "${url}" from allowed websites?`,
        async () => {
          const response = await browser.runtime.sendMessage({
            type: 'removeFromWhitelist',
            url: url
          });
          currentSettings.whitelist = response.whitelist;
          renderWhitelist();
          showToast('Site removed', 'success');
        }
      );
    });

    itemDiv.appendChild(urlSpan);
    itemDiv.appendChild(removeBtn);
    whitelistContainer.appendChild(itemDiv);
  });
}

async function addSite() {
  let url = newSiteInput.value.trim();

  if (!url) return;

  // Clean up the URL
  url = url.replace(/^https?:\/\//, '').replace(/^www\./, '');

  const response = await browser.runtime.sendMessage({
    type: 'addToWhitelist',
    url: url
  });

  currentSettings.whitelist = response.whitelist;
  renderWhitelist();
  newSiteInput.value = '';
  showToast('Site added!', 'success');
}

// Format time remaining as "Xhr Ymin" or "Ymin"
function formatTimeRemaining(minutes) {
  if (minutes <= 0) return '0min';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs > 0 && mins > 0) return `${hrs}hr ${mins}min`;
  if (hrs > 0) return `${hrs}hr`;
  return `${mins}min`;
}

// Load and display stats
async function loadStats() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getStats' });

    // Update stats display in header
    const statsDisplay = document.getElementById('statsDisplay');
    const todayBlocked = document.getElementById('todayBlocked');

    if (response.todayBlocked > 0) {
      todayBlocked.textContent = response.todayBlocked;
      statsDisplay.style.display = 'inline-block';
    } else {
      statsDisplay.style.display = 'none';
    }

    // Render activity log
    renderActivityLog(response.activityLog || []);
  } catch {
    // Stats unavailable
  }

  // Load time remaining
  loadTimeRemaining();
}

// Load and display time remaining for daily time limit
async function loadTimeRemaining() {
  try {
    const response = await browser.runtime.sendMessage({ type: 'getTimeRemaining' });
    const display = document.getElementById('timeRemainingDisplay');
    const span = document.getElementById('timeRemaining');

    if (response && response.limitActive && typeof response.minutesRemaining === 'number') {
      span.textContent = formatTimeRemaining(response.minutesRemaining);
      display.style.display = 'inline-block';
    } else {
      display.style.display = 'none';
    }
  } catch {
    // Time remaining unavailable
    document.getElementById('timeRemainingDisplay').style.display = 'none';
  }
}

// Render activity log
function renderActivityLog(activityLog) {
  const container = document.getElementById('activityList');
  const countSpan = document.getElementById('activityCount');

  // Clear existing content
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (!activityLog || activityLog.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'activity-empty';
    emptyDiv.textContent = 'No blocked attempts yet';
    container.appendChild(emptyDiv);
    countSpan.textContent = '';
    return;
  }

  countSpan.textContent = `(${activityLog.length})`;

  activityLog.forEach(entry => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'activity-item';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'activity-url';
    urlSpan.textContent = entry.url;
    urlSpan.title = entry.fullUrl;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'activity-time';
    timeSpan.textContent = formatTimeAgo(entry.timestamp);

    itemDiv.appendChild(urlSpan);
    itemDiv.appendChild(timeSpan);
    container.appendChild(itemDiv);
  });
}

// Format timestamp as "X min ago"
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// Toggle activity log visibility
document.getElementById('activityHeader').addEventListener('click', () => {
  const header = document.getElementById('activityHeader');
  const list = document.getElementById('activityList');

  header.classList.toggle('expanded');
  list.classList.toggle('show');
});

// Toggle whitelist visibility
document.getElementById('whitelistHeader').addEventListener('click', () => {
  const header = document.getElementById('whitelistHeader');
  const list = document.getElementById('whitelist');

  header.classList.toggle('expanded');
  if (header.classList.contains('expanded')) {
    list.style.display = 'block';
  } else {
    list.style.display = 'none';
  }
});

// Toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// Confirmation dialog
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmOverlay').classList.add('show');
  confirmCallback = callback;
}

document.getElementById('confirmCancel').addEventListener('click', () => {
  document.getElementById('confirmOverlay').classList.remove('show');
  confirmCallback = null;
});

document.getElementById('confirmOk').addEventListener('click', () => {
  document.getElementById('confirmOverlay').classList.remove('show');
  if (confirmCallback) {
    confirmCallback();
    confirmCallback = null;
  }
});
