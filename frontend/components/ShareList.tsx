import React, { useState, useEffect } from 'react';
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { Card, CardContent } from "./ui/card";
import { Tooltip } from "./ui/tooltip";
import LoadShare from './LoadShare';
import { Eye, EyeOff, Trash2, Download, Plus, FolderOpen } from 'lucide-react';
import ConfirmModal from './ui/ConfirmModal';

interface Share {
  id: string;
  name: string;
  share: string; // encrypted share data
  salt: string;
  groupCredential: string;
  savedAt?: string;
}

interface ShareListProps {
  onShareLoaded: (share: string, groupCredential: string, shareName: string) => void;
  onNewKeyset: () => void;
}

// Helper function to extract pubkey from share - simplified for mock data
const extractPubkeyFromShare = (share: Share): string | null => {
  // TODO: Replace with server API call to decode share and extract pubkey
  // For now, return mock pubkey from share data
  return `npub1mock${share.id.slice(0, 8)}...`;
};

const ShareList: React.FC<ShareListProps> = ({ onShareLoaded, onNewKeyset }) => {
  const [shares, setShares] = useState<Share[]>([]);
  const [loadingShare, setLoadingShare] = useState<Share | null>(null);
  const [showPasswords, setShowPasswords] = useState<{[key: string]: boolean}>({});
  const [shareToDelete, setShareToDelete] = useState<Share | null>(null);

  useEffect(() => {
    loadShares();
  }, []);

  const loadShares = async () => {
    try {
      // TODO: Replace with server API call
      // const response = await fetch('/api/shares');
      // const sharesData = await response.json();
      
      // Mock shares data for UI demonstration
      const mockShares: Share[] = [
        // Empty array for now - can be populated for testing UI
        // {
        //   id: 'share_1',
        //   name: 'Test Keyset share 1',
        //   share: 'encrypted_share_data_1',
        //   salt: 'mock_salt_1',
        //   groupCredential: 'mock_group_credential',
        //   savedAt: new Date().toISOString()
        // }
      ];
      
      setShares(mockShares);
    } catch (error) {
      console.error('Failed to load shares:', error);
      setShares([]);
    }
  };

  const handleLoadShare = (share: Share) => {
    setLoadingShare(share);
  };

  const handleCancelLoad = () => {
    setLoadingShare(null);
  };

  const handleLoadComplete = (decryptedShare: string, groupCredential: string) => {
    if (loadingShare) {
      onShareLoaded(decryptedShare, groupCredential, loadingShare.name);
      setLoadingShare(null);
    }
  };

  const togglePasswordVisibility = (shareId: string) => {
    setShowPasswords(prev => ({
      ...prev,
      [shareId]: !prev[shareId]
    }));
  };

  const handleDeleteShare = (share: Share) => {
    setShareToDelete(share);
  };

  const handleDeleteConfirm = async () => {
    if (!shareToDelete) return;
    
    try {
      // TODO: Replace with server API call
      // const response = await fetch(`/api/shares/${shareToDelete.id}`, {
      //   method: 'DELETE'
      // });
      // 
      // if (!response.ok) {
      //   throw new Error('Failed to delete share');
      // }
      
      // Mock deletion - remove from local state
      setShares(prev => prev.filter(s => s.id !== shareToDelete.id));
      setShareToDelete(null);
    } catch (error) {
      console.error('Failed to delete share:', error);
      // You could show an error toast here
    }
  };

  const handleDeleteCancel = () => {
    setShareToDelete(null);
  };

  const handleOpenLocation = async (share: Share) => {
    // TODO: Replace with server API call to open share location
    // For now, just log the action
    console.log('Opening location for share:', share.id);
    // Could open a URL or trigger a download, etc.
  };

  const handleExportShare = async (share: Share) => {
    try {
      // Create a downloadable file with the share data
      const shareData = {
        name: share.name,
        encryptedShare: share.share,
        salt: share.salt,
        groupCredential: share.groupCredential,
        exportedAt: new Date().toISOString()
      };
      
      const blob = new Blob([JSON.stringify(shareData, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${share.name.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export share:', error);
    }
  };

  if (loadingShare) {
    return (
      <LoadShare
        share={{
          id: loadingShare.id,
          name: loadingShare.name,
          encryptedShare: loadingShare.share,
          groupCredential: loadingShare.groupCredential,
          salt: loadingShare.salt
        }}
        onLoad={handleLoadComplete}
        onCancel={handleCancelLoad}
      />
    );
  }

  return (
    <>
      {shares.length > 0 ? (
        <div className="space-y-3">
          {shares.map((share) => (
            <div 
              key={share.id} 
              className="bg-gray-800/60 rounded-md p-4 flex justify-between items-center border border-gray-700 hover:border-blue-700 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <h3 className="text-blue-200 font-medium">{share.name}</h3>
                <p className="text-gray-400 text-sm mt-1">
                  ID: <span className="text-blue-400 font-mono">{share.id}</span>
                </p>
                {(() => {
                  const pubkey = extractPubkeyFromShare(share);
                  return pubkey ? (
                    <p className="text-gray-400 text-sm mt-1">
                      Pubkey: <span className="font-mono text-xs truncate block">{pubkey}</span>
                    </p>
                  ) : null;
                })()}
                {share.savedAt && (
                  <p className="text-gray-500 text-xs mt-1">
                    Saved: {new Date(share.savedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Tooltip 
                  trigger={
                    <IconButton
                      icon={<FolderOpen className="h-4 w-4" />}
                      onClick={() => handleOpenLocation(share)}
                      className="text-gray-400 hover:text-gray-300 hover:bg-gray-700/50"
                    />
                  }
                  position="top"
                  width="w-fit"
                  content="Open"
                />
                <Tooltip 
                  trigger={
                    <IconButton
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => handleDeleteShare(share)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-900/30"
                    />
                  }
                  position="top"
                  width="w-fit"
                  content="Delete"
                />
                <Button
                  onClick={() => handleLoadShare(share)}
                  className="bg-blue-600 hover:bg-blue-700 text-blue-100 transition-colors"
                >
                  Load
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-400 mb-4">No shares available</p>
          <p className="text-sm text-gray-500 mb-4">Get started by creating your first keyset</p>
          <Button
            onClick={onNewKeyset}
            className="bg-blue-600 hover:bg-blue-700 text-blue-100 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create New Keyset
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!shareToDelete}
        title="Delete Share"
        body={
          <div>
            <p>Are you sure you want to delete this share?</p>
            <p className="text-sm text-gray-400 mt-2">
              Share name: <span className="text-blue-400">{shareToDelete?.name}</span>
            </p>
            <p className="text-sm text-gray-400">
              Share ID: <span className="text-blue-400 font-mono">{shareToDelete?.id}</span>
            </p>
          </div>
        }
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
};

export default ShareList; 