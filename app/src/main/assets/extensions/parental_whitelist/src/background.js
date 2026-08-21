// Parental Whitelist Control - Background Script

// Default settings
const DEFAULT_SETTINGS = {
  pin: null, // No PIN set initially - forces setup on first use
  pinSet: false,
  pinLength: 4, // Variable PIN length: 4 or 8 digits
  whitelist: [
    'kiddle.co',           // Safe search engine for kids
    'pbskids.org',         // PBS Kids games & videos
    'khanacademy.org',     // Free educational courses
    'coolmathgames.com',   // Math-based games
    'nationalgeographic.com/kids', // Nature & science for kids
    'starfall.com',        // Early reading & math
    'funbrain.com',        // Educational games & books
    'brainpop.com'         // Animated learning videos
  ],
  enabled: true,
  blockAddonsPage: false, // Disabled by default - enable after installing policies.json
  lockoutAttempts: 0,
  lockoutUntil: null,
  theme: 'light', // Default theme
  sessionTimeout: 5, // minutes - auto-lock after inactivity
  stats: { todayBlocked: 0, todayDate: null, totalBlocked: 0 },
  activityLog: [], // Recent blocked attempts (max 100)
  pinSalt: null, // Per-installation random salt for PIN hashing
  temporaryAccess: {}, // Maps domain -> expiry timestamp

  dailyTimeLimit: null, // { enabled, limitMinutes, usedMinutes, lastResetDate }
  weeklyStats: [], // Array of daily stat objects (last 30 days)
  safeSearchEnabled: false, // Enforce safe search on major engines
  failedPinLog: [], // Array of { timestamp, source } (last 50)
  maxLockoutAttempts: 5, // Configurable max failed PIN attempts before lockout
  lockoutDurationMinutes: 5 // Configurable lockout duration in minutes
};

// Session state (in-memory only - not persisted)
let sessionState = {
  unlockedAt: null,
  timeoutId: null
};

