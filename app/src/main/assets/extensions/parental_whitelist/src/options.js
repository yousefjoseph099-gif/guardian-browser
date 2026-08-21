// Options Page Script

let currentSettings = null;
let confirmCallback = null;
let dashboardRefreshInterval = null;
let timeLimitRefreshInterval = null;

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

// DOM Elements
const pinOverlay = document.getElementById('pinOverlay');
const appContainer = document.getElementById('appContainer');
const pinError = document.getElementById('pinError');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toastText');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const response = await browser.runtime.sendMessage({ type: 'isPinSet' });

  if (!response?.pinSet) {
    showToast('Please set up your PIN first by clicking the extension icon.', 'error');
    setTimeout(() => window.close(), 2000);
    return;
  }

  // Build PIN digits dynamically based on pinLength
  await createPinDigits();
  setupPinInputs();
  setupNavigation();
  setupEventListeners();
  setupForgotPin();
  setupConfirmDialog();

  populateTimeLimitSelector();
  document.querySelector('.pin-digit[data-index="0"]').focus();
});

// Create PIN digit inputs dynamically
async function createPinDigits() {
  let pinLength = 4;
  try {
    const resp = await browser.runtime.sendMessage({ type: 'getSettings' });
    pinLength = resp?.settings?.pinLength || 4;
  } catch {
    // default 4
  }

  const container = document.getElementById('pinInputContainer');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  for (let i = 0; i < pinLength; i++) {
    const input = document.createElement('input');
    input.type = 'password';
    input.maxLength = 1;
    input.className = 'pin-digit';
    input.dataset.index = i;
    input.inputMode = 'numeric';
    container.appendChild(input);
  }
}

// Forgot PIN Modal
function setupForgotPin() {
  const forgotBtn = document.getElementById('forgotPinBtn');
  const modal = document.getElementById('forgotPinModal');
  const closeBtn = document.getElementById('closeModalBtn');
  const resetBtn = document.getElementById('resetAllBtn');

  forgotBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  closeBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });

  resetBtn.addEventListener('click', () => {
    // Show confirm modal with text input for "RESET" confirmation
    const confirmInput = document.getElementById('confirmInput');
    confirmInput.style.display = 'block';
    confirmInput.value = '';
    confirmInput.placeholder = 'Type RESET to confirm';
    showConfirm('Reset All Settings', 'This will delete your PIN, whitelist, and all settings. Type RESET below to confirm.', async () => {
      if (confirmInput.value.trim() !== 'RESET') {
        showToast('Type RESET to confirm', 'error');
        return;
      }
      confirmInput.style.display = 'none';
      await browser.runtime.sendMessage({ type: 'resetAll' });
      showToast('Settings reset. The extension will now reload.');
      setTimeout(() => window.close(), 1500);
    });
  });
}

