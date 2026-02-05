// HotSwap v3.0.0 - Background service worker
// Author: Krunal Patel
// GitHub: https://github.com/krunal039/HotSwap

const REDIRECT_RULE_ID_START = 1;
const BLOCK_RULE_ID_START = 2000;
const HEADER_RULE_ID_START = 3000;
const CSP_RULE_ID_START = 5000;
const CACHE_RULE_ID_START = 6000;

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('HotSwap v3.0.0 installed');
  
  const data = await chrome.storage.local.get(['rules', 'globalEnabled', 'profiles', 'activeProfile', 'darkMode', 'stripCSP']);
  
  if (data.rules === undefined) await chrome.storage.local.set({ rules: [] });
  if (data.globalEnabled === undefined) await chrome.storage.local.set({ globalEnabled: true });
  if (data.stripCSP === undefined) await chrome.storage.local.set({ stripCSP: true });
  if (data.profiles === undefined) await chrome.storage.local.set({ profiles: [{ id: 'default', name: 'Default' }] });
  if (data.activeProfile === undefined) await chrome.storage.local.set({ activeProfile: 'default' });
  if (data.darkMode === undefined) await chrome.storage.local.set({ darkMode: false });
  
  // Context menus
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
  
  await applyRules();
});

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-hotswap') {
    const { globalEnabled } = await chrome.storage.local.get('globalEnabled');
    await chrome.storage.local.set({ globalEnabled: !globalEnabled });
    console.log(`HotSwap: Toggled ${!globalEnabled ? 'ON' : 'OFF'}`);
  }
});

// Context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'hotswap-add-rule') {
    const url = info.linkUrl || info.srcUrl || info.pageUrl;
    if (url) {
      await chrome.storage.local.set({ pendingRuleUrl: url });
      chrome.action.openPopup();
    }
  } else if (info.menuItemId === 'hotswap-toggle') {
    const { globalEnabled } = await chrome.storage.local.get('globalEnabled');
    await chrome.storage.local.set({ globalEnabled: !globalEnabled });
  }
});

// Storage change listener
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.rules || changes.globalEnabled || changes.stripCSP || changes.activeProfile || changes.profiles)) {
    await applyRules();
  }
});

// Get active profile rules
async function getActiveProfileRules() {
  const { profiles = [], activeProfile = 'default', rules = [] } = 
    await chrome.storage.local.get(['profiles', 'activeProfile', 'rules']);
  
  if (activeProfile === 'default') return rules;
  const profile = profiles.find(p => p.id === activeProfile);
  return profile?.rules || [];
}

// Save active profile rules
async function saveActiveProfileRules(newRules) {
  const { profiles = [], activeProfile = 'default' } = 
    await chrome.storage.local.get(['profiles', 'activeProfile']);
  
  if (activeProfile === 'default') {
    await chrome.storage.local.set({ rules: newRules });
  } else {
    const updatedProfiles = profiles.map(p => 
      p.id === activeProfile ? { ...p, rules: newRules } : p
    );
    await chrome.storage.local.set({ profiles: updatedProfiles });
  }
}