// PIN hashing with PBKDF2 (100k iterations) + per-installation random salt
async function hashPin(pin, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Legacy hash for migration from pre-1.5 static salt
async function legacyHashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'parental-whitelist-salt-v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate a random salt for this installation
function generateSalt() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if PIN is already hashed (64 char hex string)
function isPinHashed(pin) {
  return pin && pin.length === 64 && /^[a-f0-9]+$/.test(pin);
}

let settings = deepCopySettings(DEFAULT_SETTINGS);

function deepCopySettings(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Protected Firefox internal pages that we should block access to (when blockAddonsPage is enabled)
const PROTECTED_PAGES = [
  "about:addons",
  "about:preferences",
  "about:config",
  "about:profiles",
  "about:privatebrowsing",
  "about:private",
  "about:devtools",
  "about:devtools-toolbox",
  "about:support",
  "about:studies",
  "about:telemetry",
  "about:debugging",    // Can manage extensions
  "about:performance",  // Shows extension processes
  "about:firefoxview",  // Recent activity bypass
  "about:reader",       // Reader mode bypass
  "about:processes"     // Can see extension info
];

// Dangerous protocols that can bypass filtering
const BLOCKED_PROTOCOLS = [
  'view-source:',  // Can view page source
  'data:',         // Can load arbitrary HTML
  'blob:'          // Can load arbitrary content
];

// Websites that could help bypass parental controls
const BLOCKED_BYPASS_SITES = [
  "addons.mozilla.org",
  "support.mozilla.org",
  "developer.mozilla.org",
  "wiki.mozilla.org",
  "firefox.com",
  "getfirefox.com"
];

// Initialize settings from storage
async function initSettings() {
  try {
    const stored = await browser.storage.local.get('parentalSettings');
    if (stored.parentalSettings) {
      settings = { ...deepCopySettings(DEFAULT_SETTINGS), ...stored.parentalSettings };
      // Ensure new settings have defaults
      if (!settings.stats) {
        settings.stats = { todayBlocked: 0, todayDate: null, totalBlocked: 0 };
      }
      if (!settings.activityLog) {
        settings.activityLog = [];
      }
      if (settings.sessionTimeout === undefined) {
        settings.sessionTimeout = 5;
      }
      // Generate per-installation salt if missing
      if (!settings.pinSalt) {
        settings.pinSalt = generateSalt();
        await saveSettings();
      }
      // Migration: ensure all new fields have defaults
      if (!settings.temporaryAccess || typeof settings.temporaryAccess !== 'object') {
        settings.temporaryAccess = {};
      }

      if (settings.dailyTimeLimit === undefined) {
        settings.dailyTimeLimit = null;
      }
      if (!Array.isArray(settings.weeklyStats)) {
        settings.weeklyStats = [];
      }
      // Clean up removed recovery feature
      if (settings.recoveryQuestion !== undefined) {
        delete settings.recoveryQuestion;
      }
      if (settings.safeSearchEnabled === undefined) {
        settings.safeSearchEnabled = false;
      }
      if (!Array.isArray(settings.failedPinLog)) {
        settings.failedPinLog = [];
      }
      if (settings.pinLength === undefined) {
        settings.pinLength = 4;
      }
      await saveSettings();
    } else {
      // First run — generate salt
      settings.pinSalt = generateSalt();
      await saveSettings();
    }
    updateBadge();
  } catch {
    // Settings load failed, defaults will be used
  }
}

// Save settings to storage
async function saveSettings() {
  try {
    await browser.storage.local.set({ parentalSettings: settings });
  } catch {
    // Storage write failed silently
  }
}

// Check if a URL matches any whitelist entry or has temporary access
function isWhitelisted(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    const fullPath = hostname + urlObj.pathname.toLowerCase();

    // Check temporary access
    if (settings.temporaryAccess && settings.temporaryAccess[hostname]) {
      const expiry = settings.temporaryAccess[hostname];
      if (Date.now() < expiry) {
        return true;
      } else {
        // Expired, clean up
        delete settings.temporaryAccess[hostname];
        saveSettingsDebounced();
      }
    }

    if (!Array.isArray(settings.whitelist)) return false;

    return settings.whitelist.some(entry => {
      let cleanEntry = entry.toLowerCase().replace(/^www\./, '').replace(/^https?:\/\//, '');

      // Handle wildcard entries like *.example.com
      if (cleanEntry.startsWith('*.')) {
        const wildcardDomain = cleanEntry.slice(2);
        return hostname === wildcardDomain || hostname.endsWith('.' + wildcardDomain);
      }

      // Check if it's a domain match
      if (hostname === cleanEntry || hostname.endsWith('.' + cleanEntry)) {
        return true;
      }

      // Check if it's a path match (e.g., youtube.com/kids)
      // Use path boundary check to prevent youtube.com/kids matching youtube.com/kidstuff
      if (fullPath === cleanEntry || fullPath.startsWith(cleanEntry + '/') || fullPath.startsWith(cleanEntry + '?')) {
        return true;
      }

      return false;
    });
  } catch {
    return false;
  }
}

// Check if URL is a protected Firefox page
function isProtectedPage(url) {
  return PROTECTED_PAGES.some(page => url.startsWith(page));
}

// Check if URL is a bypass-related site
function isBypassSite(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return BLOCKED_BYPASS_SITES.some(site =>
      hostname === site || hostname.endsWith('.' + site)
    );
  } catch {
    return false;
  }
}

// ==========================================
// DAILY TIME LIMIT
// ==========================================

// Check and reset daily time limit if it's a new day
function checkDailyTimeLimitReset() {
  if (!settings.dailyTimeLimit || !settings.dailyTimeLimit.enabled) return;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (settings.dailyTimeLimit.lastResetDate !== today) {
    settings.dailyTimeLimit.usedMinutes = 0;
    settings.dailyTimeLimit.lastResetDate = today;
    saveSettingsDebounced();
  }
}

// Check if daily time limit is exceeded
function isTimeLimitExceeded() {
  if (!settings.dailyTimeLimit || !settings.dailyTimeLimit.enabled) return false;
  checkDailyTimeLimitReset();
  return settings.dailyTimeLimit.usedMinutes >= settings.dailyTimeLimit.limitMinutes;
}

// Get remaining time in minutes, or null if no limit
function getTimeRemaining() {
  if (!settings.dailyTimeLimit || !settings.dailyTimeLimit.enabled) return null;
  checkDailyTimeLimitReset();
  const remaining = settings.dailyTimeLimit.limitMinutes - settings.dailyTimeLimit.usedMinutes;
  return Math.max(0, remaining);
}

// Track browsing time: runs every 60 seconds
let timeTrackingInterval = null;

function startTimeTracking() {
  if (timeTrackingInterval) clearInterval(timeTrackingInterval);

  timeTrackingInterval = setInterval(async () => {
    if (!settings.dailyTimeLimit || !settings.dailyTimeLimit.enabled) return;
    if (!settings.enabled || !settings.pinSet) return;

    checkDailyTimeLimitReset();

    // Count down regardless of which tab is active — the limit is total browser time
    settings.dailyTimeLimit.usedMinutes++;
    saveSettingsDebounced();

    const remaining = getTimeRemaining();

    // Update badge when < 30 min remaining, clear otherwise
    if (remaining !== null && remaining <= 30 && remaining > 0) {
      browser.browserAction.setBadgeBackgroundColor({ color: '#ef4444' });
      browser.browserAction.setBadgeText({ text: remaining + 'm' });
    } else if (remaining !== null && remaining <= 0) {
      // Time's up — redirect all non-extension tabs to blocked page
      browser.browserAction.setBadgeText({ text: '' });
      try {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
          if (tab.url && !tab.url.startsWith('moz-extension://') && !tab.url.startsWith('about:')) {
            browser.tabs.update(tab.id, {
              url: browser.runtime.getURL('src/blocked.html?reason=timelimit')
            });
          }
        }
      } catch {
        // Tab query failed
      }
    }
  }, 60000); // Every 60 seconds
}

// ==========================================
// WEEKLY STATS / DASHBOARD DATA
// ==========================================