// PIN Input Handling
function setupPinInputs() {
  const inputs = document.querySelectorAll('.pin-digit');
  const pinLength = inputs.length;

  inputs.forEach((input, index) => {
    input.addEventListener('input', async (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');

      if (e.target.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }

      const pin = Array.from(inputs).map(i => i.value).join('');
      if (pin.length === pinLength) {
        await verifyPin(pin);
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
      if (paste.length === pinLength) verifyPin(paste);
    });
  });
}

async function verifyPin(pin) {
  try {
    const response = await browser.runtime.sendMessage({ type: 'verifyPin', pin: pin });

    if (response?.valid) {
      pinError.classList.remove('show');
      await showApp();
    } else {
      pinError.classList.add('show');
      clearPinInputs();
      document.querySelector('.pin-digit[data-index="0"]').focus();
    }
  } catch {
    pinError.classList.add('show');
    clearPinInputs();
  }
}

function clearPinInputs() {
  document.querySelectorAll('.pin-digit').forEach(input => input.value = '');
}

// Show main application
async function showApp() {
  pinOverlay.style.display = 'none';
  appContainer.classList.add('active');

  // Load settings
  const response = await browser.runtime.sendMessage({ type: 'getSettings' });
  currentSettings = response?.settings;
  if (!currentSettings) return;

  // Populate UI
  renderWhitelist();
  updateProtectionStatus();

  document.getElementById('enableProtection').checked = currentSettings.enabled !== false;
  document.getElementById('blockAddons').checked = currentSettings.blockAddonsPage === true;

  // Set session timeout
  const timeoutSelect = document.getElementById('sessionTimeout');
  if (timeoutSelect) {
    timeoutSelect.value = currentSettings.sessionTimeout || 5;
  }

  // Set lockout settings
  const maxAttemptsSelect = document.getElementById('maxLockoutAttempts');
  if (maxAttemptsSelect) {
    maxAttemptsSelect.value = currentSettings.maxLockoutAttempts || 5;
  }
  const lockoutDurationSelect = document.getElementById('lockoutDuration');
  if (lockoutDurationSelect) {
    lockoutDurationSelect.value = currentSettings.lockoutDurationMinutes || 5;
  }

  // Apply theme
  const theme = currentSettings.theme || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButtons(theme);

  // Populate Safe Search toggle
  const safeSearchToggle = document.getElementById('safeSearchToggle');
  if (safeSearchToggle) {
    safeSearchToggle.checked = currentSettings.safeSearchEnabled === true;
  }

  // Populate PIN length radio
  const pinLength = currentSettings.pinLength || 4;
  const pinLengthRadio = document.querySelector(`#pinLengthSelect input[value="${pinLength}"]`);
  if (pinLengthRadio) {
    pinLengthRadio.checked = true;
  }
  // Update new PIN input placeholder and maxlength
  const newPinInput = document.getElementById('newPin');
  if (newPinInput) {
    newPinInput.maxLength = pinLength;
    newPinInput.placeholder = `Enter new ${pinLength}-digit PIN`;
  }

  // Render dashboard (default active panel)
  renderDashboard();
  startDashboardRefresh();
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

// Navigation
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const panelId = item.dataset.panel;

      // Update nav
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Update panels
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(panelId + 'Panel').classList.add('active');

      // Stop auto-refresh intervals when leaving panels
      if (dashboardRefreshInterval) {
        clearInterval(dashboardRefreshInterval);
        dashboardRefreshInterval = null;
      }
      if (timeLimitRefreshInterval) {
        clearInterval(timeLimitRefreshInterval);
        timeLimitRefreshInterval = null;
      }

      // Render panel-specific content
      if (panelId === 'dashboard') {
        renderDashboard();
        startDashboardRefresh();
      } else if (panelId === 'timelimits') {
        renderTimeLimit();
        startTimeLimitRefresh();
      }
    });
  });

  // Help sub-tabs (only tabs with data-help attribute)
  const helpTabs = document.querySelectorAll('.help-tab[data-help]');
  const helpContents = document.querySelectorAll('.help-content');

  helpTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const helpId = tab.dataset.help;
      helpTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      helpContents.forEach(c => c.classList.remove('active'));
      const targetContent = document.getElementById(helpId + 'Help');
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // Copy policy button
  const copyBtn = document.getElementById('copyPolicyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = document.getElementById('policyCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        showToast('Copied to clipboard');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    });
  }

  // Theme switcher
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      updateThemeButtons(theme);
      currentSettings.theme = theme;
      await browser.runtime.sendMessage({ type: 'setTheme', theme: theme });
      showToast(`${theme.charAt(0).toUpperCase() + theme.slice(1)} theme applied`);
    });
  });
}

// ========== Dashboard ==========

async function renderDashboard() {
  // Get weekly summary
  try {
    const summaryResp = await browser.runtime.sendMessage({ type: 'getWeeklySummary' });
    const summary = summaryResp || {};

    // Summary cards
    document.getElementById('weeklyBlockedCount').textContent = summary.weeklyBlocked || 0;
    document.getElementById('totalBlockedCount').textContent = summary.totalBlocked || 0;

    // Format browsing time
    const todayMinutes = summary.todayBrowsingMinutes || 0;
    if (todayMinutes >= 60) {
      const hrs = Math.floor(todayMinutes / 60);
      const mins = todayMinutes % 60;
      document.getElementById('todayBrowsingTime').textContent = `${hrs}h ${mins}m`;
    } else {
      document.getElementById('todayBrowsingTime').textContent = `${todayMinutes}m`;
    }

    // Top blocked sites
    renderBarChart('topBlockedList', summary.topBlocked || [], true);

    // Top allowed sites
    renderBarChart('topAllowedList', summary.topAllowed || [], false);
  } catch {
    // Leave defaults
  }

  // Failed PIN attempts
  try {
    const pinLogResp = await browser.runtime.sendMessage({ type: 'getFailedPinLog' });
    const failedAttempts = pinLogResp?.log || [];
    renderFailedAttempts(failedAttempts);

    // Update summary card count
    const failedPinCount = document.getElementById('failedPinCount');
    if (failedPinCount) {
      failedPinCount.textContent = failedAttempts.length;
      failedPinCount.style.color = failedAttempts.length > 0 ? 'var(--danger)' : 'var(--text-primary)';
    }
  } catch {
    // Leave defaults
  }

  // Active temporary access
  try {
    const settingsResp = await browser.runtime.sendMessage({ type: 'getSettings' });
    const tempAccess = settingsResp?.settings?.temporaryAccess || {};
    renderTempAccess(tempAccess);
  } catch {
    // Leave defaults
  }
}

