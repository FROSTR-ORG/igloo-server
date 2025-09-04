import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert } from './ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { PageLayout } from './ui/page-layout';
import { AppHeader } from './ui/app-header';
import { ContentCard } from './ui/content-card';
import { Lock, User, Key, ArrowRight } from 'lucide-react';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState<'admin' | 'setup' | 'complete'>('admin');
  const [adminSecret, setAdminSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasAdminSecret, setHasAdminSecret] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/onboarding/status');
      const data = await response.json();
      setHasAdminSecret(data.hasAdminSecret);
    } catch (error) {
      console.error('Error checking onboarding status:', error);
    }
  };

  const validateAdminSecret = async () => {
    if (!adminSecret.trim()) {
      setError('Admin secret is required');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/onboarding/validate-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ adminSecret }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to validate admin secret');
      }

      // Move to setup step
      setStep('setup');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to validate admin secret');
    } finally {
      setIsLoading(false);
    }
  };

  const createUser = async () => {
    // Validate inputs
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    if (username.length < 3 || username.length > 50) {
      setError('Username must be between 3 and 50 characters');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/onboarding/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          adminSecret,
          username,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      // Move to complete step
      setStep('complete');
      
      // Auto-redirect to login after 3 seconds
      setTimeout(() => {
        onComplete();
      }, 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      validateAdminSecret();
    }
  };

  const handleSetupKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      createUser();
    }
  };

  if (!hasAdminSecret) {
    return (
      <PageLayout>
        <AppHeader subtitle="Initial Setup" />
        
        <ContentCard>
          <Card className="bg-gray-900/30 border-red-900/30 backdrop-blur-sm shadow-lg max-w-md mx-auto">
            <CardHeader>
              <CardTitle className="text-xl text-red-200">Setup Required</CardTitle>
            </CardHeader>
            <CardContent>
              <Alert variant="error">
                <p className="mb-2">Admin secret is not configured.</p>
                <p className="text-sm">
                  Please set the <code className="bg-gray-800 px-1 rounded">ADMIN_SECRET</code> environment 
                  variable and restart the server to continue with the setup.
                </p>
              </Alert>
            </CardContent>
          </Card>
        </ContentCard>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <AppHeader subtitle="Initial Setup" />
      
      <div className="flex items-center justify-center min-h-[calc(100vh-12rem)] px-4">
        {step === 'admin' && (
          <Card className="bg-gray-900/40 border-blue-900/20 backdrop-blur-md shadow-2xl w-full max-w-lg">
            <CardHeader className="pb-8 pt-10">
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-blue-600/10 rounded-full">
                  <Key size={32} className="text-blue-400" />
                </div>
                <CardTitle className="text-2xl font-semibold text-blue-100 text-center">
                  Admin Authentication
                </CardTitle>
                <p className="text-gray-400 text-center max-w-sm">
                  Enter the admin secret to begin setting up your Igloo Server.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pb-10 px-8">
              <div className="space-y-3">
                <label className="text-sm font-medium text-blue-300">Admin Secret</label>
                <Input
                  type="password"
                  placeholder="Enter admin secret"
                  value={adminSecret}
                  onChange={(e) => setAdminSecret(e.target.value)}
                  onKeyPress={handleAdminKeyPress}
                  disabled={isLoading}
                  className="bg-gray-800/60 border-gray-700/60 text-gray-100 placeholder:text-gray-500 h-12 text-base"
                  autoFocus
                />
              </div>

              {error && (
                <Alert variant="error" className="bg-red-900/20 border-red-800/30">
                  {error}
                </Alert>
              )}

              <Button
                onClick={validateAdminSecret}
                disabled={isLoading || !adminSecret.trim()}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium text-base transition-colors"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Validating...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    Continue
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </span>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'setup' && (
          <Card className="bg-gray-900/40 border-blue-900/20 backdrop-blur-md shadow-2xl w-full max-w-lg">
            <CardHeader className="pb-8 pt-10">
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-blue-600/10 rounded-full">
                  <User size={32} className="text-blue-400" />
                </div>
                <CardTitle className="text-2xl font-semibold text-blue-100 text-center">
                  Create Admin Account
                </CardTitle>
                <p className="text-gray-400 text-center max-w-sm">
                  Create your admin account to secure your Igloo Server.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pb-10 px-8">
              <div className="space-y-3">
                <label className="text-sm font-medium text-blue-300">Username</label>
                <Input
                  type="text"
                  placeholder="Enter username (3-50 characters)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="bg-gray-800/60 border-gray-700/60 text-gray-100 placeholder:text-gray-500 h-12 text-base"
                  autoFocus
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-blue-300">Password</label>
                <Input
                  type="password"
                  placeholder="Enter password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="bg-gray-800/60 border-gray-700/60 text-gray-100 placeholder:text-gray-500 h-12 text-base"
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-blue-300">Confirm Password</label>
                <Input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyPress={handleSetupKeyPress}
                  disabled={isLoading}
                  className="bg-gray-800/60 border-gray-700/60 text-gray-100 placeholder:text-gray-500 h-12 text-base"
                />
              </div>

              {error && (
                <Alert variant="error" className="bg-red-900/20 border-red-800/30">
                  {error}
                </Alert>
              )}

              <Button
                onClick={createUser}
                disabled={isLoading || !username.trim() || !password.trim() || !confirmPassword.trim()}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium text-base transition-colors"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating Account...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    Create Account
                    <Lock className="ml-2 h-5 w-5" />
                  </span>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'complete' && (
          <Card className="bg-gray-900/40 border-green-900/20 backdrop-blur-md shadow-2xl w-full max-w-lg">
            <CardHeader className="pb-8 pt-10">
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-green-600/10 rounded-full">
                  <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <CardTitle className="text-2xl font-semibold text-green-100 text-center">
                  Setup Complete!
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pb-10 px-8">
              <Alert variant="success" className="bg-green-900/20 border-green-800/30">
                <p className="mb-2">Your Igloo Server has been successfully configured.</p>
                <p className="text-sm">Redirecting to login page...</p>
              </Alert>
              
              <div className="text-center text-gray-400">
                <p className="text-sm">You will be redirected in a moment.</p>
                <p className="text-sm mt-3">
                  If not, <button 
                    onClick={onComplete}
                    className="text-blue-400 hover:text-blue-300 underline transition-colors"
                  >
                    click here
                  </button> to continue.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
};

export default Onboarding;