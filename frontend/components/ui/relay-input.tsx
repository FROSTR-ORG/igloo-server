import React, { useState, useEffect, useRef } from 'react';
import { Button } from "./button";
import { InputWithValidation } from "./input-with-validation";
import { Plus, Trash2 } from "lucide-react";

interface RelayInputProps {
  relays: string[];
  onChange: (relays: string[]) => void;
  className?: string;
}

// Mock validation function to replace igloo-core
const validateRelay = (relay: string) => {
  const trimmed = relay.trim();
  
  if (!trimmed) {
    return {
      isValid: false,
      message: 'Relay URL is required',
      normalized: undefined
    };
  }
  
  // Basic WebSocket URL validation
  if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
    return {
      isValid: false,
      message: 'Relay URL must start with ws:// or wss://',
      normalized: undefined
    };
  }
  
  try {
    new URL(trimmed);
    return {
      isValid: true,
      message: undefined,
      normalized: trimmed
    };
  } catch {
    return {
      isValid: false,
      message: 'Invalid URL format',
      normalized: undefined
    };
  }
};

const RelayInput: React.FC<RelayInputProps> = ({
  relays,
  onChange,
  className
}) => {
  const [newRelayUrl, setNewRelayUrl] = useState("");
  const [isValidRelay, setIsValidRelay] = useState(false);
  const [relayError, setRelayError] = useState<string | undefined>(undefined);
  const [normalizedRelay, setNormalizedRelay] = useState<string | undefined>(undefined);
  
  // Use a ref to store the latest onChange function to avoid dependency issues
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleRelayChange = (value: string) => {
    setNewRelayUrl(value);
    const validation = validateRelay(value);
    setIsValidRelay(validation.isValid);
    setRelayError(validation.message);
    setNormalizedRelay(validation.normalized);
  };

  const handleAddRelay = () => {
    const isAlreadyAdded = relays.indexOf(normalizedRelay || '') !== -1;
    if (isValidRelay && normalizedRelay && !isAlreadyAdded) {
      onChange([...relays, normalizedRelay]);
      setNewRelayUrl("");
      setIsValidRelay(false);
      setRelayError(undefined);
      setNormalizedRelay(undefined);
    }
  };

  const handleRemoveRelay = (urlToRemove: string) => {
    onChange(relays.filter(url => url !== urlToRemove));
  };

  // Add a default relay if the list is empty
  useEffect(() => {
    if (relays.length === 0) {
      const defaultRelay = "wss://relay.primal.net";
      onChangeRef.current([defaultRelay]);
    }
  }, [relays.length]);

  return (
    <div className={className}>
      <div className="space-y-2 w-full">
        <div className="flex gap-2 w-full">
          <InputWithValidation
            label="Add Relay"
            placeholder="wss://relay.example.com"
            value={newRelayUrl}
            onChange={handleRelayChange}
            isValid={isValidRelay}
            errorMessage={relayError}
            className="flex-1 w-full"
            isRequired={false}
          />
          <div className="flex items-end">
            <Button
              onClick={handleAddRelay}
              disabled={!isValidRelay}
              className="bg-blue-600 hover:bg-blue-700 transition-colors duration-200 h-10"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {relays.length > 0 && (
        <div className="mt-4 space-y-2 w-full">
          <label className="text-blue-200 text-sm font-medium">Relays</label>
          <div className="space-y-2 w-full">
            {relays.map((relay, index) => (
              <div key={index} className="flex justify-between items-center bg-gray-800/30 p-2 rounded-md border border-gray-700/30 w-full">
                <span className="text-blue-300 text-sm truncate mr-2">{relay}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveRelay(relay)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-900/30 p-1 h-auto"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { RelayInput }; 