function startDashboardRefresh() {
  if (dashboardRefreshInterval) clearInterval(dashboardRefreshInterval);
  dashboardRefreshInterval = setInterval(() => {
    renderDashboard();
  }, 30000); // Refresh every 30 seconds
}

function renderBarChart(containerId, items, isDanger) {
  const container = document.getElementById(containerId);
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = isDanger ? 'No blocked sites data yet' : 'No allowed sites data yet';
    container.appendChild(empty);
    return;
  }

  const top5 = items.slice(0, 5);
  const maxCount = top5[0]?.count || 1;

  top5.forEach(item => {
    const row = document.createElement('div');
    row.className = 'bar-chart-item';

    const label = document.createElement('span');
    label.className = 'bar-chart-label';
    label.textContent = item.domain;
    label.title = item.domain;

    const barOuter = document.createElement('div');
    barOuter.className = 'bar-chart-bar';

    const barFill = document.createElement('div');
    barFill.className = 'bar-chart-fill' + (isDanger ? ' danger' : '');
    barFill.style.width = Math.max((item.count / maxCount) * 100, 2) + '%';

    barOuter.appendChild(barFill);

    const count = document.createElement('span');
    count.className = 'bar-chart-count';
    count.textContent = item.count;

    row.appendChild(label);
    row.appendChild(barOuter);
    row.appendChild(count);
    container.appendChild(row);
  });
}

function renderFailedAttempts(attempts) {
  const banner = document.getElementById('tamperAlertBanner');
  const list = document.getElementById('failedAttemptsList');

  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }

  if (!attempts || attempts.length === 0) {
    banner.style.display = 'none';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No security alerts';
    list.appendChild(empty);
    return;
  }

  banner.style.display = 'block';

  attempts.slice(0, 10).forEach(attempt => {
    const item = document.createElement('div');
    item.className = 'alert-item';

    const badge = document.createElement('div');
    badge.className = 'alert-badge';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z');
    const line1 = document.createElementNS(svgNS, 'line');
    line1.setAttribute('x1', '12'); line1.setAttribute('y1', '9');
    line1.setAttribute('x2', '12'); line1.setAttribute('y2', '13');
    const line2 = document.createElementNS(svgNS, 'line');
    line2.setAttribute('x1', '12'); line2.setAttribute('y1', '17');
    line2.setAttribute('x2', '12.01'); line2.setAttribute('y2', '17');
    svg.appendChild(path); svg.appendChild(line1); svg.appendChild(line2);
    badge.appendChild(svg);

    const info = document.createElement('div');
    info.className = 'alert-info';

    const time = document.createElement('div');
    time.className = 'alert-time';
    time.textContent = attempt.timestamp ? new Date(attempt.timestamp).toLocaleString() : 'Unknown time';

    const source = document.createElement('div');
    source.className = 'alert-source';
    source.textContent = attempt.source || 'Failed PIN attempt';

    info.appendChild(time);
    info.appendChild(source);
    item.appendChild(badge);
    item.appendChild(info);
    list.appendChild(item);
  });
}

function renderTempAccess(tempAccess) {
  const list = document.getElementById('activeTempList');
  while (list.firstChild) {
    list.removeChild(list.firstChild);
  }

  const now = Date.now();
  const activeEntries = [];

  for (const [domain, expiry] of Object.entries(tempAccess)) {
    const expiryTime = typeof expiry === 'number' ? expiry : new Date(expiry).getTime();
    if (expiryTime > now) {
      activeEntries.push({ domain, expiry: expiryTime });
    }
  }

  if (activeEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No active temporary access';
    list.appendChild(empty);
    return;
  }

  activeEntries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'temp-item';

    const domain = document.createElement('span');
    domain.className = 'temp-domain';
    domain.textContent = entry.domain;

    const countdown = document.createElement('span');
    countdown.className = 'temp-countdown';
    const remaining = Math.max(0, Math.ceil((entry.expiry - now) / 60000));
    countdown.textContent = remaining + ' min remaining';

    item.appendChild(domain);
    item.appendChild(countdown);
    list.appendChild(item);
  });
}