// Get today's date string in YYYY-MM-DD format
function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// Get or create today's stats entry
function getTodayStats() {
  const today = getTodayDateString();

  // Prune entries older than 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().split('T')[0];
  settings.weeklyStats = settings.weeklyStats.filter(s => s.date >= cutoff);

  // Find or create today's entry
  let todayEntry = settings.weeklyStats.find(s => s.date === today);
  if (!todayEntry) {
    todayEntry = {
      date: today,
      blocked: 0,
      allowedVisits: {},
      blockedDomains: {}
    };
    settings.weeklyStats.push(todayEntry);
  }
  return todayEntry;
}

// Track an allowed visit in weekly stats
function trackAllowedVisit(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    const todayStats = getTodayStats();
    todayStats.allowedVisits[hostname] = (todayStats.allowedVisits[hostname] || 0) + 1;
  } catch {
    // URL parsing failed
  }
}

// ==========================================
// SAFE SEARCH ENFORCEMENT
// ==========================================

function enforceSafeSearch(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname.toLowerCase();

    // Google: hostname matches google.* and path is /search
    if (/^(www\.)?google\.[a-z.]+$/.test(hostname) && pathname === '/search') {
      if (urlObj.searchParams.get('safe') !== 'active') {
        urlObj.searchParams.set('safe', 'active');
        return { redirectUrl: urlObj.toString() };
      }
    }

    // Bing: hostname matches bing.com and path is /search
    if (/^(www\.)?bing\.com$/.test(hostname) && pathname === '/search') {
      if (urlObj.searchParams.get('adlt') !== 'strict') {
        urlObj.searchParams.set('adlt', 'strict');
        return { redirectUrl: urlObj.toString() };
      }
    }

    // DuckDuckGo: hostname matches duckduckgo.com
    if (/^(www\.)?duckduckgo\.com$/.test(hostname)) {
      if (urlObj.searchParams.get('kp') !== '1') {
        urlObj.searchParams.set('kp', '1');
        return { redirectUrl: urlObj.toString() };
      }
    }
  } catch {
    // URL parsing failed
  }

  return null;
}

// ==========================================
// TAMPER ALERTS (Failed PIN logging)
// ==========================================

function logFailedPin(source) {
  if (!Array.isArray(settings.failedPinLog)) {
    settings.failedPinLog = [];
  }

  settings.failedPinLog.push({
    timestamp: Date.now(),
    source: source || 'popup'
  });

  // Keep last 50 entries
  if (settings.failedPinLog.length > 50) {
    settings.failedPinLog = settings.failedPinLog.slice(-50);
  }

  // Check for 3+ failures within 10 minutes
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  const recentFailures = settings.failedPinLog.filter(f => f.timestamp > tenMinutesAgo);
  if (recentFailures.length >= 3) {
    sendTamperNotification(recentFailures.length);
  }

  saveSettingsDebounced();
}

function sendTamperNotification(count) {
  try {
    browser.notifications.create('tamper-alert-' + Date.now(), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('src/icons/icon48.png'),
      title: 'Parental Whitelist - Tamper Alert',
      message: count + ' failed PIN attempts detected in the last 10 minutes. Someone may be trying to bypass parental controls.'
    });
  } catch {
    // Notifications API not available
  }
}

// ==========================================
// TEMPORARY ACCESS CLEANUP
// ==========================================

// Prune expired temporary access entries
let lastTempAccessCleanup = 0;

function pruneTemporaryAccess() {
  const now = Date.now();
  // Only prune at most once per minute
  if (now - lastTempAccessCleanup < 60000) return;
  lastTempAccessCleanup = now;

  if (!settings.temporaryAccess) return;
  let changed = false;
  for (const domain of Object.keys(settings.temporaryAccess)) {
    if (settings.temporaryAccess[domain] <= now) {
      delete settings.temporaryAccess[domain];
      changed = true;
    }
  }
  if (changed) {
    saveSettingsDebounced();
  }
}

// ==========================================
// MAIN REQUEST HANDLER
// ==========================================

function handleRequest(details) {
  if (!settings.enabled || !settings.pinSet) {
    return {}; // Extension not active or not set up
  }

  const url = details.url;

  // Allow extension's own pages
  if (url.startsWith('moz-extension://')) {
    return {};
  }

  // Prune expired temporary access entries periodically
  pruneTemporaryAccess();

  // Block dangerous protocols (view-source:, data:, blob:)
  for (const protocol of BLOCKED_PROTOCOLS) {
    if (url.startsWith(protocol)) {
      logBlockedAttempt(url, 'protocol');
      return { redirectUrl: browser.runtime.getURL('src/blocked.html?reason=protected') };
    }
  }

  // Block protected Firefox pages
  if (settings.blockAddonsPage && isProtectedPage(url)) {
    logBlockedAttempt(url, 'protected');
    return { redirectUrl: browser.runtime.getURL('src/blocked.html?reason=protected') };
  }

  // Block bypass-related sites (Mozilla help, addons, etc.)
  if (settings.blockAddonsPage && isBypassSite(url)) {
    logBlockedAttempt(url, 'bypass');
    return { redirectUrl: browser.runtime.getURL('src/blocked.html?reason=bypass') };
  }

  // Block developer tools URLs (only browser-internal devtools, not websites about devtools)
  if (url.startsWith('about:devtools') || url.startsWith('chrome://devtools')) {
    logBlockedAttempt(url, 'devtools');
    return { redirectUrl: browser.runtime.getURL('src/blocked.html?reason=protected') };
  }

  // Safe search enforcement - BEFORE whitelist check
  if (settings.safeSearchEnabled) {
    const safeSearchResult = enforceSafeSearch(url);
    if (safeSearchResult) {
      return safeSearchResult;
    }
  }

  // Daily time limit check - applies even to whitelisted sites
  if (isTimeLimitExceeded()) {
    return { redirectUrl: browser.runtime.getURL('src/blocked.html?reason=timelimit') };
  }

  // Allow whitelisted sites (includes temporary access check)
  if (isWhitelisted(url)) {
    trackAllowedVisit(url);
    return {};
  }

  // Block everything else
  logBlockedAttempt(url, 'whitelist');
  return { redirectUrl: browser.runtime.getURL('src/blocked.html?url=' + encodeURIComponent(url)) };
}

