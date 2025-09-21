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
import Spinner from './ui/spinner'
import { Shield, Users, Bell, HelpCircle, Copy as CopyIcon, Check as CheckIcon, Eye, EyeOff } from 'lucide-react'
import { Tooltip } from './ui/tooltip'
import { IconButton } from './ui/icon-button'

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
  const [initializing, setInitializing] = useState(true)
  const [showFullKeys, setShowFullKeys] = useState(false)
  const [copied, setCopied] = useState<{ transport?: boolean; user?: boolean }>({})

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

  // Obtain a stable transport key for this user from the server (DB-backed)
  const fetchTransportKey = async (): Promise<string | undefined> => {
    try {
      const res = await fetch('/api/nip46/transport', { headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) } })
      if (res.ok) {
        const data = await res.json()
        const sk = typeof data?.transport_sk === 'string' ? data.transport_sk : ''
        if (/^[0-9a-fA-F]{64}$/.test(sk)) return sk.toLowerCase()
      }
    } catch (e) {
      console.warn('[NIP46] Failed to fetch transport key from server; falling back to local storage', e)
    }
    // Fallback: persist locally to avoid signer identity churn within the browser
    try {
      const storageKey = 'igloo:nip46:transport_sk'
      const storage = typeof window !== 'undefined' ? window.sessionStorage : undefined
      if (!storage) return undefined
      let sk = storage.getItem(storageKey) || ''
      if (sk && /^[0-9a-fA-F]{64}$/.test(sk)) return sk.toLowerCase()
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      sk = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      storage.setItem(storageKey, sk)
      return sk
    } catch {
      return undefined
    }
  }

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      if (groupCred && shareCred) {
        setInitializing(true)
        const stableSk = await fetchTransportKey()
        // Fetch server relays to align NIP-46 with backend
        let serverRelays: string[] = []
        try {
          const res = await fetch('/api/status', { headers: { ...(authHeaders || {}) } })
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data?.relays)) {
              serverRelays = data.relays.filter((r: any) => typeof r === 'string' && r.startsWith('ws'))
            }
          }
        } catch {}
        if (!cancelled) await initializeController(stableSk, authHeaders, serverRelays)
      } else if (privateKey) {
        setInitializing(true)
        let serverRelays: string[] = []
        try {
          const res = await fetch('/api/status', { headers: { ...(authHeaders || {}) } })
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data?.relays)) {
              serverRelays = data.relays.filter((r: any) => typeof r === 'string' && r.startsWith('ws'))
            }
          }
        } catch {}
        if (!cancelled) await initializeController(privateKey, authHeaders, serverRelays)
      } else {
        setInitializing(false)
      }
    }
    boot()

    return () => {
      // Detach event listeners and close socket cleanly
      try { cleanupRef.current?.() } catch {}
      cleanupRef.current = null
      controller?.disconnect().catch(() => {})
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateKey, groupCred, shareCred, authHeaders])

  const initializeController = async (key?: string, auth?: Record<string, string>, serverRelays?: string[]) => {
    try {
      setError(null)
      const nip46Controller = new NIP46Controller(defaultConfig)

      // Bind handlers with stable references for cleanup
      const onConnected = () => { setIsConnected(true); setError(null) }
      const onDisconnected = () => setIsConnected(false)
      const onError = (err: Error) => setError(err.message)
      const updateCounts = () => {
        const sessions = nip46Controller.getActiveSessions().length + nip46Controller.getPendingSessions().length
        setSessionCount(sessions)
        setRequestCount(nip46Controller.getPendingRequests().length)
      }
      const onRequestApproved = () => { updateCounts(); setError(null) }
      const onRequestDenied = () => { updateCounts() }

      nip46Controller.on('connected', onConnected)
      nip46Controller.on('disconnected', onDisconnected)
      nip46Controller.on('error', onError)
      nip46Controller.on('session:active', updateCounts)
      nip46Controller.on('session:pending', updateCounts)
      nip46Controller.on('session:updated', updateCounts)
      nip46Controller.on('request:new', updateCounts)
      nip46Controller.on('request:approved', onRequestApproved)
      nip46Controller.on('request:denied', onRequestDenied)

      // Initialize transport (derive deterministic key only if explicitly provided)
      // Use the provided key for deterministic identity, or ephemeral if undefined
      await nip46Controller.initialize(key, auth, Array.isArray(serverRelays) ? serverRelays : [])

      // Prime counts immediately
      updateCounts()

      // Save controller and a cleanup function to detach listeners
      setController(nip46Controller)
      setInitializing(false)
      cleanupRef.current = () => {
        try {
          nip46Controller.off('connected', onConnected)
          nip46Controller.off('disconnected', onDisconnected)
          nip46Controller.off('error', onError)
          nip46Controller.off('session:active', updateCounts)
          nip46Controller.off('session:pending', updateCounts)
          nip46Controller.off('session:updated', updateCounts)
          nip46Controller.off('request:new', updateCounts)
          nip46Controller.off('request:approved', onRequestApproved)
          nip46Controller.off('request:denied', onRequestDenied)
        } catch {}
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize NIP-46')
      setInitializing(false)
    }
  }

  // Auto-dismiss errors after a short delay so the UI doesn’t get stuck
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 12000)
    return () => clearTimeout(t)
  }, [error])

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

  if (initializing) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
          <Spinner label="Initializing NIP‑46…" size="md" />
        </div>
      </div>
    )
  }

  const renderKey = (hex?: string | null) => {
    if (!hex) return ''
    return showFullKeys ? hex : `${hex.slice(0, 8)}...${hex.slice(-4)}`
  }
  const copy = async (which: 'transport' | 'user', text?: string | null) => {
    if (!text) return
    try { await navigator.clipboard.writeText(text) } catch {}
    setCopied(prev => ({ ...prev, [which]: true }))
    setTimeout(() => setCopied(prev => ({ ...prev, [which]: false })), 1500)
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
        <div className="flex flex-col gap-2 md:gap-1">
          {/* Row 1: status + counts */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              <StatusIndicator status={isConnected ? 'success' : 'idle'} label={isConnected ? 'NIP-46 Ready' : 'NIP-46 Disconnected'} />
              <div className="flex items-center gap-4 text-sm">
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
          </div>

          {/* Row 2: identities + controls; wraps on small screens */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <IconButton
                variant="ghost"
                size="sm"
                icon={showFullKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                tooltip={showFullKeys ? 'Show shortened keys' : 'Show full keys'}
                onClick={() => setShowFullKeys(v => !v)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs md:justify-end">
              {controller && controller.getTransportPubkey() && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Transport</span>
                  <Tooltip
                    trigger={<HelpCircle className="h-3.5 w-3.5 text-blue-400 cursor-pointer" />}
                    width="w-72"
                    content={
                      <>
                        <p className="mb-1 font-semibold">Remote‑signer pubkey</p>
                        <p className="text-xs text-gray-300">Key used for nostr‑connect traffic (kind 24133). Clients address this key; distinct from the user pubkey returned by get_public_key.</p>
                      </>
                    }
                  />
                  <span className="font-mono text-blue-200 bg-blue-900/30 px-2 py-0.5 rounded">
                    {renderKey(controller.getTransportPubkey())}
                  </span>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={copied.transport ? <CheckIcon className="h-4 w-4 text-green-400" /> : <CopyIcon className="h-4 w-4 text-blue-300" />}
                    tooltip={copied.transport ? 'Copied' : 'Copy transport pubkey'}
                    onClick={() => copy('transport', controller.getTransportPubkey())}
                  />
                </div>
              )}
              {controller && controller.getIdentityPubkey() && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">User</span>
                  <Shield className="h-3 w-3 text-blue-400" />
                  <span className="font-mono text-blue-200 bg-blue-900/30 px-2 py-0.5 rounded">
                    {renderKey(controller.getIdentityPubkey())}
                  </span>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={copied.user ? <CheckIcon className="h-4 w-4 text-green-400" /> : <CopyIcon className="h-4 w-4 text-blue-300" />}
                    tooltip={copied.user ? 'Copied' : 'Copy user pubkey'}
                    onClick={() => copy('user', controller.getIdentityPubkey())}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)} dismissAfterMs={12000}>
          {error}
        </Alert>
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