// Apply rules
async function applyRules() {
  try {
    const { globalEnabled = true, stripCSP = true } = await chrome.storage.local.get(['globalEnabled', 'stripCSP']);
    const rules = await getActiveProfileRules();
    
    // Remove existing rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (existingRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRules.map(r => r.id)
      });
    }
    
    if (!globalEnabled) {
      updateBadge(false, 0);
      return;
    }
    
    const newRules = [];
    let redirectId = REDIRECT_RULE_ID_START;
    let blockId = BLOCK_RULE_ID_START;
    let headerId = HEADER_RULE_ID_START;
    const domainsNeedingCSPStrip = new Set();
    
    // Process redirect rules
    for (const rule of rules) {
      if (!rule.enabled || !rule.sourceUrl) continue;
      if (rule.ruleType === 'block' || rule.ruleType === 'modifyHeaders') continue;
      if (!rule.targetUrl) continue;
      
      try {
        const hasCaptureGroups = /\$\d+/.test(rule.targetUrl);
        const redirectRule = {
          id: redirectId++,
          priority: rule.priority || 1,
          action: { type: 'redirect', redirect: {} },
          condition: { resourceTypes: getResourceTypes(rule.resourceTypes) }
        };
        
        if (rule.useRegex) {
          redirectRule.condition.regexFilter = rule.sourceUrl;
          if (hasCaptureGroups) {
            redirectRule.action.redirect.regexSubstitution = rule.targetUrl;
          } else {
            redirectRule.action.redirect.url = rule.targetUrl;
          }
        } else {
          redirectRule.condition.urlFilter = rule.sourceUrl;
          redirectRule.action.redirect.url = rule.targetUrl;
        }
        
        if (rule.domains?.length) {
          redirectRule.condition.initiatorDomains = rule.domains;
          rule.domains.forEach(d => domainsNeedingCSPStrip.add(d));
        }
        
        newRules.push(redirectRule);
      } catch (err) {
        console.error(`Error creating redirect rule: ${rule.sourceUrl}`, err);
      }
    }
    
    // Process block rules
    for (const rule of rules) {
      if (!rule.enabled || rule.ruleType !== 'block' || !rule.sourceUrl) continue;
      
      const blockRule = {
        id: blockId++,
        priority: rule.priority || 1,
        action: { type: 'block' },
        condition: { resourceTypes: getResourceTypes(rule.resourceTypes) }
      };
      
      if (rule.useRegex) {
        blockRule.condition.regexFilter = rule.sourceUrl;
      } else {
        blockRule.condition.urlFilter = rule.sourceUrl;
      }
      
      if (rule.domains?.length) {
        blockRule.condition.initiatorDomains = rule.domains;
      }
      
      newRules.push(blockRule);
    }
    
    // Process header modification rules
    for (const rule of rules) {
      if (!rule.enabled || rule.ruleType !== 'modifyHeaders' || !rule.sourceUrl) continue;
      if (!rule.headers || rule.headers.length === 0) continue;
      
      const requestHeaders = [];
      const responseHeaders = [];
      
      for (const h of rule.headers) {
        const headerMod = {
          header: h.name,
          operation: h.operation
        };
        if (h.operation !== 'remove' && h.value) {
          headerMod.value = h.value;
        }
        
        if (h.type === 'request') {
          requestHeaders.push(headerMod);
        } else {
          responseHeaders.push(headerMod);
        }
      }
      
      const headerRule = {
        id: headerId++,
        priority: rule.priority || 1,
        action: { type: 'modifyHeaders' },
        condition: { resourceTypes: getResourceTypes(rule.resourceTypes) }
      };
      
      if (requestHeaders.length) headerRule.action.requestHeaders = requestHeaders;
      if (responseHeaders.length) headerRule.action.responseHeaders = responseHeaders;
      
      if (rule.useRegex) {
        headerRule.condition.regexFilter = rule.sourceUrl;
      } else {
        headerRule.condition.urlFilter = rule.sourceUrl;
      }
      
      if (rule.domains?.length) {
        headerRule.condition.initiatorDomains = rule.domains;
      }
      
      newRules.push(headerRule);
    }
    
    // CSP stripping rules
    if (stripCSP && newRules.length > 0) {
      const cspRules = createCSPStrippingRules(domainsNeedingCSPStrip);
      newRules.push(...cspRules);
    }
    
    // Cache-busting rules
    const cacheBustRules = createCacheBustingRules(rules, CACHE_RULE_ID_START);
    newRules.push(...cacheBustRules);
    
    // Apply rules
    if (newRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: newRules });
    }
    
    const redirectCount = newRules.filter(r => r.action.type === 'redirect').length;
    const blockCount = newRules.filter(r => r.action.type === 'block').length;
    const headerCount = newRules.filter(r => r.action.type === 'modifyHeaders').length;
    
    console.log(`HotSwap: Applied ${redirectCount} redirects, ${blockCount} blocks, ${headerCount} header rules`);
    updateBadge(true, redirectCount + blockCount);
    
  } catch (error) {
    console.error('Error applying rules:', error);
  }
}

