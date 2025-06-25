import React from 'react';
import { Button } from './button';
import { LogOut, User } from 'lucide-react';

interface AppHeaderProps {
  subtitle?: React.ReactNode;
  authEnabled?: boolean;
  userId?: string;
  onLogout?: () => void;
}

export function AppHeader({ subtitle, authEnabled, userId, onLogout }: AppHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center justify-center flex-1">
          <img src="/assets/frostr-logo-transparent.png" alt="Frostr Logo" className="w-12 h-12 mr-2" />
          <h1 className="text-4xl font-bold font-orbitron bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-cyan-300">Igloo Server</h1>
        </div>
        
        {authEnabled && userId && onLogout && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-blue-300 text-sm">
              <User size={16} />
              <span>{userId}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
            >
              <LogOut size={16} className="mr-1" />
              Logout
            </Button>
          </div>
        )}
      </div>
      
      {subtitle && (
        <p className="mb-8 text-blue-400 text-center max-w-xl mx-auto text-sm">
          {subtitle}
        </p>
      )}
    </>
  );
} 