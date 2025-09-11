import React, { useState, useEffect, useRef, useMemo } from "react"
import Configure from "./components/Configure"
import Signer from "./components/Signer"
import Recover from "./components/Recover"
import Login from "./components/Login"
import Onboarding from "./components/Onboarding"
import type { SignerHandle } from "./types"
import { Button } from "./components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs"
import { PageLayout } from "./components/ui/page-layout"
import { AppHeader } from "./components/ui/app-header"
import { ContentCard } from "./components/ui/content-card"

interface SignerData {
  share: string;
  groupCredential: string;
  name?: string;
  threshold?: number;
  totalShares?: number;
  relays?: string[];
}

interface AuthState {
  isAuthenticated: boolean;
  sessionId?: string;
  userId?: string | number;
  authEnabled: boolean;
  apiKey?: string;
  basicAuth?: { username: string; password: string };
  needsOnboarding?: boolean;
  headlessMode?: boolean;
}

const App: React.FC = () => {
  const [signerData, setSignerData] = useState<SignerData | null>(null);
  const [activeTab, setActiveTab] = useState("signer");
  const [initializing, setInitializing] = useState(true);
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    authEnabled: false
  });
  // Reference to the Signer component to call its stop method
  const signerRef = useRef<SignerHandle>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Check onboarding status first with retry logic
      let onboardingData: any = {};
      const maxRetries = 3;
      let retryCount = 0;
      
      while (retryCount < maxRetries) {
        try {
          const onboardingResponse = await fetch('/api/onboarding/status');
          if (!onboardingResponse.ok) {
            // Non-OK means endpoint exists but failed; treat as non-headless by default
            console.warn('Onboarding status non-OK:', onboardingResponse.status);
            onboardingData = { headlessMode: false };
          } else {
            onboardingData = await onboardingResponse.json();
          }
          break; // Success, exit retry loop
        } catch (err) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.error('Onboarding status fetch failed after retries:', err);
            // Network or unexpected failure: do not assume headless, let UI prompt
            onboardingData = { headlessMode: false };
          } else {
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
      }
      
      // Check if we're in headless mode or need onboarding
      if (onboardingData.headlessMode === undefined) {
        // Endpoint missing/old: do not assume headless; let UI prompt
        onboardingData.headlessMode = false;
      }
      
      if (!onboardingData.headlessMode && !onboardingData.initialized) {
        // Need to complete onboarding first
        setAuthState({ 
          isAuthenticated: false, 
          authEnabled: true, 
          needsOnboarding: true,
          headlessMode: false 
        });
        setInitializing(false);
        return;
      }
      
      // Check authentication status
      let authStatus: { enabled: boolean } = { enabled: true }; // Default to auth enabled as a safe fallback
      try {
        const authResponse = await fetch('/api/auth/status');
        if (authResponse.ok) {
          authStatus = await authResponse.json();
        } else {
          console.warn('Auth status check failed:', authResponse.status, 'Falling back to requiring authentication.');
          // Keep default of auth enabled
        }
      } catch (error) {
        console.error('Error fetching auth status:', error, 'Falling back to requiring authentication.');
        // Keep default of auth enabled
      }
      
      // If auth is disabled or we're in headless mode, proceed normally
      if (!authStatus.enabled || onboardingData.headlessMode) {
        setAuthState({
          isAuthenticated: true,
          authEnabled: false,
          headlessMode: onboardingData.headlessMode
        });
        await loadAppData(undefined, { headlessMode: onboardingData.headlessMode });
      } else {
        // Auth is enabled, need to show login screen
        setAuthState({ 
          isAuthenticated: false, 
          authEnabled: true,
          headlessMode: false 
        });
      }
    } catch (error) {
      console.error('Error initializing app:', error);
      // On error, assume we need to authenticate
      setAuthState({ isAuthenticated: false, authEnabled: true });
    } finally {
      setInitializing(false);
    }
  };

  const loadAppData = async (
    authHeaders?: Record<string, string>,
    opts?: { headlessMode?: boolean }
  ) => {
    try {
      // Use provided headers or get current auth headers
      const headers = authHeaders || getAuthHeaders();
      
      console.log('Loading app data with headers:', Object.keys(headers));
      
      // Determine mode without relying solely on async state
      const isHeadless = opts?.headlessMode ?? authState.headlessMode;
      let credentials: any = null;
      
      if (isHeadless) {
        // Headless mode - fetch from environment
        const response = await fetch('/api/env', {
          headers
        });
        
        if (!response.ok) {
          // Check for 401 Unauthorized
          if (response.status === 401) {
            console.log('Authentication failed, logging out...');
            await handleLogout();
            return;
          }
          const errorText = await response.text();
          console.error('Failed to fetch environment variables:', response.status, errorText);
          throw new Error(`Failed to fetch environment variables: ${response.status}`);
        }
        
        const envVars = await response.json();
        credentials = envVars;
      } else {
        // Database mode - fetch from user credentials
        const response = await fetch('/api/user/credentials', {
          headers
        });
        
        if (response.ok) {
          credentials = await response.json();
          // Map database fields to expected format
          credentials = {
            SHARE_CRED: credentials.share_cred,
            GROUP_CRED: credentials.group_cred,
            GROUP_NAME: credentials.group_name,
            RELAYS: credentials.relays || null
          };
        } else {
          // Check for 401 Unauthorized
          if (response.status === 401) {
            console.log('Authentication failed, logging out...');
            await handleLogout();
            return;
          }
          console.log('No credentials stored for user');
          credentials = {};
        }
      }
      
      const envVars = credentials;
      console.log('Loaded environment variables:', {
        hasShareCred: !!envVars.SHARE_CRED,
        hasGroupCred: !!envVars.GROUP_CRED,
        hasGroupName: !!envVars.GROUP_NAME,
        hasRelays: !!envVars.RELAYS,
        keys: Object.keys(envVars)
      });
      
      const savedShare = envVars.SHARE_CRED;
      const savedGroup = envVars.GROUP_CRED;
      const savedName = envVars.GROUP_NAME;
      const savedRelays = envVars.RELAYS;
      
      if (savedShare && savedGroup) {
        console.log('Found saved credentials, setting signer data');
        
        // Handle relays defensively - can be null, undefined, string, array, or other types
        let relaysArray: string[] = [];
        
        if (savedRelays == null) {
          // null or undefined - use empty array
          relaysArray = [];
        } else if (typeof savedRelays === 'string') {
          // String - attempt to parse as JSON
          try {
            const parsed = JSON.parse(savedRelays);
            if (Array.isArray(parsed)) {
              // Validate array contents - filter to only string elements
              relaysArray = parsed.filter(item => typeof item === 'string');
              if (relaysArray.length !== parsed.length) {
                console.warn('Some relay entries were not strings and were filtered out');
              }
            } else {
              console.warn('Parsed relays is not an array, using empty array instead:', typeof parsed);
              relaysArray = [];
            }
          } catch (error) {
            console.warn('Failed to parse relay string as JSON, using empty array:', error);
            relaysArray = [];
          }
        } else if (Array.isArray(savedRelays)) {
          // Already an array - validate contents
          relaysArray = savedRelays.filter(item => typeof item === 'string');
          if (relaysArray.length !== savedRelays.length) {
            console.warn('Some relay entries were not strings and were filtered out');
          }
        } else {
          // Any other type - log warning and use empty array
          console.warn('Unexpected relay type, using empty array. Type:', typeof savedRelays, 'Value:', savedRelays);
          relaysArray = [];
        }
        
        // If we have saved credentials, go directly to Signer
        setSignerData({
          share: savedShare,
          groupCredential: savedGroup,
          name: savedName || 'Saved Share',
          relays: relaysArray.length > 0 ? relaysArray : undefined
        });
      } else {
        console.log('No saved credentials found');
        // In headless mode, prefer server status to decide the view
        if (isHeadless) {
          try {
            const statusRes = await fetch('/api/status', { headers });
            if (statusRes.ok) {
              const status = await statusRes.json();
              if (status?.hasCredentials || status?.nodeActive) {
                // Show Signer even without client-side secrets
                setSignerData(prev => prev ?? { share: '', groupCredential: '', name: 'Server credentials' });
              }
            }
          } catch {}
        }
      }
      // If no saved credentials, we'll show Configure page (default state)
    } catch (error) {
      console.error('Error loading app data:', error);
      // On error, default to Configure page (default state)
    }
  };

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    
    // Try session-based auth first
    if (authState.sessionId) {
      headers['X-Session-ID'] = authState.sessionId;
    }
    // Fall back to API key auth
    else if (authState.apiKey) {
      headers['X-API-Key'] = authState.apiKey;
    }
    // Fall back to basic auth
    else if (authState.basicAuth) {
      const credentials = btoa(`${authState.basicAuth.username}:${authState.basicAuth.password}`);
      headers['Authorization'] = `Basic ${credentials}`;
    }
    
    return headers;
  };

  // Memoize auth headers to prevent unnecessary re-renders in child components
  // Only recreate when authentication state changes
  const memoizedAuthHeaders = useMemo(() => {
    return getAuthHeaders();
  }, [authState.sessionId, authState.apiKey, authState.basicAuth]);

  const handleOnboardingComplete = () => {
    // After onboarding, reset state to show login
    setAuthState({
      isAuthenticated: false,
      authEnabled: true,
      needsOnboarding: false,
      headlessMode: false
    });
  };
  
  const handleLogin = async (sessionId: string | undefined, userId: string | number, credentials?: { apiKey?: string; basicAuth?: { username: string; password: string } }) => {
    setAuthState({
      isAuthenticated: true,
      sessionId: sessionId || undefined,
      userId,
      authEnabled: true,
      apiKey: credentials?.apiKey,
      basicAuth: credentials?.basicAuth
    });
    
    // Create auth headers directly from credentials to avoid state timing issues
    const authHeaders: Record<string, string> = {};
    if (sessionId) {
      authHeaders['X-Session-ID'] = sessionId;
    } else if (credentials?.apiKey) {
      authHeaders['X-API-Key'] = credentials.apiKey;
    } else if (credentials?.basicAuth) {
      const basicCredentials = btoa(`${credentials.basicAuth.username}:${credentials.basicAuth.password}`);
      authHeaders['Authorization'] = `Basic ${basicCredentials}`;
    }
    
    // Now load the app data with the correct headers
    await loadAppData(authHeaders);
  };

  const handleLogout = async () => {
    try {
      // Stop signer first
      await signerRef.current?.stopSigner().catch(console.error);
      
      // Call logout endpoint
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Reset state
      setAuthState({
        isAuthenticated: false,
        authEnabled: true
      });
      setSignerData(null);
    }
  };

  const handleKeysetCreated = (data: { groupCredential: string; shareCredentials: string[]; name: string }) => {
    // When configuration is complete, go directly to Signer
    setSignerData({
      share: data.shareCredentials[0],
      groupCredential: data.groupCredential,
      name: data.name
    });
  };

  const handleCredentialsSaved = async () => {
    // Reload app data to get the saved credentials
    await loadAppData();
    // The loadAppData will set signerData if credentials exist
    // Status will be checked via Signer onReady callback once mounted
  };

  const handleBackToConfigure = async () => {
    // Stop signer before navigating away
    await signerRef.current?.stopSigner().catch(console.error);
    setSignerData(null);
    // Note: We don't clear credentials here anymore - user must do it manually on Configure page
  };

  const handleTabChange = async (value: string) => {
    // If switching away from signer tab, stop the signer
    if (activeTab === "signer" && value !== "signer") {
      await signerRef.current?.stopSigner().catch(console.error);
    }
    setActiveTab(value);
  };

  // Show loading state while initializing
  if (initializing) {
    return (
      <PageLayout>
        <AppHeader subtitle="Frostr keyset manager and remote signer." />
        
        <ContentCard>
          <div className="flex items-center justify-center py-12">
            <div className="text-blue-300">Loading...</div>
          </div>
        </ContentCard>
      </PageLayout>
    );
  }

  // Show onboarding if needed
  if (authState.needsOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  // Show login screen if authentication is required and user is not authenticated
  if (authState.authEnabled && !authState.isAuthenticated) {
    return <Login onLogin={handleLogin} authEnabled={authState.authEnabled} />;
  }

  // Show signer view when share is loaded
  if (signerData) {
    return (
      <PageLayout>
        <AppHeader 
          authEnabled={authState.authEnabled}
          userId={authState.userId}
          onLogout={authState.authEnabled ? handleLogout : undefined}
        />
        
        <ContentCard
          title="Signer"
          headerRight={
            <Button
              variant="ghost"
              onClick={handleBackToConfigure}
              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
            >
              Back to Configure
            </Button>
          }
        >
          <Tabs 
            defaultValue="signer" 
            className="w-full"
            value={activeTab}
            onValueChange={handleTabChange}
          >
            <TabsList className="grid grid-cols-2 mb-4 bg-gray-800/50 w-full">
              <TabsTrigger value="signer" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
                Signer
              </TabsTrigger>
              <TabsTrigger value="recover" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
                Recover
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="signer" className="border border-blue-900/30 rounded-lg p-2 sm:p-4">
              <Signer 
                initialData={signerData} 
                ref={signerRef}
                authHeaders={memoizedAuthHeaders}
                isHeadlessMode={authState.headlessMode ?? false}
                onReady={() => signerRef.current?.checkStatus()}
              />
            </TabsContent>
            
            <TabsContent value="recover" className="border border-purple-900/30 rounded-lg p-2 sm:p-4">
              <Recover 
                initialShare={signerData?.share} 
                initialGroupCredential={signerData?.groupCredential}
                defaultThreshold={signerData?.threshold}
                defaultTotalShares={signerData?.totalShares}
                authHeaders={memoizedAuthHeaders}
              />
            </TabsContent>
          </Tabs>
        </ContentCard>
      </PageLayout>
    );
  }

  // Show Configure view (default when no credentials)
  return (
    <PageLayout>
      <AppHeader 
        subtitle="Frostr keyset manager and remote signer." 
        authEnabled={authState.authEnabled}
        userId={authState.userId}
        onLogout={authState.authEnabled ? handleLogout : undefined}
      />

      <ContentCard>
        <Configure 
          onKeysetCreated={handleKeysetCreated}
          onCredentialsSaved={handleCredentialsSaved}
          onBack={() => {}} 
          authHeaders={getAuthHeaders()}
        />
      </ContentCard>
    </PageLayout>
  )
}

export default App;
