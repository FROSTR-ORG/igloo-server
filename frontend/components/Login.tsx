import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

interface LoginProps {
  onLogin: (sessionId: string, userId: string) => void;
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
        onLogin(data.sessionId, data.userId);
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <img 
              src="/assets/frostr-logo-transparent.png" 
              alt="FROSTR Logo" 
              className="h-16 w-auto"
            />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Igloo Server
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Authentication required to access this server
          </p>
        </div>

        <Card className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && !authStatus && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {authStatus && (
            <div className="mb-6">
              <div className="flex justify-center space-x-4">
                {authStatus.methods.includes('basic-auth') && (
                  <button
                    type="button"
                    onClick={() => setAuthMode('basic')}
                    className={`px-3 py-1 text-sm rounded ${
                      authMode === 'basic'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-700 border border-gray-300'
                    }`}
                  >
                    Username/Password
                  </button>
                )}
                {authStatus.methods.includes('api-key') && (
                  <button
                    type="button"
                    onClick={() => setAuthMode('api')}
                    className={`px-3 py-1 text-sm rounded ${
                      authMode === 'api'
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-700 border border-gray-300'
                    }`}
                  >
                    API Key
                  </button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            {authMode === 'basic' ? (
              <>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <Input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="Enter username"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="mt-1"
                    placeholder="Enter password"
                  />
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">
                  API Key
                </label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  className="mt-1"
                  placeholder="Enter API key"
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          {authStatus && (
            <div className="mt-6 text-xs text-gray-500 space-y-1">
              <p>• Authentication: {authStatus.enabled ? 'Enabled' : 'Disabled'}</p>
              <p>• Rate limiting: {authStatus.rateLimiting ? 'Enabled' : 'Disabled'}</p>
              <p>• Session timeout: {Math.floor(authStatus.sessionTimeout / 60)} minutes</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Login; 