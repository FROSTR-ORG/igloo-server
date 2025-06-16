console.log('Igloo Environment Manager is running')

// Environment Variables Manager
class EnvironmentManager {
  constructor() {
    this.envVars = {};
    this.eventLog = [];
    this.isLogExpanded = false;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadEnvironmentVariables();
    this.setupEventLog();
  }

  bindEvents() {
    // Template buttons
    document.getElementById('basicTemplateBtn').addEventListener('click', () => this.applyTemplate('basic'));
    document.getElementById('fullTemplateBtn').addEventListener('click', () => this.applyTemplate('full'));
    
    // Add variable button
    document.getElementById('addVarBtn').addEventListener('click', () => this.showAddModal());
    
    // Modal events
    document.getElementById('closeModal').addEventListener('click', () => this.hideModal('envModal'));
    document.getElementById('cancelModal').addEventListener('click', () => this.hideModal('envModal'));
    document.getElementById('envForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
    
    // Delete modal events
    document.getElementById('closeDeleteModal').addEventListener('click', () => this.hideModal('deleteModal'));
    document.getElementById('cancelDelete').addEventListener('click', () => this.hideModal('deleteModal'));
    document.getElementById('confirmDelete').addEventListener('click', () => this.handleDelete());
    
    // Event log toggle
    document.getElementById('eventLogHeader').addEventListener('click', () => this.toggleEventLog());
    document.getElementById('clearLogsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearEventLog();
    });

    // Copy buttons for essential variables
    document.getElementById('copyGroupBtn').addEventListener('click', () => this.copyEssentialVariable('GROUP_CRED'));
    document.getElementById('copyShareBtn').addEventListener('click', () => this.copyEssentialVariable('SHARE_CRED'));

    // Close modals on outside click
    document.getElementById('envModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideModal('envModal');
    });
    document.getElementById('deleteModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hideModal('deleteModal');
    });
  }

  async loadEnvironmentVariables() {
    try {
      this.updateStatus('loading', 'Loading environment variables...');
      
      const response = await fetch('/api/env');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      this.envVars = data.variables || {};
      
      const count = Object.keys(this.envVars).length;
      this.updateStatus('success', `Loaded ${count} environment variable${count !== 1 ? 's' : ''}`);
      
      this.renderVariables();
      this.addEventLogEntry('success', 'Environment variables loaded successfully', { count });
      
    } catch (error) {
      console.error('Failed to load environment variables:', error);
      this.updateStatus('error', 'Failed to load environment variables');
      this.addEventLogEntry('error', 'Failed to load environment variables', { error: error.message });
    }
  }

  renderVariables() {
    // Update essential variables
    this.renderEssentialVariables();
    
    // Filter out essential variables for additional section
    const additionalVars = Object.keys(this.envVars).filter(key => 
      !['GROUP_CRED', 'SHARE_CRED'].includes(key)
    );
    
    const additionalSection = document.getElementById('additionalSection');
    const envList = document.getElementById('envList');
    const noVars = document.getElementById('noVars');
    
    if (additionalVars.length > 0) {
      additionalSection.style.display = 'block';
      noVars.style.display = 'none';
      
      // Render additional variables
      envList.innerHTML = additionalVars.map(key => this.renderVariableCard(key, this.envVars[key])).join('');
    } else {
      additionalSection.style.display = 'none';
      if (Object.keys(this.envVars).length === 0) {
        noVars.style.display = 'block';
      }
    }
  }

  renderEssentialVariables() {
    const groupCredInput = document.getElementById('groupCredInput');
    const shareCredInput = document.getElementById('shareCredInput');
    
    // Set values for essential variables
    groupCredInput.value = this.envVars['GROUP_CRED'] || '';
    shareCredInput.value = this.envVars['SHARE_CRED'] || '';
    
    // Enable/disable copy buttons
    document.getElementById('copyGroupBtn').disabled = !this.envVars['GROUP_CRED'];
    document.getElementById('copyShareBtn').disabled = !this.envVars['SHARE_CRED'];
  }

  renderVariableCard(key, value) {
    const isSensitive = this.isSensitiveVariable(key);
    const displayValue = isSensitive ? '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••' : value;
    
    return `
      <div class="bg-slate-800/40 p-4 rounded-lg border border-slate-700/50 hover:border-slate-600/50 transition-all duration-200 hover:bg-slate-800/60">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <h4 class="text-blue-300 font-mono text-sm font-medium">${key}</h4>
              ${isSensitive ? '<span class="inline-flex items-center px-2 py-1 rounded text-xs bg-yellow-900/30 text-yellow-400 border border-yellow-800/30 font-mono">SENSITIVE</span>' : ''}
            </div>
            <div class="bg-gray-900/50 p-2 rounded text-sm font-mono text-gray-300 break-all">
              ${displayValue}
            </div>
          </div>
          <div class="flex gap-2 ml-4">
            <button 
              class="bg-blue-800/30 hover:bg-blue-800/50 text-blue-400 hover:text-blue-300 px-3 py-2 rounded transition-colors border border-blue-700/50 hover:border-blue-600/50 font-mono"
              onclick="envManager.copyVariable('${key}')"
              title="Copy"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
            </button>
            <button 
              class="bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-gray-300 px-3 py-2 rounded transition-colors border border-gray-600/50 hover:border-gray-500/50 font-mono"
              onclick="envManager.showEditModal('${key}')"
              title="Edit"
            >
              Edit
            </button>
            <button 
              class="bg-red-800/30 hover:bg-red-700/50 text-red-400 hover:text-red-300 px-3 py-2 rounded transition-colors border border-red-700/50 hover:border-red-600/50 font-mono"
              onclick="envManager.showDeleteModal('${key}')"
              title="Delete"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }

  async copyVariable(key) {
    const value = this.envVars[key];
    if (!value) return;
    
    try {
      await navigator.clipboard.writeText(value);
      this.showCopyFeedback(key);
      this.addEventLogEntry('info', `Copied ${key} to clipboard`);
    } catch (error) {
      console.error('Failed to copy:', error);
      this.addEventLogEntry('error', `Failed to copy ${key}`, { error: error.message });
    }
  }

  async copyEssentialVariable(key) {
    const value = this.envVars[key];
    if (!value) return;
    
    try {
      await navigator.clipboard.writeText(value);
      this.showEssentialCopyFeedback(key);
      this.addEventLogEntry('info', `Copied ${key} to clipboard`);
    } catch (error) {
      console.error('Failed to copy:', error);
      this.addEventLogEntry('error', `Failed to copy ${key}`, { error: error.message });
    }
  }

  showCopyFeedback(key) {
    // Visual feedback for copy action
    const buttons = document.querySelectorAll(`button[onclick="envManager.copyVariable('${key}')"]`);
    buttons.forEach(button => {
      const originalHtml = button.innerHTML;
      button.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
      `;
      button.classList.add('bg-green-600/50', 'text-green-300');
      
      setTimeout(() => {
        button.innerHTML = originalHtml;
        button.classList.remove('bg-green-600/50', 'text-green-300');
      }, 2000);
    });
  }

  showEssentialCopyFeedback(key) {
    const buttonId = key === 'GROUP_CRED' ? 'copyGroupBtn' : 'copyShareBtn';
    const button = document.getElementById(buttonId);
    
    const originalHtml = button.innerHTML;
    button.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
    `;
    button.classList.add('bg-green-600/50', 'text-green-300');
    
    setTimeout(() => {
      button.innerHTML = originalHtml;
      button.classList.remove('bg-green-600/50', 'text-green-300');
    }, 2000);
  }

  showAddModal() {
    document.getElementById('modalTitle').textContent = 'Add Environment Variable';
    document.getElementById('envKey').value = '';
    document.getElementById('envValue').value = '';
    document.getElementById('envKey').disabled = false;
    this.currentEditingKey = null;
    this.showModal('envModal');
  }

  showEditModal(key) {
    document.getElementById('modalTitle').textContent = 'Edit Environment Variable';
    document.getElementById('envKey').value = key;
    document.getElementById('envValue').value = this.envVars[key] || '';
    document.getElementById('envKey').disabled = true;
    this.currentEditingKey = key;
    this.showModal('envModal');
  }

  showDeleteModal(key) {
    document.getElementById('deleteVarName').textContent = key;
    this.keyToDelete = key;
    this.showModal('deleteModal');
  }

  showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Focus first input
    if (modalId === 'envModal') {
      setTimeout(() => {
        const keyInput = document.getElementById('envKey');
        if (!keyInput.disabled) {
          keyInput.focus();
        } else {
          document.getElementById('envValue').focus();
        }
      }, 100);
    }
  }

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    
    const key = document.getElementById('envKey').value.trim();
    const value = document.getElementById('envValue').value.trim();
    
    if (!key || !value) {
      this.addEventLogEntry('error', 'Both variable name and value are required');
      return;
    }

    try {
      const response = await fetch('/api/env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        this.envVars[key] = value;
        this.renderVariables();
        this.hideModal('envModal');
        
        const action = this.currentEditingKey ? 'updated' : 'added';
        this.addEventLogEntry('success', `Environment variable ${action}`, { key, action });
        
        // Update status
        const count = Object.keys(this.envVars).length;
        this.updateStatus('success', `Loaded ${count} environment variable${count !== 1 ? 's' : ''}`);
      } else {
        throw new Error(result.error || 'Failed to save variable');
      }
    } catch (error) {
      console.error('Failed to save variable:', error);
      this.addEventLogEntry('error', 'Failed to save environment variable', { 
        key, 
        error: error.message 
      });
    }
  }

  async handleDelete() {
    if (!this.keyToDelete) return;

    try {
      const response = await fetch('/api/env/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: this.keyToDelete }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success) {
        delete this.envVars[this.keyToDelete];
        this.renderVariables();
        this.hideModal('deleteModal');
        
        this.addEventLogEntry('success', 'Environment variable deleted', { key: this.keyToDelete });
        
        // Update status
        const count = Object.keys(this.envVars).length;
        this.updateStatus('success', `Loaded ${count} environment variable${count !== 1 ? 's' : ''}`);
        
        this.keyToDelete = null;
      } else {
        throw new Error(result.error || 'Failed to delete variable');
      }
    } catch (error) {
      console.error('Failed to delete variable:', error);
      this.addEventLogEntry('error', 'Failed to delete environment variable', { 
        key: this.keyToDelete, 
        error: error.message 
      });
    }
  }

  async applyTemplate(type) {
    try {
      let templateVars = {};
      
      if (type === 'basic') {
        templateVars = {
          'GROUP_CRED': 'bfgroup_paste_your_group_credential_here',
          'SHARE_CRED': 'bfshare_paste_your_share_credential_here',
          'HOST_PORT': '8002'
        };
      } else if (type === 'full') {
        templateVars = {
          'GROUP_CRED': 'bfgroup_paste_your_group_credential_here',
          'SHARE_CRED': 'bfshare_paste_your_share_credential_here',
          'HOST_PORT': '8002',
          'HOST_NAME': 'localhost',
          'RELAYS': 'wss://relay.primal.net,wss://relay.snort.social'
        };
      }

      // Apply template variables one by one
      for (const [key, value] of Object.entries(templateVars)) {
        const response = await fetch('/api/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ key, value }),
        });

        if (response.ok) {
          this.envVars[key] = value;
        }
      }

      this.renderVariables();
      this.addEventLogEntry('success', `Applied ${type} template`, { 
        template: type, 
        variables: Object.keys(templateVars) 
      });
      
      // Update status
      const count = Object.keys(this.envVars).length;
      this.updateStatus('success', `Loaded ${count} environment variable${count !== 1 ? 's' : ''}`);
      
    } catch (error) {
      console.error('Failed to apply template:', error);
      this.addEventLogEntry('error', `Failed to apply ${type} template`, { error: error.message });
    }
  }

  isSensitiveVariable(key) {
    const sensitiveKeys = ['CRED', 'KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS'];
    return sensitiveKeys.some(sensitive => key.toUpperCase().includes(sensitive));
  }

  updateStatus(type, message) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    statusDot.className = 'w-3 h-3 rounded-full';
    statusText.textContent = message;
    
    switch (type) {
      case 'success':
        statusDot.classList.add('bg-green-500');
        break;
      case 'loading':
        statusDot.classList.add('bg-yellow-500', 'pulse-glow');
        break;
      case 'error':
        statusDot.classList.add('bg-red-500');
        break;
    }
  }

  setupEventLog() {
    this.updateEventLogDisplay();
  }

  toggleEventLog() {
    this.isLogExpanded = !this.isLogExpanded;
    
    const content = document.getElementById('eventLogContent');
    const chevron = document.getElementById('eventLogChevron');
    
    if (this.isLogExpanded) {
      content.style.maxHeight = '300px';
      content.style.opacity = '1';
      chevron.style.transform = 'rotate(180deg)';
    } else {
      content.style.maxHeight = '0';
      content.style.opacity = '0';
      chevron.style.transform = 'rotate(0deg)';
    }
  }

  addEventLogEntry(type, message, data = null) {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      data,
      id: Math.random().toString(36).substr(2, 9)
    };
    
    this.eventLog.push(entry);
    
    // Keep only last 50 entries
    if (this.eventLog.length > 50) {
      this.eventLog = this.eventLog.slice(-50);
    }
    
    this.updateEventLogDisplay();
  }

  updateEventLogDisplay() {
    const entriesContainer = document.getElementById('eventLogEntries');
    const eventLogCount = document.getElementById('eventLogCount');
    
    eventLogCount.textContent = `${this.eventLog.length} events`;
    
    if (this.eventLog.length === 0) {
      entriesContainer.innerHTML = '<div class="text-center text-gray-500 text-sm py-8 font-mono">No events yet</div>';
      return;
    }
    
    // Show latest entries first
    const recentEntries = this.eventLog.slice(-20).reverse();
    
    entriesContainer.innerHTML = recentEntries.map(entry => this.renderLogEntry(entry)).join('');
  }

  renderLogEntry(entry) {
    const badgeClass = this.getLogBadgeClass(entry.type);
    const hasData = entry.data && Object.keys(entry.data).length > 0;
    
    return `
      <div class="mb-2 bg-gray-800/40 p-2 rounded hover:bg-gray-800/50 transition-colors">
        <div class="flex items-center gap-2 ${hasData ? 'cursor-pointer' : ''}" ${hasData ? `onclick="envManager.toggleLogEntry('${entry.id}')"` : ''}>
          ${hasData ? `
            <div class="text-blue-400 transition-transform duration-200 w-4 h-4 flex-shrink-0" id="chevron-${entry.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          ` : `
            <div class="w-4 h-4 flex-shrink-0 text-gray-600/30">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
          `}
          <span class="text-gray-500 text-xs font-mono">${entry.timestamp}</span>
          <span class="inline-flex items-center px-2 py-1 rounded text-xs font-mono text-uppercase ${badgeClass}">
            ${entry.type.toUpperCase()}
          </span>
          <span class="text-gray-300 font-mono">${entry.message}</span>
        </div>
        ${hasData ? `
          <div class="transition-all duration-200 ease-in-out overflow-hidden" id="data-${entry.id}" style="max-height: 0; opacity: 0;">
            <pre class="mt-2 text-xs bg-gray-900/50 p-2 rounded overflow-x-auto text-gray-400 shadow-inner font-mono">${JSON.stringify(entry.data, null, 2)}</pre>
          </div>
        ` : ''}
      </div>
    `;
  }

  toggleLogEntry(entryId) {
    const dataDiv = document.getElementById(`data-${entryId}`);
    const chevron = document.getElementById(`chevron-${entryId}`);
    
    if (dataDiv.style.maxHeight === '0px' || dataDiv.style.maxHeight === '') {
      dataDiv.style.maxHeight = '500px';
      dataDiv.style.opacity = '1';
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    } else {
      dataDiv.style.maxHeight = '0';
      dataDiv.style.opacity = '0';
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    }
  }

  getLogBadgeClass(type) {
    switch (type) {
      case 'error':
        return 'bg-red-900/20 text-red-400 border border-red-800/30';
      case 'success':
        return 'bg-green-900/20 text-green-400 border border-green-800/30';
      case 'warning':
        return 'bg-yellow-900/20 text-yellow-400 border border-yellow-800/30';
      case 'info':
        return 'bg-blue-900/20 text-blue-400 border border-blue-800/30';
      default:
        return 'bg-gray-900/20 text-gray-400 border border-gray-800/30';
    }
  }

  clearEventLog() {
    this.eventLog = [];
    this.updateEventLogDisplay();
    this.addEventLogEntry('info', 'Event log cleared');
  }
}

// Initialize the environment manager
const envManager = new EnvironmentManager();
