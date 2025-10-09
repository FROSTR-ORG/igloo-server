import React, { useState, useEffect, FormEvent, useRef, useCallback } from "react"
import { Button } from "./ui/button"
import { InputWithValidation } from "./ui/input-with-validation"
import { Tooltip } from "./ui/tooltip"
import { HelpCircle } from "lucide-react"
import {
  validateShare,
  validateGroup,
  decodeShare,
  decodeGroup
} from '@frostr/igloo-core';

interface RecoverProps {
  initialShare?: string;
  initialGroupCredential?: string;
  defaultThreshold?: number;
  defaultTotalShares?: number;
  authHeaders?: Record<string, string>;
}

// Helper function to save share data to localStorage
const saveShareToStorage = (shareCredential: string, groupCredential: string) => {
  try {
    const existingRaw = localStorage.getItem('igloo-shares');
    let existingShares = [];
    
    if (existingRaw) {
      try {
        existingShares = JSON.parse(existingRaw);
      } catch (error) {
        console.warn('Failed to parse existing shares, starting fresh:', error);
        existingShares = [];
      }
    }
    
    // Create new share entry
    const newShare = {
      shareCredential,
      groupCredential,
      savedAt: new Date().toISOString(),
      id: `share-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    };
    
    // Check if this exact combination already exists
    const existingIndex = existingShares.findIndex((s: any) => 
      s.shareCredential === shareCredential && s.groupCredential === groupCredential
    );
    
    if (existingIndex >= 0) {
      // Update existing entry with new timestamp
      existingShares[existingIndex] = newShare;
    } else {
      // Add new entry
      existingShares.push(newShare);
    }
    
    // Keep only the most recent 10 shares to avoid localStorage bloat
    if (existingShares.length > 10) {
      existingShares.sort((a: any, b: any) => 
        new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
      );
      existingShares = existingShares.slice(0, 10);
    }
    
    localStorage.setItem('igloo-shares', JSON.stringify(existingShares));
  } catch (error) {
    console.warn('Failed to save share to localStorage:', error);
  }
};

const Recover: React.FC<RecoverProps> = ({ 
  initialShare,
  initialGroupCredential,
  defaultThreshold = 2,
  defaultTotalShares = 3,
  authHeaders = {}
}) => {
  // State for t of n shares
  const [sharesInputs, setSharesInputs] = useState<string[]>([initialShare || ""]);
  const [sharesValidity, setSharesValidity] = useState<{ isValid: boolean; message?: string }[]>([{ isValid: false }]);
  
  const [groupCredential, setGroupCredential] = useState<string>(initialGroupCredential || "");
  const [isGroupValid, setIsGroupValid] = useState(false);
  const [groupError, setGroupError] = useState<string | undefined>(undefined);
  
  // Add state for tracking if the group was auto-populated
  const [isGroupAutofilled, setIsGroupAutofilled] = useState(false);
  
  // Add a timeout ref to clear the autofilled indicator
  const autofilledTimeoutRef = useRef<number | null>(null);
  
  const [sharesFormValid, setSharesFormValid] = useState(false);
  
  // State for the result
  const [result, setResult] = useState<{ success: boolean; message: string | React.ReactNode }>({ 
    success: false, 
    message: null 
  });
  const [isProcessing, setIsProcessing] = useState(false);

  // Add state for the dynamic threshold
  const [currentThreshold, setCurrentThreshold] = useState<number>(defaultThreshold);
  // Add state for dynamic total shares
  const [currentTotalShares, setCurrentTotalShares] = useState<number>(defaultTotalShares);

  // Validate the shares form
  useEffect(() => {
    const validSharesCount = sharesValidity.filter(validity => validity.isValid).length;
    setSharesFormValid(validSharesCount >= currentThreshold && isGroupValid);
  }, [sharesValidity, currentThreshold, isGroupValid]);

  // Auto-detect shares from storage
  useEffect(() => {
    const autoDetectShares = async () => {
      // If we already have initial data, don't auto-detect
      if (initialShare || initialGroupCredential) {
        return;
      }
      
      // If we already have user input, don't override
      if (sharesInputs.some(s => s.trim()) || groupCredential.trim()) {
        return;
      }
      
      try {
        // First try localStorage for client-side storage
        const sharesRaw = localStorage.getItem('igloo-shares');
        let shares = [];
        
        if (sharesRaw) {
          try {
            shares = JSON.parse(sharesRaw);
          } catch (error) {
            console.warn('Failed to parse localStorage shares:', error);
          }
        }
        
        // If no localStorage data, try server API
        if (!shares || shares.length === 0) {
          try {
            const response = await fetch('/api/env/shares', {
              headers: authHeaders
            });
            if (response.ok) {
              const serverShares = await response.json();
              if (Array.isArray(serverShares)) {
                shares = serverShares;
              }
            }
          } catch (error) {
            // Server API might not exist yet, that's okay
            console.debug('Server shares API not available:', error);
          }
        }
        
        if (shares && Array.isArray(shares) && shares.length > 0) {
          // Sort by savedAt date if available, most recent first
          const sortedShares = [...shares].sort((a, b) => {
            if (a.savedAt && b.savedAt) {
              return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
            }
            return 0;
          });
          
          // Find the most recent share with both group and share credentials
          const validShare = sortedShares.find(s => 
            s.shareCredential && s.shareCredential.trim() && 
            s.groupCredential && s.groupCredential.trim()
          );
          
          if (validShare) {
            // Validate before using
            const shareValidation = validateShare(validShare.shareCredential);
            const groupValidation = validateGroup(validShare.groupCredential);
            
            if (shareValidation.isValid && groupValidation.isValid) {
              // Set the share
              setSharesInputs([validShare.shareCredential]);
              setSharesValidity([shareValidation]);
              
              // Set the group with auto-detection indicator
              setGroupCredential(validShare.groupCredential);
              setIsGroupValid(true);
              setGroupError(undefined);
              setIsGroupAutofilled(true);
              
              // Try to decode group for threshold/total shares
              try {
                const decodedGroup = decodeGroup(validShare.groupCredential);
                setCurrentThreshold(decodedGroup.threshold);
                setCurrentTotalShares(decodedGroup.commits.length);
              } catch (error) {
                setCurrentThreshold(defaultThreshold);
                setCurrentTotalShares(defaultTotalShares);
              }
              
              // Clear auto-detection indicator after 5 seconds
              if (autofilledTimeoutRef.current) {
                clearTimeout(autofilledTimeoutRef.current);
              }
              autofilledTimeoutRef.current = window.setTimeout(() => {
                setIsGroupAutofilled(false);
              }, 5000);
            }
          }
        }
      } catch (error) {
        console.warn('Auto-detection failed:', error);
      }
    };
    
    autoDetectShares();
  }, [initialShare, initialGroupCredential, defaultThreshold, defaultTotalShares, sharesInputs, groupCredential]);

  // Handle initialShare and initialGroupCredential
  useEffect(() => {
    if (initialShare) {
      setSharesInputs([initialShare]);
      const validation = validateShare(initialShare);
      setSharesValidity([validation]);
    }
    
    if (initialGroupCredential) {
      setGroupCredential(initialGroupCredential);
      const validation = validateGroup(initialGroupCredential);
      setIsGroupValid(validation.isValid);
      setGroupError(validation.message);
      
      // Try to decode group to get threshold and total shares
      if (validation.isValid) {
        try {
          const decodedGroup = decodeGroup(initialGroupCredential);
          setCurrentThreshold(decodedGroup.threshold);
          setCurrentTotalShares(decodedGroup.commits.length);
        } catch (error) {
          // If decode fails, use defaults
          setCurrentThreshold(defaultThreshold);
          setCurrentTotalShares(defaultTotalShares);
        }
      }
    }
  }, [initialShare, initialGroupCredential, defaultThreshold, defaultTotalShares]);

  // Handle adding more share inputs
  const addShareInput = () => {
    if (sharesInputs.length < currentThreshold) {
      setSharesInputs([...sharesInputs, ""]);
      setSharesValidity([...sharesValidity, { isValid: false }]);
    }
  };

  // Handle removing a share input
  const removeShareInput = (indexToRemove: number) => {
    if (sharesInputs.length > 1) {
      const newSharesInputs = sharesInputs.filter((_, index) => index !== indexToRemove);
      const newSharesValidity = sharesValidity.filter((_, index) => index !== indexToRemove);
      setSharesInputs(newSharesInputs);
      setSharesValidity(newSharesValidity);
    }
  };

  // Handle updating share input values
  const updateShareInput = (index: number, value: string) => {
    const newSharesInputs = [...sharesInputs];
    newSharesInputs[index] = value;
    setSharesInputs(newSharesInputs);
    
    const validation = validateShare(value);
    
    // Additional validation - try to decode if the basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        const decodedShare = decodeShare(value);
        
        // Additional structure validation
        if (typeof decodedShare.idx !== 'number' || 
            typeof decodedShare.seckey !== 'string' || 
            typeof decodedShare.binder_sn !== 'string' || 
            typeof decodedShare.hidden_sn !== 'string') {
          const newSharesValidity = [...sharesValidity];
          newSharesValidity[index] = { 
            isValid: false, 
            message: 'Share has invalid internal structure' 
          };
          setSharesValidity(newSharesValidity);
          return;
        }
        
        // Update share validity
        const newSharesValidity = [...sharesValidity];
        newSharesValidity[index] = validation;
        setSharesValidity(newSharesValidity);
        
        // Save valid share to localStorage for future auto-detection
        if (groupCredential && isGroupValid) {
          saveShareToStorage(value, groupCredential);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid share structure';
        const newSharesValidity = [...sharesValidity];
        newSharesValidity[index] = { isValid: false, message: errorMessage };
        setSharesValidity(newSharesValidity);
      }
    } else {
      const newSharesValidity = [...sharesValidity];
      newSharesValidity[index] = validation;
      setSharesValidity(newSharesValidity);
    }
  };

  // Handle group credential change
  const handleGroupChange = (value: string) => {
    setGroupCredential(value);
    setIsGroupAutofilled(false); // Clear the autofilled flag when user types
    
    const validation = validateGroup(value);
    
    // Try deeper validation if basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        const decodedGroup = decodeGroup(value);
        
        // Additional structure validation
        if (typeof decodedGroup.threshold !== 'number' || 
            typeof decodedGroup.group_pk !== 'string' || 
            !Array.isArray(decodedGroup.commits) ||
            decodedGroup.commits.length === 0) {
          setIsGroupValid(false);
          setGroupError('Group credential has invalid internal structure');
          setCurrentThreshold(defaultThreshold);
          setCurrentTotalShares(defaultTotalShares);
          return;
        }
        
        // Set the dynamic threshold and total shares
        setCurrentThreshold(decodedGroup.threshold);
        setCurrentTotalShares(decodedGroup.commits.length);
        setIsGroupValid(true);
        setGroupError(undefined);
        
        // Save to localStorage if we have a valid share as well
        const validShares = sharesInputs.filter((_, index) => sharesValidity[index]?.isValid);
        if (validShares.length > 0) {
          validShares.forEach(share => saveShareToStorage(share, value));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid group structure';
        setIsGroupValid(false);
        
        if (errorMessage.includes('malformed') || 
            errorMessage.includes('decode') || 
            errorMessage.includes('bech32')) {
          setGroupError('Invalid bfgroup format - must be a valid bech32m encoded credential');
        } else {
          setGroupError(`Invalid group: ${errorMessage}`);
        }
        setCurrentThreshold(defaultThreshold);
        setCurrentTotalShares(defaultTotalShares);
      }
    } else {
      setIsGroupValid(validation.isValid);
      setGroupError(validation.message);
      if (!validation.isValid) {
        setCurrentThreshold(defaultThreshold);
        setCurrentTotalShares(defaultTotalShares);
      }
    }
  };

  // Handle form submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!sharesFormValid) return;
    
    setIsProcessing(true);
    try {
      // Get valid share credentials
      const validShareCredentials = sharesInputs
        .filter((_, index) => sharesValidity[index].isValid);

      // Call server API for recovery
      const response = await fetch('/api/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          groupCredential,
          shareCredentials: validShareCredentials
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Recovery failed');
      }

      if (result.success) {
        setResult({
          success: true,
          message: (
            <div>
              <div className="mb-3 text-green-200 font-medium">
                Successfully recovered NSEC using {result.details.sharesUsed} shares
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium mb-1">Recovered NSEC:</div>
                  <div className="bg-gray-800/50 p-2 rounded text-xs break-all">
                    {result.nsec}
                  </div>
                </div>
                {result.details.invalidShares && (
                  <div className="text-sm text-orange-300">
                    Note: {result.details.invalidShares.length} invalid shares were ignored
                  </div>
                )}
              </div>
            </div>
          )
        });
      } else {
        throw new Error(result.error || 'Recovery failed');
      }
    } catch (error) {
      setResult({
        success: false,
        message: `Error recovering NSEC: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg sm:text-xl text-blue-200 font-semibold">Recover NSEC</h2>
        <Tooltip
          trigger={<HelpCircle size={18} className="text-blue-400 flex-shrink-0 cursor-pointer" />}
          position="right"
          content={
            <>
              <p className="mb-2 font-semibold">NSEC Recovery:</p>
              <p>
                Use your FROSTR threshold shares to recover your original Nostr private key (nsec). 
                You need at least {currentThreshold} valid shares from your signing group to reconstruct the key.
              </p>
            </>
          }
        />
      </div>
      <div className="space-y-8">
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="bg-gray-800/50 p-3 sm:p-4 rounded-lg">
              <div className="text-sm text-blue-300 mb-2">Recovery Requirements:</div>
              <div className="text-sm text-blue-200">
                You need {currentThreshold} out of {currentTotalShares} shares to recover your NSEC
              </div>
            </div>

            <InputWithValidation
              label={
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <span>Group Credential</span>
                  {isGroupAutofilled && (
                    <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full animate-pulse whitespace-nowrap">
                      Auto-detected
                    </span>
                  )}
                </div>
              }
              type="text"
              placeholder="Enter bfgroup1... credential"
              value={groupCredential}
              onChange={handleGroupChange}
              isValid={isGroupValid}
              errorMessage={groupError}
              isRequired={true}
              className="w-full"
            />

            <div className="space-y-3 w-full">
              <div className="text-blue-200 text-sm font-medium">Share Credentials:</div>
              {sharesInputs.map((share, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-2 w-full">
                  <InputWithValidation
                    placeholder={`Enter share ${index + 1} (bfshare1...)`}
                    value={share}
                    onChange={(value) => updateShareInput(index, value)}
                    isValid={sharesValidity[index]?.isValid}
                    errorMessage={sharesValidity[index]?.message}
                    className="flex-1 w-full"
                    disabled={isProcessing}
                    isRequired={true}
                  />
                  <Button
                    type="button"
                    onClick={() => removeShareInput(index)}
                    className="bg-red-900/30 hover:bg-red-800/50 text-red-200 hover:text-red-100 px-3 py-2 sm:px-2 w-full sm:w-auto text-base sm:text-sm font-medium"
                    disabled={isProcessing || sharesInputs.length <= 1}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              {sharesInputs.length < currentThreshold && (
                <Button
                  type="button"
                  onClick={addShareInput}
                  className="w-full mt-2 bg-blue-600/30 hover:bg-blue-700/30 text-blue-200 hover:text-blue-100 text-sm sm:text-base"
                  disabled={isProcessing}
                >
                  Add Share Input ({sharesInputs.length}/{currentThreshold})
                </Button>
              )}
            </div>
          </div>

          <div className="mt-6">
            <Button 
              type="submit"
              className="w-full py-4 sm:py-5 bg-green-600 hover:bg-green-700 text-white hover:text-gray-100 transition-colors duration-200 text-sm sm:text-base font-medium hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isProcessing || !sharesFormValid}
            >
              {isProcessing ? "Processing..." : "Recover NSEC"}
            </Button>
          </div>
        </form>

        {result.message && (
          <div className={`mt-4 p-3 rounded-lg ${
            result.success ? 'bg-green-900/30 text-green-200' : 'bg-red-900/30 text-red-200'
          }`}>
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
};

export default Recover; 
