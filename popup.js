// Popup script for URL Override extension

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadGlobalState();
  await loadRules();
  setupEventListeners();
}

// Load global enabled state
async function loadGlobalState() {
  const { globalEnabled = true, stripCSP = true } = await chrome.storage.local.get(['globalEnabled', 'stripCSP']);
  const toggle = document.getElementById('globalEnabled');
  const status = document.getElementById('globalStatus');
  const cspToggle = document.getElementById('stripCSP');
  
  toggle.checked = globalEnabled;
  status.textContent = globalEnabled ? 'Enabled' : 'Disabled';
  cspToggle.checked = stripCSP;
}

// Load and render rules
async function loadRules() {
  const { rules = [] } = await chrome.storage.local.get('rules');
  renderRules(rules);
}

// Render rules list
function renderRules(rules) {
  const container = document.getElementById('rules-list');
  
  if (rules.length === 0) {
    container.innerHTML = '<p class="empty-state">No redirect rules configured. Add a rule to get started.</p>';
    return;
  }
  
  container.innerHTML = rules.map((rule, index) => `
    <div class="rule-card ${rule.enabled ? '' : 'disabled'}">
      <div class="rule-header">
        <span class="rule-name">
          ${escapeHtml(rule.name)}
          ${rule.useRegex ? '<span class="rule-badge regex">REGEX</span>' : ''}
        </span>
        <div class="rule-toggle">
          <label class="switch">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-index="${index}" class="rule-enabled-toggle">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="rule-urls">
        <div class="url-row">
          <span class="label">From:</span>
          <span class="url">${escapeHtml(rule.sourceUrl)}</span>
        </div>
        <div class="url-row">
          <span class="label">To:</span>
          <span class="url">${escapeHtml(rule.targetUrl)}</span>
        </div>
        ${rule.domains && rule.domains.length > 0 ? `
        <div class="url-row">
          <span class="label">Domains:</span>
          <span class="url">${escapeHtml(rule.domains.join(', '))}</span>
        </div>
        ` : ''}
      </div>
      <div class="rule-actions">
        <button class="btn-edit" data-index="${index}">Edit</button>
        <button class="btn-delete" data-index="${index}">Delete</button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners for rule cards
  container.querySelectorAll('.rule-enabled-toggle').forEach(toggle => {
    toggle.addEventListener('change', handleRuleToggle);
  });
  
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', handleEditRule);
  });
  
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', handleDeleteRule);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Global toggle
  document.getElementById('globalEnabled').addEventListener('change', handleGlobalToggle);
  
  // CSP toggle
  document.getElementById('stripCSP').addEventListener('change', handleCSPToggle);
  
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', handleTabClick);
  });
  
  // Add rule form
  document.getElementById('add-rule-form').addEventListener('submit', handleAddRule);
  
  // Regex toggle - update help text
  document.getElementById('useRegex').addEventListener('change', updatePatternHelp);
  
  // Edit form
  document.getElementById('edit-rule-form').addEventListener('submit', handleSaveEdit);
  document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
  
  // Import/Export
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('importBtn').addEventListener('click', handleImport);
  document.getElementById('clearAllBtn').addEventListener('click', handleClearAll);
  
  // Logs
  document.getElementById('clearLogsBtn').addEventListener('click', handleClearLogs);
  
  // Debug tools
  document.getElementById('viewActiveRulesBtn').addEventListener('click', handleViewActiveRules);
  document.getElementById('testPatternBtn').addEventListener('click', handleTestPattern);
  
  // Close modal on outside click
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') {
      closeEditModal();
    }
  });
}

// Update pattern help text based on regex toggle
function updatePatternHelp() {
  const useRegex = document.getElementById('useRegex').checked;
  const helpEl = document.getElementById('patternHelp');
  
  if (useRegex) {
    helpEl.innerHTML = `
      <strong>Regex pattern:</strong> Use JavaScript regex syntax.<br>
      Example: <code>.*\\.dynamics\\.com/.*\\.bundle\\.js</code><br>
      Tip: Escape dots with <code>\\.</code> and use <code>.*</code> for wildcards
    `;
  } else {
    helpEl.innerHTML = `
      <strong>Simple pattern:</strong> Use <code>*</code> as wildcard.<br>
      Example: <code>*://*.dynamics.com/*bundle.js</code>
    `;
  }
}

// Handle global toggle
async function handleGlobalToggle(e) {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ globalEnabled: enabled });
  document.getElementById('globalStatus').textContent = enabled ? 'Enabled' : 'Disabled';
  showToast(enabled ? 'URL Override enabled' : 'URL Override disabled', 'info');
}

// Handle CSP toggle
async function handleCSPToggle(e) {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ stripCSP: enabled });
  showToast(enabled ? 'CSP stripping enabled - localhost redirects will work' : 'CSP stripping disabled', 'info');
}

// Handle tab click
function handleTabClick(e) {
  const tabName = e.target.dataset.tab;
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
  
  // Load logs when switching to logs tab
  if (tabName === 'logs') {
    loadLogs();
  }
}

// Handle add rule
async function handleAddRule(e) {
  e.preventDefault();
  
  const name = document.getElementById('ruleName').value.trim();
  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const targetUrl = document.getElementById('targetUrl').value.trim();
  const domainsInput = document.getElementById('domains').value.trim();
  const priority = parseInt(document.getElementById('priority').value) || 1;
  
  // Get selected resource types
  const resourceTypes = Array.from(document.querySelectorAll('input[name="resourceType"]:checked'))
    .map(cb => cb.value);
  
  // Get regex toggle
  const useRegex = document.getElementById('useRegex').checked;
  
  // Parse domains
  const domains = domainsInput ? domainsInput.split(',').map(d => d.trim()).filter(d => d) : [];
  
  // Create rule object
  const newRule = {
    id: generateId(),
    name,
    sourceUrl,
    targetUrl,
    domains,
    resourceTypes,
    priority,
    useRegex,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  // Save to storage
  const { rules = [] } = await chrome.storage.local.get('rules');
  rules.push(newRule);
  await chrome.storage.local.set({ rules });
  
  // Reset form
  e.target.reset();
  document.getElementById('priority').value = '1';
  
  // Reload rules and switch to rules tab
  await loadRules();
  document.querySelector('[data-tab="rules"]').click();
  
  showToast('Rule added successfully', 'success');
}

// Handle rule toggle
async function handleRuleToggle(e) {
  const index = parseInt(e.target.dataset.index);
  const enabled = e.target.checked;
  
  const { rules = [] } = await chrome.storage.local.get('rules');
  if (rules[index]) {
    rules[index].enabled = enabled;
    await chrome.storage.local.set({ rules });
    await loadRules();
    showToast(enabled ? 'Rule enabled' : 'Rule disabled', 'info');
  }
}

// Handle edit rule
async function handleEditRule(e) {
  const index = parseInt(e.target.dataset.index);
  const { rules = [] } = await chrome.storage.local.get('rules');
  const rule = rules[index];
  
  if (!rule) return;
  
  // Populate edit form
  document.getElementById('editIndex').value = index;
  document.getElementById('editRuleName').value = rule.name;
  document.getElementById('editSourceUrl').value = rule.sourceUrl;
  document.getElementById('editTargetUrl').value = rule.targetUrl;
  document.getElementById('editDomains').value = rule.domains ? rule.domains.join(', ') : '';
  document.getElementById('editPriority').value = rule.priority || 1;
  document.getElementById('editUseRegex').checked = rule.useRegex || false;
  
  // Show modal
  document.getElementById('editModal').classList.add('active');
}

// Handle save edit
async function handleSaveEdit(e) {
  e.preventDefault();
  
  const index = parseInt(document.getElementById('editIndex').value);
  const { rules = [] } = await chrome.storage.local.get('rules');
  
  if (!rules[index]) return;
  
  // Update rule
  rules[index].name = document.getElementById('editRuleName').value.trim();
  rules[index].sourceUrl = document.getElementById('editSourceUrl').value.trim();
  rules[index].targetUrl = document.getElementById('editTargetUrl').value.trim();
  rules[index].priority = parseInt(document.getElementById('editPriority').value) || 1;
  rules[index].useRegex = document.getElementById('editUseRegex').checked;
  
  const domainsInput = document.getElementById('editDomains').value.trim();
  rules[index].domains = domainsInput ? domainsInput.split(',').map(d => d.trim()).filter(d => d) : [];
  
  await chrome.storage.local.set({ rules });
  
  closeEditModal();
  await loadRules();
  showToast('Rule updated successfully', 'success');
}

// Close edit modal
function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

// Handle delete rule
async function handleDeleteRule(e) {
  const index = parseInt(e.target.dataset.index);
  
  if (!confirm('Are you sure you want to delete this rule?')) {
    return;
  }
  
  const { rules = [] } = await chrome.storage.local.get('rules');
  rules.splice(index, 1);
  await chrome.storage.local.set({ rules });
  
  await loadRules();
  showToast('Rule deleted', 'info');
}

// Handle export
async function handleExport() {
  const data = await chrome.storage.local.get(['rules', 'globalEnabled']);
  const exportData = JSON.stringify(data, null, 2);
  
  // Copy to clipboard
  await navigator.clipboard.writeText(exportData);
  
  // Also trigger download
  const blob = new Blob([exportData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `url-override-rules-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Rules exported and copied to clipboard', 'success');
}

// Handle import
async function handleImport() {
  const importText = document.getElementById('importData').value.trim();
  
  if (!importText) {
    showToast('Please paste configuration data', 'error');
    return;
  }
  
  try {
    const data = JSON.parse(importText);
    
    if (data.rules && Array.isArray(data.rules)) {
      // Merge or replace option
      const { rules: existingRules = [] } = await chrome.storage.local.get('rules');
      
      if (existingRules.length > 0) {
        const merge = confirm('Do you want to merge with existing rules? Click Cancel to replace all.');
        
        if (merge) {
          const mergedRules = [...existingRules, ...data.rules];
          await chrome.storage.local.set({ rules: mergedRules });
        } else {
          await chrome.storage.local.set({ rules: data.rules });
        }
      } else {
        await chrome.storage.local.set({ rules: data.rules });
      }
      
      if (data.globalEnabled !== undefined) {
        await chrome.storage.local.set({ globalEnabled: data.globalEnabled });
        await loadGlobalState();
      }
      
      await loadRules();
      document.getElementById('importData').value = '';
      showToast('Rules imported successfully', 'success');
    } else {
      showToast('Invalid configuration format', 'error');
    }
  } catch (err) {
    showToast('Invalid JSON format', 'error');
    console.error('Import error:', err);
  }
}

// Handle clear all
async function handleClearAll() {
  if (!confirm('Are you sure you want to delete ALL rules? This cannot be undone.')) {
    return;
  }
  
  await chrome.storage.local.set({ rules: [] });
  await loadRules();
  showToast('All rules cleared', 'info');
}

// Load and render logs
async function loadLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getLogs' });
    renderLogs(response.logs || []);
  } catch (err) {
    console.error('Error loading logs:', err);
    renderLogs([]);
  }
}

