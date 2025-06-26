import React, { useState, useEffect, useRef } from "react"
import Configure from "./components/Configure"
import Signer from "./components/Signer"
import Recover from "./components/Recover"
import Login from "./components/Login"
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
}

interface AuthState {
  isAuthenticated: boolean;
  sessionId?: string;
  userId?: string;
  authEnabled: boolean;
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
      // First check authentication status
      const authResponse = await fetch('/api/auth/status');
      const authStatus = await authResponse.json();
      
      // If auth is disabled, we can proceed normally
      if (!authStatus.enabled) {
        setAuthState({ isAuthenticated: true, authEnabled: false });
        await loadAppData();
      } else {
        // Auth is enabled, check if we have a valid session
        setAuthState(prev => ({ ...prev, authEnabled: true }));
        
        // Try to make an authenticated request to see if we're already logged in
        const testResponse = await fetch('/api/status');
        if (testResponse.ok) {
          // Already authenticated
          setAuthState(prev => ({ ...prev, isAuthenticated: true }));
          await loadAppData();
        } else {
          // Need to authenticate
          setAuthState(prev => ({ ...prev, isAuthenticated: false }));
        }
      }
    } catch (error) {
      console.error('Error checking authentication:', error);
      // On error, assume we need to authenticate if auth is enabled
      const defaultAuthEnabled = true; // Default to secure
      setAuthState({ isAuthenticated: !defaultAuthEnabled, authEnabled: defaultAuthEnabled });
    } finally {
      setInitializing(false);
    }
  };

  const loadAppData = async () => {
    try {
      // Fetch environment variables from server
      const response = await fetch('/api/env', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch environment variables');
      }
      
      const envVars = await response.json();
      
      const savedShare = envVars.SHARE_CRED;
      const savedGroup = envVars.GROUP_CRED;
      const savedName = envVars.GROUP_NAME;
      
      if (savedShare && savedGroup) {
        // If we have saved credentials, go directly to Signer
        setSignerData({
          share: savedShare,
          groupCredential: savedGroup,
          name: savedName || 'Saved Share'
        });
      }
      // If no saved credentials, we'll show Configure page (default state)
    } catch (error) {
      console.error('Error loading app data:', error);
      // On error, default to Configure page (default state)
    }
  };

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (authState.sessionId) {
      headers['X-Session-ID'] = authState.sessionId;
    }
    return headers;
  };

  const handleLogin = async (sessionId: string, userId: string) => {
    setAuthState({
      isAuthenticated: true,
      sessionId,
      userId,
      authEnabled: true
    });
    
    // Now load the app data
    await loadAppData();
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
            
            <TabsContent value="signer" className="border border-blue-900/30 rounded-lg p-4">
              <Signer 
                initialData={signerData} 
                ref={signerRef}
                authHeaders={getAuthHeaders()}
              />
            </TabsContent>
            
            <TabsContent value="recover" className="border border-purple-900/30 rounded-lg p-4">
              <Recover 
                initialShare={signerData?.share} 
                initialGroupCredential={signerData?.groupCredential}
                defaultThreshold={signerData?.threshold}
                defaultTotalShares={signerData?.totalShares}
                authHeaders={getAuthHeaders()}
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
          onBack={() => {}} 
          authHeaders={getAuthHeaders()}
        />
      </ContentCard>
    </PageLayout>
  )
}

export default App;