// ========== Time Limits ==========

function populateTimeLimitSelector() {
  const select = document.getElementById('timeLimitValue');
  if (!select) return;

  // 30 min to 8 hrs in 15-min increments
  for (let mins = 30; mins <= 480; mins += 15) {
    const opt = document.createElement('option');
    opt.value = mins;
    if (mins < 60) {
      opt.textContent = mins + ' minutes';
    } else {
      const hrs = Math.floor(mins / 60);
      const rem = mins % 60;
      opt.textContent = hrs + ' hr' + (hrs > 1 ? 's' : '') + (rem > 0 ? ' ' + rem + ' min' : '');
    }
    select.appendChild(opt);
  }

  // Default to 2 hours
  select.value = 120;
}

function renderTimeLimit() {
  if (!currentSettings) return;
  const timeLimit = currentSettings.dailyTimeLimit || {};

  document.getElementById('enableTimeLimit').checked = timeLimit.enabled === true;

  const limitMinutes = timeLimit.limitMinutes || 120;
  const timeLimitSelect = document.getElementById('timeLimitValue');
  if (timeLimitSelect) {
    timeLimitSelect.value = limitMinutes;
  }

  const usedMinutes = timeLimit.usedMinutes || 0;
  updateTimeLimitDisplay(usedMinutes, limitMinutes);
}

function updateTimeLimitDisplay(usedMinutes, limitMinutes) {
  const usedHrs = Math.floor(usedMinutes / 60);
  const usedMins = usedMinutes % 60;
  const limitHrs = Math.floor(limitMinutes / 60);
  const limitMins = limitMinutes % 60;

  const usedStr = usedHrs > 0 ? `${usedHrs} hr ${usedMins} min` : `${usedMins} min`;
  const limitStr = limitHrs > 0 ? `${limitHrs} hr` + (limitMins > 0 ? ` ${limitMins} min` : '') : `${limitMins} min`;

  const currentUsage = document.getElementById('currentUsage');
  if (currentUsage) {
    while (currentUsage.firstChild) currentUsage.removeChild(currentUsage.firstChild);
    currentUsage.appendChild(document.createTextNode('Used today: '));
    const usedBold = document.createElement('strong');
    usedBold.textContent = usedStr;
    currentUsage.appendChild(usedBold);
    currentUsage.appendChild(document.createTextNode(' of '));
    const limitBold = document.createElement('strong');
    limitBold.textContent = limitStr;
    currentUsage.appendChild(limitBold);
    currentUsage.appendChild(document.createTextNode(' limit'));
  }

  const percent = limitMinutes > 0 ? Math.min((usedMinutes / limitMinutes) * 100, 100) : 0;

  const fill = document.getElementById('usageProgressFill');
  if (fill) {
    fill.style.width = percent + '%';
    fill.className = 'progress-fill';
    if (percent >= 90) {
      fill.classList.add('danger');
    } else if (percent >= 70) {
      fill.classList.add('warning');
    }
  }

  const label = document.getElementById('usageProgressLabel');
  if (label) {
    label.textContent = Math.round(percent) + '% used';
  }
}

function startTimeLimitRefresh() {
  if (timeLimitRefreshInterval) clearInterval(timeLimitRefreshInterval);
  timeLimitRefreshInterval = setInterval(async () => {
    try {
      const response = await browser.runtime.sendMessage({ type: 'getDailyTimeLimit' });
      if (response && response.dailyTimeLimit) {
        currentSettings.dailyTimeLimit = response.dailyTimeLimit;
        const usedMinutes = response.dailyTimeLimit.usedMinutes || 0;
        const limitMinutes = response.dailyTimeLimit.limitMinutes || 120;
        updateTimeLimitDisplay(usedMinutes, limitMinutes);
      }
    } catch {}
  }, 15000); // refresh every 15 seconds
}