// CSP stripping rules
function createCSPStrippingRules(domains) {
  const rules = [];
  let ruleId = CSP_RULE_ID_START;
  
  const cspHeaders = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-security-policy',
    'x-webkit-csp'
  ];
  
  if (domains.size > 0) {
    const domainList = [...domains];
    
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(h => ({ header: h, operation: 'remove' }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        initiatorDomains: domainList
      }
    });
    
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(h => ({ header: h, operation: 'remove' }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: ['main_frame', 'sub_frame'],
        requestDomains: domainList
      }
    });
  } else {
    const defaultDomains = ['dynamics.com', 'crm.dynamics.com', 'powerapps.com', 'make.powerapps.com', 'apps.powerapps.com', 'content.powerapps.com'];
    
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: cspHeaders.map(h => ({ header: h, operation: 'remove' }))
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

// Cache-busting rules
function createCacheBustingRules(rules, startId) {
  const cacheBustingRules = [];
  let ruleId = startId;
  
  const responseCacheHeaders = ['cache-control', 'expires', 'etag', 'last-modified'];
  
  for (const rule of rules) {
    if (!rule.enabled || !rule.sourceUrl || rule.ruleType === 'block') continue;
    
    const responseRule = {
      id: ruleId++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: responseCacheHeaders.map(h => ({ header: h, operation: 'remove' }))
      },
      condition: { resourceTypes: ['script', 'stylesheet', 'xmlhttprequest'] }
    };
    
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
      condition: { resourceTypes: ['script', 'stylesheet', 'xmlhttprequest'] }
    };
    
    if (rule.useRegex) {
      responseRule.condition.regexFilter = rule.sourceUrl;
      requestRule.condition.regexFilter = rule.sourceUrl;
    } else {
      responseRule.condition.urlFilter = rule.sourceUrl;
      requestRule.condition.urlFilter = rule.sourceUrl;
    }
    
    cacheBustingRules.push(responseRule, requestRule);
  }
  
  return cacheBustingRules;
}

// Get resource types
function getResourceTypes(types) {
  const defaultTypes = ['script', 'xmlhttprequest', 'stylesheet', 'image', 'font', 'media', 'other'];
  return types?.length ? types : defaultTypes;
}

// Update badge
function updateBadge(enabled, count) {
  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#999' });
  } else if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Logs storage
let redirectLogs = [];
const MAX_LOGS = 100;
let sessionRedirectCount = 0;
let sessionBlockCount = 0;
let sessionHeaderCount = 0;
let ruleMatchCounts = {};

