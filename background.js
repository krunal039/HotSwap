// HotSwap - Background service worker for URL redirection
// Author: Krunal Patel
// GitHub: https://github.com/krunal039/HotSwap

const REDIRECT_RULE_ID_START = 1;
const CSP_RULE_ID_START = 5000; // Reserve IDs 5000+ for CSP rules

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('URL Override extension installed');
  
  // Initialize storage with default values if not set
  const data = await chrome.storage.local.get(['rules', 'globalEnabled']);
  
  if (data.rules === undefined) {
    await chrome.storage.local.set({ rules: [] });
  }
  
  if (data.globalEnabled === undefined) {
    await chrome.storage.local.set({ globalEnabled: true });
  }
  
  if (data.stripCSP === undefined) {
    await chrome.storage.local.set({ stripCSP: true });
  }
  
  // Apply existing rules on install
  await applyRules();
});

// Listen for storage changes to update rules dynamically
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.rules || changes.globalEnabled || changes.stripCSP)) {
    await applyRules();
  }
});

// Apply redirect rules based on stored configuration
async function applyRules() {
  try {
    const { rules = [], globalEnabled = true, stripCSP = true } = await chrome.storage.local.get(['rules', 'globalEnabled', 'stripCSP']);
    
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
        // Create redirect rule
        const redirectRule = {
          id: ruleId++,
          priority: rule.priority || 1,
          action: {
            type: 'redirect',
            redirect: {
              url: rule.targetUrl
            }
          },
          condition: {
            resourceTypes: getResourceTypes(rule.resourceTypes)
          }
        };
        
        // Use regexFilter for regex patterns, urlFilter for simple patterns
        if (rule.useRegex) {
          redirectRule.condition.regexFilter = rule.sourceUrl;
        } else {
          redirectRule.condition.urlFilter = rule.sourceUrl;
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
    
    // Add CSP stripping rules if enabled and we have redirect rules
    if (stripCSP && newRules.length > 0) {
      const cspRules = createCSPStrippingRules(domainsNeedingCSPStrip);
      newRules.push(...cspRules);
      console.log(`URL Override: Adding ${cspRules.length} CSP stripping rules`);
    }
    
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
  
  // Headers to remove/modify that enforce CSP
  const cspHeaders = [
    'content-security-policy',
    'content-security-policy-report-only',
    'x-content-security-policy',
    'x-webkit-csp'
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
      'apps.powerapps.com'
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

// Listen for rule matches (redirects)
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
  // Only log redirect rules, not CSP stripping rules
  if (info.rule.ruleId < CSP_RULE_ID_START) {
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      requestUrl: info.request.url,
      ruleId: info.rule.ruleId,
      tabId: info.request.tabId,
      type: info.request.type,
      initiator: info.request.initiator || 'unknown'
    };
    
    // Get the rule to find the target URL
    chrome.storage.local.get('rules').then(({ rules = [] }) => {
      const ruleIndex = info.rule.ruleId - REDIRECT_RULE_ID_START;
      if (rules[ruleIndex]) {
        logEntry.targetUrl = rules[ruleIndex].targetUrl;
        logEntry.ruleName = rules[ruleIndex].name;
      }
      
      redirectLogs.unshift(logEntry);
      
      // Trim logs to max size
      if (redirectLogs.length > MAX_LOGS) {
        redirectLogs = redirectLogs.slice(0, MAX_LOGS);
      }
      
      console.log('URL Override: Redirected', info.request.url, '→', logEntry.targetUrl);
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
});
