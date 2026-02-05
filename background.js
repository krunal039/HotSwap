// HotSwap - Background service worker for URL redirection
// Author: Krunal Patel
// GitHub: https://github.com/krunal039/HotSwap

const REDIRECT_RULE_ID_START = 1;
const CSP_RULE_ID_START = 5000; // Reserve IDs 5000+ for CSP rules

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('HotSwap extension installed');
  
  // Initialize storage with default values if not set
  const data = await chrome.storage.local.get(['rules', 'globalEnabled', 'profiles', 'activeProfile', 'darkMode']);
  
  if (data.rules === undefined) {
    await chrome.storage.local.set({ rules: [] });
  }
  
  if (data.globalEnabled === undefined) {
    await chrome.storage.local.set({ globalEnabled: true });
  }
  
  if (data.stripCSP === undefined) {
    await chrome.storage.local.set({ stripCSP: true });
  }
  
  if (data.profiles === undefined) {
    await chrome.storage.local.set({ profiles: [{ id: 'default', name: 'Default' }] });
  }
  
  if (data.activeProfile === undefined) {
    await chrome.storage.local.set({ activeProfile: 'default' });
  }
  
  if (data.darkMode === undefined) {
    await chrome.storage.local.set({ darkMode: false });
  }
  
  // Create context menu
  chrome.contextMenus.create({
    id: 'hotswap-add-rule',
    title: 'Add HotSwap rule for this URL',
    contexts: ['link', 'page', 'image', 'video', 'audio']
  });
  
  chrome.contextMenus.create({
    id: 'hotswap-toggle',
    title: 'Toggle HotSwap',
    contexts: ['action']
  });
  
  // Apply existing rules on install
  await applyRules();
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-hotswap') {
    const { globalEnabled } = await chrome.storage.local.get('globalEnabled');
    await chrome.storage.local.set({ globalEnabled: !globalEnabled });
    
    // Show notification
    const status = !globalEnabled ? 'ON' : 'OFF';
    console.log(`HotSwap: Toggled ${status} via keyboard shortcut`);
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'hotswap-add-rule') {
    const url = info.linkUrl || info.srcUrl || info.pageUrl;
    if (url) {
      // Store the URL to be added
      await chrome.storage.local.set({ pendingRuleUrl: url });
      // Open popup (user will see the URL pre-filled)
      chrome.action.openPopup();
    }
  } else if (info.menuItemId === 'hotswap-toggle') {
    const { globalEnabled } = await chrome.storage.local.get('globalEnabled');
    await chrome.storage.local.set({ globalEnabled: !globalEnabled });
  }
});

// Listen for storage changes to update rules dynamically
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.rules || changes.globalEnabled || changes.stripCSP || changes.activeProfile || changes.profiles)) {
    await applyRules();
  }
});

// Get rules for the active profile
async function getActiveProfileRules() {
  const { profiles = [], activeProfile = 'default', rules = [] } = 
    await chrome.storage.local.get(['profiles', 'activeProfile', 'rules']);
  
  // Default profile uses the main 'rules' array
  if (activeProfile === 'default') {
    return rules;
  }
  
  // Other profiles have rules stored inside the profile object
  const profile = profiles.find(p => p.id === activeProfile);
  return profile?.rules || [];
}

// Save rules for the active profile
async function saveActiveProfileRules(newRules) {
  const { profiles = [], activeProfile = 'default' } = 
    await chrome.storage.local.get(['profiles', 'activeProfile']);
  
  if (activeProfile === 'default') {
    // Default profile uses main 'rules' array
    await chrome.storage.local.set({ rules: newRules });
  } else {
    // Other profiles store rules inside profile object
    const updatedProfiles = profiles.map(p => {
      if (p.id === activeProfile) {
        return { ...p, rules: newRules };
      }
      return p;
    });
    await chrome.storage.local.set({ profiles: updatedProfiles });
  }
}