// Listen for rule matches
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  if (info.rule.ruleId < CSP_RULE_ID_START) {
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
    
    getActiveProfileRules().then((rules) => {
      // Determine rule type based on ID range
      let ruleType = 'redirect';
      let ruleIndex = -1;
      
      if (info.rule.ruleId >= HEADER_RULE_ID_START && info.rule.ruleId < CSP_RULE_ID_START) {
        ruleType = 'modifyHeaders';
        ruleIndex = rules.findIndex(r => r.ruleType === 'modifyHeaders' && r.enabled);
      } else if (info.rule.ruleId >= BLOCK_RULE_ID_START && info.rule.ruleId < HEADER_RULE_ID_START) {
        ruleType = 'block';
        ruleIndex = rules.findIndex(r => r.ruleType === 'block' && r.enabled);
      } else {
        ruleIndex = info.rule.ruleId - REDIRECT_RULE_ID_START;
      }
      
      if (rules[ruleIndex]) {
        logEntry.targetUrl = rules[ruleIndex].targetUrl;
        logEntry.ruleName = rules[ruleIndex].name;
        logEntry.ruleType = rules[ruleIndex].ruleType || 'redirect';
      } else {
        logEntry.ruleType = ruleType;
      }
      
      // Update counts
      if (logEntry.ruleType === 'block') sessionBlockCount++;
      else if (logEntry.ruleType === 'modifyHeaders') sessionHeaderCount++;
      else sessionRedirectCount++;
      
      const totalCount = sessionRedirectCount + sessionBlockCount + sessionHeaderCount;
      chrome.action.setBadgeText({ text: totalCount.toString() });
      chrome.action.setBadgeBackgroundColor({ 
        color: logEntry.ruleType === 'block' ? '#EF4444' : logEntry.ruleType === 'modifyHeaders' ? '#3B82F6' : '#10B981'
      });
      
      redirectLogs.unshift(logEntry);
      if (redirectLogs.length > MAX_LOGS) redirectLogs = redirectLogs.slice(0, MAX_LOGS);
      
      console.log('HotSwap:', logEntry.ruleType, info.request.url);
    });
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    refreshRules: () => applyRules().then(() => ({ success: true })).catch(err => ({ success: false, error: err.message })),
    getRuleCount: () => chrome.declarativeNetRequest.getDynamicRules().then(rules => ({ count: rules.length })),
    getLogs: () => ({ logs: redirectLogs }),
    clearLogs: () => { redirectLogs = []; return { success: true }; },
    getActiveRules: () => chrome.declarativeNetRequest.getDynamicRules().then(rules => ({ rules })),
    getStats: () => ({
      redirectCount: sessionRedirectCount,
      blockCount: sessionBlockCount,
      headerCount: sessionHeaderCount,
      ruleMatchCounts,
      logCount: redirectLogs.length
    }),
    resetStats: () => {
      sessionRedirectCount = 0;
      sessionBlockCount = 0;
      sessionHeaderCount = 0;
      ruleMatchCounts = {};
      redirectLogs = [];
      chrome.action.setBadgeText({ text: '' });
      return { success: true };
    },
    getPendingUrl: async () => {
      const { pendingRuleUrl } = await chrome.storage.local.get('pendingRuleUrl');
      await chrome.storage.local.remove('pendingRuleUrl');
      return { url: pendingRuleUrl };
    },
    testPattern: () => {
      const { pattern, useRegex, testUrl } = message;
      try {
        let matches = false;
        if (useRegex) {
          matches = new RegExp(pattern).test(testUrl);
        } else {
          const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
          matches = new RegExp(regexPattern, 'i').test(testUrl);
        }
        return { matches, error: null };
      } catch (err) {
        return { matches: false, error: err.message };
      }
    },
    switchProfile: async () => {
      await chrome.storage.local.set({ activeProfile: message.profileId });
      await applyRules();
      return { success: true };
    },
    getActiveRulesForProfile: async () => ({ rules: await getActiveProfileRules() }),
    saveRulesForProfile: async () => {
      await saveActiveProfileRules(message.rules);
      return { success: true };
    },
    createProfile: async () => {
      const { profiles = [] } = await chrome.storage.local.get('profiles');
      const newProfile = { id: `profile-${Date.now()}`, name: message.name, rules: [] };
      profiles.push(newProfile);
      await chrome.storage.local.set({ profiles });
      return { success: true, profile: newProfile };
    },
    renameProfile: async () => {
      const { profiles = [] } = await chrome.storage.local.get('profiles');
      const updated = profiles.map(p => p.id === message.profileId ? { ...p, name: message.newName } : p);
      await chrome.storage.local.set({ profiles: updated });
      return { success: true };
    },
    deleteProfile: async () => {
      if (message.profileId === 'default') return { success: false, error: 'Cannot delete default' };
      const { profiles = [], activeProfile } = await chrome.storage.local.get(['profiles', 'activeProfile']);
      const filtered = profiles.filter(p => p.id !== message.profileId);
      const updates = { profiles: filtered };
      if (activeProfile === message.profileId) updates.activeProfile = 'default';
      await chrome.storage.local.set(updates);
      await applyRules();
      return { success: true };
    },
    duplicateProfile: async () => {
      const { profiles = [], rules = [] } = await chrome.storage.local.get(['profiles', 'rules']);
      const source = profiles.find(p => p.id === message.profileId);
      const sourceRules = message.profileId === 'default' ? rules : (source?.rules || []);
      const newProfile = {
        id: `profile-${Date.now()}`,
        name: message.newName || `${source?.name || 'Profile'} (Copy)`,
        rules: JSON.parse(JSON.stringify(sourceRules))
      };
      profiles.push(newProfile);
      await chrome.storage.local.set({ profiles });
      return { success: true, profile: newProfile };
    }
  };
  
  const handler = handlers[message.action];
  if (handler) {
    const result = handler();
    if (result instanceof Promise) {
      result.then(sendResponse);
      return true;
    }
    sendResponse(result);
    return true;
  }
});