// Log blocked attempt for stats and activity log
function logBlockedAttempt(url, reason) {
  const now = new Date();
  const today = now.toDateString();

  // Reset daily stats if new day
  if (settings.stats.todayDate !== today) {
    settings.stats.todayDate = today;
    settings.stats.todayBlocked = 0;
  }

  // Increment counters
  settings.stats.todayBlocked++;
  settings.stats.totalBlocked = (settings.stats.totalBlocked || 0) + 1;

  // Update weekly stats
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    const todayStats = getTodayStats();
    todayStats.blocked++;
    todayStats.blockedDomains[hostname] = (todayStats.blockedDomains[hostname] || 0) + 1;
  } catch {
    // URL parsing failed for weekly stats
    const todayStats = getTodayStats();
    todayStats.blocked++;
  }

  // Add to activity log (keep last 100)
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');

    settings.activityLog.unshift({
      url: hostname,
      fullUrl: url,
      reason: reason,
      timestamp: now.getTime()
    });

    // Keep only last 100 entries
    if (settings.activityLog.length > 100) {
      settings.activityLog = settings.activityLog.slice(0, 100);
    }
  } catch {
    // URL parsing failed, log the raw URL
    settings.activityLog.unshift({
      url: url.substring(0, 50),
      fullUrl: url,
      reason: reason,
      timestamp: now.getTime()
    });
    if (settings.activityLog.length > 100) {
      settings.activityLog = settings.activityLog.slice(0, 100);
    }
  }

  // Update badge
  updateBadge();

  // Save settings (debounced to avoid too many writes)
  saveSettingsDebounced();
}

// Debounced save to avoid excessive writes
let saveTimeout = null;
function saveSettingsDebounced() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveSettings();
    saveTimeout = null;
  }, 1000);
}

// Update toolbar badge
function updateBadge() {
  const isActive = settings.enabled && settings.pinSet;
  const color = isActive ? '#22c55e' : '#ef4444';
  let text = '';

  // Show remaining time when < 30 min left
  if (isActive) {
    const remaining = getTimeRemaining();
    if (remaining !== null && remaining <= 30 && remaining > 0) {
      text = remaining + 'm';
      browser.browserAction.setBadgeBackgroundColor({ color: '#ef4444' });
      browser.browserAction.setBadgeText({ text });
      return;
    }
  }

  browser.browserAction.setBadgeBackgroundColor({ color });
  browser.browserAction.setBadgeText({ text });
}

// Set up the web request listener
browser.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

// Messages that require an active session (PIN already verified)
const SESSION_REQUIRED_MESSAGES = [
  'updateWhitelist', 'updateBlockAddons', 'addToWhitelist', 'removeFromWhitelist',
  'toggleEnabled', 'setTheme', 'updateSessionTimeout',
  'setPin', 'updateDailyTimeLimit',
  'updateSafeSearch', 'clearFailedPinLog', 'updatePinLength', 'resetAll',
  'updateLockoutSettings'
];

// Messages allowed only from non-web-accessible extension pages
const INTERNAL_ONLY_MESSAGES = [
  'getSettings', 'verifyPin', 'setPin', 'updateWhitelist', 'updateBlockAddons',
  'addToWhitelist', 'removeFromWhitelist', 'toggleEnabled',
  'updateSessionTimeout', 'resetAll', 'setTheme',
  'updateDailyTimeLimit',
  'updateSafeSearch', 'clearFailedPinLog', 'updatePinLength',
  'getWeeklySummary', 'getDailyTimeLimit', 'getTimeRemaining',
  'getFailedPinLog', 'updateLockoutSettings'
];

// Messages allowed from blocked.html
const BLOCKED_PAGE_ALLOWED_MESSAGES = [
  'verifyPin', 'isPinSet', 'checkLockout', 'getSettings',
  'grantTemporaryAccess', 'getPinLength',
  'addToWhitelist'
];