// Apply redirect rules based on stored configuration
async function applyRules() {
  try {
    const { globalEnabled = true, stripCSP = true } = await chrome.storage.local.get(['globalEnabled', 'stripCSP']);
    const rules = await getActiveProfileRules();
    
    // Get existing dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    // Remove all existing dynamic rules
    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds
      });
    }
    
    // If globally disabled, don't add any rules
    if (!globalEnabled) {
      console.log('URL Override: Global redirect disabled');
      updateBadge(false, 0);
      return;
    }
    
    // Build new rules from enabled configurations
    const newRules = [];
    let ruleId = REDIRECT_RULE_ID_START;
    const domainsNeedingCSPStrip = new Set();
    
    for (const rule of rules) {
      if (!rule.enabled || !rule.sourceUrl || !rule.targetUrl) {
        continue;
      }
      
      try {
        // Skip if this is a block or mock rule (handled separately)
        if (rule.ruleType === 'block' || rule.ruleType === 'mock') {
          continue;
        }
        
        // Create redirect rule
        const redirectRule = {
          id: ruleId++,
          priority: rule.priority || 1,
          action: {
            type: 'redirect',
            redirect: {}
          },
          condition: {
            resourceTypes: getResourceTypes(rule.resourceTypes)
          }
        };
        
        // Check if target URL has capture group placeholders ($1, $2, etc.)
        const hasCaptureGroups = /\$\d+/.test(rule.targetUrl);
        
        // Use regexFilter for regex patterns, urlFilter for simple patterns
        if (rule.useRegex) {
          redirectRule.condition.regexFilter = rule.sourceUrl;
          // Use regexSubstitution for capture groups
          if (hasCaptureGroups) {
            redirectRule.action.redirect.regexSubstitution = rule.targetUrl;
          } else {
            redirectRule.action.redirect.url = rule.targetUrl;
          }
        } else {
          redirectRule.condition.urlFilter = rule.sourceUrl;
          redirectRule.action.redirect.url = rule.targetUrl;
        }
        
        // Add domain filter if specified
        if (rule.domains && rule.domains.length > 0) {
          redirectRule.condition.initiatorDomains = rule.domains;
          // Track domains that need CSP stripping
          rule.domains.forEach(d => domainsNeedingCSPStrip.add(d));
        }
        
        // Check if redirecting to localhost - will need CSP stripping
        if (rule.targetUrl.includes('localhost') || rule.targetUrl.includes('127.0.0.1')) {
          rule.needsCSPStrip = true;
        }
        
        newRules.push(redirectRule);
      } catch (err) {
        console.error(`Error creating rule for ${rule.sourceUrl}:`, err);
      }
    }
    
    // Process block rules
    for (const rule of rules) {
      if (!rule.enabled || rule.ruleType !== 'block') continue;
      
      const blockRule = {
        id: ruleId++,
        priority: rule.priority || 1,
        action: { type: 'block' },
        condition: {
          resourceTypes: getResourceTypes(rule.resourceTypes)
        }
      };
      
      if (rule.useRegex) {
        blockRule.condition.regexFilter = rule.sourceUrl;
      } else {
        blockRule.condition.urlFilter = rule.sourceUrl;
      }
      
      if (rule.domains && rule.domains.length > 0) {
        blockRule.condition.initiatorDomains = rule.domains;
      }
      
      newRules.push(blockRule);
    }
    
    // Add CSP stripping rules if enabled and we have redirect rules
    if (stripCSP && newRules.length > 0) {
      const cspRules = createCSPStrippingRules(domainsNeedingCSPStrip);
      newRules.push(...cspRules);
      console.log(`HotSwap: Adding ${cspRules.length} CSP stripping rules`);
    }
    
    // Add cache-busting rules for each redirect pattern (dynamic, any domain)
    const cacheBustStartId = CSP_RULE_ID_START + 1000;
    const cacheBustRules = createCacheBustingRules(rules, cacheBustStartId);
    newRules.push(...cacheBustRules);
    console.log(`HotSwap: Adding ${cacheBustRules.length} cache-busting rules`);
    
    // Add new rules
    if (newRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: newRules
      });
    }
    
    const redirectCount = newRules.filter(r => r.action.type === 'redirect').length;
    console.log(`URL Override: Applied ${redirectCount} redirect rules`);
    updateBadge(true, redirectCount);
    
  } catch (error) {
    console.error('Error applying rules:', error);
  }
}

// Create rules to strip CSP headers that block localhost
function createCSPStrippingRules(domains) {
  const rules = [];
  let ruleId = CSP_RULE_ID_START;
  
  // Headers to remove that enforce CSP
  const cspHeaders = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-security-policy',
    'x-webkit-csp'
  ];
  
  // Headers to remove that cause caching
  const cacheHeaders = [
    'cache-control',
    'expires',
    'etag',
    'last-modified'
  ];
  
  // If specific domains are configured, create rules for each
  if (domains.size > 0) {
    const domainList = Array.from(domains);
    
    // Create one rule to strip CSP headers for all configured domains
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(header => ({
          header: header,
          operation: 'remove'
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        initiatorDomains: domainList
      }
    });
    
    // Also strip from responses TO these domains
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(header => ({
          header: header,
          operation: 'remove'
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        requestDomains: domainList
      }
    });
    
  } else {
    // No specific domains - create a broader rule for common dev scenarios
    // This targets dynamics/powerapps domains commonly used with PCF
    const defaultDomains = [
      'dynamics.com',
      'crm.dynamics.com', 
      'powerapps.com',
      'make.powerapps.com',
      'apps.powerapps.com',
      'content.powerapps.com'
    ];
    
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(header => ({
          header: header,
          operation: 'remove'
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        requestDomains: defaultDomains
      }
    });
    
  }
  
  return rules;
}

