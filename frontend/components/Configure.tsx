import React, { useState, useEffect, useRef } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Tooltip } from "./ui/tooltip"
import { Alert } from "./ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import Spinner from "./ui/spinner"
import { HelpCircle, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { InputWithValidation } from "./ui/input-with-validation"

interface ConfigureProps {
  onKeysetCreated: (data: { groupCredential: string; shareCredentials: string[]; name: string }) => void;
  onCredentialsSaved?: () => void;
  onBack?: () => void;
  authHeaders?: Record<string, string>;
}

const Configure: React.FC<ConfigureProps> = ({ onKeysetCreated, onCredentialsSaved, onBack, authHeaders = {} }) => {
  const [keysetGenerated, setKeysetGenerated] = useState<{ success: boolean; location: string | React.ReactNode | null }>({ success: false, location: null });
  const [isGenerating, setIsGenerating] = useState(false);
  const [keysetName, setKeysetName] = useState("");
  const [share, setShare] = useState("");
  const [isValidShare, setIsValidShare] = useState(false);
  const [shareError, setShareError] = useState<string | undefined>(undefined);
  const [groupCredential, setGroupCredential] = useState("");
  const [isValidGroup, setIsValidGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | undefined>(undefined);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [isNameValid, setIsNameValid] = useState(true);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [hasExistingCredentials, setHasExistingCredentials] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [originalKeysetName, setOriginalKeysetName] = useState("");
  const [originalShare, setOriginalShare] = useState("");
  const [originalGroupCredential, setOriginalGroupCredential] = useState("");
  const [isHeadlessMode, setIsHeadlessMode] = useState(false);
  const [existingRelays, setExistingRelays] = useState<string[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState({
    RELAYS: '["wss://relay.primal.net"]',
    SESSION_TIMEOUT: '3600',
    FROSTR_SIGN_TIMEOUT: '30000',
    RATE_LIMIT_ENABLED: 'true',
    RATE_LIMIT_WINDOW: '900',
    RATE_LIMIT_MAX: '100',
    NODE_RESTART_DELAY: '30000',
    NODE_MAX_RETRIES: '5',
    NODE_BACKOFF_MULTIPLIER: '1.5',
    NODE_MAX_RETRY_DELAY: '300000',
    INITIAL_CONNECTIVITY_DELAY: '5000',
    ALLOWED_ORIGINS: ''
  });
  const [originalAdvancedSettings, setOriginalAdvancedSettings] = useState<typeof advancedSettings>({...advancedSettings});
  const [isLoadingAdvanced, setIsLoadingAdvanced] = useState(false);
  // Initial load gate to prevent empty form flash
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [advancedError, setAdvancedError] = useState<string | undefined>(undefined);
  const loadAdvancedSettingsRef = useRef<AbortController | null>(null);

  /**
   * Convert an environment value of unknown type to a string suitable for input fields.
   * - Arrays/objects: JSON.stringify
   * - Booleans: 'true' | 'false'
   * - Numbers: String(number)
   * - Strings: returned as-is
   * - null/undefined: fall back to provided defaultString
   */
  function coerceEnvValueToString(value: unknown, defaultString: string): string {
    if (value === null || value === undefined) return defaultString;
    const valueType = typeof value;
    if (valueType === 'string') return value as string;
    if (valueType === 'boolean') return (value as boolean) ? 'true' : 'false';
    if (valueType === 'number') {
      const num = value as number;
      return Number.isFinite(num) ? String(num) : defaultString;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return defaultString;
    }
  }

  // Function to load advanced settings from env
  const loadAdvancedSettings = async () => {
    // Load advanced settings in both headless and database modes
    if (loadAdvancedSettingsRef.current) {
      try { loadAdvancedSettingsRef.current.abort() } catch {}
    }
    loadAdvancedSettingsRef.current = new AbortController();
    const signal = loadAdvancedSettingsRef.current.signal;
    
    try {
      setIsLoadingAdvanced(true);
      setAdvancedError(undefined);
      const envResponse = await fetch('/api/env', {
        headers: authHeaders,
        signal
      });
      if (envResponse.ok) {
        const envVars = await envResponse.json();
        interface AdvancedSettingsData {
          SESSION_TIMEOUT: string;
          FROSTR_SIGN_TIMEOUT: string;
          RATE_LIMIT_ENABLED: string;
          RATE_LIMIT_WINDOW: string;
          RATE_LIMIT_MAX: string;
          NODE_RESTART_DELAY: string;
          NODE_MAX_RETRIES: string;
          NODE_BACKOFF_MULTIPLIER: string;
          NODE_MAX_RETRY_DELAY: string;
          INITIAL_CONNECTIVITY_DELAY: string;
          ALLOWED_ORIGINS: string;
          RELAYS?: string;
        }
        const newSettings: AdvancedSettingsData = {
          SESSION_TIMEOUT: coerceEnvValueToString(envVars.SESSION_TIMEOUT, '3600'),
          FROSTR_SIGN_TIMEOUT: coerceEnvValueToString(envVars.FROSTR_SIGN_TIMEOUT, '30000'),
          RATE_LIMIT_ENABLED: coerceEnvValueToString(envVars.RATE_LIMIT_ENABLED, 'true'),
          RATE_LIMIT_WINDOW: coerceEnvValueToString(envVars.RATE_LIMIT_WINDOW, '900'),
          RATE_LIMIT_MAX: coerceEnvValueToString(envVars.RATE_LIMIT_MAX, '100'),
          NODE_RESTART_DELAY: coerceEnvValueToString(envVars.NODE_RESTART_DELAY, '30000'),
          NODE_MAX_RETRIES: coerceEnvValueToString(envVars.NODE_MAX_RETRIES, '5'),
          NODE_BACKOFF_MULTIPLIER: coerceEnvValueToString(envVars.NODE_BACKOFF_MULTIPLIER, '1.5'),
          NODE_MAX_RETRY_DELAY: coerceEnvValueToString(envVars.NODE_MAX_RETRY_DELAY, '300000'),
          INITIAL_CONNECTIVITY_DELAY: coerceEnvValueToString(envVars.INITIAL_CONNECTIVITY_DELAY, '5000'),
          ALLOWED_ORIGINS: coerceEnvValueToString(envVars.ALLOWED_ORIGINS, '')
        };
        
        // Only include RELAYS in headless mode (server-wide configuration)
        // In database mode, relays are managed per-user through the Signer component
        if (isHeadlessMode) {
          newSettings.RELAYS = coerceEnvValueToString(envVars.RELAYS, '["wss://relay.primal.net"]');
        }
        setAdvancedSettings(newSettings);
        setOriginalAdvancedSettings({...newSettings});
      } else {
        const err = await envResponse.json().catch(() => ({}));
        setAdvancedError(err.error || `Failed to load settings: ${envResponse.status}`);
      }
    } catch (error) {
      if ((error as any)?.name === 'AbortError') {
        return; // newer request superseded this one
      }
      console.error('Error loading advanced settings:', error);
      setAdvancedError('Failed to load advanced settings');
    } finally {
      setIsLoadingAdvanced(false);
    }
  };

  useEffect(() => {
    const loadExistingData = async () => {
      try {
        setIsLoadingConfig(true);
        // Check if we're in headless mode
        const statusResponse = await fetch('/api/onboarding/status');
        
        if (!statusResponse.ok) {
          throw new Error('Unable to determine server mode');
        }
        
        const statusData = await statusResponse.json();
        const headlessMode = statusData.headlessMode === true;
        setIsHeadlessMode(headlessMode);
        
        // Load credentials based on mode
        let savedShare, savedGroup, savedName, savedRelays;
        
        if (headlessMode) {
          // Headless mode - fetch from environment
          const response = await fetch('/api/env', {
            headers: authHeaders
          });
          if (response.ok) {
            const envVars = await response.json();
            savedShare = envVars.SHARE_CRED;
            savedGroup = envVars.GROUP_CRED;
            savedName = envVars.GROUP_NAME;
            // Parse relays from environment
            if (envVars.RELAYS) {
              try {
                savedRelays = typeof envVars.RELAYS === 'string' ? JSON.parse(envVars.RELAYS) : envVars.RELAYS;
              } catch {
                savedRelays = null;
              }
            }
          }
        } else {
          // Database mode - fetch from user credentials
          const response = await fetch('/api/user/credentials', {
            headers: authHeaders
          });
          if (response.ok) {
            const credentials = await response.json();
            savedShare = credentials.share_cred;
            savedGroup = credentials.group_cred;
            savedName = credentials.group_name;
            savedRelays = credentials.relays;
          }
        }
        
        // Load advanced settings in both modes
        await loadAdvancedSettings();
        
        // Store existing relays (if any)
        if (savedRelays && Array.isArray(savedRelays) && savedRelays.length > 0) {
          setExistingRelays(savedRelays);
        }
        
        // Check if we have real credentials (not placeholders)
        const isRealShare = savedShare && savedShare !== '[CONFIGURED]';
        const isRealGroup = savedGroup && savedGroup !== '[CONFIGURED]';
        
        if (isRealShare && isRealGroup) {
          setHasExistingCredentials(true);
          setShare(savedShare);
          setIsValidShare(true);
          setGroupCredential(savedGroup);
          setIsValidGroup(true);
          if (savedName) {
            setKeysetName(savedName);
            setIsNameValid(true);
          }
          // Store originals for change detection
          setOriginalShare(savedShare);
          setOriginalGroupCredential(savedGroup);
          setOriginalKeysetName(savedName || "");
        }
        
        // TODO: Replace with server API call for existing names
        // const sharesResponse = await fetch('/api/shares');
        // const shares = await sharesResponse.json();
        
        // Mock data for UI demonstration
        const shares: any[] = []; // Empty array for now, can be populated for testing
        if (shares) {
          const names = shares.map(share => share.name.split(' share ')[0]);
          setExistingNames(names);
        }
      } catch (error) {
        console.error('Error loading existing data:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    };
    loadExistingData();
  }, []);

  // Reload advanced settings when window regains focus or when showAdvanced changes
  // This ensures relay changes from Signer.tsx are reflected here
  useEffect(() => {
    if (!showAdvanced) return;

    const handleFocus = () => { loadAdvancedSettings() };
    loadAdvancedSettings();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      if (loadAdvancedSettingsRef.current) {
        try { loadAdvancedSettingsRef.current.abort() } catch {}
        loadAdvancedSettingsRef.current = null
      }
    };
  }, [showAdvanced]);

  const handleNameChange = (value: string) => {
    setKeysetName(value);
    if (value.trim()) {
      const nameWithoutShare = value.split(' share ')[0];
      const valid = existingNames.indexOf(nameWithoutShare) === -1;
      setIsNameValid(valid);
      setNameError(valid ? undefined : 'This keyset name already exists');
    } else {
      setIsNameValid(false);
      setNameError('Name is required');
    }
  };

  const handleShareChange = (value: string) => {
    setShare(value);
    
    // Validate share format
    const isValidFormat = value.startsWith('bfshare') && value.length > 10;
    if (value.trim() && isValidFormat) {
      setIsValidShare(true);
      setShareError(undefined);
    } else if (value.trim()) {
      setIsValidShare(false);
      setShareError('Invalid share format. Should start with "bfshare" and be properly formatted.');
    } else {
      setIsValidShare(false);
      setShareError('Share is required');
    }
  };

  const handleGroupChange = (value: string) => {
    setGroupCredential(value);
    
    // Validate group credential format
    const isValidFormat = value.startsWith('bfgroup') && value.length > 10;
    if (value.trim() && isValidFormat) {
      setIsValidGroup(true);
      setGroupError(undefined);
    } else if (value.trim()) {
      setIsValidGroup(false);
      setGroupError('Invalid group credential format. Should start with "bfgroup" and be properly formatted.');
    } else {
      setIsValidGroup(false);
      setGroupError('Group credential is required');
    }
  };

  const handleSaveAdvancedSettings = async () => {
    setIsLoadingAdvanced(true);
    setAdvancedError(undefined);
    
    try {
      // Validate JSON format for RELAYS (only in headless mode)
      if (isHeadlessMode && advancedSettings.RELAYS) {
        try {
          const parsedRelays = JSON.parse(advancedSettings.RELAYS);
          if (!Array.isArray(parsedRelays)) {
            throw new Error('RELAYS must be a JSON array');
          }
          if (parsedRelays.length === 0) {
            throw new Error('RELAYS must contain at least one relay URL');
          }
          // Validate each relay URL format
          for (const relay of parsedRelays) {
            if (typeof relay !== 'string') {
              throw new Error('Each relay must be a string');
            }
            try {
              const url = new URL(relay);
              if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
                throw new Error(`Invalid relay protocol: ${url.protocol}. Must be ws:// or wss://`);
              }
            } catch (e) {
              if (e instanceof TypeError) {
                throw new Error(`Invalid relay URL: ${relay}`);
              }
              throw e;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error('RELAYS must be valid JSON format');
          }
          throw e;
        }
      }
      
      // Validate numeric fields
      const numericFields = [
        { key: 'SESSION_TIMEOUT', label: 'Session Timeout', min: 60, max: 86400 },
        { key: 'FROSTR_SIGN_TIMEOUT', label: 'Signing Timeout (ms)', min: 1000, max: 120000 },
        { key: 'RATE_LIMIT_WINDOW', label: 'Rate Limit Window', min: 1, max: 3600 },
        { key: 'RATE_LIMIT_MAX', label: 'Rate Limit Max', min: 1, max: 10000 },
        { key: 'NODE_RESTART_DELAY', label: 'Node Restart Delay', min: 1000, max: 3600000 },
        { key: 'NODE_MAX_RETRIES', label: 'Node Max Retries', min: 1, max: 100 },
        { key: 'NODE_MAX_RETRY_DELAY', label: 'Node Max Retry Delay', min: 1000, max: 7200000 },
        { key: 'INITIAL_CONNECTIVITY_DELAY', label: 'Initial Connectivity Delay', min: 0, max: 60000 }
      ];
      
      for (const field of numericFields) {
        const value = advancedSettings[field.key as keyof typeof advancedSettings];
        if (value !== '') {
          const numValue = Number(value);
          if (isNaN(numValue)) {
            throw new Error(`${field.label} must be a valid number`);
          }
          if (!Number.isInteger(numValue) || numValue < 0) {
            throw new Error(`${field.label} must be a non-negative integer`);
          }
          if (field.min !== undefined && numValue < field.min) {
            throw new Error(`${field.label} must be at least ${field.min}`);
          }
          if (field.max !== undefined && numValue > field.max) {
            throw new Error(`${field.label} must not exceed ${field.max}`);
          }
        }
      }
      
      // Validate NODE_BACKOFF_MULTIPLIER as a non-negative float
      const backoffValue = advancedSettings.NODE_BACKOFF_MULTIPLIER;
      if (backoffValue !== '') {
        const numBackoff = Number(backoffValue);
        if (isNaN(numBackoff) || numBackoff < 0) {
          throw new Error('Node Backoff Multiplier must not be negative');
        }
        if (numBackoff < 1.0 || numBackoff > 10.0) {
          throw new Error('Node Backoff Multiplier must be between 1.0 and 10.0');
        }
      }
      
      // Validate boolean fields
      const booleanFields = [
        { key: 'RATE_LIMIT_ENABLED', label: 'Rate Limit Enabled' }
      ];
      
      for (const field of booleanFields) {
        const value = advancedSettings[field.key as keyof typeof advancedSettings];
        if (value !== '' && value !== 'true' && value !== 'false') {
          throw new Error(`${field.label} must be either "true" or "false"`);
        }
      }
      
      // Save advanced settings
      const response = await fetch('/api/env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(advancedSettings)
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save settings: ${response.status}`);
      }
      
      setOriginalAdvancedSettings({...advancedSettings});
      setKeysetGenerated({
        success: true,
        location: "Advanced settings saved successfully!"
      });
    } catch (error) {
      console.error('Error saving advanced settings:', error);
      setAdvancedError(error instanceof Error ? error.message : 'Failed to save advanced settings');
    } finally {
      setIsLoadingAdvanced(false);
    }
  };

  const handleClearCredentials = async () => {
    try {
      let response;
      
      if (isHeadlessMode) {
        // Headless mode - delete from env
        response = await fetch('/api/env/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            keys: ['SHARE_CRED', 'GROUP_CRED', 'GROUP_NAME']
          })
        });
      } else {
        // Database mode - delete from user credentials
        response = await fetch('/api/user/credentials', {
          method: 'DELETE',
          headers: authHeaders
        });
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete credentials: ${response.status}`);
      }
      
      // Notify parent component to refresh views
      if (onCredentialsSaved) {
        onCredentialsSaved();
      }
      
      // Clear the form
      setShare("");
      setIsValidShare(false);
      setGroupCredential("");
      setIsValidGroup(false);
      setKeysetName("");
      setIsNameValid(false);
      setHasExistingCredentials(false);
      setShowClearConfirm(false);
      
      setKeysetGenerated({
        success: true,
        location: "Credentials cleared successfully!"
      });
    } catch (error) {
      console.error('Error clearing credentials:', error);
      setKeysetGenerated({
        success: false,
        location: 'Error clearing credentials'
      });
    }
  };

  const handleCreateKeyset = async () => {
    if (!keysetName.trim() || !share.trim() || !groupCredential.trim() || !isValidShare || !isValidGroup || !isNameValid) return;

    setIsGenerating(true);
    try {
      // Save credentials based on mode
      if (isHeadlessMode) {
        // Headless mode - save to env
        await fetch('/api/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            SHARE_CRED: share,
            GROUP_CRED: groupCredential,
            GROUP_NAME: keysetName,
            // Ensure we have at least one valid relay for the server to use
            RELAYS: JSON.stringify(["wss://relay.primal.net"])
          })
        });
      } else {
        // Database mode - save to user credentials
        // Preserve existing relays or use default if none exist
        const relaysToSave = existingRelays || ["wss://relay.primal.net"];
        
        await fetch('/api/user/credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            share_cred: share,
            group_cred: groupCredential,
            group_name: keysetName,
            relays: relaysToSave
          })
        });
      }
      
      setHasExistingCredentials(true);
      setKeysetGenerated({
        success: true,
        location: hasExistingCredentials ? "Signer credentials updated successfully!" : "Signer configured successfully! Your credentials have been saved."
      });
      
      // Create a mock keyset object for the callback
      const configuredKeyset = {
        groupCredential: groupCredential,
        shareCredentials: [share],
        name: keysetName
      };
      
      // Call the appropriate callback
      if (onCredentialsSaved) {
        // In database mode, notify that credentials were saved
        onCredentialsSaved();
      } else {
        // Legacy callback for compatibility
        onKeysetCreated(configuredKeyset);
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
      setKeysetGenerated({
        success: false,
        location: `Error configuring signer: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Compute if any value has changed from the original
  const isChanged = hasExistingCredentials && (
    keysetName !== originalKeysetName ||
    share !== originalShare ||
    groupCredential !== originalGroupCredential
  );

  if (isLoadingConfig) {
    return (
      <Card className="bg-gray-900/30 border-blue-900/30 backdrop-blur-sm shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl text-blue-200">Loading Configuration…</CardTitle>
        </CardHeader>
        <CardContent>
          <Spinner label="Fetching saved credentials…" size="md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900/30 border-blue-900/30 backdrop-blur-sm shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center w-full justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl text-blue-200">
                {hasExistingCredentials ? 'Update Signer Configuration' : 'Configure Signer'}
              </CardTitle>
              <Tooltip 
                trigger={<HelpCircle size={18} className="text-blue-400 cursor-pointer" />}
                content={
                  <>
                    <p className="mb-2 font-semibold">Configure your signer:</p>
                    <p className="mb-2">Set up your signer by entering a share and group credential from an existing FROSTR keyset.</p>
                    <p>The share and group credential will be saved to your environment variables for use with your igloo server signer here.</p>
                  </>
                }
              />
            </div>
            {hasExistingCredentials && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                className="bg-red-600/20 hover:bg-red-600/30 text-red-300 border-red-600/30"
                disabled={isGenerating}
              >
                Clear Credentials
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasExistingCredentials && (
          <div className="bg-green-900/30 border border-green-700/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-green-300 font-medium">Existing Configuration Found</span>
            </div>
            <p className="text-green-200 text-sm">
              Your signer is already configured. You can update the credentials below or clear them to start fresh.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <InputWithValidation
              label={
                <div className="flex items-center gap-1">
                  <span>Keyset Name</span>
                  <Tooltip 
                    trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                    content={
                      <p>A unique name to identify your signer configuration. This helps you distinguish between different signer setups.</p>
                    }
                    width="w-60"
                  />
                </div>
              }
              placeholder="Enter a name for your signer"
              value={keysetName}
              onChange={handleNameChange}
              isValid={isNameValid}
              errorMessage={nameError}
              isRequired={true}
              disabled={isGenerating}
              className="w-full"
            />
          </div>

          <div className="space-y-2 w-full">
            <InputWithValidation
              label={
                <div className="flex items-center gap-1">
                  <span>Share</span>
                  <Tooltip 
                    trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                    content={
                      <>
                        <p className="mb-2 font-semibold">Your share credential:</p>
                        <p className="mb-2">This is your individual share from a FROSTR keyset. It should start with "bfshare" and contains your portion of the signing key.</p>
                        <p>Paste your share credential here to configure your signer.</p>
                      </>
                    }
                  />
                </div>
              }
              type="password"
              placeholder="Enter your share credential (bfshare...)"
              value={share}
              onChange={handleShareChange}
              isValid={isValidShare}
              errorMessage={shareError}
              isRequired={true}
              disabled={isGenerating}
              className="w-full"
            />
          </div>

          <div className="space-y-2 w-full">
            <InputWithValidation
              label={
                <div className="flex items-center gap-1">
                  <span>Group Credential</span>
                  <Tooltip 
                    trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                    content={
                      <>
                        <p className="mb-2 font-semibold">Your group credential:</p>
                        <p className="mb-2">This is the group information from your FROSTR keyset. It should start with "bfgroup" and contains the public information about your keyset.</p>
                        <p>Paste your group credential here to configure your signer.</p>
                      </>
                    }
                  />
                </div>
              }
              type="password"
              placeholder="Enter your group credential (bfgroup...)"
              value={groupCredential}
              onChange={handleGroupChange}
              isValid={isValidGroup}
              errorMessage={groupError}
              isRequired={true}
              disabled={isGenerating}
              className="w-full"
            />
          </div>


        </div>

        <Button
          onClick={handleCreateKeyset}
          className="w-full py-5 bg-blue-600 hover:bg-blue-700 transition-colors duration-200 text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-white"
          disabled={isGenerating || !keysetName.trim() || !share.trim() || !groupCredential.trim() || !isValidShare || !isValidGroup || !isNameValid}
        >
          {isGenerating
            ? "Saving..."
            : hasExistingCredentials
              ? isChanged
                ? "Update and Continue"
                : "Continue"
              : "Configure Signer"}
        </Button>
        
        {/* Advanced Settings Section - Available in both headless and database modes */}
        <div className="mt-6 border-t border-gray-700/50 pt-6">
            <Button
              variant="ghost"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between py-3 px-4 text-blue-300 hover:bg-gray-800/30 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-2">
                <Settings size={18} />
                <span className="font-medium">Advanced Settings</span>
              </div>
              {showAdvanced ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </Button>
            
            {showAdvanced && (
              <div className="mt-4 space-y-4 p-4 bg-gray-900/20 rounded-lg border border-gray-700/30">
                {isLoadingAdvanced && (
                  <Spinner label="Loading settings…" size="sm" inline />
                )}
                {/* Relays Configuration - Only show in headless mode */}
                {isHeadlessMode && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-blue-200 flex items-center gap-1">
                      <span>Nostr Relays</span>
                      <Tooltip
                        trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                        content={
                          <>
                            <p className="mb-2 font-semibold">Nostr relay configuration:</p>
                            <p className="mb-2">JSON array of relay URLs for FROSTR protocol communication. These relays are used for discovering and communicating with other FROSTR nodes.</p>
                            <p className="mb-1">Example: ["wss://relay.primal.net", "wss://relay.damus.io"]</p>
                            <p className="text-xs">Default: ["wss://relay.primal.net"]</p>
                          </>
                        }
                        width="w-60"
                      />
                    </label>
                    <Input
                      type="text"
                      placeholder='["wss://relay.primal.net"]'
                      value={typeof advancedSettings.RELAYS === 'string' ? advancedSettings.RELAYS : JSON.stringify(advancedSettings.RELAYS)}
                      onChange={(e) => setAdvancedSettings({...advancedSettings, RELAYS: e.target.value})}
                      disabled={isLoadingAdvanced}
                      className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 font-mono text-sm"
                    />
                  </div>
                )}
                
                {/* Info message for database mode users */}
                {!isHeadlessMode && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-blue-200 flex items-center gap-1">
                      <span>Relay Configuration</span>
                      <Tooltip
                        trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                        content={
                          <>
                            <p className="mb-2 font-semibold">Database Mode Relay Management:</p>
                            <p>In database mode, relays are managed per-user through the Signer tab. Each user can configure their own relay preferences.</p>
                          </>
                        }
                        width="w-60"
                      />
                    </div>
                    <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-sm text-blue-300">
                      In database mode, relays are configured per-user in the <strong>Signer</strong> tab.
                    </div>
                  </div>
                )}
                
                {/* Session Timeout */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-200 flex items-center gap-1">
                    <span>Session Timeout (seconds)</span>
                    <Tooltip
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">Session timeout:</p>
                          <p>Duration in seconds before a session expires. Default: 3600 (1 hour)</p>
                        </>
                      }
                      width="w-60"
                    />
                  </label>
                  <Input
                    type="text"
                    placeholder="3600"
                    value={advancedSettings.SESSION_TIMEOUT}
                    onChange={(e) => setAdvancedSettings({...advancedSettings, SESSION_TIMEOUT: e.target.value})}
                    disabled={isLoadingAdvanced}
                    className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                  />
                </div>
                
                {/* Signing Timeout */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-200 flex items-center gap-1">
                    <span>Signing Timeout (ms)</span>
                    <Tooltip
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">FROSTR signing timeout:</p>
                          <p>Maximum time the server waits for a signature before failing. Default: 30000ms (30s). Min 1000, Max 120000.</p>
                        </>
                      }
                      width="w-60"
                    />
                  </label>
                  <Input
                    type="text"
                    placeholder="30000"
                    value={advancedSettings.FROSTR_SIGN_TIMEOUT}
                    onChange={(e) => setAdvancedSettings({...advancedSettings, FROSTR_SIGN_TIMEOUT: e.target.value})}
                    disabled={isLoadingAdvanced}
                    className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                  />
                </div>
                
                {/* Rate Limiting Section */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-blue-200 flex items-center gap-1">
                    Rate Limiting
                    <Tooltip
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">Rate limiting configuration:</p>
                          <p>Protect your server from abuse by limiting request rates per IP address.</p>
                        </>
                      }
                      width="w-60"
                    />
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Enabled</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Enable rate limiting:</p>
                              <p>When enabled, limits the number of API requests per IP address. Default: true (enabled)</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <select
                        value={advancedSettings.RATE_LIMIT_ENABLED}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, RATE_LIMIT_ENABLED: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="w-full bg-gray-800/50 border border-gray-700/50 text-blue-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Window (seconds)</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Rate limit window:</p>
                              <p>Time window in seconds for counting requests. Default: 900 seconds (15 minutes)</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="900"
                        value={advancedSettings.RATE_LIMIT_WINDOW}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, RATE_LIMIT_WINDOW: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Max Requests</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Maximum requests:</p>
                              <p>Maximum number of requests allowed per IP address within the time window. Default: 100 requests</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="100"
                        value={advancedSettings.RATE_LIMIT_MAX}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, RATE_LIMIT_MAX: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                  </div>
                </div>
                
                {/* Node Recovery Settings */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-blue-200 flex items-center gap-1">
                    Node Recovery
                    <Tooltip
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">Node recovery configuration:</p>
                          <p>Configure how the node handles failures and reconnection attempts.</p>
                        </>
                      }
                      width="w-60"
                    />
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Restart Delay (ms)</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Initial restart delay:</p>
                              <p>Initial delay in milliseconds before attempting to restart a failed node. Default: 30000ms (30 seconds)</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="30000"
                        value={advancedSettings.NODE_RESTART_DELAY}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, NODE_RESTART_DELAY: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Max Retries</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Maximum retry attempts:</p>
                              <p>Maximum number of times to attempt restarting a failed node. Default: 5 attempts</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="5"
                        value={advancedSettings.NODE_MAX_RETRIES}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, NODE_MAX_RETRIES: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Backoff Multiplier</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Retry backoff multiplier:</p>
                              <p>Multiplier for exponential backoff between retry attempts. Each retry delay is multiplied by this value. Default: 1.5</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="1.5"
                        value={advancedSettings.NODE_BACKOFF_MULTIPLIER}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, NODE_BACKOFF_MULTIPLIER: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Max Delay (ms)</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Maximum retry delay:</p>
                              <p>Maximum delay in milliseconds between retry attempts. Default: 300000ms (5 minutes)</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="300000"
                        value={advancedSettings.NODE_MAX_RETRY_DELAY}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, NODE_MAX_RETRY_DELAY: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-blue-300 flex items-center gap-1">
                        <span>Initial Delay (ms)</span>
                        <Tooltip
                          trigger={<HelpCircle size={14} className="text-blue-400 cursor-pointer" />}
                          content={
                            <>
                              <p className="mb-2 font-semibold">Initial connectivity delay:</p>
                              <p>Initial delay in milliseconds before checking node connectivity after startup. Default: 5000ms (5 seconds)</p>
                            </>
                          }
                          width="w-60"
                        />
                      </label>
                      <Input
                        type="text"
                        placeholder="5000"
                        value={advancedSettings.INITIAL_CONNECTIVITY_DELAY}
                        onChange={(e) => setAdvancedSettings({...advancedSettings, INITIAL_CONNECTIVITY_DELAY: e.target.value})}
                        disabled={isLoadingAdvanced}
                        className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm py-1.5"
                      />
                    </div>
                  </div>
                </div>
                
                {/* CORS Settings */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-200 flex items-center gap-1">
                    <span>Allowed Origins (CORS)</span>
                    <Tooltip
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">CORS configuration:</p>
                          <p className="mb-2">Comma-separated list of allowed origins for API requests. Leave empty to allow all origins (*) - not recommended for production.</p>
                          <p className="mb-1">Example: http://localhost:3000,https://yourdomain.com</p>
                          <p className="text-xs">Default: Empty (allows all origins with warning)</p>
                        </>
                      }
                      width="w-60"
                    />
                  </label>
                  <Input
                    type="text"
                    placeholder="http://localhost:3000,http://localhost:8002"
                    value={advancedSettings.ALLOWED_ORIGINS}
                    onChange={(e) => setAdvancedSettings({...advancedSettings, ALLOWED_ORIGINS: e.target.value})}
                    disabled={isLoadingAdvanced}
                    className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500 text-sm"
                  />
                </div>
                
                {/* Save Advanced Settings Button */}
                {(JSON.stringify(advancedSettings) !== JSON.stringify(originalAdvancedSettings)) && (
                  <Button
                    onClick={handleSaveAdvancedSettings}
                    disabled={isLoadingAdvanced}
                    className="w-full py-2 bg-green-600 hover:bg-green-700 text-white transition-colors"
                  >
                    {isLoadingAdvanced ? "Saving Advanced Settings..." : "Save Advanced Settings"}
                  </Button>
                )}
                
                {advancedError && (
                  <Alert variant="error" className="mt-2">
                    {advancedError}
                  </Alert>
                )}
              </div>
            )}
          </div>

        {keysetGenerated.location && (
          <Alert 
            variant={keysetGenerated.success ? 'success' : 'error'}
            className="mt-4"
          >
            {keysetGenerated.location}
          </Alert>
        )}

        {/* Clear Credentials Confirmation Modal */}
        {showClearConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 border border-red-600/30 rounded-lg p-6 max-w-md mx-4">
              <h3 className="text-lg font-semibold text-red-300 mb-3">Clear Credentials?</h3>
              <p className="text-gray-300 mb-4">
                This will permanently remove your saved credentials and stop the signer. 
                You'll need to reconfigure with new credentials to use the signer again.
              </p>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setShowClearConfirm(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleClearCredentials}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Clear Credentials
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Configure; 