// Handle messages from popup/options
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return a Promise for reliable async response handling in Firefox
  const handleMessage = async () => {
    // Block messages from web-accessible pages (blocked.html loaded by external sites)
    // Allow messages from extension pages that are NOT loaded in web content
    if (sender.url) {
      const blockedPageUrl = browser.runtime.getURL('src/blocked.html');
      const blockedJsUrl = browser.runtime.getURL('src/blocked.js');
      const isBlockedPage = sender.url.startsWith(blockedPageUrl) || sender.url.startsWith(blockedJsUrl);

      // blocked.html can only send limited message types
      if (isBlockedPage && INTERNAL_ONLY_MESSAGES.includes(message.type) &&
          !BLOCKED_PAGE_ALLOWED_MESSAGES.includes(message.type)) {
        return { error: 'Unauthorized' };
      }
    }

    // Require active session for sensitive operations
    if (SESSION_REQUIRED_MESSAGES.includes(message.type)) {
      // verifyPin and setPin (initial setup) are exempt from session check in specific cases
      if (message.type === 'setPin' && !settings.pinSet) {
        // Allow initial PIN setup without session
      } else if (!isSessionValid()) {
        return { error: 'Session expired', sessionRequired: true };
      }
    }

    switch (message.type) {
      case 'getSettings': {
        // Return settings without sensitive data
        const safeSettings = { ...settings };
        safeSettings.pin = settings.pinSet ? '****' : null;
        safeSettings.pinSalt = undefined; // Never expose salt
        return { settings: safeSettings };
      }

      case 'verifyPin': {
        if (!message.pin) return { valid: false };

        // Check lockout first
        if (settings.lockoutUntil && Date.now() < settings.lockoutUntil) {
          return { valid: false, lockoutUntil: settings.lockoutUntil };
        }

        let isValid = false;

        if (!isPinHashed(settings.pin)) {
          // Old plain-text PIN - verify and migrate to PBKDF2 hash
          isValid = message.pin === settings.pin;
          if (isValid && settings.pin) {
            if (!settings.pinSalt) {
              settings.pinSalt = generateSalt();
            }
            settings.pin = await hashPin(message.pin, settings.pinSalt);
            await saveSettings();
          }
        } else if (settings.pinSalt) {
          // PBKDF2 hashed PIN (v1.5+)
          const inputHash = await hashPin(message.pin, settings.pinSalt);
          isValid = inputHash === settings.pin;
        } else {
          // Legacy SHA-256 hash (no salt stored) - verify and migrate
          const legacyHash = await legacyHashPin(message.pin);
          isValid = legacyHash === settings.pin;
          if (isValid) {
            // Migrate to PBKDF2 with per-installation salt
            settings.pinSalt = generateSalt();
            settings.pin = await hashPin(message.pin, settings.pinSalt);
            await saveSettings();
          }
        }

        if (!isValid) {
          settings.lockoutAttempts++;
          // Log failed attempt for tamper alerts
          logFailedPin(sender.url || 'popup');

          const maxAttempts = settings.maxLockoutAttempts || 5;
          const lockoutMins = settings.lockoutDurationMinutes || 5;
          if (settings.lockoutAttempts >= maxAttempts) {
            settings.lockoutUntil = Date.now() + (lockoutMins * 60 * 1000);
            settings.lockoutAttempts = 0;
          }
          await saveSettings();
        } else {
          settings.lockoutAttempts = 0;
          settings.lockoutUntil = null;
          startSession();
          await saveSettings();
        }
        return { valid: isValid, lockoutUntil: settings.lockoutUntil };
      }

      case 'setPin': {
        if (!message.pin) return { error: 'PIN is required' };
        // Validate PIN is digits-only and correct length
        const expectedLength = settings.pinLength || 4;
        if (message.pin.length !== expectedLength || !/^\d+$/.test(message.pin)) {
          return { error: 'PIN must be ' + expectedLength + ' digits' };
        }
        if (!settings.pinSalt) {
          settings.pinSalt = generateSalt();
        }
        settings.pin = await hashPin(message.pin, settings.pinSalt);
        settings.pinSet = true;
        await saveSettings();
        updateBadge();
        startSession();
        return { success: true };
      }

      case 'updateWhitelist':
        settings.whitelist = sanitizeWhitelist(message.whitelist);
        await saveSettings();
        return { success: true };

      case 'updateBlockAddons':
        settings.blockAddonsPage = !!message.blockAddonsPage;
        await saveSettings();
        return { success: true };

      case 'addToWhitelist': {
        const cleanUrl = sanitizeWhitelistEntry(message.url);
        if (cleanUrl && !settings.whitelist.includes(cleanUrl)) {
          settings.whitelist.push(cleanUrl);
          await saveSettings();
        }
        return { success: true, whitelist: settings.whitelist };
      }

      case 'removeFromWhitelist':
        settings.whitelist = settings.whitelist.filter(url => url !== message.url);
        await saveSettings();
        return { success: true, whitelist: settings.whitelist };

      case 'toggleEnabled':
        settings.enabled = !!message.enabled;
        await saveSettings();
        updateBadge();
        return { success: true };

      case 'checkLockout':
        if (settings.lockoutUntil && Date.now() < settings.lockoutUntil) {
          return { lockedOut: true, until: settings.lockoutUntil };
        } else {
          settings.lockoutUntil = null;
          return { lockedOut: false };
        }

      case 'isPinSet':
        return {
          pinSet: settings.pinSet,
          pinLength: settings.pinLength || 4
        };

      case 'setTheme':
        settings.theme = (message.theme === 'dark') ? 'dark' : 'light';
        await saveSettings();
        return { success: true };

      case 'getStats': {
        const today = new Date().toDateString();
        if (settings.stats.todayDate !== today) {
          settings.stats.todayDate = today;
          settings.stats.todayBlocked = 0;
          saveSettingsDebounced();
        }
        return {
          todayBlocked: settings.stats.todayBlocked,
          totalBlocked: settings.stats.totalBlocked || 0,
          activityLog: settings.activityLog || []
        };
      }

      case 'updateSessionTimeout': {
        const timeout = parseInt(message.timeout, 10);
        if (isNaN(timeout) || timeout < 1 || timeout > 60) {
          return { error: 'Timeout must be between 1 and 60 minutes' };
        }
        settings.sessionTimeout = timeout;
        await saveSettings();
        return { success: true };
      }

      case 'resetAll':
        settings = deepCopySettings(DEFAULT_SETTINGS);
        endSession();
        await browser.storage.local.remove('parentalSettings');
        updateBadge();
        // Delay reload to let response send
        setTimeout(() => browser.runtime.reload(), 100);
        return { success: true };

      // ==========================================
      // PIN LENGTH
      // ==========================================

      case 'updatePinLength':
        if (message.pinLength === 4 || message.pinLength === 8) {
          settings.pinLength = message.pinLength;
          await saveSettings();
          return { success: true };
        }
        return { error: 'PIN length must be 4 or 8' };

      case 'getPinLength':
        return { pinLength: settings.pinLength || 4 };

      // ==========================================
      // TEMPORARY ACCESS
      // ==========================================

      case 'grantTemporaryAccess': {
        // Requires PIN verification inline
        if (!message.pin || !message.domain || !message.duration) {
          return { error: 'Missing required fields: pin, domain, duration' };
        }

        // Check lockout first
        if (settings.lockoutUntil && Date.now() < settings.lockoutUntil) {
          return { error: 'Too many attempts. Try again later.', valid: false, lockoutUntil: settings.lockoutUntil };
        }

        // Verify PIN (same logic as verifyPin, including migration)
        let pinValid = false;
        if (!isPinHashed(settings.pin)) {
          pinValid = message.pin === settings.pin;
          if (pinValid && settings.pin) {
            if (!settings.pinSalt) settings.pinSalt = generateSalt();
            settings.pin = await hashPin(message.pin, settings.pinSalt);
            await saveSettings();
          }
        } else if (settings.pinSalt) {
          const inputHash = await hashPin(message.pin, settings.pinSalt);
          pinValid = inputHash === settings.pin;
        } else {
          const legacyHash = await legacyHashPin(message.pin);
          pinValid = legacyHash === settings.pin;
          if (pinValid) {
            settings.pinSalt = generateSalt();
            settings.pin = await hashPin(message.pin, settings.pinSalt);
            await saveSettings();
          }
        }

        if (!pinValid) {
          settings.lockoutAttempts++;
          logFailedPin(sender.url || 'blocked');
          const maxAttempts = settings.maxLockoutAttempts || 5;
          const lockoutMins = settings.lockoutDurationMinutes || 5;
          if (settings.lockoutAttempts >= maxAttempts) {
            settings.lockoutUntil = Date.now() + (lockoutMins * 60 * 1000);
            settings.lockoutAttempts = 0;
          }
          await saveSettings();
          return { error: 'Invalid PIN', valid: false, lockoutUntil: settings.lockoutUntil };
        }

        // Grant temporary access (cap at 2 hours max)
        const domain = message.domain.toLowerCase().replace(/^www\./, '').replace(/^https?:\/\//, '');
        const cappedDuration = Math.min(Math.max(1, parseInt(message.duration, 10) || 30), 120);
        const durationMs = cappedDuration * 60 * 1000;
        const expiry = Date.now() + durationMs;

        if (!settings.temporaryAccess) {
          settings.temporaryAccess = {};
        }
        settings.temporaryAccess[domain] = expiry;
        await saveSettings();

        return {
          success: true,
          domain: domain,
          expiresAt: expiry,
          redirectUrl: 'https://' + domain
        };
      }

      // ==========================================
      // DAILY TIME LIMIT
      // ==========================================

      case 'getDailyTimeLimit':
        checkDailyTimeLimitReset();
        return { dailyTimeLimit: settings.dailyTimeLimit };

      case 'updateDailyTimeLimit': {
        if (!message.dailyTimeLimit || typeof message.dailyTimeLimit !== 'object') {
          return { error: 'Invalid time limit data' };
        }
        const limitMins = parseInt(message.dailyTimeLimit.limitMinutes, 10);
        const usedMins = parseInt(message.dailyTimeLimit.usedMinutes, 10);
        settings.dailyTimeLimit = {
          enabled: !!message.dailyTimeLimit.enabled,
          limitMinutes: (limitMins > 0 && limitMins <= 480) ? limitMins : 120,
          usedMinutes: (usedMins >= 0) ? usedMins : 0,
          lastResetDate: message.dailyTimeLimit.lastResetDate || null
        };
        if (settings.dailyTimeLimit.enabled && !settings.dailyTimeLimit.lastResetDate) {
          settings.dailyTimeLimit.lastResetDate = new Date().toISOString().split('T')[0];
        }
        await saveSettings();
        updateBadge();
        return { success: true };
      }

      case 'getTimeRemaining': {
        const remaining = getTimeRemaining();
        return {
          limitActive: remaining !== null,
          minutesRemaining: remaining
        };
      }

      // ==========================================
      // WEEKLY SUMMARY
      // ==========================================

      case 'getWeeklySummary': {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoff = sevenDaysAgo.toISOString().split('T')[0];

        const lastWeek = (settings.weeklyStats || []).filter(s => s.date >= cutoff);

        // Aggregate weekly blocked count
        let weeklyBlocked = 0;
        const blockedDomainTotals = {};
        const allowedDomainTotals = {};

        lastWeek.forEach(day => {
          weeklyBlocked += day.blocked || 0;

          // Aggregate blocked domains
          if (day.blockedDomains) {
            for (const [domain, count] of Object.entries(day.blockedDomains)) {
              blockedDomainTotals[domain] = (blockedDomainTotals[domain] || 0) + count;
            }
          }

          // Aggregate allowed domains
          if (day.allowedVisits) {
            for (const [domain, count] of Object.entries(day.allowedVisits)) {
              allowedDomainTotals[domain] = (allowedDomainTotals[domain] || 0) + count;
            }
          }
        });

        // Sort and return top domains
        const topBlocked = Object.entries(blockedDomainTotals)
          .map(([domain, count]) => ({ domain, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const topAllowed = Object.entries(allowedDomainTotals)
          .map(([domain, count]) => ({ domain, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        // Today's browsing time from dailyTimeLimit
        const todayBrowsingMinutes = settings.dailyTimeLimit?.usedMinutes || 0;

        return {
          weeklyBlocked,
          totalBlocked: settings.stats?.totalBlocked || 0,
          todayBrowsingMinutes,
          topBlocked,
          topAllowed,
          stats: lastWeek
        };
      }

      // ==========================================
      // SAFE SEARCH
      // ==========================================

      case 'updateSafeSearch':
        settings.safeSearchEnabled = !!message.enabled;
        await saveSettings();
        return { success: true };

      // ==========================================
      // TAMPER ALERTS / FAILED PIN LOG
      // ==========================================

      case 'getFailedPinLog':
        return { log: settings.failedPinLog || [] };

      case 'clearFailedPinLog':
        settings.failedPinLog = [];
        await saveSettings();
        return { success: true };

      case 'updateLockoutSettings': {
        const maxAttempts = parseInt(message.maxAttempts, 10);
        const duration = parseInt(message.duration, 10);
        if ([3, 5, 10].includes(maxAttempts)) {
          settings.maxLockoutAttempts = maxAttempts;
        }
        if ([1, 5, 15, 30, 60].includes(duration)) {
          settings.lockoutDurationMinutes = duration;
        }
        await saveSettings();
        return { success: true };
      }

      default:
        return { error: 'Unknown message type' };
    }
  };

  // Return the promise for proper Firefox async message handling
  handleMessage().then(sendResponse);
  return true;
});

// Sanitize a single whitelist entry
function sanitizeWhitelistEntry(entry) {
  if (!entry || typeof entry !== 'string') return null;
  let clean = entry.trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[<>"'`]/g, '') // Strip dangerous chars
    .toLowerCase();
  // Must contain at least a dot (basic domain validation)
  if (!clean || !clean.includes('.') || clean.length > 253) return null;
  return clean;
}

// Sanitize entire whitelist array
function sanitizeWhitelist(list) {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeWhitelistEntry).filter(Boolean);
}

// Session management functions
function startSession() {
  sessionState.unlockedAt = Date.now();
  resetSessionTimeout();
}

function endSession() {
  sessionState.unlockedAt = null;
  if (sessionState.timeoutId) {
    clearTimeout(sessionState.timeoutId);
    sessionState.timeoutId = null;
  }
}

function isSessionValid() {
  if (!sessionState.unlockedAt) {
    return false;
  }
  const timeout = (settings.sessionTimeout || 5) * 60 * 1000;
  return (Date.now() - sessionState.unlockedAt) < timeout;
}

function resetSessionTimeout() {
  if (sessionState.timeoutId) {
    clearTimeout(sessionState.timeoutId);
  }
  const timeout = (settings.sessionTimeout || 5) * 60 * 1000;
  sessionState.timeoutId = setTimeout(() => {
    endSession();
  }, timeout);
}

// Flush pending saves before extension unloads
addEventListener('beforeunload', () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveSettings();
  }
});

// Initialize on startup
initSettings();

// Start daily time tracking interval
startTimeTracking();

// ==========================================
// PRIVATE BROWSING BLOCKING
// ==========================================

// Close any private windows immediately
async function closePrivateWindows() {
  if (!settings.enabled || !settings.pinSet) return;

  try {
    const windows = await browser.windows.getAll();
    for (const win of windows) {
      if (win.incognito) {
        await browser.windows.remove(win.id);
      }
    }
  } catch {
    // Cannot close private windows
  }
}

// Monitor for new windows being created
browser.windows.onCreated.addListener(async (window) => {
  if (!settings.enabled || !settings.pinSet) return;

  if (window.incognito) {
    // Close the private window immediately
    try {
      await browser.windows.remove(window.id);

      // Open a notification tab in a normal window
      const normalWindows = await browser.windows.getAll({ windowTypes: ['normal'] });
      const nonPrivateWindow = normalWindows.find(w => !w.incognito);

      if (nonPrivateWindow) {
        browser.tabs.create({
          windowId: nonPrivateWindow.id,
          url: browser.runtime.getURL('src/blocked.html?reason=private')
        });
      }
    } catch {
      // Cannot handle private window
    }
  }
});

// Check for existing private windows on startup
closePrivateWindows();

// Also monitor tabs for any that try to navigate to private browsing or protected pages
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!settings.enabled || !settings.pinSet) return;

  if (changeInfo.url) {
    // Block private browsing
    if (changeInfo.url.startsWith('about:privatebrowsing')) {
      browser.tabs.update(tabId, {
        url: browser.runtime.getURL('src/blocked.html?reason=private')
      });
      return;
    }

    // Block any protected about: pages that might slip through (only if setting enabled)
    if (settings.blockAddonsPage && isProtectedPage(changeInfo.url)) {
      browser.tabs.update(tabId, {
        url: browser.runtime.getURL('src/blocked.html?reason=protected')
      });
      return;
    }

    // Intercept Firefox's enterprise policy blocked page and redirect to our themed page
    if (changeInfo.url.startsWith('about:blocked')) {
      browser.tabs.update(tabId, {
        url: browser.runtime.getURL('src/blocked.html?reason=protected')
      });
      return;
    }
  }

  // Also check tab URL for Firefox's enterprise blocked page (fallback detection)
  // Only check against known Firefox internal URLs, not page titles which can match normal sites
  if (tab.url && tab.url.startsWith('about:blocked')) {
    browser.tabs.update(tabId, {
      url: browser.runtime.getURL('src/blocked.html?reason=protected')
    });
    return;
  }
});

