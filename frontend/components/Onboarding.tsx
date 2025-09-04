import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert } from './ui/alert';
import { PageLayout } from './ui/page-layout';
import { AppHeader } from './ui/app-header';
import { ContentCard } from './ui/content-card';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
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

  const getCurrentStepNumber = () => {
    return step === 'admin' ? 1 : step === 'setup' ? 2 : 3;
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
      
      <ContentCard>
        <div className="space-y-6">
        {step === 'admin' && (
          <>
            {/* Step indicator */}
            <div className="flex items-center justify-center space-x-2">
              {['Admin', 'Setup', 'Complete'].map((label, i) => {
                const stepNum = i + 1;
                const currentStep = getCurrentStepNumber();
                const isActive = stepNum === currentStep;
                const isPast = stepNum < currentStep;
                return (
                  <div key={i} className="flex items-center">
                    <div
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                        ${
                          isPast
                            ? 'bg-green-600/80 text-white'
                            : isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800/50 text-gray-500'
                        }
                      `}
                    >
                      {isPast ? '✓' : stepNum}
                    </div>
                    {i < 2 && (
                      <div
                        className={`w-8 h-0.5 ${
                          isPast ? 'bg-green-600/50' : 'bg-gray-700/50'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Icon and Title */}
            <div className="flex items-center justify-center">
              <div className="p-4 bg-blue-600/10 rounded-2xl border border-blue-600/20">
                <Key className="w-8 h-8 text-blue-400" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold text-blue-200">
                Admin Authentication
              </h3>
              <p className="text-sm text-blue-300/70">
                Enter the admin secret to begin setting up your Igloo Server
              </p>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-200">Admin Secret</label>
                <Input
                  type="password"
                  placeholder="Enter admin secret"
                  value={adminSecret}
                  onChange={(e) => setAdminSecret(e.target.value)}
                  onKeyPress={handleAdminKeyPress}
                  disabled={isLoading}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                  autoFocus
                />
              </div>

              {error && (
                <Alert variant="error">
                  {error}
                </Alert>
              )}

              <Button
                onClick={validateAdminSecret}
                disabled={isLoading || !adminSecret.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
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
            </div>
          </>
        )}

        {step === 'setup' && (
          <>
            {/* Step indicator */}
            <div className="flex items-center justify-center space-x-2">
              {['Admin', 'Setup', 'Complete'].map((label, i) => {
                const stepNum = i + 1;
                const currentStep = getCurrentStepNumber();
                const isActive = stepNum === currentStep;
                const isPast = stepNum < currentStep;
                return (
                  <div key={i} className="flex items-center">
                    <div
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                        ${
                          isPast
                            ? 'bg-green-600/80 text-white'
                            : isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800/50 text-gray-500'
                        }
                      `}
                    >
                      {isPast ? '✓' : stepNum}
                    </div>
                    {i < 2 && (
                      <div
                        className={`w-8 h-0.5 ${
                          isPast ? 'bg-green-600/50' : 'bg-gray-700/50'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Icon and Title */}
            <div className="flex items-center justify-center">
              <div className="p-4 bg-green-600/10 rounded-2xl border border-green-600/20">
                <User className="w-8 h-8 text-green-400" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold text-blue-200">
                Create Admin Account
              </h3>
              <p className="text-sm text-blue-300/70">
                Create your admin account to secure your Igloo Server
              </p>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-200">Username</label>
                <Input
                  type="text"
                  placeholder="Enter username (3-50 characters)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-200">Password</label>
                <Input
                  type="password"
                  placeholder="Enter password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-blue-200">Confirm Password</label>
                <Input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyPress={handleSetupKeyPress}
                  disabled={isLoading}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                />
              </div>

              {error && (
                <Alert variant="error">
                  {error}
                </Alert>
              )}

              <Button
                onClick={createUser}
                disabled={isLoading || !username.trim() || !password.trim() || !confirmPassword.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
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
            </div>
          </>
        )}

        {step === 'complete' && (
          <>
            {/* Step indicator */}
            <div className="flex items-center justify-center space-x-2">
              {['Admin', 'Setup', 'Complete'].map((label, i) => {
                const stepNum = i + 1;
                const currentStep = getCurrentStepNumber();
                const isActive = stepNum === currentStep;
                const isPast = stepNum < currentStep;
                return (
                  <div key={i} className="flex items-center">
                    <div
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                        ${
                          isPast
                            ? 'bg-green-600/80 text-white'
                            : isActive
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800/50 text-gray-500'
                        }
                      `}
                    >
                      {isPast ? '✓' : stepNum}
                    </div>
                    {i < 2 && (
                      <div
                        className={`w-8 h-0.5 ${
                          isPast ? 'bg-green-600/50' : 'bg-gray-700/50'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Icon and Title */}
            <div className="flex items-center justify-center">
              <div className="p-4 bg-blue-600/10 rounded-2xl border border-blue-600/20">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold text-blue-200">
                Setup Complete!
              </h3>
            </div>

            {/* Content */}
            <div className="space-y-4">
              <div className="bg-green-900/20 border border-green-600/30 rounded-lg p-4 space-y-2">
                <p className="text-green-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Admin secret validated
                </p>
                <p className="text-green-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  User account created
                </p>
                <p className="text-green-400 text-sm flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Ready to sign in
                </p>
              </div>
              
              <div className="text-center space-y-2">
                <p className="text-sm text-blue-300/70">
                  Redirecting to login page in a moment...
                </p>
                <button 
                  onClick={onComplete}
                  className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                >
                  Click here to continue immediately
                </button>
              </div>
            </div>
          </>
        )}
        </div>
      </ContentCard>
    </PageLayout>
  );
};

export default Onboarding;