import React, { useState } from 'react';
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { Input } from "./ui/input";
import { Alert } from "./ui/alert";

interface LoadShareProps {
  share: {
    id: string;
    name: string;
    encryptedShare: string;
    groupCredential: string;
    salt: string;
  };
  onLoad?: (decryptedShare: string, groupCredential: string) => void;
  onCancel?: () => void;
}

const LoadShare: React.FC<LoadShareProps> = ({ share, onLoad, onCancel }) => {
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      setPasswordError('Password is required');
      return;
    }

    setIsLoading(true);
    setPasswordError(null);

    try {
      // TODO: Replace with server API call to decrypt share
      // const response = await fetch('/api/decrypt-share', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     encryptedShare: share.encryptedShare,
      //     password,
      //     salt: share.salt
      //   })
      // });
      // 
      // if (!response.ok) {
      //   throw new Error('Failed to decrypt share');
      // }
      // 
      // const { decryptedShare } = await response.json();

      // For now, simulate decryption with placeholder logic
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time
      
      // Validate password format (mock validation)
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      
      // Mock decrypted share (would come from server)
      const mockDecryptedShare = `bfshare_mock_${share.id}_${Date.now()}`;
      
      // Call the onLoad prop with decrypted data
      if (onLoad) {
        onLoad(mockDecryptedShare, share.groupCredential);
      }
      
      setPassword('');
    } catch (err) {
      setPasswordError('Failed to decrypt share: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onCancel || (() => {})} title={`Load ${share.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {passwordError && (
          <Alert variant="error">{passwordError}</Alert>
        )}
        
        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-blue-200">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to decrypt this share"
            disabled={isLoading}
            className="w-full"
          />
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? 'Decrypting...' : 'Load Share'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default LoadShare; 