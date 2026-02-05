// HotSwap - Popup script
// Author: Krunal Patel

document.addEventListener('DOMContentLoaded', init);

// Global state
let currentProfile = 'default';
let allRules = [];
let statsInterval = null;

async function init() {
  await loadTheme();
  await loadProfiles();
  await loadGlobalState();
  await loadRules();
  await loadStats();
  await checkPendingUrl();
  setupEventListeners();
  
  // Start live stats polling (every 2 seconds)
  startStatsPolling();
}

// Start polling for live stats updates
function startStatsPolling() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(loadStats, 2000);
}

// Stop polling when popup closes
window.addEventListener('unload', () => {
  if (statsInterval) clearInterval(statsInterval);
});

// Load theme (dark mode)
async function loadTheme() {
  const { darkMode = false } = await chrome.storage.local.get('darkMode');
  if (darkMode) {
    document.body.classList.add('dark-mode');
    document.getElementById('darkModeBtn').textContent = '☀️';
  }
}

// Load profiles
async function loadProfiles() {
  const { profiles = [{ id: 'default', name: 'Default' }], activeProfile = 'default' } = 
    await chrome.storage.local.get(['profiles', 'activeProfile']);
  
  currentProfile = activeProfile;
  const select = document.getElementById('profileSelect');
  
  select.innerHTML = profiles.map(p => 
    `<option value="${p.id}" ${p.id === activeProfile ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
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

// Load and render rules (profile-aware)
async function loadRules() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getActiveRulesForProfile' });
    allRules = response.rules || [];
    renderRules(allRules);
    // Update active rules count immediately
    const activeEl = document.getElementById('activeRulesCount');
    if (activeEl) activeEl.textContent = allRules.filter(r => r.enabled).length;
  } catch (err) {
    console.error('Error loading rules:', err);
    allRules = [];
    renderRules([]);
  }
}

// Save rules (profile-aware)
async function saveRules(rules) {
  await chrome.runtime.sendMessage({ action: 'saveRulesForProfile', rules });
  allRules = rules;
  // Refresh stats after rule changes
  setTimeout(loadStats, 500);
}

// Load stats
async function loadStats() {
  try {
    // Get stats from background
    const response = await chrome.runtime.sendMessage({ action: 'getStats' });
    
    // Update UI
    const redirectEl = document.getElementById('totalRedirects');
    const blockEl = document.getElementById('totalBlocks');
    const activeEl = document.getElementById('activeRulesCount');
    
    if (redirectEl) redirectEl.textContent = response.redirectCount || 0;
    if (blockEl) blockEl.textContent = response.blockCount || 0;
    
    // Active rules = enabled rules in current profile
    if (activeEl) activeEl.textContent = allRules.filter(r => r.enabled).length;
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// Check for pending URL from context menu
async function checkPendingUrl() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getPendingUrl' });
    if (response.url) {
      // Pre-fill the add rule form
      toggleAddForm();
      document.getElementById('sourceUrl').value = response.url;
      document.getElementById('ruleName').focus();
    }
  } catch (err) {
    console.error('Error checking pending URL:', err);
  }
}

// Render rules list
function renderRules(rules, filter = '') {
  const container = document.getElementById('rules-list');
  
  // Apply filter
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    rules = rules.filter(rule => 
      rule.name.toLowerCase().includes(lowerFilter) ||
      rule.sourceUrl.toLowerCase().includes(lowerFilter) ||
      (rule.targetUrl && rule.targetUrl.toLowerCase().includes(lowerFilter))
    );
  }
  
  if (rules.length === 0) {
    container.innerHTML = filter 
      ? '<p class="empty-state">No rules match your search.</p>'
      : '<p class="empty-state">No rules configured. Click "Add New Rule" to get started.</p>';
    return;
  }
  
  container.innerHTML = rules.map((rule, index) => {
    const actualIndex = allRules.findIndex(r => r.id === rule.id);
    const ruleType = rule.ruleType || 'redirect';
    const typeClass = ruleType === 'block' ? 'block' : ruleType === 'mock' ? 'mock' : 'redirect';
    
    return `
    <div class="rule-card ${rule.enabled ? '' : 'disabled'}">
      <div class="rule-header">
        <span class="rule-name">
          ${escapeHtml(rule.name)}
          <span class="rule-type-badge ${typeClass}">${ruleType.toUpperCase()}</span>
          ${rule.useRegex ? '<span class="rule-badge regex">REGEX</span>' : ''}
        </span>
        <div class="rule-toggle">
          <label class="switch">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-index="${actualIndex}" class="rule-enabled-toggle">
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="rule-urls">
        <div class="url-row">
          <span class="label">From:</span>
          <span class="url">${escapeHtml(rule.sourceUrl)}</span>
        </div>
        ${ruleType !== 'block' ? `
        <div class="url-row">
          <span class="label">To:</span>
          <span class="url">${escapeHtml(rule.targetUrl || 'N/A')}</span>
        </div>
        ` : ''}
        ${rule.domains && rule.domains.length > 0 ? `
        <div class="url-row">
          <span class="label">Domains:</span>
          <span class="url">${escapeHtml(rule.domains.join(', '))}</span>
        </div>
        ` : ''}
      </div>
      <div class="rule-actions">
        <button class="btn-edit" data-index="${actualIndex}">Edit</button>
        <button class="btn-duplicate" data-index="${actualIndex}">Duplicate</button>
        <button class="btn-delete" data-index="${actualIndex}">Delete</button>
      </div>
    </div>
  `;
  }).join('');
  
  // Add event listeners for rule cards
  container.querySelectorAll('.rule-enabled-toggle').forEach(toggle => {
    toggle.addEventListener('change', handleRuleToggle);
  });
  
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', handleEditRule);
  });
  
  container.querySelectorAll('.btn-duplicate').forEach(btn => {
    btn.addEventListener('click', handleDuplicateRule);
  });
  
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', handleDeleteRule);
  });
}

// Handle duplicate rule
async function handleDuplicateRule(e) {
  const index = parseInt(e.target.dataset.index);
  const rule = allRules[index];
  
  if (!rule) return;
  
  const newRule = {
    ...rule,
    id: generateId(),
    name: rule.name + ' (Copy)',
    createdAt: new Date().toISOString()
  };
  
  const updatedRules = [...allRules, newRule];
  await saveRules(updatedRules);
  
  await loadRules();
  showToast('Rule duplicated', 'success');
}

// Setup event listeners
function setupEventListeners() {
  // Global toggle
  document.getElementById('globalEnabled').addEventListener('change', handleGlobalToggle);
  
  // CSP toggle
  document.getElementById('stripCSP').addEventListener('change', handleCSPToggle);
  
  // Dark mode toggle
  document.getElementById('darkModeBtn').addEventListener('click', toggleDarkMode);
  
  // Profile selector
  document.getElementById('profileSelect').addEventListener('change', handleProfileChange);
  document.getElementById('profileMenuBtn').addEventListener('click', toggleProfileMenu);
  document.getElementById('newProfileBtn').addEventListener('click', handleNewProfile);
  document.getElementById('duplicateProfileBtn').addEventListener('click', handleDuplicateProfile);
  document.getElementById('renameProfileBtn').addEventListener('click', handleRenameProfile);
  document.getElementById('deleteProfileBtn').addEventListener('click', handleDeleteProfile);
  
  // Profile modal
  document.getElementById('profile-form').addEventListener('submit', handleProfileFormSubmit);
  document.getElementById('cancelProfile').addEventListener('click', closeProfileModal);
  
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', handleTabClick);
  });
  
  // Search
  document.getElementById('searchRules').addEventListener('input', handleSearch);
  
  // Add rule form toggle
  document.getElementById('toggleAddForm').addEventListener('click', toggleAddForm);
  document.getElementById('cancelAddRule').addEventListener('click', hideAddForm);
  
  // Rule type change (show/hide target URL)
  document.getElementById('ruleType').addEventListener('change', handleRuleTypeChange);
  
  // Add rule form
  document.getElementById('add-rule-form').addEventListener('submit', handleAddRule);
  
  // Regex toggle - update help text
  document.getElementById('useRegex').addEventListener('change', updatePatternHelp);
  
  // Edit form
  document.getElementById('edit-rule-form').addEventListener('submit', handleSaveEdit);
  document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
  document.getElementById('editRuleType').addEventListener('change', handleEditRuleTypeChange);
  
  // Import/Export
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('importBtn').addEventListener('click', handleImport);
  document.getElementById('clearAllBtn').addEventListener('click', handleClearAll);
  
  // Logs
  document.getElementById('clearLogsBtn').addEventListener('click', handleClearLogs);
  document.getElementById('resetStatsBtn').addEventListener('click', handleResetStats);
  
  // Debug tools
  document.getElementById('viewActiveRulesBtn').addEventListener('click', handleViewActiveRules);
  document.getElementById('testPatternBtn').addEventListener('click', handleTestPattern);
  
  // Close modals on outside click
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
  });
  document.getElementById('profileModal').addEventListener('click', (e) => {
    if (e.target.id === 'profileModal') closeProfileModal();
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-selector')) {
      document.getElementById('profileMenu').classList.add('hidden');
    }
  });
}

// Toggle dark mode
async function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  document.getElementById('darkModeBtn').textContent = isDark ? '☀️' : '🌙';
  await chrome.storage.local.set({ darkMode: isDark });
}

// Profile handlers
function toggleProfileMenu(e) {
  e.stopPropagation();
  document.getElementById('profileMenu').classList.toggle('hidden');
}

async function handleProfileChange(e) {
  const profileId = e.target.value;
  await chrome.runtime.sendMessage({ action: 'switchProfile', profileId });
  currentProfile = profileId;
  await loadRules();
  showToast('Profile switched', 'info');
}

let profileAction = 'new';

function handleNewProfile() {
  profileAction = 'new';
  document.getElementById('profileModalTitle').textContent = 'New Profile';
  document.getElementById('profileName').value = '';
  document.getElementById('profileModal').classList.add('active');
  document.getElementById('profileMenu').classList.add('hidden');
}

function handleDuplicateProfile() {
  profileAction = 'duplicate';
  document.getElementById('profileModalTitle').textContent = 'Duplicate Profile';
  document.getElementById('profileName').value = '';
  document.getElementById('profileModal').classList.add('active');
  document.getElementById('profileMenu').classList.add('hidden');
}

function handleRenameProfile() {
  if (currentProfile === 'default') {
    showToast('Cannot rename default profile', 'error');
    document.getElementById('profileMenu').classList.add('hidden');
    return;
  }
  profileAction = 'rename';
  document.getElementById('profileModalTitle').textContent = 'Rename Profile';
  // Get current profile name
  const select = document.getElementById('profileSelect');
  const currentName = select.options[select.selectedIndex].text;
  document.getElementById('profileName').value = currentName;
  document.getElementById('profileModal').classList.add('active');
  document.getElementById('profileMenu').classList.add('hidden');
}

async function handleDeleteProfile() {
  document.getElementById('profileMenu').classList.add('hidden');
  if (currentProfile === 'default') {
    showToast('Cannot delete default profile', 'error');
    return;
  }
  if (!confirm('Delete this profile and all its rules?')) return;
  
  await chrome.runtime.sendMessage({ action: 'deleteProfile', profileId: currentProfile });
  currentProfile = 'default';
  await loadProfiles();
  await loadRules();
  showToast('Profile deleted', 'info');
}

async function handleProfileFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('profileName').value.trim();
  if (!name) return;
  
  if (profileAction === 'new') {
    const response = await chrome.runtime.sendMessage({ action: 'createProfile', name });
    showToast('Profile created', 'success');
  } else if (profileAction === 'duplicate') {
    await chrome.runtime.sendMessage({ action: 'duplicateProfile', profileId: currentProfile, newName: name });
    showToast('Profile duplicated', 'success');
  } else if (profileAction === 'rename') {
    await chrome.runtime.sendMessage({ action: 'renameProfile', profileId: currentProfile, newName: name });
    showToast('Profile renamed', 'success');
  }
  
  closeProfileModal();
  await loadProfiles();
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('active');
}

// Search handler
function handleSearch(e) {
  const filter = e.target.value.trim();
  renderRules(allRules, filter);
}

// Rule type change handler
function handleRuleTypeChange() {
  const ruleType = document.getElementById('ruleType').value;
  const targetGroup = document.getElementById('targetUrlGroup');
  const targetInput = document.getElementById('targetUrl');
  
  if (ruleType === 'block') {
    targetGroup.style.display = 'none';
    targetInput.removeAttribute('required');
  } else {
    targetGroup.style.display = 'block';
    targetInput.setAttribute('required', 'required');
  }
}

function handleEditRuleTypeChange() {
  const ruleType = document.getElementById('editRuleType').value;
  const targetGroup = document.getElementById('editTargetUrlGroup');
  
  if (ruleType === 'block') {
    targetGroup.style.display = 'none';
  } else {
    targetGroup.style.display = 'block';
  }
}

// Toggle add form visibility
function toggleAddForm() {
  const container = document.getElementById('addRuleFormContainer');
  const btn = document.getElementById('toggleAddForm');
  
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    btn.innerHTML = '<span class="btn-icon">−</span> Cancel';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    document.getElementById('ruleName').focus();
  } else {
    hideAddForm();
  }
}

// Hide add form
function hideAddForm() {
  const container = document.getElementById('addRuleFormContainer');
  const btn = document.getElementById('toggleAddForm');
  
  container.classList.add('hidden');
  btn.innerHTML = '<span class="btn-icon">+</span> Add New Rule';
  btn.classList.remove('btn-secondary');
  btn.classList.add('btn-primary');
  document.getElementById('add-rule-form').reset();
  document.getElementById('priority').value = '1';
  document.getElementById('ruleType').value = 'redirect';
  handleRuleTypeChange();
}

// Update pattern help text based on regex toggle
function updatePatternHelp() {
  const useRegex = document.getElementById('useRegex').checked;
  const hintEl = document.getElementById('patternHint');
  
  if (hintEl) {
    if (useRegex) {
      hintEl.textContent = 'Using regex (.*\\.js)';
      hintEl.style.color = '#dc3545';
    } else {
      hintEl.textContent = 'Using wildcards (*)';
      hintEl.style.color = '#667eea';
    }
  }
}

// Handle global toggle
async function handleGlobalToggle(e) {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ globalEnabled: enabled });
  document.getElementById('globalStatus').textContent = enabled ? 'Enabled' : 'Disabled';
  showToast(enabled ? 'HotSwap enabled' : 'HotSwap disabled', 'info');
}

// Handle CSP toggle
async function handleCSPToggle(e) {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ stripCSP: enabled });
  showToast(enabled ? 'CSP stripping enabled' : 'CSP stripping disabled', 'info');
}

// Handle tab click
function handleTabClick(e) {
  const tabName = e.target.dataset.tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
  
  if (tabName === 'logs') {
    loadLogs();
    loadStats();
  }
}

// Handle add rule
async function handleAddRule(e) {
  e.preventDefault();
  
  const name = document.getElementById('ruleName').value.trim();
  const ruleType = document.getElementById('ruleType').value;
  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const targetUrl = document.getElementById('targetUrl').value.trim();
  const domainsInput = document.getElementById('domains').value.trim();
  const priority = parseInt(document.getElementById('priority').value) || 1;
  const useRegex = document.getElementById('useRegex').checked;
  
  const resourceTypes = Array.from(document.querySelectorAll('input[name="resourceType"]:checked'))
    .map(cb => cb.value);
  
  const domains = domainsInput ? domainsInput.split(',').map(d => d.trim()).filter(d => d) : [];
  
  const newRule = {
    id: generateId(),
    name,
    ruleType,
    sourceUrl,
    targetUrl: ruleType !== 'block' ? targetUrl : '',
    domains,
    resourceTypes,
    priority,
    useRegex,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  const updatedRules = [...allRules, newRule];
  await saveRules(updatedRules);
  
  e.target.reset();
  document.getElementById('priority').value = '1';
  hideAddForm();
  
  await loadRules();
  showToast('Rule added successfully', 'success');
}

// Handle rule toggle
async function handleRuleToggle(e) {
  const index = parseInt(e.target.dataset.index);
  const enabled = e.target.checked;
  
  if (allRules[index]) {
    const updatedRules = [...allRules];
    updatedRules[index] = { ...updatedRules[index], enabled };
    await saveRules(updatedRules);
    await loadRules();
    showToast(enabled ? 'Rule enabled' : 'Rule disabled', 'info');
  }
}

// Handle edit rule
async function handleEditRule(e) {
  const index = parseInt(e.target.dataset.index);
  const rule = allRules[index];
  
  if (!rule) return;
  
  document.getElementById('editIndex').value = index;
  document.getElementById('editRuleName').value = rule.name;
  document.getElementById('editRuleType').value = rule.ruleType || 'redirect';
  document.getElementById('editSourceUrl').value = rule.sourceUrl;
  document.getElementById('editTargetUrl').value = rule.targetUrl || '';
  document.getElementById('editDomains').value = rule.domains ? rule.domains.join(', ') : '';
  document.getElementById('editPriority').value = rule.priority || 1;
  document.getElementById('editUseRegex').checked = rule.useRegex || false;
  
  handleEditRuleTypeChange();
  document.getElementById('editModal').classList.add('active');
}

// Handle save edit
async function handleSaveEdit(e) {
  e.preventDefault();
  
  const index = parseInt(document.getElementById('editIndex').value);
  
  if (!allRules[index]) return;
  
  const updatedRules = [...allRules];
  updatedRules[index] = {
    ...updatedRules[index],
    name: document.getElementById('editRuleName').value.trim(),
    ruleType: document.getElementById('editRuleType').value,
    sourceUrl: document.getElementById('editSourceUrl').value.trim(),
    targetUrl: document.getElementById('editTargetUrl').value.trim(),
    priority: parseInt(document.getElementById('editPriority').value) || 1,
    useRegex: document.getElementById('editUseRegex').checked,
    domains: document.getElementById('editDomains').value.trim()
      ? document.getElementById('editDomains').value.trim().split(',').map(d => d.trim()).filter(d => d)
      : []
  };
  
  await saveRules(updatedRules);
  
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
  
  if (!confirm('Are you sure you want to delete this rule?')) return;
  
  const updatedRules = allRules.filter((_, i) => i !== index);
  await saveRules(updatedRules);
  
  await loadRules();
  showToast('Rule deleted', 'info');
}

// Handle export
async function handleExport() {
  const storage = await chrome.storage.local.get(['globalEnabled', 'profiles', 'activeProfile']);
  // Export current profile's rules
  const exportData = JSON.stringify({
    rules: allRules,
    globalEnabled: storage.globalEnabled,
    activeProfile: storage.activeProfile,
    profiles: storage.profiles
  }, null, 2);
  
  await navigator.clipboard.writeText(exportData);
  
  const blob = new Blob([exportData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hotswap-${currentProfile}-${new Date().toISOString().split('T')[0]}.json`;
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
      if (allRules.length > 0) {
        const merge = confirm('Do you want to merge with existing rules? Click Cancel to replace all.');
        
        if (merge) {
          const mergedRules = [...allRules, ...data.rules];
          await saveRules(mergedRules);
        } else {
          await saveRules(data.rules);
        }
      } else {
        await saveRules(data.rules);
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
  if (!confirm('Are you sure you want to delete ALL rules in this profile? This cannot be undone.')) return;
  
  await saveRules([]);
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
    container.innerHTML = '<p class="empty-state">No activity logged yet. Activity will appear here when URLs match your rules.</p>';
    return;
  }
  
  container.innerHTML = logs.map(log => {
    const ruleType = log.ruleType || 'redirect';
    const typeClass = ruleType === 'block' ? 'block' : 'success';
    
    return `
    <div class="log-entry ${typeClass}">
      <div class="log-time">${formatTime(log.timestamp)}</div>
      <div class="log-from">
        <span class="log-label">URL:</span>
        <span class="log-url full-url">${escapeHtml(log.requestUrl)}</span>
      </div>
      ${ruleType !== 'block' && log.targetUrl ? `
      <div class="log-to">
        <span class="log-label">To:</span>
        <span class="log-url full-url">${escapeHtml(log.targetUrl)}</span>
      </div>
      ` : ''}
      <div class="log-meta">
        <span>Rule: ${escapeHtml(log.ruleName || 'Rule #' + log.ruleId)}</span>
        <span>Type: ${log.type}</span>
        <span>Action: ${ruleType.toUpperCase()}</span>
      </div>
    </div>
  `;
  }).join('');
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

// Handle reset stats
async function handleResetStats() {
  await chrome.runtime.sendMessage({ action: 'resetStats' });
  await loadStats();
  await loadLogs();
  showToast('Stats and logs reset', 'info');
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
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}