// Render logs list
function renderLogs(logs) {
  const container = document.getElementById('logs-list');
  
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="empty-state">No redirects logged yet. Redirects will appear here when URLs match your rules.</p>';
    return;
  }
  
  container.innerHTML = logs.map(log => `
    <div class="log-entry success">
      <div class="log-time">${formatTime(log.timestamp)}</div>
      <div class="log-from">
        <span class="log-label">From:</span>
        <span class="log-url">${escapeHtml(truncateUrl(log.requestUrl))}</span>
      </div>
      <div class="log-to">
        <span class="log-label">To:</span>
        <span class="log-url">${escapeHtml(log.targetUrl || 'unknown')}</span>
      </div>
      <div class="log-meta">
        <span>Rule: ${escapeHtml(log.ruleName || 'Rule #' + log.ruleId)}</span>
        <span>Type: ${log.type}</span>
      </div>
    </div>
  `).join('');
}

// Format timestamp
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString() + ' - ' + date.toLocaleDateString();
}

// Truncate long URLs
function truncateUrl(url, maxLength = 60) {
  if (!url) return '';
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

// Handle clear logs
async function handleClearLogs() {
  await chrome.runtime.sendMessage({ action: 'clearLogs' });
  await loadLogs();
  showToast('Logs cleared', 'info');
}

// Handle view active rules
async function handleViewActiveRules() {
  const output = document.getElementById('activeRulesOutput');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getActiveRules' });
    const rules = response.rules || [];
    
    if (rules.length === 0) {
      output.textContent = 'No active rules registered in Chrome.\n\nThis means your rules may have invalid patterns.';
      output.className = 'debug-output active error';
    } else {
      const formatted = rules.map(r => {
        const condition = r.condition;
        return `Rule #${r.id}:\n  Type: ${r.action.type}\n  Filter: ${condition.urlFilter || condition.regexFilter || 'N/A'}\n  IsRegex: ${!!condition.regexFilter}\n  Resources: ${condition.resourceTypes?.join(', ')}`;
      }).join('\n\n');
      output.textContent = `${rules.length} active rules:\n\n${formatted}`;
      output.className = 'debug-output active';
    }
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.className = 'debug-output active error';
  }
}