// Create cache-busting rules for each redirect rule's source pattern
function createCacheBustingRules(rules, startId) {
  const cacheBustingRules = [];
  let ruleId = startId;
  
  const responseCacheHeaders = [
    'cache-control',
    'expires', 
    'etag',
    'last-modified'
  ];
  
  for (const rule of rules) {
    if (!rule.enabled || !rule.sourceUrl) continue;
    
    // Rule to strip cache headers from RESPONSE (prevents future caching)
    const responseRule = {
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: responseCacheHeaders.map(header => ({
          header: header,
          operation: 'remove'
        }))
      },
      condition: {
        resourceTypes: ['script', 'stylesheet', 'xmlhttprequest']
      }
    };
    
    // Rule to add no-cache to REQUEST (forces revalidation of cached content)
    const requestRule = {
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Cache-Control', operation: 'set', value: 'no-cache, no-store, must-revalidate' },
          { header: 'Pragma', operation: 'set', value: 'no-cache' }
        ]
      },
      condition: {
        resourceTypes: ['script', 'stylesheet', 'xmlhttprequest']
      }
    };
    
    // Use same pattern type as the redirect rule
    if (rule.useRegex) {
      responseRule.condition.regexFilter = rule.sourceUrl;
      requestRule.condition.regexFilter = rule.sourceUrl;
    } else {
      responseRule.condition.urlFilter = rule.sourceUrl;
      requestRule.condition.urlFilter = rule.sourceUrl;
    }
    
    cacheBustingRules.push(responseRule);
    cacheBustingRules.push(requestRule);
  }
  
  return cacheBustingRules;
}

// Get resource types array
function getResourceTypes(types) {
  const defaultTypes = ['script', 'xmlhttprequest', 'stylesheet', 'image', 'font', 'media', 'other'];
  
  if (!types || types.length === 0) {
    return defaultTypes;
  }
  
  return types;
}

// Update extension badge
function updateBadge(enabled, count) {
  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#999999' });
  } else if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Store for redirect logs (in-memory, cleared on service worker restart)
let redirectLogs = [];
const MAX_LOGS = 100;
let sessionRedirectCount = 0;
let sessionBlockCount = 0;
let ruleMatchCounts = {}; // Track per-rule match counts

