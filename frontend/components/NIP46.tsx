import React, { useState, useEffect, useRef, useMemo } from 'react'
import { NIP46Controller } from './nip46/controller'
import { Sessions } from './nip46/Sessions'
import { Requests } from './nip46/Requests'
import { NIP46Config } from './nip46/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from './ui/button'
import { Alert } from './ui/alert'
import { Badge } from './ui/badge'
import { StatusIndicator } from './ui/status-indicator'
import { Shield, Users, Bell } from 'lucide-react'

interface NIP46Props {
  privateKey?: string
  authHeaders?: Record<string, string>
  groupCred?: string
  shareCred?: string
  bifrostNode?: any
}

export function NIP46({ privateKey, authHeaders, groupCred, shareCred }: NIP46Props) {
  const [controller, setController] = useState<NIP46Controller | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('sessions')
  const [requestCount, setRequestCount] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)
  const cleanupRef = useRef<(() => void) | null>(null)

  const defaultConfig: NIP46Config = useMemo(() => ({
    relays: [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://bucket.coracle.social',
      'wss://relay.nsec.app/'
    ],
    policy: {
      methods: {
        'sign_event': true,
        'get_public_key': true,
        'nip44_encrypt': true,
        'nip44_decrypt': true,
        // NIP-04 is not implemented in ServerSigner; keep disabled by default
        'nip04_encrypt': false,
        'nip04_decrypt': false
      },
      kinds: {}
    },
    profile: {
      name: 'Igloo Server',
      url: typeof window !== 'undefined' ? window.location.origin : undefined,
      image: '/assets/frostr-logo-transparent.png'
    },
    timeout: 30
  }), [])

  useEffect(() => {
    if (groupCred && shareCred) {
      // Use ephemeral transport key when credentials are loaded; avoid exposing secrets in the browser
      initializeController(undefined, authHeaders)
    } else if (privateKey) {
      initializeController(privateKey, authHeaders)
    }

    return () => {
      // Detach event listeners and close socket cleanly
      try { cleanupRef.current?.() } catch {}
      cleanupRef.current = null
      controller?.disconnect().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey, groupCred, shareCred, authHeaders])

  const initializeController = async (key?: string, auth?: Record<string, string>) => {
    try {
      setError(null)
      const nip46Controller = new NIP46Controller(defaultConfig)

      // Bind handlers with stable references for cleanup
      const onConnected = () => setIsConnected(true)
      const onDisconnected = () => setIsConnected(false)
      const onError = (err: Error) => setError(err.message)
      const updateCounts = () => {
        const sessions = nip46Controller.getActiveSessions().length + nip46Controller.getPendingSessions().length
        setSessionCount(sessions)
        setRequestCount(nip46Controller.getPendingRequests().length)
      }

      nip46Controller.on('connected', onConnected)
      nip46Controller.on('disconnected', onDisconnected)
      nip46Controller.on('error', onError)
      nip46Controller.on('session:active', updateCounts)
      nip46Controller.on('session:pending', updateCounts)
      nip46Controller.on('session:updated', updateCounts)
      nip46Controller.on('request:new', updateCounts)
      nip46Controller.on('request:approved', updateCounts)
      nip46Controller.on('request:denied', updateCounts)

      // Initialize transport (derive deterministic key only if explicitly provided)
      // Always use ephemeral transport unless a deterministic key path is explicitly reintroduced
      await nip46Controller.initialize(undefined, auth)

      // Prime counts immediately
      updateCounts()

      // Save controller and a cleanup function to detach listeners
      setController(nip46Controller)
      cleanupRef.current = () => {
        try {
          nip46Controller.off('connected', onConnected)
          nip46Controller.off('disconnected', onDisconnected)
          nip46Controller.off('error', onError)
          nip46Controller.off('session:active', updateCounts)
          nip46Controller.off('session:pending', updateCounts)
          nip46Controller.off('session:updated', updateCounts)
          nip46Controller.off('request:new', updateCounts)
          nip46Controller.off('request:approved', updateCounts)
          nip46Controller.off('request:denied', updateCounts)
        } catch {}
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize NIP-46')
    }
  }

  if (!privateKey && !(groupCred && shareCred)) {
    return (
      <div className="space-y-6">
        <Alert variant="warning">
          <Shield className="h-4 w-4" />
          <span>NIP-46 remote signing requires an active signer with loaded credentials.</span>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <StatusIndicator status={isConnected ? 'success' : 'idle'} label={isConnected ? 'NIP-46 Ready' : 'NIP-46 Disconnected'} />
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4 text-blue-400" />
                <span className="text-gray-400">{sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}</span>
              </div>
              <div className="flex items-center gap-1">
                <Bell className="h-4 w-4 text-blue-400" />
                <span className="text-gray-400">{requestCount} {requestCount === 1 ? 'request' : 'requests'}</span>
              </div>
            </div>
          </div>
          {controller && controller.getIdentityPubkey() && (
            <div className="flex items-center gap-1 text-xs">
              <Shield className="h-3 w-3 text-blue-400" />
              <span className="text-gray-400 font-mono">
                {controller.getIdentityPubkey()?.slice(0, 8)}...{controller.getIdentityPubkey()?.slice(-4)}
              </span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="error">{error}</Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 mb-4 bg-gray-800/50 w-full">
          <TabsTrigger value="sessions" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
            <Users className="h-4 w-4 mr-2" />
            Sessions
            {sessionCount > 0 && <Badge variant="info" className="ml-2">{sessionCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="requests" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
            <Bell className="h-4 w-4 mr-2" />
            Requests
            {requestCount > 0 && <Badge variant="warning" className="ml-2">{requestCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <Sessions controller={controller} />
        </TabsContent>

        <TabsContent value="requests">
          <Requests controller={controller} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
