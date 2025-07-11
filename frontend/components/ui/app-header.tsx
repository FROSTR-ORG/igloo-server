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
      {/* Desktop/Tablet Header (hidden on mobile) */}
      <div className="relative items-center mb-8 h-16 hidden sm:flex">
        {/* Center: Title (perfectly centered) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-cyan-300">Igloo Server</h1>
        </div>
        {/* Logo positioned immediately to the left of the centered text */}
        <div className="absolute left-1/2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ transform: 'translateX(calc(-50% - 160px)) translateY(-50%)' }}>
          <img src="/assets/frostr-logo-transparent.png" alt="Frostr Logo" className="w-12 h-12" />
        </div>
        {/* Right: User/Logout */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
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
      </div>

      {/* Mobile Header (shown only on mobile) */}
      <div className="flex flex-col items-center justify-center mb-8 sm:hidden">
        <img src="/assets/frostr-logo-transparent.png" alt="Frostr Logo" className="w-10 h-10 mb-2" />
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-cyan-300">Igloo Server</h1>
      </div>

      {subtitle && (
        <p className="mb-8 text-blue-400 text-center max-w-xl mx-auto text-sm">
          {subtitle}
        </p>
      )}
    </>
  );
} 