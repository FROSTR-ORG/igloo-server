import React, { useState, useEffect } from "react"
import { Button } from "./ui/button"
import { IconButton } from "./ui/icon-button"
import { Input } from "./ui/input"
import { Tooltip } from "./ui/tooltip"
import { Alert } from "./ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { InputWithValidation } from "./ui/input-with-validation"

interface ConfigureProps {
  onKeysetCreated: (data: { groupCredential: string; shareCredentials: string[]; name: string }) => void;
  onBack?: () => void;
}

const Configure: React.FC<ConfigureProps> = ({ onKeysetCreated, onBack }) => {
  const [keysetGenerated, setKeysetGenerated] = useState<{ success: boolean; location: string | React.ReactNode }>({ success: false, location: null });
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

  useEffect(() => {
    const loadExistingData = async () => {
      try {
        // Check for existing credentials in environment variables
        const response = await fetch('/api/env');
        const envVars = await response.json();
        
        const savedShare = envVars.SHARE_CRED;
        const savedGroup = envVars.GROUP_CRED;
        const savedName = envVars.GROUP_NAME;
        
        if (savedShare && savedGroup) {
          setHasExistingCredentials(true);
          setShare(savedShare);
          setIsValidShare(true);
          setGroupCredential(savedGroup);
          setIsValidGroup(true);
          if (savedName) {
            setKeysetName(savedName);
            setIsNameValid(true);
          }
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
      }
    };
    loadExistingData();
  }, []);

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

  const handleClearCredentials = async () => {
    try {
      await fetch('/api/env/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keys: ['SHARE_CRED', 'GROUP_CRED', 'GROUP_NAME']
        })
      });
      
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
      // Save the share, group credential, and name to .env file
      try {
        await fetch('/api/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            SHARE_CRED: share,
            GROUP_CRED: groupCredential,
            GROUP_NAME: keysetName,
            // Ensure we have at least one valid relay for the server to use
            RELAYS: JSON.stringify(["wss://relay.primal.net"])
          })
        });
        
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
        
        onKeysetCreated(configuredKeyset);
      } catch (envError) {
        console.error('Error saving credentials to environment variables:', envError);
        setKeysetGenerated({
          success: false,
          location: 'Error saving credentials to environment variables'
        });
      }
    } catch (error) {
      setKeysetGenerated({
        success: false,
        location: `Error configuring signer: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsGenerating(false);
    }
  };

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
          className="w-full py-5 bg-blue-600 hover:bg-blue-700 transition-colors duration-200 text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isGenerating || !keysetName.trim() || !share.trim() || !groupCredential.trim() || !isValidShare || !isValidGroup || !isNameValid}
        >
          {isGenerating ? "Saving..." : hasExistingCredentials ? "Update Configuration" : "Configure Signer"}
        </Button>

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