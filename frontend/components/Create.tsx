import React, { useState, useEffect } from "react"
import { Button } from "./ui/button"
import { IconButton } from "./ui/icon-button"
import { Input } from "./ui/input"
import { Tooltip } from "./ui/tooltip"
import { Alert } from "./ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { ArrowLeft, HelpCircle } from 'lucide-react';
import { InputWithValidation } from "./ui/input-with-validation"

interface CreateProps {
  onKeysetCreated: (data: { groupCredential: string; shareCredentials: string[]; name: string }) => void;
  onBack: () => void;
}

const Create: React.FC<CreateProps> = ({ onKeysetCreated, onBack }) => {
  const [keysetGenerated, setKeysetGenerated] = useState<{ success: boolean; location: string | React.ReactNode }>({ success: false, location: null });
  const [isGenerating, setIsGenerating] = useState(false);
  const [totalKeys, setTotalKeys] = useState<number>(3);
  const [threshold, setThreshold] = useState<number>(2);
  const [keysetName, setKeysetName] = useState("");
  const [nsec, setNsec] = useState("");
  const [isValidNsec, setIsValidNsec] = useState(false);
  const [nsecError, setNsecError] = useState<string | undefined>(undefined);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [isNameValid, setIsNameValid] = useState(true);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const loadExistingNames = async () => {
      // TODO: Replace with server API call
      // const response = await fetch('/api/shares');
      // const shares = await response.json();
      
      // Mock data for UI demonstration
      const shares: any[] = []; // Empty array for now, can be populated for testing
      if (shares) {
        const names = shares.map(share => share.name.split(' share ')[0]);
        setExistingNames(names);
      }
    };
    loadExistingNames();
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

  const handleGenerateNsec = async () => {
    setIsGenerating(true);
    try {
      // TODO: Replace with server API call to generate new nsec
      // const response = await fetch('/api/generate-nsec', { method: 'POST' });
      // const { nsec: newNsec } = await response.json();
      
      // Mock nsec generation for UI demonstration
      const mockNsec = `nsec1${'a'.repeat(59)}`; // Mock nsec format
      setNsec(mockNsec);
      setIsValidNsec(true);
      setKeysetGenerated({
        success: true,
        location: "New nsec key generated successfully"
      });
    } catch (error) {
      setKeysetGenerated({
        success: false,
        location: `Error generating nsec: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNsecChange = (value: string) => {
    setNsec(value);
    
    // TODO: Replace with server API call for validation
    // const response = await fetch('/api/validate-nsec', {
    //   method: 'POST',
    //   body: JSON.stringify({ nsec: value })
    // });
    // const validation = await response.json();
    
    // Mock validation for UI demonstration
    const isValidFormat = value.startsWith('nsec1') && value.length >= 60;
    if (value.trim() && isValidFormat) {
      setIsValidNsec(true);
      setNsecError(undefined);
    } else if (value.trim()) {
      setIsValidNsec(false);
      setNsecError('Invalid nsec format. Should start with "nsec1" and be properly formatted.');
    } else {
      setIsValidNsec(false);
      setNsecError('Nsec is required');
    }
  };

  const handleCreateKeyset = async () => {
    if (!keysetName.trim() || !nsec.trim() || !isValidNsec || !isNameValid) return;

    setIsGenerating(true);
    try {
      // TODO: Replace with server API call to create keyset
      // const response = await fetch('/api/create-keyset', {
      //   method: 'POST',
      //   body: JSON.stringify({
      //     nsec,
      //     threshold,
      //     totalKeys,
      //     name: keysetName
      //   })
      // });
      // const keyset = await response.json();
      
      // Mock keyset creation for UI demonstration
      const mockKeyset = {
        groupCredential: `group_credential_mock_${Date.now()}`,
        shareCredentials: Array.from({ length: totalKeys }, (_, i) => 
          `share_credential_mock_${i + 1}_${Date.now()}`
        ),
        name: keysetName
      };

      onKeysetCreated(mockKeyset);
    } catch (error) {
      setKeysetGenerated({
        success: false,
        location: `Error creating keyset: ${error instanceof Error ? error.message : 'Unknown error'}`
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
              <CardTitle className="text-xl text-blue-200">Create Keyset</CardTitle>
              <Tooltip 
                trigger={<HelpCircle size={18} className="text-blue-400 cursor-pointer" />}
                content={
                  <>
                    <p className="mb-2 font-semibold">Create a new keyset:</p>
                    <p className="mb-2">Split your nostr private key into multiple shares using FROST (Flexible Round-Optimized Schnorr Threshold signatures).</p>
                    <p>You can either import your existing nsec or generate a new one. The keyset will be split into shares that can be distributed across different devices for secure signing.</p>
                  </>
                }
              />
            </div>
            <IconButton
              variant="ghost"
              icon={<ArrowLeft className="w-4 h-4" />}
              onClick={onBack}
              tooltip="Back to shares"
              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <InputWithValidation
              label={
                <div className="flex items-center gap-1">
                  <span>Keyset Name</span>
                  <Tooltip 
                    trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                    content={
                      <p>A unique name to identify this keyset. This helps you distinguish between different keysets when managing multiple sets of shares.</p>
                    }
                    width="w-60"
                  />
                </div>
              }
              placeholder="Enter a name for this keyset"
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
            <div className="flex gap-2 w-full">
              <InputWithValidation
                label={
                  <div className="flex items-center gap-1">
                    <span>Nostr Private Key (nsec)</span>
                    <Tooltip 
                      trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                      content={
                        <>
                          <p className="mb-2 font-semibold">Your nostr private key:</p>
                          <p className="mb-2">This is your nostr private key (nsec) that will be split into shares. You can either paste your existing nsec or generate a new one.</p>
                          <p>The private key will be used to create the threshold shares but will not be stored after the keyset is created.</p>
                        </>
                      }
                    />
                  </div>
                }
                type="password"
                placeholder="Enter your nsec or generate a new one"
                value={nsec}
                onChange={handleNsecChange}
                isValid={isValidNsec}
                errorMessage={nsecError}
                isRequired={true}
                disabled={isGenerating}
                className="flex-1 w-full"
              />
              <div className="flex items-end">
                <Button
                  onClick={handleGenerateNsec}
                  className="bg-blue-600 hover:bg-blue-700 transition-colors duration-200 h-10"
                  disabled={isGenerating}
                >
                  Generate
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 w-full">
            <div className="space-y-2 w-full">
              <div className="flex items-center gap-1">
                <label htmlFor="total-keys" className="text-blue-200 text-sm font-medium">
                  Total Keys
                </label>
                <Tooltip 
                  trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                  content={
                    <p>The total number of key shares that will be created. Each share can be stored on a different device.</p>
                  }
                  width="w-60"
                />
              </div>
              <Input
                id="total-keys"
                type="number"
                min={2}
                value={totalKeys}
                onChange={(e) => setTotalKeys(Number(e.target.value))}
                className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full"
                disabled={isGenerating}
              />
            </div>
            <div className="space-y-2 w-full">
              <div className="flex items-center gap-1">
                <label htmlFor="threshold" className="text-blue-200 text-sm font-medium">
                  Threshold
                </label>
                <Tooltip 
                  trigger={<HelpCircle size={16} className="text-blue-400 cursor-pointer" />}
                  content={
                    <p>The minimum number of shares required to sign. Must be at least 2 and no more than the total number of keys.</p>
                  }
                  width="w-60"
                />
              </div>
              <Input
                id="threshold"
                type="number"
                min={2}
                max={totalKeys}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full"
                disabled={isGenerating}
              />
            </div>
          </div>
        </div>

        <Button
          onClick={handleCreateKeyset}
          className="w-full py-5 bg-blue-600 hover:bg-blue-700 transition-colors duration-200 text-sm font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isGenerating || !keysetName.trim() || !nsec.trim() || !isValidNsec || !isNameValid}
        >
          {isGenerating ? "Creating..." : "Create keyset"}
        </Button>

        {keysetGenerated.location && (
          <Alert 
            variant={keysetGenerated.success ? 'success' : 'error'}
            className="mt-4"
          >
            {keysetGenerated.location}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default Create; 