// Whitelist Management
function renderWhitelist() {
  const container = document.getElementById('whitelistContainer');
  const whitelist = currentSettings.whitelist || [];

  // Update count
  document.getElementById('siteCount').textContent = `${whitelist.length} site${whitelist.length !== 1 ? 's' : ''}`;

  // Clear container safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (whitelist.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'whitelist-empty';
    emptyDiv.textContent = 'No websites added yet';
    container.appendChild(emptyDiv);
    return;
  }

  // Sort alphabetically
  const sorted = [...whitelist].sort((a, b) => a.localeCompare(b));

  sorted.forEach(site => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'whitelist-item';

    const span = document.createElement('span');
    span.textContent = site;

    const btn = document.createElement('button');
    btn.className = 'btn btn-danger btn-sm';
    btn.textContent = 'Remove';
    btn.addEventListener('click', () => removeSite(site));

    itemDiv.appendChild(span);
    itemDiv.appendChild(btn);
    container.appendChild(itemDiv);
  });
}

async function addSite(site) {
  site = site.trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!site) return;

  if (!currentSettings.whitelist.includes(site)) {
    currentSettings.whitelist.push(site);
    await browser.runtime.sendMessage({
      type: 'updateWhitelist',
      whitelist: currentSettings.whitelist
    });
    renderWhitelist();
    showToast('Site added to whitelist');
  } else {
    showToast('Site already in whitelist', 'error');
  }
}

function removeSite(site) {
  showConfirm(
    'Remove Site',
    `Remove "${site}" from allowed websites?`,
    async () => {
      currentSettings.whitelist = currentSettings.whitelist.filter(s => s !== site);
      await browser.runtime.sendMessage({
        type: 'updateWhitelist',
        whitelist: currentSettings.whitelist
      });
      renderWhitelist();
      showToast('Site removed');
    }
  );
}

// Protection Status
function updateProtectionStatus() {
  const status = document.getElementById('protectionStatus');
  const isEnabled = currentSettings.enabled !== false;

  if (isEnabled) {
    status.classList.add('active');
    status.classList.remove('inactive');
    status.querySelector('.status-text').textContent = 'Protection Active';
  } else {
    status.classList.remove('active');
    status.classList.add('inactive');
    status.querySelector('.status-text').textContent = 'Protection Disabled';
  }
}

// Toast Notifications
function showToast(message, type = 'success') {
  toastText.textContent = message;
  toast.className = 'toast show ' + type;

  // Update icon
  const icon = toast.querySelector('.toast-icon');
  icon.className = 'toast-icon ' + type;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Confirmation Dialog
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmModal').classList.add('show');
  confirmCallback = callback;
}

function setupConfirmDialog() {
  const modal = document.getElementById('confirmModal');
  const closeBtn = document.getElementById('closeConfirmBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');
  const okBtn = document.getElementById('confirmOkBtn');

  if (!modal) return;

  function hideConfirmModal() {
    modal.classList.remove('show');
    confirmCallback = null;
    const input = document.getElementById('confirmInput');
    if (input) input.style.display = 'none';
  }

  closeBtn.addEventListener('click', hideConfirmModal);
  cancelBtn.addEventListener('click', hideConfirmModal);

  okBtn.addEventListener('click', () => {
    const cb = confirmCallback;
    hideConfirmModal();
    if (cb) cb();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) hideConfirmModal();
  });
}