// Handle test pattern
async function handleTestPattern() {
  const pattern = document.getElementById('testPattern').value.trim();
  const useRegex = document.getElementById('testUseRegex').checked;
  const testUrl = document.getElementById('testUrl').value.trim();
  const output = document.getElementById('testResult');
  
  if (!pattern || !testUrl) {
    output.textContent = 'Please enter both a pattern and a URL to test';
    output.className = 'debug-output active error';
    return;
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'testPattern', 
      pattern, 
      useRegex, 
      testUrl 
    });
    
    if (response.error) {
      output.textContent = `INVALID PATTERN!\n\nError: ${response.error}\n\nIf using regex, make sure:\n- Don't start with * (use .* instead)\n- Escape dots with \\.\n- Use .* for "match anything"`;
      output.className = 'debug-output active error';
    } else if (response.matches) {
      output.textContent = `✓ MATCH!\n\nPattern "${pattern}" matches the URL.`;
      output.className = 'debug-output active success';
    } else {
      output.textContent = `✗ NO MATCH\n\nPattern "${pattern}" does not match the URL.\n\nTips:\n- For regex: use .* instead of *\n- For regex: escape dots with \\.`;
      output.className = 'debug-output active error';
    }
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.className = 'debug-output active error';
  }
}

// Utility functions
function generateId() {
  return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  // Remove existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Create new toast
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Auto remove
  setTimeout(() => {
    toast.remove();
  }, 3000);
}