// ==========================================
// ADDITIONAL DETERRENTS
// ==========================================

// Remove extension from browser action context menu to prevent easy "Remove Extension" option
browser.menus.create({
  id: "parental-control-info",
  title: "Parental Whitelist Control Active",
  contexts: ["browser_action"],
  enabled: false
});

// Block F12 and other dev tools keyboard shortcuts via content script injection
// Note: This is injected into all pages to catch keyboard shortcuts
const BLOCKED_KEYS_SCRIPT = `
(function() {
  if (window.__parentalControlKeysBlocked) return;
  window.__parentalControlKeysBlocked = true;

  document.addEventListener('keydown', function(e) {
    // Block F12 (Developer Tools)
    if (e.key === 'F12') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Ctrl+Shift+I (Developer Tools)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Ctrl+Shift+J (Browser Console)
    if (e.ctrlKey && e.shiftKey && e.key === 'J') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Ctrl+Shift+K (Web Console)
    if (e.ctrlKey && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Ctrl+U (View Source)
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Block Ctrl+Shift+C (Inspector)
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // Block right-click context menu to prevent "Inspect Element"
  document.addEventListener('contextmenu', function(e) {
    // Allow right-click on inputs and textareas for usability
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
`;

// Inject keyboard blocker script into all tabs
async function injectKeyboardBlocker(tabId) {
  if (!settings.enabled || !settings.pinSet) return;

  try {
    await browser.tabs.executeScript(tabId, {
      code: BLOCKED_KEYS_SCRIPT,
      allFrames: true,
      runAt: 'document_start'
    });
  } catch {
    // Silently fail for privileged pages we can't inject into
  }
}

