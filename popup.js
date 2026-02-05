// HotSwap v1.1.1.0 - Popup script
// Author: Krunal Patel

document.addEventListener('DOMContentLoaded', init);

// Global state
let currentProfile = 'default';
let allRules = [];
let statsInterval = null;
let selectedRules = new Set();
let undoStack = [];
let redoStack = [];
let selectedRuleIndex = -1;
let isRecording = false;
let recordedRequests = [];
let currentDomain = null;
let pendingRule = null;

async function init() {
  await loadTheme();
  await loadProfiles();
  await loadGlobalState();
  await loadRules();
  await loadStats();
  await checkPendingUrl();
  await getCurrentDomain();
  setupEventListeners();
  setupKeyboardNavigation();
  startStatsPolling();
  updateGroupFilter();
}

// Stats polling
function startStatsPolling() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(loadStats, 2000);
}

window.addEventListener('unload', () => {
  if (statsInterval) clearInterval(statsInterval);
});

// Load theme
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

// Load global state
async function loadGlobalState() {
  const { globalEnabled = true, stripCSP = true } = await chrome.storage.local.get(['globalEnabled', 'stripCSP']);
  document.getElementById('globalEnabled').checked = globalEnabled;
  document.getElementById('globalStatus').textContent = globalEnabled ? 'Enabled' : 'Disabled';
  document.getElementById('stripCSP').checked = stripCSP;
}

// Load rules
async function loadRules() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getActiveRulesForProfile' });
    allRules = response.rules || [];
    renderRules(allRules);
    updateGroupFilter();
    document.getElementById('activeRulesCount').textContent = allRules.filter(r => r.enabled).length;
  } catch (err) {
    console.error('Error loading rules:', err);
    allRules = [];
    renderRules([]);
  }
}

// Save rules with undo support
async function saveRules(rules, skipUndo = false) {
  if (!skipUndo) {
    undoStack.push(JSON.stringify(allRules));
    redoStack = [];
    updateUndoRedoButtons();
  }
  await chrome.runtime.sendMessage({ action: 'saveRulesForProfile', rules });
  allRules = rules;
  setTimeout(loadStats, 500);
}

// Load stats
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStats' });
    document.getElementById('totalRedirects').textContent = response.redirectCount || 0;
    document.getElementById('totalBlocks').textContent = response.blockCount || 0;
    document.getElementById('totalHeaders').textContent = response.headerCount || 0;
    document.getElementById('activeRulesCount').textContent = allRules.filter(r => r.enabled).length;
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// Get current domain
async function getCurrentDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      currentDomain = url.hostname;
      document.getElementById('currentDomain').textContent = currentDomain.length > 15 
        ? currentDomain.substring(0, 15) + '...' 
        : currentDomain;
      updateDomainToggleState();
    }
  } catch (err) {
    console.error('Error getting domain:', err);
  }
}

// Update domain toggle state
function updateDomainToggleState() {
  if (!currentDomain) return;
  const btn = document.getElementById('domainToggleBtn');
  const hasActiveRulesForDomain = allRules.some(r => 
    r.enabled && r.domains && r.domains.includes(currentDomain)
  );
  btn.classList.toggle('active', hasActiveRulesForDomain);
}

// Check pending URL
async function checkPendingUrl() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getPendingUrl' });
    if (response.url) {
      toggleAddForm();
      document.getElementById('sourceUrl').value = response.url;
      document.getElementById('ruleName').focus();
    }
  } catch (err) {
    console.error('Error checking pending URL:', err);
  }
}

// Update group filter dropdown
function updateGroupFilter() {
  const groups = [...new Set(allRules.map(r => r.group).filter(g => g))];
  const select = document.getElementById('filterGroup');
  const currentValue = select.value;
  select.innerHTML = '<option value="">All Groups</option>' + 
    groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  select.value = currentValue;
  
  // Update datalists for group inputs
  const datalist = document.getElementById('groupsList');
  const editDatalist = document.getElementById('editGroupsList');
  if (datalist) datalist.innerHTML = groups.map(g => `<option value="${escapeHtml(g)}">`).join('');
  if (editDatalist) editDatalist.innerHTML = groups.map(g => `<option value="${escapeHtml(g)}">`).join('');
}