// Listen for rule matches (redirects and blocks)
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  // Only log redirect/block rules, not CSP stripping rules
  if (info.rule.ruleId < CSP_RULE_ID_START) {
    // Track per-rule counts
    const ruleId = info.rule.ruleId;
    ruleMatchCounts[ruleId] = (ruleMatchCounts[ruleId] || 0) + 1;
    
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      requestUrl: info.request.url,
      ruleId: info.rule.ruleId,
      tabId: info.request.tabId,
      type: info.request.type,
      initiator: info.request.initiator || 'unknown',
      method: info.request.method || 'GET'
    };
    
    // Get the rule to find the target URL and type
    getActiveProfileRules().then((rules) => {
      const ruleIndex = info.rule.ruleId - REDIRECT_RULE_ID_START;
      if (rules[ruleIndex]) {
        logEntry.targetUrl = rules[ruleIndex].targetUrl;
        logEntry.ruleName = rules[ruleIndex].name;
        logEntry.ruleType = rules[ruleIndex].ruleType || 'redirect';
      }
      
      // Update counts based on rule type
      if (logEntry.ruleType === 'block') {
        sessionBlockCount++;
      } else {
        sessionRedirectCount++;
      }
      
      // Update badge with total count
      const totalCount = sessionRedirectCount + sessionBlockCount;
      chrome.action.setBadgeText({ text: totalCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: logEntry.ruleType === 'block' ? '#EF4444' : '#10B981' });
      
      redirectLogs.unshift(logEntry);
      
      // Trim logs to max size
      if (redirectLogs.length > MAX_LOGS) {
        redirectLogs = redirectLogs.slice(0, MAX_LOGS);
      }
      
      console.log('HotSwap:', logEntry.ruleType || 'redirect', info.request.url, logEntry.ruleType === 'block' ? '[BLOCKED]' : '→ ' + logEntry.targetUrl);
    });
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshRules') {
    applyRules().then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'getRuleCount') {
    chrome.declarativeNetRequest.getDynamicRules().then(rules => {
      sendResponse({ count: rules.length });
    });
    return true;
  }
  
  if (message.action === 'getLogs') {
    sendResponse({ logs: redirectLogs });
    return true;
  }
  
  if (message.action === 'clearLogs') {
    redirectLogs = [];
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'getActiveRules') {
    chrome.declarativeNetRequest.getDynamicRules().then(rules => {
      sendResponse({ rules: rules });
    });
    return true;
  }
  
  if (message.action === 'testPattern') {
    const { pattern, useRegex, testUrl } = message;
    try {
      let matches = false;
      if (useRegex) {
        const regex = new RegExp(pattern);
        matches = regex.test(testUrl);
      } else {
        // Simple urlFilter matching simulation
        const regexPattern = pattern
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        const regex = new RegExp(regexPattern, 'i');
        matches = regex.test(testUrl);
      }
      sendResponse({ matches, error: null });
    } catch (err) {
      sendResponse({ matches: false, error: err.message });
    }
    return true;
  }
  
  if (message.action === 'getStats') {
    sendResponse({
      redirectCount: sessionRedirectCount,
      blockCount: sessionBlockCount,
      ruleMatchCounts: ruleMatchCounts,
      logCount: redirectLogs.length
    });
    return true;
  }
  
  if (message.action === 'resetStats') {
    sessionRedirectCount = 0;
    sessionBlockCount = 0;
    ruleMatchCounts = {};
    redirectLogs = [];
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'getPendingUrl') {
    chrome.storage.local.get('pendingRuleUrl').then(({ pendingRuleUrl }) => {
      // Clear it after reading
      chrome.storage.local.remove('pendingRuleUrl');
      sendResponse({ url: pendingRuleUrl });
    });
    return true;
  }
  
  // Profile management
  if (message.action === 'switchProfile') {
    const { profileId } = message;
    chrome.storage.local.set({ activeProfile: profileId }).then(() => {
      applyRules().then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  if (message.action === 'getActiveRulesForProfile') {
    getActiveProfileRules().then(rules => {
      sendResponse({ rules });
    });
    return true;
  }
  
  if (message.action === 'saveRulesForProfile') {
    const { rules } = message;
    saveActiveProfileRules(rules).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.action === 'createProfile') {
    const { name } = message;
    chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
      const newProfile = {
        id: `profile-${Date.now()}`,
        name: name,
        rules: [] // New profile starts empty
      };
      profiles.push(newProfile);
      chrome.storage.local.set({ profiles }).then(() => {
        sendResponse({ success: true, profile: newProfile });
      });
    });
    return true;
  }
  
  if (message.action === 'renameProfile') {
    const { profileId, newName } = message;
    chrome.storage.local.get(['profiles']).then(({ profiles = [] }) => {
      const updatedProfiles = profiles.map(p => {
        if (p.id === profileId) {
          return { ...p, name: newName };
        }
        return p;
      });
      chrome.storage.local.set({ profiles: updatedProfiles }).then(() => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  if (message.action === 'deleteProfile') {
    const { profileId } = message;
    if (profileId === 'default') {
      sendResponse({ success: false, error: 'Cannot delete default profile' });
      return true;
    }
    chrome.storage.local.get(['profiles', 'activeProfile']).then(({ profiles = [], activeProfile }) => {
      profiles = profiles.filter(p => p.id !== profileId);
      const updates = { profiles };
      if (activeProfile === profileId) {
        updates.activeProfile = 'default';
      }
      chrome.storage.local.set(updates).then(() => {
        applyRules().then(() => {
          sendResponse({ success: true });
        });
      });
    });
    return true;
  }
  
  if (message.action === 'duplicateProfile') {
    const { profileId, newName } = message;
    chrome.storage.local.get(['profiles', 'rules']).then(({ profiles = [], rules = [] }) => {
      const sourceProfile = profiles.find(p => p.id === profileId);
      // For default profile, use current rules; for others, use profile-specific rules
      const sourceRules = profileId === 'default' ? rules : (sourceProfile?.rules || []);
      
      const newProfile = {
        id: `profile-${Date.now()}`,
        name: newName || `${sourceProfile?.name || 'Profile'} (Copy)`,
        rules: JSON.parse(JSON.stringify(sourceRules))
      };
      profiles.push(newProfile);
      chrome.storage.local.set({ profiles }).then(() => {
        sendResponse({ success: true, profile: newProfile });
      });
    });
    return true;
  }
});
