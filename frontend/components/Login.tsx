import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PageLayout } from './ui/page-layout';
import { AppHeader } from './ui/app-header';
import { ContentCard } from './ui/content-card';
import { Alert } from './ui/alert';

interface LoginProps {
  onLogin: (sessionId: string | undefined, userId: string, credentials?: { apiKey?: string; basicAuth?: { username: string; password: string } }) => void;
  authEnabled: boolean;
}

interface AuthStatus {
  enabled: boolean;
  methods: string[];
  rateLimiting: boolean;
  sessionTimeout: number;
}

const Login: React.FC<LoginProps> = ({ onLogin, authEnabled }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [authMode, setAuthMode] = useState<'basic' | 'api'>('basic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  const fetchAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const status = await response.json();
        setAuthStatus(status);
        setError(''); // Clear any previous error
        // Set default auth mode based on available methods
        if (status.methods.includes('api-key')) {
          setAuthMode('api');
        } else if (status.methods.includes('basic-auth')) {
          setAuthMode('basic');
        }
      } else {
        setError('Failed to fetch authentication status. Please try again later.');
        setAuthStatus(null);
      }
    } catch (error) {
      console.error('Failed to fetch auth status:', error);
      setError('Unable to connect to the server to check authentication status.');
      setAuthStatus(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const loginData = authMode === 'api'
        ? { apiKey }
        : { username, password };

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Pass credentials along with session info for fallback authentication
        const credentials = authMode === 'api' 
          ? { apiKey } 
          : { basicAuth: { username, password } };
        onLogin(data.sessionId, data.userId, credentials);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!authEnabled) {
    return null;
  }

  return (
    <PageLayout maxWidth="max-w-lg">
      <AppHeader subtitle="Authentication required to access this server" />

      <ContentCard>
        <div className="space-y-6">
          {/* Logo and Title */}
          <div className="text-center space-y-4">
            <p className="text-blue-300/70 text-base mt-2">
              Sign in to continue
            </p>
          </div>

          {/* Connection Error */}
          {error && !authStatus && (
            <Alert variant="error">
              {error}
            </Alert>
          )}

          {/* Auth Method Toggle */}
          {authStatus && (
            <div className="flex justify-center">
              <div className="flex bg-gray-800/50 rounded-lg p-1 space-x-1">
                {authStatus.methods.includes('basic-auth') && (
                  <button
                    type="button"
                    onClick={() => setAuthMode('basic')}
                    className={`px-4 py-2 text-sm rounded-md transition-colors ${authMode === 'basic'
                        ? 'bg-blue-600 text-white'
                        : 'text-blue-300 hover:text-blue-200 hover:bg-gray-700/50'
                      }`}
                  >
                    Username/Password
                  </button>
                )}
                {authStatus.methods.includes('api-key') && (
                  <button
                    type="button"
                    onClick={() => setAuthMode('api')}
                    className={`px-4 py-2 text-sm rounded-md transition-colors ${authMode === 'api'
                        ? 'bg-blue-600 text-white'
                        : 'text-blue-300 hover:text-blue-200 hover:bg-gray-700/50'
                      }`}
                  >
                    API Key
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {authMode === 'basic' ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="username" className="block text-sm font-medium text-blue-200">
                    Username
                  </label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Enter username"
                    className="bg-gray-800/50 border-gray-700/50 text-blue-300"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-blue-200">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter password"
                    className="bg-gray-800/50 border-gray-700/50 text-blue-300"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label htmlFor="apiKey" className="block text-sm font-medium text-blue-200">
                  API Key
                </label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  placeholder="Enter API key"
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300"
                />
              </div>
            )}

            {/* Login Error */}
            {error && authStatus && (
              <Alert variant="error">
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          {/* Auth Status Info */}
          {authStatus && (
            <div className="mt-6 p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
              <div className="text-xs text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Authentication:</span>
                  <span className="text-blue-300">{authStatus.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Rate limiting:</span>
                  <span className="text-blue-300">{authStatus.rateLimiting ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Session timeout:</span>
                  <span className="text-blue-300">{Math.floor(authStatus.sessionTimeout / 60)} minutes</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ContentCard>
    </PageLayout>
  );
};

export default Login; 