// Event Listeners
function setupEventListeners() {
  // Add site
  document.getElementById('addSiteBtn').addEventListener('click', () => {
    const input = document.getElementById('newSiteInput');
    addSite(input.value);
    input.value = '';
    input.focus();
  });

  document.getElementById('newSiteInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addSite(e.target.value);
      e.target.value = '';
    }
  });

  // Lock button
  document.getElementById('lockBtn').addEventListener('click', () => {
    appContainer.classList.remove('active');
    pinOverlay.style.display = 'flex';
    clearPinInputs();
    document.querySelector('.pin-digit[data-index="0"]').focus();

    // Reset to dashboard panel
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('.nav-item[data-panel="dashboard"]').classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('dashboardPanel').classList.add('active');
  });

  // Protection toggle
  document.getElementById('enableProtection').addEventListener('change', async (e) => {
    if (!e.target.checked) {
      // Show confirmation when disabling
      e.target.checked = true; // Revert until confirmed
      showConfirm(
        'Disable Protection?',
        'This will allow access to ALL websites. Are you sure you want to disable protection?',
        async () => {
          document.getElementById('enableProtection').checked = false;
          currentSettings.enabled = false;
          await browser.runtime.sendMessage({
            type: 'toggleEnabled',
            enabled: false
          });
          updateProtectionStatus();
          showToast('Protection disabled', 'error');
        }
      );
    } else {
      currentSettings.enabled = true;
      await browser.runtime.sendMessage({
        type: 'toggleEnabled',
        enabled: true
      });
      updateProtectionStatus();
      showToast('Protection enabled');
    }
  });

  // Block addons toggle
  document.getElementById('blockAddons').addEventListener('change', async (e) => {
    currentSettings.blockAddonsPage = e.target.checked;
    await browser.runtime.sendMessage({
      type: 'updateBlockAddons',
      blockAddonsPage: e.target.checked
    });
    showToast('Settings updated');
  });

  // Safe Search toggle
  document.getElementById('safeSearchToggle').addEventListener('change', async (e) => {
    currentSettings.safeSearchEnabled = e.target.checked;
    await browser.runtime.sendMessage({
      type: 'updateSafeSearch',
      enabled: e.target.checked
    });
    showToast(e.target.checked ? 'Safe search enabled' : 'Safe search disabled');
  });

  // Lockout settings
  document.getElementById('maxLockoutAttempts').addEventListener('change', async (e) => {
    const maxAttempts = parseInt(e.target.value, 10);
    currentSettings.maxLockoutAttempts = maxAttempts;
    await browser.runtime.sendMessage({
      type: 'updateLockoutSettings',
      maxAttempts: maxAttempts,
      duration: currentSettings.lockoutDurationMinutes || 5
    });
    showToast('Lockout settings updated');
  });

  document.getElementById('lockoutDuration').addEventListener('change', async (e) => {
    const duration = parseInt(e.target.value, 10);
    currentSettings.lockoutDurationMinutes = duration;
    await browser.runtime.sendMessage({
      type: 'updateLockoutSettings',
      maxAttempts: currentSettings.maxLockoutAttempts || 5,
      duration: duration
    });
    showToast('Lockout settings updated');
  });

  // Failed PIN card click - scroll to Security Alerts
  const failedPinCard = document.getElementById('failedPinCard');
  if (failedPinCard) {
    failedPinCard.addEventListener('click', () => {
      const alertsSection = document.getElementById('tamperAlertBanner')?.parentElement;
      if (alertsSection) {
        alertsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  // Change PIN
  document.getElementById('changePinBtn').addEventListener('click', async () => {
    const newPin = document.getElementById('newPin').value;
    const pinLength = currentSettings.pinLength || 4;
    const pinRegex = new RegExp(`^\\d{${pinLength}}$`);

    if (!pinRegex.test(newPin)) {
      showToast(`PIN must be ${pinLength} digits`, 'error');
      return;
    }

    await browser.runtime.sendMessage({
      type: 'setPin',
      pin: newPin
    });
    document.getElementById('newPin').value = '';
    showToast('PIN updated successfully');
  });

  // PIN Length radio buttons
  const pinLengthRadios = document.querySelectorAll('#pinLengthSelect input[type="radio"]');
  pinLengthRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const newLength = parseInt(e.target.value, 10);
      showConfirm(
        'Change PIN Length',
        `Changing to ${newLength}-digit PIN requires setting a new PIN. Continue?`,
        async () => {
          currentSettings.pinLength = newLength;
          await browser.runtime.sendMessage({
            type: 'updatePinLength',
            pinLength: newLength
          });
          // Update new PIN input
          const newPinInput = document.getElementById('newPin');
          newPinInput.maxLength = newLength;
          newPinInput.placeholder = `Enter new ${newLength}-digit PIN`;
          newPinInput.value = '';
          showToast(`PIN length changed to ${newLength} digits. Set a new PIN now.`);
        }
      );
    });
  });

  // Dashboard: Clear alerts
  document.getElementById('clearAlertsBtn').addEventListener('click', async () => {
    try {
      await browser.runtime.sendMessage({ type: 'clearFailedPinLog' });
      renderFailedAttempts([]);
      showToast('Security alerts cleared');
    } catch {
      showToast('Failed to clear alerts', 'error');
    }
  });

  // Time Limits: enable toggle
  document.getElementById('enableTimeLimit').addEventListener('change', async (e) => {
    if (!currentSettings.dailyTimeLimit) {
      currentSettings.dailyTimeLimit = {};
    }
    currentSettings.dailyTimeLimit.enabled = e.target.checked;
    const limitMinutes = parseInt(document.getElementById('timeLimitValue').value, 10) || 120;
    currentSettings.dailyTimeLimit.limitMinutes = limitMinutes;
    try {
      await browser.runtime.sendMessage({
        type: 'updateDailyTimeLimit',
        dailyTimeLimit: {
          enabled: e.target.checked,
          limitMinutes: limitMinutes,
          usedMinutes: currentSettings.dailyTimeLimit.usedMinutes || 0,
          lastResetDate: currentSettings.dailyTimeLimit.lastResetDate || null
        }
      });
      showToast(e.target.checked ? 'Time limit enabled' : 'Time limit disabled');
    } catch {
      showToast('Failed to update time limit', 'error');
    }
  });

  // Time Limits: value change
  document.getElementById('timeLimitValue').addEventListener('change', async (e) => {
    const limitMinutes = parseInt(e.target.value, 10);
    if (!currentSettings.dailyTimeLimit) {
      currentSettings.dailyTimeLimit = {};
    }
    currentSettings.dailyTimeLimit.limitMinutes = limitMinutes;
    const usedMinutes = currentSettings.dailyTimeLimit.usedMinutes || 0;
    updateTimeLimitDisplay(usedMinutes, limitMinutes);
    try {
      await browser.runtime.sendMessage({
        type: 'updateDailyTimeLimit',
        dailyTimeLimit: {
          enabled: currentSettings.dailyTimeLimit.enabled === true,
          limitMinutes: limitMinutes,
          usedMinutes: currentSettings.dailyTimeLimit.usedMinutes || 0,
          lastResetDate: currentSettings.dailyTimeLimit.lastResetDate || null
        }
      });
      showToast('Time limit updated');
    } catch {
      showToast('Failed to update time limit', 'error');
    }
  });

  // Time Limits: reset usage
  document.getElementById('resetUsageBtn').addEventListener('click', async () => {
    showConfirm(
      'Reset Usage',
      'Reset today\'s browsing time to zero?',
      async () => {
        if (!currentSettings.dailyTimeLimit) {
          currentSettings.dailyTimeLimit = {};
        }
        currentSettings.dailyTimeLimit.usedMinutes = 0;
        const limitMinutes = currentSettings.dailyTimeLimit.limitMinutes || 120;
        updateTimeLimitDisplay(0, limitMinutes);
        try {
          await browser.runtime.sendMessage({
            type: 'updateDailyTimeLimit',
            dailyTimeLimit: {
              enabled: currentSettings.dailyTimeLimit.enabled === true,
              limitMinutes: limitMinutes,
              usedMinutes: 0,
              lastResetDate: new Date().toISOString().split('T')[0]
            }
          });
          showToast('Usage reset');
        } catch {
          showToast('Failed to reset usage', 'error');
        }
      }
    );
  });

  // Export (both buttons)
  const exportHandler = () => {
    const data = {
      whitelist: currentSettings.whitelist,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'parental-whitelist-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Whitelist exported');
  };

  document.getElementById('exportBtn').addEventListener('click', exportHandler);
  document.getElementById('exportBtn2').addEventListener('click', exportHandler);

  // Import (both buttons)
  const importHandler = () => document.getElementById('importFile').click();
  document.getElementById('importBtn').addEventListener('click', importHandler);
  document.getElementById('importBtn2').addEventListener('click', importHandler);

  // Import file handler
  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let whitelist;

      try {
        const data = JSON.parse(text);
        whitelist = data.whitelist || data;
      } catch {
        whitelist = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      }

      if (Array.isArray(whitelist)) {
        whitelist = whitelist.map(url =>
          url.replace(/^https?:\/\//, '').replace(/^www\./, '').trim()
        ).filter(url => url.length > 0 && url.includes('.'));

        // Merge with existing whitelist instead of replacing
        const existing = new Set(currentSettings.whitelist);
        let addedCount = 0;
        for (const url of whitelist) {
          if (!existing.has(url)) {
            currentSettings.whitelist.push(url);
            addedCount++;
          }
        }

        await browser.runtime.sendMessage({
          type: 'updateWhitelist',
          whitelist: currentSettings.whitelist
        });

        renderWhitelist();
        showToast(`Imported ${addedCount} new site${addedCount !== 1 ? 's' : ''} (${whitelist.length - addedCount} already existed)`);
      }
    } catch {
      showToast('Error importing file', 'error');
    }

    e.target.value = '';
  });

  // Session timeout
  const timeoutSelect = document.getElementById('sessionTimeout');
  if (timeoutSelect) {
    timeoutSelect.addEventListener('change', async (e) => {
      const timeout = parseInt(e.target.value, 10);
      await browser.runtime.sendMessage({
        type: 'updateSessionTimeout',
        timeout: timeout
      });
      currentSettings.sessionTimeout = timeout;
      showToast('Auto-lock timeout updated');
    });
  }

  // Presets modal
  setupPresetsModal();

  // Policies helper
  setupPoliciesHelper();
}