// Render rules
function renderRules(rules, filter = '', groupFilter = '') {
  const container = document.getElementById('rules-list');
  
  // Apply filters
  let filteredRules = rules;
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    filteredRules = filteredRules.filter(rule => 
      rule.name.toLowerCase().includes(lowerFilter) ||
      rule.sourceUrl.toLowerCase().includes(lowerFilter) ||
      (rule.targetUrl && rule.targetUrl.toLowerCase().includes(lowerFilter)) ||
      (rule.group && rule.group.toLowerCase().includes(lowerFilter))
    );
  }
  if (groupFilter) {
    filteredRules = filteredRules.filter(rule => rule.group === groupFilter);
  }
  
  if (filteredRules.length === 0) {
    container.innerHTML = filter || groupFilter
      ? '<p class="empty-state">No rules match your filter.</p>'
      : '<p class="empty-state">No rules configured. Click "Add Rule" to get started.</p>';
    return;
  }
  
  container.innerHTML = filteredRules.map((rule, idx) => {
    const actualIndex = allRules.findIndex(r => r.id === rule.id);
    const ruleType = rule.ruleType || 'redirect';
    const isSelected = selectedRuleIndex === actualIndex;
    const isChecked = selectedRules.has(rule.id);
    
    return `
    <div class="rule-card ${rule.enabled ? '' : 'disabled'} ${isSelected ? 'selected' : ''}" 
         data-index="${actualIndex}" data-id="${rule.id}" data-color="${rule.color || ''}" draggable="true">
      <div class="rule-card-inner">
        <input type="checkbox" class="rule-checkbox" ${isChecked ? 'checked' : ''} data-id="${rule.id}">
        <span class="rule-drag-handle">⋮⋮</span>
        <div class="rule-content">
          <div class="rule-header">
            <div class="rule-name-row">
              <span class="rule-name">${escapeHtml(rule.name)}</span>
              <span class="rule-type-badge ${ruleType}">${ruleType.toUpperCase()}</span>
              ${rule.useRegex ? '<span class="rule-badge regex">REGEX</span>' : ''}
              ${rule.group ? `<span class="rule-badge group">${escapeHtml(rule.group)}</span>` : ''}
            </div>
            <div class="rule-toggle">
              <label class="switch">
                <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-index="${actualIndex}" class="rule-enabled-toggle">
                <span class="slider"></span>
              </label>
            </div>
          </div>
          <div class="rule-urls">
            <div class="url-row"><span class="label">From:</span><span class="url">${escapeHtml(rule.sourceUrl)}</span></div>
            ${ruleType === 'redirect' && rule.targetUrl ? `<div class="url-row"><span class="label">To:</span><span class="url">${escapeHtml(rule.targetUrl)}</span></div>` : ''}
            ${rule.headers && rule.headers.length > 0 ? `<div class="url-row"><span class="label">Headers:</span><span class="url">${rule.headers.length} modification(s)</span></div>` : ''}
          </div>
          <div class="rule-actions">
            <button class="btn-edit" data-index="${actualIndex}">Edit</button>
            <button class="btn-duplicate" data-index="${actualIndex}">Copy</button>
            <button class="btn-delete" data-index="${actualIndex}">Delete</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  
  // Event listeners
  container.querySelectorAll('.rule-enabled-toggle').forEach(t => t.addEventListener('change', handleRuleToggle));
  container.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', handleEditRule));
  container.querySelectorAll('.btn-duplicate').forEach(b => b.addEventListener('click', handleDuplicateRule));
  container.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', handleDeleteRule));
  container.querySelectorAll('.rule-checkbox').forEach(c => c.addEventListener('change', handleRuleSelect));
  container.querySelectorAll('.rule-card').forEach(c => {
    c.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.rule-drag-handle')) {
        selectedRuleIndex = parseInt(c.dataset.index);
        renderRules(allRules, document.getElementById('searchRules').value, document.getElementById('filterGroup').value);
      }
    });
  });
  
  // Drag and drop
  setupDragAndDrop();
  updateBulkActionsVisibility();
}

// Setup drag and drop
function setupDragAndDrop() {
  const container = document.getElementById('rules-list');
  let draggedItem = null;
  
  container.querySelectorAll('.rule-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedItem = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedItem = null;
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedItem && draggedItem !== card) {
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          card.parentNode.insertBefore(draggedItem, card);
        } else {
          card.parentNode.insertBefore(draggedItem, card.nextSibling);
        }
      }
    });
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      // Reorder rules based on DOM order
      const newOrder = [...container.querySelectorAll('.rule-card')].map(c => c.dataset.id);
      const reorderedRules = newOrder.map(id => allRules.find(r => r.id === id)).filter(Boolean);
      await saveRules(reorderedRules);
      await loadRules();
      showToast('Rules reordered', 'success');
    });
  });
}

// Handle rule selection
function handleRuleSelect(e) {
  const id = e.target.dataset.id;
  if (e.target.checked) {
    selectedRules.add(id);
  } else {
    selectedRules.delete(id);
  }
  updateBulkActionsVisibility();
}

// Update bulk actions visibility
function updateBulkActionsVisibility() {
  const bulkActions = document.getElementById('bulkActions');
  const selectAllRow = document.getElementById('selectAllRow');
  const selectedCount = document.getElementById('selectedCount');
  
  if (selectedRules.size > 0) {
    bulkActions.classList.remove('hidden');
    selectAllRow.classList.remove('hidden');
    selectedCount.textContent = selectedRules.size;
  } else {
    bulkActions.classList.add('hidden');
    selectAllRow.classList.add('hidden');
  }
}

// Setup event listeners
function setupEventListeners() {
  // Global toggle
  document.getElementById('globalEnabled').addEventListener('change', handleGlobalToggle);
  document.getElementById('stripCSP').addEventListener('change', handleCSPToggle);
  document.getElementById('darkModeBtn').addEventListener('click', toggleDarkMode);
  
  // Undo/Redo
  document.getElementById('undoBtn').addEventListener('click', handleUndo);
  document.getElementById('redoBtn').addEventListener('click', handleRedo);
  
  // Domain toggle
  document.getElementById('domainToggleBtn').addEventListener('click', handleDomainToggle);
  
  // Profile
  document.getElementById('profileSelect').addEventListener('change', handleProfileChange);
  document.getElementById('profileMenuBtn').addEventListener('click', toggleProfileMenu);
  document.getElementById('newProfileBtn').addEventListener('click', handleNewProfile);
  document.getElementById('duplicateProfileBtn').addEventListener('click', handleDuplicateProfile);
  document.getElementById('renameProfileBtn').addEventListener('click', handleRenameProfile);
  document.getElementById('deleteProfileBtn').addEventListener('click', handleDeleteProfile);
  document.getElementById('profile-form').addEventListener('submit', handleProfileFormSubmit);
  document.getElementById('cancelProfile').addEventListener('click', closeProfileModal);
  
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', handleTabClick));
  
  // Search & Filter
  document.getElementById('searchRules').addEventListener('input', handleSearch);
  document.getElementById('filterGroup').addEventListener('change', handleSearch);
  
  // Bulk actions
  document.getElementById('selectAllRules').addEventListener('change', handleSelectAll);
  document.getElementById('bulkDeleteBtn').addEventListener('click', () => handleBulkAction('delete'));
  
  // Add rule form
  document.getElementById('toggleAddForm').addEventListener('click', toggleAddForm);
  document.getElementById('cancelAddRule').addEventListener('click', hideAddForm);
  document.getElementById('ruleType').addEventListener('change', handleRuleTypeChange);
  document.getElementById('add-rule-form').addEventListener('submit', handleAddRule);
  document.getElementById('useRegex').addEventListener('change', updatePatternHelp);
  document.getElementById('addHeaderBtn').addEventListener('click', () => addHeaderRow('headersList'));
  
  // Color picker
  document.querySelectorAll('.color-picker .color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const picker = e.target.closest('.color-picker');
      picker.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      const input = picker.nextElementSibling || document.getElementById('ruleColor');
      if (input) input.value = e.target.dataset.color;
    });
  });
  
  // Edit form
  document.getElementById('edit-rule-form').addEventListener('submit', handleSaveEdit);
  document.getElementById('cancelEdit').addEventListener('click', closeEditModal);
  document.getElementById('editRuleType').addEventListener('change', handleEditRuleTypeChange);
  document.getElementById('editAddHeaderBtn')?.addEventListener('click', () => addHeaderRow('editHeadersList'));
  
  // Duplicate warning modal
  document.getElementById('addAnyway').addEventListener('click', handleAddAnyway);
  document.getElementById('cancelDuplicate').addEventListener('click', closeDuplicateModal);
  
  // Import/Export
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('exportStatsBtn').addEventListener('click', handleExportStats);
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCsv);
  document.getElementById('importBtn').addEventListener('click', handleImport);
  document.getElementById('clearAllBtn').addEventListener('click', handleClearAll);
  
  // Logs
  document.getElementById('clearLogsBtn').addEventListener('click', handleClearLogs);
  document.getElementById('resetStatsBtn').addEventListener('click', handleResetStats);
  document.getElementById('recordRequests').addEventListener('change', toggleRecording);
  document.getElementById('clearRecordingBtn').addEventListener('click', clearRecording);
  
  // Debug
  document.getElementById('viewActiveRulesBtn').addEventListener('click', handleViewActiveRules);
  document.getElementById('testPatternBtn').addEventListener('click', handleTestPattern);
  
  // Modal close on outside click
  ['editModal', 'profileModal', 'duplicateModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target.id === id) document.getElementById(id).classList.remove('active');
    });
  });
  
  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.profile-selector')) {
      document.getElementById('profileMenu').classList.add('hidden');
    }
  });
}

// Setup keyboard navigation
function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Only handle when rules tab is active
    if (!document.getElementById('rules-tab').classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedRuleIndex = Math.min(selectedRuleIndex + 1, allRules.length - 1);
        renderRules(allRules, document.getElementById('searchRules').value, document.getElementById('filterGroup').value);
        scrollToSelectedRule();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedRuleIndex = Math.max(selectedRuleIndex - 1, 0);
        renderRules(allRules, document.getElementById('searchRules').value, document.getElementById('filterGroup').value);
        scrollToSelectedRule();
        break;
      case 'Enter':
        if (selectedRuleIndex >= 0) {
          e.preventDefault();
          handleEditRule({ target: { dataset: { index: selectedRuleIndex } } });
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedRuleIndex >= 0 && !e.target.closest('input')) {
          e.preventDefault();
          handleDeleteRule({ target: { dataset: { index: selectedRuleIndex } } });
        }
        break;
      case ' ':
        if (selectedRuleIndex >= 0 && !e.target.closest('input')) {
          e.preventDefault();
          const rule = allRules[selectedRuleIndex];
          if (rule) toggleRuleEnabled(selectedRuleIndex, !rule.enabled);
        }
        break;
      case 'z':
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        }
        break;
      case 'y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleRedo();
        }
        break;
    }
  });
}

function scrollToSelectedRule() {
  const selected = document.querySelector('.rule-card.selected');
  if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Undo/Redo
async function handleUndo() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify(allRules));
  const previousState = JSON.parse(undoStack.pop());
  await saveRules(previousState, true);
  await loadRules();
  updateUndoRedoButtons();
  showToast('Undone', 'info');
}

async function handleRedo() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify(allRules));
  const nextState = JSON.parse(redoStack.pop());
  await saveRules(nextState, true);
  await loadRules();
  updateUndoRedoButtons();
  showToast('Redone', 'info');
}

function updateUndoRedoButtons() {
  document.getElementById('undoBtn').disabled = undoStack.length === 0;
  document.getElementById('redoBtn').disabled = redoStack.length === 0;
}

// Toggle dark mode
async function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  document.getElementById('darkModeBtn').textContent = isDark ? '☀️' : '🌙';
  await chrome.storage.local.set({ darkMode: isDark });
}

// Domain toggle
async function handleDomainToggle() {
  if (!currentDomain) return;
  const rulesForDomain = allRules.filter(r => r.domains && r.domains.includes(currentDomain));
  if (rulesForDomain.length === 0) {
    showToast(`No rules configured for ${currentDomain}`, 'info');
    return;
  }
  const allEnabled = rulesForDomain.every(r => r.enabled);
  const updatedRules = allRules.map(r => {
    if (r.domains && r.domains.includes(currentDomain)) {
      return { ...r, enabled: !allEnabled };
    }
    return r;
  });
  await saveRules(updatedRules);
  await loadRules();
  showToast(allEnabled ? 'Rules disabled for domain' : 'Rules enabled for domain', 'info');
}

// Profile handlers
function toggleProfileMenu(e) {
  e.stopPropagation();
  document.getElementById('profileMenu').classList.toggle('hidden');
}

async function handleProfileChange(e) {
  await chrome.runtime.sendMessage({ action: 'switchProfile', profileId: e.target.value });
  currentProfile = e.target.value;
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
  const select = document.getElementById('profileSelect');
  document.getElementById('profileName').value = select.options[select.selectedIndex].text;
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
  
  if (profileAction === 'new') await chrome.runtime.sendMessage({ action: 'createProfile', name });
  else if (profileAction === 'duplicate') await chrome.runtime.sendMessage({ action: 'duplicateProfile', profileId: currentProfile, newName: name });
  else if (profileAction === 'rename') await chrome.runtime.sendMessage({ action: 'renameProfile', profileId: currentProfile, newName: name });
  
  closeProfileModal();
  await loadProfiles();
  showToast(`Profile ${profileAction === 'new' ? 'created' : profileAction === 'rename' ? 'renamed' : 'duplicated'}`, 'success');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('active');
}

// Bulk actions
function handleSelectAll(e) {
  if (e.target.checked) {
    allRules.forEach(r => selectedRules.add(r.id));
  } else {
    selectedRules.clear();
  }
  renderRules(allRules, document.getElementById('searchRules').value, document.getElementById('filterGroup').value);
}

async function handleBulkAction(action) {
  if (selectedRules.size === 0) return;
  
  if (action === 'delete' && !confirm(`Delete ${selectedRules.size} selected rules?`)) return;
  
  let updatedRules = [...allRules];
  if (action === 'enable') {
    updatedRules = updatedRules.map(r => selectedRules.has(r.id) ? { ...r, enabled: true } : r);
  } else if (action === 'disable') {
    updatedRules = updatedRules.map(r => selectedRules.has(r.id) ? { ...r, enabled: false } : r);
  } else if (action === 'delete') {
    updatedRules = updatedRules.filter(r => !selectedRules.has(r.id));
  }
  
  await saveRules(updatedRules);
  selectedRules.clear();
  await loadRules();
  showToast(`${action === 'delete' ? 'Deleted' : action === 'enable' ? 'Enabled' : 'Disabled'} selected rules`, 'success');
}

// Search
function handleSearch() {
  const filter = document.getElementById('searchRules').value.trim();
  const groupFilter = document.getElementById('filterGroup').value;
  renderRules(allRules, filter, groupFilter);
}

// Global toggle
async function handleGlobalToggle(e) {
  await chrome.storage.local.set({ globalEnabled: e.target.checked });
  document.getElementById('globalStatus').textContent = e.target.checked ? 'Enabled' : 'Disabled';
  showToast(e.target.checked ? 'HotSwap enabled' : 'HotSwap disabled', 'info');
}

async function handleCSPToggle(e) {
  await chrome.storage.local.set({ stripCSP: e.target.checked });
  showToast(e.target.checked ? 'CSP stripping enabled' : 'CSP stripping disabled', 'info');
}

// Tabs
function handleTabClick(e) {
  const tabName = e.target.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `${tabName}-tab`));
  if (tabName === 'logs') { loadLogs(); loadStats(); }
}

// Rule type change
function handleRuleTypeChange() {
  const type = document.getElementById('ruleType').value;
  document.getElementById('targetUrlGroup').style.display = type === 'block' ? 'none' : 'block';
  document.getElementById('headersSection').classList.toggle('hidden', type !== 'modifyHeaders');
  if (type !== 'block') document.getElementById('targetUrl').required = type === 'redirect';
}

function handleEditRuleTypeChange() {
  const type = document.getElementById('editRuleType').value;
  document.getElementById('editTargetUrlGroup').style.display = type === 'block' ? 'none' : 'block';
  document.getElementById('editHeadersSection').classList.toggle('hidden', type !== 'modifyHeaders');
}

// Add header row
function addHeaderRow(containerId, header = null) {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'header-row';
  row.innerHTML = `
    <select class="header-operation">
      <option value="set" ${header?.operation === 'set' ? 'selected' : ''}>Set</option>
      <option value="remove" ${header?.operation === 'remove' ? 'selected' : ''}>Remove</option>
      <option value="append" ${header?.operation === 'append' ? 'selected' : ''}>Append</option>
    </select>
    <select class="header-type">
      <option value="request" ${header?.type === 'request' ? 'selected' : ''}>Request</option>
      <option value="response" ${header?.type === 'response' ? 'selected' : ''}>Response</option>
    </select>
    <input type="text" class="header-name" placeholder="Header name" value="${escapeHtml(header?.name || '')}">
    <input type="text" class="header-value" placeholder="Value" value="${escapeHtml(header?.value || '')}">
    <button type="button" class="btn-remove-header">×</button>
  `;
  row.querySelector('.btn-remove-header').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

// Get headers from form
function getHeadersFromForm(containerId) {
  const container = document.getElementById(containerId);
  const rows = container.querySelectorAll('.header-row');
  return [...rows].map(row => ({
    operation: row.querySelector('.header-operation').value,
    type: row.querySelector('.header-type').value,
    name: row.querySelector('.header-name').value.trim(),
    value: row.querySelector('.header-value').value.trim()
  })).filter(h => h.name);
}

// Toggle add form
function toggleAddForm() {
  const container = document.getElementById('addRuleFormContainer');
  const btn = document.getElementById('toggleAddForm');
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    btn.innerHTML = '<span class="btn-icon">−</span> Cancel';
    btn.classList.replace('btn-primary', 'btn-secondary');
    document.getElementById('ruleName').focus();
  } else {
    hideAddForm();
  }
}

function hideAddForm() {
  document.getElementById('addRuleFormContainer').classList.add('hidden');
  const btn = document.getElementById('toggleAddForm');
  btn.innerHTML = '<span class="btn-icon">+</span> Add Rule';
  btn.classList.replace('btn-secondary', 'btn-primary');
  document.getElementById('add-rule-form').reset();
  document.getElementById('headersList').innerHTML = `<div class="header-row">
    <select class="header-operation"><option value="set">Set</option><option value="remove">Remove</option><option value="append">Append</option></select>
    <select class="header-type"><option value="request">Request</option><option value="response">Response</option></select>
    <input type="text" class="header-name" placeholder="Header name"><input type="text" class="header-value" placeholder="Value">
    <button type="button" class="btn-remove-header">×</button>
  </div>`;
  handleRuleTypeChange();
}

function updatePatternHelp() {
  const hint = document.getElementById('patternHint');
  if (document.getElementById('useRegex').checked) {
    hint.textContent = 'Regex (.*\\.js)';
    hint.style.color = '#dc3545';
  } else {
    hint.textContent = 'Wildcards (*)';
    hint.style.color = '#667eea';
  }
}

// Check for duplicate
function checkDuplicate(sourceUrl) {
  return allRules.find(r => r.sourceUrl === sourceUrl);
}

// Add rule
async function handleAddRule(e) {
  e.preventDefault();
  
  const name = document.getElementById('ruleName').value.trim();
  const ruleType = document.getElementById('ruleType').value;
  const sourceUrl = document.getElementById('sourceUrl').value.trim();
  const targetUrl = document.getElementById('targetUrl').value.trim();
  const group = document.getElementById('ruleGroup').value.trim();
  const color = document.getElementById('ruleColor').value;
  const domainsInput = document.getElementById('domains').value.trim();
  const priority = parseInt(document.getElementById('priority').value) || 1;
  const useRegex = document.getElementById('useRegex').checked;
  const headers = ruleType === 'modifyHeaders' ? getHeadersFromForm('headersList') : [];
  const resourceTypes = [...document.querySelectorAll('input[name="resourceType"]:checked')].map(c => c.value);
  const domains = domainsInput ? domainsInput.split(',').map(d => d.trim()).filter(Boolean) : [];
  
  // Check for duplicate
  const duplicate = checkDuplicate(sourceUrl);
  if (duplicate) {
    pendingRule = { name, ruleType, sourceUrl, targetUrl, group, color, domains, resourceTypes, priority, useRegex, headers };
    document.getElementById('duplicateMessage').textContent = `A rule with pattern "${sourceUrl}" already exists (${duplicate.name}).`;
    document.getElementById('duplicateModal').classList.add('active');
    return;
  }
  
  await addNewRule({ name, ruleType, sourceUrl, targetUrl, group, color, domains, resourceTypes, priority, useRegex, headers });
}

async function addNewRule(ruleData) {
  const newRule = {
    id: generateId(),
    ...ruleData,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  await saveRules([...allRules, newRule]);
  hideAddForm();
  await loadRules();
  showToast('Rule added', 'success');
}

function handleAddAnyway() {
  closeDuplicateModal();
  if (pendingRule) {
    addNewRule(pendingRule);
    pendingRule = null;
  }
}

function closeDuplicateModal() {
  document.getElementById('duplicateModal').classList.remove('active');
}

// Toggle rule
async function handleRuleToggle(e) {
  const index = parseInt(e.target.dataset.index);
  await toggleRuleEnabled(index, e.target.checked);
}

async function toggleRuleEnabled(index, enabled) {
  if (allRules[index]) {
    const updatedRules = [...allRules];
    updatedRules[index] = { ...updatedRules[index], enabled };
    await saveRules(updatedRules);
    await loadRules();
    showToast(enabled ? 'Rule enabled' : 'Rule disabled', 'info');
  }
}

// Edit rule
function handleEditRule(e) {
  const index = parseInt(e.target.dataset.index);
  const rule = allRules[index];
  if (!rule) return;
  
  document.getElementById('editIndex').value = index;
  document.getElementById('editRuleName').value = rule.name;
  document.getElementById('editRuleType').value = rule.ruleType || 'redirect';
  document.getElementById('editSourceUrl').value = rule.sourceUrl;
  document.getElementById('editTargetUrl').value = rule.targetUrl || '';
  document.getElementById('editRuleGroup').value = rule.group || '';
  document.getElementById('editRuleColor').value = rule.color || '';
  document.getElementById('editDomains').value = rule.domains ? rule.domains.join(', ') : '';
  document.getElementById('editPriority').value = rule.priority || 1;
  document.getElementById('editUseRegex').checked = rule.useRegex || false;
  
  // Color picker
  document.querySelectorAll('#editColorPicker .color-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === (rule.color || ''));
  });
  
  // Headers
  const headersList = document.getElementById('editHeadersList');
  headersList.innerHTML = '';
  if (rule.headers && rule.headers.length > 0) {
    rule.headers.forEach(h => addHeaderRow('editHeadersList', h));
  } else {
    addHeaderRow('editHeadersList');
  }
  
  handleEditRuleTypeChange();
  document.getElementById('editModal').classList.add('active');
}

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
    group: document.getElementById('editRuleGroup').value.trim(),
    color: document.getElementById('editRuleColor').value,
    priority: parseInt(document.getElementById('editPriority').value) || 1,
    useRegex: document.getElementById('editUseRegex').checked,
    headers: getHeadersFromForm('editHeadersList'),
    domains: document.getElementById('editDomains').value.trim()
      ? document.getElementById('editDomains').value.trim().split(',').map(d => d.trim()).filter(Boolean) : []
  };
  
  await saveRules(updatedRules);
  closeEditModal();
  await loadRules();
  showToast('Rule updated', 'success');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

// Delete rule
async function handleDeleteRule(e) {
  const index = parseInt(e.target.dataset.index);
  if (!confirm('Delete this rule?')) return;
  await saveRules(allRules.filter((_, i) => i !== index));
  await loadRules();
  showToast('Rule deleted', 'info');
}

// Duplicate rule
async function handleDuplicateRule(e) {
  const index = parseInt(e.target.dataset.index);
  const rule = allRules[index];
  if (!rule) return;
  await saveRules([...allRules, { ...rule, id: generateId(), name: rule.name + ' (Copy)', createdAt: new Date().toISOString() }]);
  await loadRules();
  showToast('Rule duplicated', 'success');
}

// Export/Import
async function handleExport() {
  const storage = await chrome.storage.local.get(['globalEnabled', 'profiles', 'activeProfile']);
  const data = JSON.stringify({ rules: allRules, ...storage }, null, 2);
  await navigator.clipboard.writeText(data);
  downloadFile(data, `hotswap-${currentProfile}-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
  showToast('Exported and copied to clipboard', 'success');
}

async function handleExportStats() {
  const response = await chrome.runtime.sendMessage({ action: 'getStats' });
  const csv = `Type,Count\nRedirects,${response.redirectCount || 0}\nBlocks,${response.blockCount || 0}\nActive Rules,${allRules.filter(r => r.enabled).length}`;
  downloadFile(csv, `hotswap-stats-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  showToast('Stats exported', 'success');
}

async function handleExportCsv() {
  const response = await chrome.runtime.sendMessage({ action: 'getLogs' });
  const logs = response.logs || [];
  const csv = 'Timestamp,Type,URL,Target,Rule\n' + logs.map(l => 
    `"${l.timestamp}","${l.ruleType || 'redirect'}","${l.requestUrl}","${l.targetUrl || ''}","${l.ruleName || ''}"`
  ).join('\n');
  downloadFile(csv, `hotswap-logs-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  showToast('Logs exported', 'success');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImport() {
  const text = document.getElementById('importData').value.trim();
  if (!text) { showToast('Paste configuration data', 'error'); return; }
  
  try {
    const data = JSON.parse(text);
    if (data.rules && Array.isArray(data.rules)) {
      if (allRules.length > 0) {
        const merge = confirm('Merge with existing rules? Cancel to replace all.');
        await saveRules(merge ? [...allRules, ...data.rules] : data.rules);
      } else {
        await saveRules(data.rules);
      }
      if (data.globalEnabled !== undefined) {
        await chrome.storage.local.set({ globalEnabled: data.globalEnabled });
        await loadGlobalState();
      }
      await loadRules();
      document.getElementById('importData').value = '';
      showToast('Imported successfully', 'success');
    } else {
      showToast('Invalid format', 'error');
    }
  } catch (err) {
    showToast('Invalid JSON', 'error');
  }
}

async function handleClearAll() {
  if (!confirm('Delete ALL rules in this profile?')) return;
  await saveRules([]);
  await loadRules();
  showToast('All rules cleared', 'info');
}

// Logs
async function loadLogs() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getLogs' });
    renderLogs(response.logs || []);
  } catch (err) {
    renderLogs([]);
  }
}

function renderLogs(logs) {
  const container = document.getElementById('logs-list');
  if (!logs.length) {
    container.innerHTML = '<p class="empty-state">No activity yet.</p>';
    return;
  }
  container.innerHTML = logs.map(log => {
    const type = log.ruleType || 'redirect';
    return `<div class="log-entry ${type === 'block' ? 'block' : type === 'modifyHeaders' ? 'headers' : 'success'}">
      <div class="log-time">${formatTime(log.timestamp)}</div>
      <div class="log-from"><span class="log-label">URL:</span><span class="log-url full-url">${escapeHtml(log.requestUrl)}</span></div>
      ${type === 'redirect' && log.targetUrl ? `<div class="log-to"><span class="log-label">To:</span><span class="log-url full-url">${escapeHtml(log.targetUrl)}</span></div>` : ''}
      <div class="log-meta"><span>Rule: ${escapeHtml(log.ruleName || 'Rule #' + log.ruleId)}</span><span>Type: ${type.toUpperCase()}</span></div>
    </div>`;
  }).join('');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString() + ' ' + d.toLocaleDateString();
}

async function handleClearLogs() {
  await chrome.runtime.sendMessage({ action: 'clearLogs' });
  await loadLogs();
  showToast('Logs cleared', 'info');
}

async function handleResetStats() {
  await chrome.runtime.sendMessage({ action: 'resetStats' });
  await loadStats();
  await loadLogs();
  showToast('Stats reset', 'info');
}

// Recording
function toggleRecording(e) {
  isRecording = e.target.checked;
  document.getElementById('recordedRequests').classList.toggle('hidden', !isRecording);
  if (isRecording) {
    chrome.runtime.sendMessage({ action: 'startRecording' });
    showToast('Recording started', 'info');
  } else {
    chrome.runtime.sendMessage({ action: 'stopRecording' });
  }
}

function clearRecording() {
  recordedRequests = [];
  document.getElementById('recordedList').innerHTML = '';
}

// Debug
async function handleViewActiveRules() {
  const output = document.getElementById('activeRulesOutput');
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getActiveRules' });
    const rules = response.rules || [];
    if (rules.length === 0) {
      output.textContent = 'No active rules. Your patterns may be invalid.';
      output.className = 'debug-output active error';
    } else {
      output.textContent = `${rules.length} active rules:\n\n` + rules.map(r => 
        `#${r.id}: ${r.action.type}\n  Filter: ${r.condition.urlFilter || r.condition.regexFilter || 'N/A'}\n  Resources: ${r.condition.resourceTypes?.join(', ')}`
      ).join('\n\n');
      output.className = 'debug-output active';
    }
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.className = 'debug-output active error';
  }
}

async function handleTestPattern() {
  const pattern = document.getElementById('testPattern').value.trim();
  const useRegex = document.getElementById('testUseRegex').checked;
  const testUrl = document.getElementById('testUrl').value.trim();
  const output = document.getElementById('testResult');
  
  if (!pattern || !testUrl) {
    output.textContent = 'Enter both pattern and URL';
    output.className = 'debug-output active error';
    return;
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'testPattern', pattern, useRegex, testUrl });
    if (response.error) {
      output.textContent = `INVALID: ${response.error}`;
      output.className = 'debug-output active error';
    } else if (response.matches) {
      output.textContent = '✓ MATCH!';
      output.className = 'debug-output active success';
    } else {
      output.textContent = '✗ NO MATCH';
      output.className = 'debug-output active error';
    }
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
    output.className = 'debug-output active error';
  }
}

// Utilities
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
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}
