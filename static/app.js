console.log('Igloo Environment Manager is running')

// Environment Variables Manager
class EnvironmentManager {
  constructor() {
    this.envVars = new Map();
    this.eventLog = [];
    this.isEventLogExpanded = false;
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadEnvironmentVariables();
    this.updateStatus('loading', 'Loading environment variables...');
  }

  setupEventListeners() {
    // Save configuration button
    document.getElementById('saveConfigBtn').addEventListener('click', () => this.saveConfiguration());

    // Copy buttons
    document.getElementById('copyGroupBtn').addEventListener('click', () => this.copyField('groupCredInput'));
    document.getElementById('copyShareBtn').addEventListener('click', () => this.copyField('shareCredInput'));
    document.getElementById('copyRelaysBtn').addEventListener('click', () => this.copyField('relaysInput'));

    // Event log toggle
    document.getElementById('eventLogHeader').addEventListener('click', () => this.toggleEventLog());
    document.getElementById('clearLogsBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearLogs();
    });

    // Input field changes
    const inputs = ['groupCredInput', 'shareCredInput', 'relaysInput', 'hostNameInput', 'hostPortInput'];
    inputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (input) {
        input.addEventListener('input', () => this.handleInputChange());
      }
    });
  }

  async loadEnvironmentVariables() {
    try {
      const response = await fetch('/api/env');
      const data = await response.json();

      if (data.success) {
        this.envVars.clear();
        Object.entries(data.variables).forEach(([key, value]) => {
          this.envVars.set(key, value);
        });
        this.populateInputFields();
        this.updateStatus('success', `Configuration loaded successfully`);
        this.addLogEntry('success', `Loaded ${this.envVars.size} environment variables`);
      } else {
        throw new Error(data.error || 'Failed to load environment variables');
      }
    } catch (error) {
      console.error('Failed to load environment variables:', error);
      this.updateStatus('error', 'Failed to load environment variables');
      this.addLogEntry('error', 'Failed to load environment variables', error.message);
    }
  }

  populateInputFields() {
    // Populate the input fields with current environment variables
    document.getElementById('groupCredInput').value = this.envVars.get('GROUP_CRED') || '';
    document.getElementById('shareCredInput').value = this.envVars.get('SHARE_CRED') || '';
    document.getElementById('relaysInput').value = this.envVars.get('RELAYS') || '';
    document.getElementById('hostNameInput').value = this.envVars.get('HOST_NAME') || 'localhost';
    document.getElementById('hostPortInput').value = this.envVars.get('HOST_PORT') || '8002';
  }

  handleInputChange() {
    // Update status to indicate unsaved changes
    this.updateStatus('loading', 'Configuration has unsaved changes');
  }

  async saveConfiguration() {
    try {
      this.updateStatus('loading', 'Saving configuration...');
      this.addLogEntry('info', 'Saving environment configuration');

      // Collect values from input fields
      const config = {
        GROUP_CRED: document.getElementById('groupCredInput').value.trim(),
        SHARE_CRED: document.getElementById('shareCredInput').value.trim(),
        RELAYS: document.getElementById('relaysInput').value.trim(),
        HOST_NAME: document.getElementById('hostNameInput').value.trim() || 'localhost',
        HOST_PORT: document.getElementById('hostPortInput').value.trim() || '8002'
      };

      // Remove empty values
      Object.keys(config).forEach(key => {
        if (!config[key]) {
          delete config[key];
        }
      });

      const response = await fetch('/api/env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config)
      });

      const data = await response.json();

      if (data.success) {
        // Update internal state
        Object.entries(config).forEach(([key, value]) => {
          this.envVars.set(key, value);
        });

        this.updateStatus('success', 'Configuration saved successfully');
        this.addLogEntry('success', 'Environment configuration saved', `Updated ${Object.keys(config).length} variables`);
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      this.updateStatus('error', 'Failed to save configuration');
      this.addLogEntry('error', 'Failed to save configuration', error.message);
    }
  }

  async copyField(inputId) {
    try {
      const input = document.getElementById(inputId);
      const value = input.value;
      
      if (!value) {
        this.addLogEntry('warning', 'No value to copy');
        return;
      }

      await navigator.clipboard.writeText(value);
      
      // Get the field name for logging
      const fieldNames = {
        'groupCredInput': 'Group Credential',
        'shareCredInput': 'Share Credential', 
        'relaysInput': 'Relay URLs'
      };
      
      const fieldName = fieldNames[inputId] || 'Field';
      this.addLogEntry('success', `${fieldName} copied to clipboard`);
      
      // Visual feedback
      const copyBtn = document.getElementById(inputId.replace('Input', 'Btn'));
      if (copyBtn) {
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>`;
        copyBtn.classList.add('bg-green-600/30', 'text-green-400');
        
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
          copyBtn.classList.remove('bg-green-600/30', 'text-green-400');
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.addLogEntry('error', 'Failed to copy to clipboard', error.message);
    }
  }

  updateStatus(type, message) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    statusDot.className = 'w-3 h-3 rounded-full transition-all duration-300';
    statusText.textContent = message;

    switch (type) {
      case 'success':
        statusDot.classList.add('bg-green-500', 'pulse-glow');
        break;
      case 'loading':
        statusDot.classList.add('bg-yellow-500', 'pulse-yellow');
        break;
      case 'error':
        statusDot.classList.add('bg-red-500');
        break;
      case 'warning':
        statusDot.classList.add('bg-yellow-500');
        break;
      default:
        statusDot.classList.add('bg-gray-500');
    }
  }

  toggleEventLog() {
    this.isEventLogExpanded = !this.isEventLogExpanded;
    const eventLogContent = document.getElementById('eventLogContent');
    const chevron = document.querySelector('#eventLogHeader svg');
    
    if (this.isEventLogExpanded) {
      eventLogContent.style.display = 'block';
      chevron.style.transform = 'rotate(90deg)';
      this.addLogEntry('info', 'Event log expanded');
    } else {
      eventLogContent.style.display = 'none';
      chevron.style.transform = 'rotate(0deg)';
    }
    
    this.updateEventLogStatus();
  }

  clearLogs() {
    this.eventLog = [];
    this.renderEventLog();
    this.updateEventLogStatus();
    this.addLogEntry('info', 'Event log cleared');
  }

  addLogEntry(type, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      type,
      message,
      data
    };
    
    this.eventLog.unshift(logEntry);
    
    // Keep only last 50 entries
    if (this.eventLog.length > 50) {
      this.eventLog = this.eventLog.slice(0, 50);
    }
    
    this.renderEventLog();
    this.updateEventLogStatus();
  }

  renderEventLog() {
    const eventLogContent = document.getElementById('eventLogContent');
    if (!eventLogContent) return;

    if (this.eventLog.length === 0) {
      eventLogContent.innerHTML = `
        <div class="text-center py-4 text-gray-500">
          <p class="text-sm">No events logged yet</p>
        </div>
      `;
      return;
    }

    eventLogContent.innerHTML = this.eventLog.map(entry => `
      <div class="flex items-start gap-3 p-3 bg-gray-800/30 rounded border border-gray-700/30">
        <div class="flex-shrink-0">
          <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium ${this.getEventLogBadgeClass(entry.type)}">
            ${entry.type.toUpperCase()}
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-300">${entry.message}</div>
          <div class="text-xs text-gray-500 mt-1">${entry.timestamp}</div>
          ${entry.data ? `<div class="text-xs text-gray-400 mt-1 font-mono bg-black/20 p-1 rounded">${entry.data}</div>` : ''}
        </div>
      </div>
    `).join('');
  }

  getEventLogBadgeClass(type) {
    const classes = {
      success: 'bg-green-600/20 text-green-400 border border-green-600/30',
      error: 'bg-red-600/20 text-red-400 border border-red-600/30',
      warning: 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30',
      info: 'bg-blue-600/20 text-blue-400 border border-blue-600/30'
    };
    return classes[type] || classes.info;
  }

  updateEventLogStatus() {
    const statusSpan = document.getElementById('eventLogStatus');
    if (statusSpan) {
      if (this.eventLog.length === 0) {
        statusSpan.textContent = 'No events';
        statusSpan.className = 'text-gray-500 text-sm';
      } else {
        statusSpan.textContent = `${this.eventLog.length} event${this.eventLog.length !== 1 ? 's' : ''}`;
        statusSpan.className = 'text-green-400 text-sm';
      }
    }
  }
}

// Initialize the manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.envManager = new EnvironmentManager();
});
