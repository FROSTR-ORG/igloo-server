import React, { useState, useEffect } from 'react'
import { NIP46Controller } from './nip46/controller'
import { Sessions } from './nip46/Sessions'
import { Requests } from './nip46/Requests'
import { NIP46Config } from './nip46/types'
import { shareToPrivateKey } from './nip46/utils'
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

  const defaultConfig: NIP46Config = {
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
  }

  useEffect(() => {
    if (groupCred && shareCred) {
      ;(window as any).GROUP_CRED = groupCred
      ;(window as any).SHARE_CRED = shareCred
      initializeController(undefined, authHeaders)
    } else if (privateKey) {
      initializeController(privateKey, authHeaders)
    }

    return () => {
      controller?.disconnect().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey, groupCred, shareCred, authHeaders])

  const initializeController = async (key?: string, auth?: Record<string, string>) => {
    try {
      setError(null)
      const nip46Controller = new NIP46Controller(defaultConfig)

      nip46Controller.on('connected', () => setIsConnected(true))
      nip46Controller.on('disconnected', () => setIsConnected(false))
      nip46Controller.on('error', (err: Error) => setError(err.message))

      const updateCounts = () => {
        const sessions = nip46Controller.getActiveSessions().length + nip46Controller.getPendingSessions().length
        setSessionCount(sessions)
        setRequestCount(nip46Controller.getPendingRequests().length)
      }

      nip46Controller.on('session:active', updateCounts)
      nip46Controller.on('session:pending', updateCounts)
      nip46Controller.on('session:updated', updateCounts)
      nip46Controller.on('request:new', updateCounts)
      nip46Controller.on('request:approved', updateCounts)
      nip46Controller.on('request:denied', updateCounts)

      if (key) {
        const hex = shareToPrivateKey(key)
        await nip46Controller.initialize(hex, auth)
      } else {
        await nip46Controller.initialize(undefined, auth)
      }

      setController(nip46Controller)
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