// Inject into newly created tabs
browser.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    injectKeyboardBlocker(tab.id);
  }
});

// Inject when tab finishes loading
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    injectKeyboardBlocker(tabId);
  }
});

// Inject into all existing tabs on startup
async function injectIntoAllTabs() {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      injectKeyboardBlocker(tab.id);
    }
  }
}

// Run on startup
injectIntoAllTabs();

// Monitor for attempts to access about:addons via various methods
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (!settings.enabled || !settings.pinSet) return;

  // Only block if blockAddonsPage is enabled
  if (settings.blockAddonsPage && details.url && (isProtectedPage(details.url) || isBypassSite(details.url))) {
    browser.tabs.update(details.tabId, {
      url: browser.runtime.getURL('src/blocked.html?reason=protected')
    });
  }

  // Intercept Firefox's enterprise blocked pages
  if (details.url && details.url.startsWith('about:blocked')) {
    browser.tabs.update(details.tabId, {
      url: browser.runtime.getURL('src/blocked.html?reason=protected')
    });
  }
}, { url: [{ schemes: ["about", "http", "https"] }] });

// Additional listener specifically for about: pages including blocked
browser.webNavigation.onCommitted.addListener((details) => {
  if (!settings.enabled || !settings.pinSet) return;

  // Catch Firefox's enterprise policy blocked page
  if (details.url && details.url.startsWith('about:blocked')) {
    browser.tabs.update(details.tabId, {
      url: browser.runtime.getURL('src/blocked.html?reason=protected')
    });
  }
});
