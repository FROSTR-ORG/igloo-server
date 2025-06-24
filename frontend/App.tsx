import React, { useState, useEffect, useRef } from "react"
import Configure from "./components/Configure"
import Signer, { SignerHandle } from "./components/Signer"
import Recover from "./components/Recover"
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

const App: React.FC = () => {
  const [signerData, setSignerData] = useState<SignerData | null>(null);
  const [activeTab, setActiveTab] = useState("signer");
  const [initializing, setInitializing] = useState(true);
  // Reference to the Signer component to call its stop method
  const signerRef = useRef<SignerHandle>(null);

  useEffect(() => {
    // Check for environment variables and initialize the appropriate view
    const initializeApp = async () => {
      try {
        // Fetch environment variables from server
        const response = await fetch('/api/env');
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
        console.error('Error initializing app:', error);
        // On error, default to Configure page (default state)
      } finally {
        setInitializing(false);
      }
    };

    initializeApp();
  }, []);

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

  // Show signer view when share is loaded
  if (signerData) {
    return (
      <PageLayout>
        <AppHeader />
        
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
              />
            </TabsContent>
            
            <TabsContent value="recover" className="border border-purple-900/30 rounded-lg p-4">
              <Recover 
                initialShare={signerData?.share} 
                initialGroupCredential={signerData?.groupCredential}
                defaultThreshold={signerData?.threshold}
                defaultTotalShares={signerData?.totalShares}
              />
            </TabsContent>
          </Tabs>
        </ContentCard>
      </PageLayout>
    );
  }

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

  // Show Configure view (default when no credentials)
  return (
    <PageLayout>
      <AppHeader subtitle="Frostr keyset manager and remote signer." />

      <ContentCard>
        <Configure onKeysetCreated={handleKeysetCreated} onBack={() => {}} />
      </ContentCard>
    </PageLayout>
  )
}

export default App;