// Presets Modal
function setupPresetsModal() {
  const presetsBtn = document.getElementById('presetsBtn');
  const presetsModal = document.getElementById('presetsModal');
  const closePresetsBtn = document.getElementById('closePresetsBtn');
  const cancelPresetsBtn = document.getElementById('cancelPresetsBtn');
  const addPresetsBtn = document.getElementById('addPresetsBtn');

  if (!presetsBtn || !presetsModal) return;

  presetsBtn.addEventListener('click', () => {
    presetsModal.classList.add('show');
  });

  closePresetsBtn.addEventListener('click', () => {
    presetsModal.classList.remove('show');
  });

  cancelPresetsBtn.addEventListener('click', () => {
    presetsModal.classList.remove('show');
  });

  presetsModal.addEventListener('click', (e) => {
    if (e.target === presetsModal) {
      presetsModal.classList.remove('show');
    }
  });

  addPresetsBtn.addEventListener('click', async () => {
    const presets = [
      { id: 'preset-kiddle', url: 'kiddle.co' },
      { id: 'preset-khan', url: 'khanacademy.org' },
      { id: 'preset-pbskids', url: 'pbskids.org' },
      { id: 'preset-natgeo', url: 'nationalgeographic.com/kids' },
      { id: 'preset-coolmath', url: 'coolmathgames.com' },
      { id: 'preset-starfall', url: 'starfall.com' },
      { id: 'preset-brainpop', url: 'brainpop.com' },
      { id: 'preset-funbrain', url: 'funbrain.com' }
    ];

    let addedCount = 0;
    for (const preset of presets) {
      const checkbox = document.getElementById(preset.id);
      if (checkbox && checkbox.checked) {
        if (!currentSettings.whitelist.includes(preset.url)) {
          currentSettings.whitelist.push(preset.url);
          addedCount++;
        }
      }
    }

    if (addedCount > 0) {
      await browser.runtime.sendMessage({
        type: 'updateWhitelist',
        whitelist: currentSettings.whitelist
      });
      renderWhitelist();
      showToast(`Added ${addedCount} site${addedCount > 1 ? 's' : ''} to allowed list`);
    } else {
      showToast('No new sites to add', 'error');
    }

    presetsModal.classList.remove('show');
  });
}

