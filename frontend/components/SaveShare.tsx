import React, { useState } from 'react';
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { Input } from "./ui/input";
import { Alert } from "./ui/alert";

interface SaveShareProps {
  onSave?: (password: string, salt: string, encryptedShare: string) => void;
  shareToEncrypt?: string;
}

const SaveShare: React.FC<SaveShareProps> = ({ onSave, shareToEncrypt }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isPasswordValid = password.length >= 8;
  const isConfirmValid = confirmPassword === password && confirmPassword.length > 0;

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (value.length > 0 && value.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
    } else {
      setPasswordError(null);
    }
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (value.length > 0 && value !== password) {
      setConfirmError('Passwords do not match');
    } else {
      setConfirmError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isPasswordValid || !isConfirmValid || !shareToEncrypt) {
      return;
    }

    setIsSubmitting(true);

    try {
      // TODO: Replace with server API call to encrypt share
      // const response = await fetch('/api/encrypt-share', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     shareData: shareToEncrypt,
      //     password: password
      //   })
      // });
      // 
      // if (!response.ok) {
      //   throw new Error('Failed to encrypt share');
      // }
      // 
      // const { encryptedShare, salt } = await response.json();

      // For now, simulate encryption with placeholder logic
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time
      
      // Generate mock salt and encrypted share (would come from server)
      const salt = btoa(Math.random().toString()).substring(0, 16);
      const mockEncryptedShare = `encrypted_${btoa(shareToEncrypt)}_${Date.now()}`;

      // Call the onSave callback with the encrypted data
      if (onSave) {
        onSave(password, salt, mockEncryptedShare);
      }

      // Reset form
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError('Failed to encrypt share: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={() => {}} title="Save Share">
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
            onChange={(e) => handlePasswordChange(e.target.value)}
            placeholder="Enter password to encrypt this share"
            disabled={isSubmitting}
            className="w-full"
          />
          {passwordError && (
            <p className="text-sm text-red-400">{passwordError}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-blue-200">
            Confirm Password
          </label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => handleConfirmPasswordChange(e.target.value)}
            placeholder="Confirm your password"
            disabled={isSubmitting}
            className="w-full"
          />
          {confirmError && (
            <p className="text-sm text-red-400">{confirmError}</p>
          )}
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            type="submit"
            disabled={isSubmitting || !isPasswordValid || !isConfirmValid || !shareToEncrypt}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? 'Encrypting...' : 'Save Share'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default SaveShare; 