import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert } from './ui/alert';
import { PageLayout } from './ui/page-layout';
import { AppHeader } from './ui/app-header';
import { ContentCard } from './ui/content-card';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tooltip } from './ui/tooltip';
import { Lock, User, Key, ArrowRight, HelpCircle } from 'lucide-react';

interface OnboardingProps {
  onComplete: () => void;
  initialSkipAdminValidation?: boolean;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete, initialSkipAdminValidation = false }) => {
  const [step, setStep] = useState<'admin' | 'setup' | 'complete'>(initialSkipAdminValidation ? 'setup' : 'admin');
  const [adminSecret, setAdminSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasAdminSecret, setHasAdminSecret] = useState(true);
  const [skipAdminValidation, setSkipAdminValidation] = useState<boolean>(Boolean(initialSkipAdminValidation));
  const [networkError, setNetworkError] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref to adminSecret to ensure it's not lost during re-renders
  const adminSecretRef = useRef<string>('');

  // Match server-side password policy exactly (see src/routes/onboarding.ts)
  // - Minimum 8 characters
  // - At least one uppercase letter, one lowercase letter, one digit, and one special character
  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const parseRetryAfter = (retryAfterHeader: string | null): number | null => {
    if (!retryAfterHeader) return null;
    const trimmed = retryAfterHeader.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    const timestamp = new Date(trimmed).getTime();
    if (!Number.isNaN(timestamp)) {
      const deltaMs = timestamp - Date.now();
      return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
    }
    return null;
  };

  // Prime UI immediately when caller already knows skip flag (e.g., Umbrel).
  useEffect(() => {
    if (initialSkipAdminValidation) {
      setSkipAdminValidation(true);
      setStep('setup');
    }
  }, [initialSkipAdminValidation]);

  useEffect(() => {
    checkStatus();
    
    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Sync adminSecret with ref to ensure it's not lost during re-renders
  useEffect(() => {
    adminSecretRef.current = adminSecret;
  }, [adminSecret]);

  const checkStatus = async () => {
    setIsCheckingStatus(true);
    setNetworkError('');

    try {
      const response = await fetch('/api/onboarding/status');

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const data = await response.json();
      setHasAdminSecret(data.hasAdminSecret);

      // If skipAdminValidation is enabled (e.g., Umbrel deployment),
      // skip the admin secret step and go directly to account creation
      if (data.skipAdminValidation) {
        setSkipAdminValidation(true);
        setStep('setup');
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      const errorMessage = error instanceof Error ? error.message : 'Network error occurred';
      setNetworkError(`Failed to check server status: ${errorMessage}`);
    } finally {
      setIsCheckingStatus(false);
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
          'Authorization': `Bearer ${adminSecret}`,
        },
        body: JSON.stringify({}),
      });

      // Handle rate limiting first
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        throw new Error(`Rate limit exceeded. Please try again${retryAfter != null ? ` in ${retryAfter} seconds` : ' later'}.`);
      }

      // Handle 204 No Content as success
      if (response.status === 204) {
        setStep('setup');
        return;
      }

      // Try to parse JSON response, but handle non-JSON gracefully
      let data: any = {};
      try {
        data = await response.json();
      } catch (jsonError) {
        // If response is not JSON, that's okay - we'll use status text
        if (!response.ok) {
          throw new Error(`Validation failed: ${response.statusText || response.status}`);
        }
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to validate admin secret: ${response.statusText || response.status}`);
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
    // Trim username and password for consistent validation and submission
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Validate inputs
    if (!trimmedUsername || !trimmedPassword) {
      setError('Username and password are required');
      return;
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) {
      setError('Username must be between 3 and 50 characters');
      return;
    }

    if (trimmedPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    // Enforce same password rules as server (uppercase, lowercase, digit, special)
    if (!PASSWORD_REGEX.test(trimmedPassword)) {
      setError('Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character');
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError('Passwords do not match');
      return;
    }

    // Check if adminSecret is still available (use ref as fallback)
    // Skip this check if skipAdminValidation is enabled (e.g., Umbrel)
    const secretToUse = adminSecret || adminSecretRef.current;
    if (!skipAdminValidation && !secretToUse) {
      setError('Session expired. Please refresh and try again.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Build headers - only include Authorization if we have a secret
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (secretToUse) {
        headers['Authorization'] = `Bearer ${secretToUse}`;
      }

      const response = await fetch('/api/onboarding/setup', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: trimmedUsername,
          password: trimmedPassword,
        }),
      });

      // Handle rate limiting first (Retry-After can be seconds or HTTP-date)
      if (response.status === 429) {
        const seconds = parseRetryAfter(response.headers.get('Retry-After'));
        throw new Error(seconds != null ? `Rate limited. Try again in ${seconds}s.` : 'Rate limited. Try again shortly.');
      }

      const isJson = response.headers.get('Content-Type')?.includes('application/json');
      const data = isJson ? await response.json().catch(() => null) : null;
      if (!response.ok) {
        throw new Error((data && (data.error || data.message)) || 'Failed to create user');
      }

      // Move to complete step
      setStep('complete');
      
      // Clear sensitive data from memory
      setAdminSecret('');
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      
      // Auto-redirect to login after 3 seconds
      timeoutRef.current = setTimeout(() => {
        onComplete();
      }, 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      validateAdminSecret();
    }
  };

  const handleSetupKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      createUser();
    }
  };

  const getCurrentStepNumber = () => {
    if (skipAdminValidation) {
      // When skipping admin validation, we only have 2 steps: Setup (1) and Complete (2)
      return step === 'setup' ? 1 : 2;
    }
    return step === 'admin' ? 1 : step === 'setup' ? 2 : 3;
  };

  // Step indicator component
  const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => {
    // When skipping admin validation (e.g., Umbrel), show only Setup and Complete steps
    const steps = skipAdminValidation ? ['Setup', 'Complete'] : ['Admin', 'Setup', 'Complete'];

    return (
      <div className="flex items-center justify-center space-x-2">
        {steps.map((label, i) => {
          const stepNum = i + 1;
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
              {i < steps.length - 1 && (
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
    );
  };

  if (isCheckingStatus) {
    return (
      <PageLayout>
        <AppHeader subtitle="Initial Setup" />
        <ContentCard>
          <div className="flex items-center justify-center py-12">
            <div className="text-blue-300">Checking server status...</div>
          </div>
        </ContentCard>
      </PageLayout>
    );
  }

  if (networkError) {
    return (
      <PageLayout>
        <AppHeader subtitle="Initial Setup" />
        <ContentCard>
          <div className="p-8 text-center">
            <Alert variant="error">{networkError}</Alert>
            <Button onClick={checkStatus} className="mt-4">
              Retry
            </Button>
          </div>
        </ContentCard>
      </PageLayout>
    );
  }

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
        {step === 'admin' && !skipAdminValidation && (
          <>
            <StepIndicator currentStep={getCurrentStepNumber()} />

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
                  onKeyDown={handleAdminKeyDown}
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
            <StepIndicator currentStep={getCurrentStepNumber()} />

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
                <label htmlFor="username" className="text-sm font-medium text-blue-200 flex items-center gap-1">
                  <span>Username</span>
                  <Tooltip
                    trigger={
                      <button type="button" aria-label="Username help" className="text-blue-400">
                        <HelpCircle size={16} />
                      </button>
                    }
                    content={
                      <>
                        <p className="mb-2 font-semibold">Your admin username:</p>
                        <p className="mb-2">Choose a unique username that will identify you as the administrator of this Igloo Server.</p>
                        <p>Requirements: 3-50 characters, can include letters, numbers, and underscores.</p>
                      </>
                    }
                    width="w-60"
                  />
                </label>
                <Input
                  id="username"
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
                <label htmlFor="password" className="text-sm font-medium text-blue-200 flex items-center gap-1">
                  <span>Password</span>
                  <Tooltip
                    trigger={
                      <button type="button" aria-label="Password help" className="text-blue-400">
                        <HelpCircle size={16} />
                      </button>
                    }
                    content={
                      <>
                        <p className="mb-2 font-semibold">Your secure password:</p>
                        <p className="mb-2">Create a strong password to protect your admin account. This password will be securely hashed using Argon2id.</p>
                        <p>Requirements: Minimum 8 characters, with at least one uppercase letter, one lowercase letter, one number, and one special character.</p>
                      </>
                    }
                    width="w-60"
                  />
                </label>
                <Input
                  id="password"
                  autoComplete="new-password"
                  type="password"
                  placeholder="Enter password (min 8, incl. upper, lower, number, special)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 placeholder:text-gray-500"
                  pattern={PASSWORD_REGEX.source}
                  title="Minimum 8 characters, with at least one uppercase letter, one lowercase letter, one number, and one special character"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-blue-200 flex items-center gap-1">
                  <span>Confirm Password</span>
                  <Tooltip
                    trigger={
                      <button type="button" aria-label="Confirm password help" className="text-blue-400">
                        <HelpCircle size={16} />
                      </button>
                    }
                    content={
                      <>
                        <p className="mb-2 font-semibold">Password confirmation:</p>
                        <p className="mb-2">Re-enter your password to ensure it was typed correctly. Both passwords must match exactly.</p>
                        <p>Passwords must meet the strength requirements: Minimum 8 characters, with at least one uppercase letter, one lowercase letter, one number, and one special character.</p>
                      </>
                    }
                    width="w-60"
                  />
                </label>
                <Input
                  id="confirmPassword"
                  autoComplete="new-password"
                  type="password"
                  placeholder="Confirm password (must match and meet requirements)"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={handleSetupKeyDown}
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
            <StepIndicator currentStep={getCurrentStepNumber()} />

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
                {!skipAdminValidation && (
                  <p className="text-green-400 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Admin secret validated
                  </p>
                )}
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
  // If skip flag flips to true for any reason, force the step to setup
  useEffect(() => {
    if (skipAdminValidation && step === 'admin') {
      setStep('setup');
    }
  }, [skipAdminValidation, step]);