// Policies Helper
function setupPoliciesHelper() {
  // Download policies.json button
  const downloadBtn = document.getElementById('downloadPolicyBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const policiesContent = {
        "policies": {
          "BlockAboutAddons": true,
          "BlockAboutConfig": true,
          "BlockAboutProfiles": true,
          "BlockAboutSupport": true,
          "DisableDeveloperTools": true,
          "DisablePrivateBrowsing": true,
          "DisableSafeMode": true,
          "DisableProfileRefresh": true,
          "DisableProfileImport": true,
          "InstallAddonsPermission": {
            "Default": false
          },
          "Preferences": {
            "devtools.policy.disabled": true,
            "browser.privatebrowsing.autostart": false
          }
        }
      };

      const blob = new Blob([JSON.stringify(policiesContent, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'policies.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('policies.json downloaded');
    });
  }

  // Verify policies button - copy URL to clipboard
  const verifyBtn = document.getElementById('verifyPoliciesBtn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText('about:policies').then(() => {
        showToast('Copied! Paste in address bar and press Enter');
      }).catch(() => {
        showToast('Type about:policies in address bar', 'error');
      });
    });
  }

  // OS instructions tabs
  const osTabs = document.querySelectorAll('.os-tab');
  osTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const os = tab.dataset.os;

      // Update tabs
      osTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update instructions
      document.getElementById('windowsInstructions').style.display = os === 'windows' ? 'block' : 'none';
      document.getElementById('macInstructions').style.display = os === 'mac' ? 'block' : 'none';
      document.getElementById('linuxInstructions').style.display = os === 'linux' ? 'block' : 'none';
    });
  });
}

