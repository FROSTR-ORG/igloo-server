import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Sessions } from './nip46/Sessions'
import { Requests } from './nip46/Requests'
import { RelaySettings } from './nip46/RelaySettings'
import { Nip46SessionApi, Nip46RequestApi, PermissionPolicy, PolicyPatch } from './nip46/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { StatusIndicator } from './ui/status-indicator'
import { Input } from './ui/input'
import { Alert } from './ui/alert'
import { QRScanner } from './nip46/QRScanner'
import Spinner from './ui/spinner'
import { Users, Bell, HelpCircle, Copy as CopyIcon, Check as CheckIcon, Eye, EyeOff, Radio, QrCode, X as CloseIcon } from 'lucide-react'

interface NIP46Props {
  authHeaders?: Record<string, string>
}

interface RequestActionOptions {
  policyPatch?: PolicyPatch
}

const truncate = (hex?: string | null, size = 8) => {
  if (!hex) return ''
  return hex.length <= size * 2 ? hex : `${hex.slice(0, size)}...${hex.slice(-size)}`
}

export function NIP46({ authHeaders }: NIP46Props) {
  const [sessions, setSessions] = useState<Nip46SessionApi[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [requests, setRequests] = useState<Nip46RequestApi[]>([])
  const [requestsLoading, setRequestsLoading] = useState(true)
  const [requestsError, setRequestsError] = useState<string | null>(null)
  const [requestActionPending, setRequestActionPending] = useState(false)
  const [nip46Relays, setNip46Relays] = useState<string[]>([])
  const [relaysLoading, setRelaysLoading] = useState(true)
  const [relaySaving, setRelaySaving] = useState(false)
  const [relaysError, setRelaysError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('sessions')
  const [showFullKeys, setShowFullKeys] = useState(false)
  const [copied, setCopied] = useState<{ transport?: boolean; user?: boolean }>({})
  const [transportKey, setTransportKey] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [connectUri, setConnectUri] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectSuccess, setConnectSuccess] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const sessionsSignature = useRef('')

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', ...(authHeaders || {}) }), [authHeaders])
  const sessionsInitialized = useRef(false)
  const requestsInitialized = useRef(false)

  const fetchSessions = useCallback(async () => {
    if (!sessionsInitialized.current) {
      setSessionsLoading(true)
    }
    try {
      const res = await fetch('/api/nip46/sessions?history=true', { headers })
      if (res.ok) {
        const data = await res.json()
        const rawSessions: Nip46SessionApi[] = Array.isArray(data.sessions) ? data.sessions : []
        const normalized = [...rawSessions].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
        const signature = JSON.stringify(normalized)
        if (signature !== sessionsSignature.current) {
          sessionsSignature.current = signature
          setSessions(normalized)
        }
      }
    } finally {
      sessionsInitialized.current = true
      setSessionsLoading(false)
    }
  }, [headers])

  const fetchRequests = useCallback(async () => {
    if (!requestsInitialized.current) {
      setRequestsLoading(true)
    }
    try {
      const res = await fetch('/api/nip46/requests?status=pending', { headers })
      if (res.ok) {
        const data = await res.json()
        setRequests(Array.isArray(data.requests) ? data.requests : [])
      }
    } finally {
      requestsInitialized.current = true
      setRequestsLoading(false)
    }
  }, [headers])

  const fetchRelays = useCallback(async () => {
    setRelaysLoading(true)
    try {
      const res = await fetch('/api/nip46/relays', { headers })
      if (res.ok) {
        const data = await res.json()
        setNip46Relays(Array.isArray(data.relays) ? data.relays : [])
      }
    } finally {
      setRelaysLoading(false)
    }
  }, [headers])

  const fetchTransport = useCallback(async () => {
    try {
      const res = await fetch('/api/nip46/transport', { headers })
      if (res.ok) {
        const data = await res.json()
        if (typeof data?.transport_sk === 'string') {
          setTransportKey(data.transport_sk)
          setIsConnected(true)
        }
      }
    } catch {
      setIsConnected(false)
    }
  }, [headers])

  const performRequestAction = useCallback(async (
    targets: Nip46RequestApi[],
    action: 'approve' | 'deny',
    options?: RequestActionOptions
  ) => {
    if (!targets.length) return
    setRequestsError(null)
    setRequestActionPending(true)
    try {
      await Promise.all(targets.map(async target => {
        const payload: Record<string, any> = { id: target.id, action }
        if (options?.policyPatch) {
          payload.policy = options.policyPatch
        }
        const res = await fetch('/api/nip46/requests', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || 'Failed to update request')
        }
      }))
      await fetchRequests()
      if (options?.policyPatch) {
        await fetchSessions()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update request'
      setRequestsError(message)
    } finally {
      setRequestActionPending(false)
    }
  }, [headers, fetchRequests, fetchSessions])

  useEffect(() => {
    fetchSessions()
    fetchRequests()
    fetchRelays()
    fetchTransport()

    const interval = setInterval(() => {
      fetchSessions()
      fetchRequests()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchSessions, fetchRequests, fetchRelays, fetchTransport])

  useEffect(() => {
    const handleNip46Event = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail
      const type = typeof detail?.type === 'string' ? detail.type : ''
      if (!type.startsWith('nip46:')) return

      if (type === 'nip46:request') {
        void fetchRequests()
      } else if (type === 'nip46:request_status') {
        void fetchRequests()
        void fetchSessions()
      } else if (type === 'nip46:session_pending') {
        void fetchSessions()
      }
    }

    window.addEventListener('nip46Event', handleNip46Event as EventListener)
    return () => {
      window.removeEventListener('nip46Event', handleNip46Event as EventListener)
    }
  }, [fetchRequests, fetchSessions])

  const copyTimeoutRef = useRef<{ transport?: ReturnType<typeof setTimeout> | null; user?: ReturnType<typeof setTimeout> | null }>({})

  const handleCopy = async (which: 'transport' | 'user', text?: string | null) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(prev => ({ ...prev, [which]: true }))
      if (copyTimeoutRef.current[which]) clearTimeout(copyTimeoutRef.current[which] as any)
      copyTimeoutRef.current[which] = setTimeout(() => {
        setCopied(prev => ({ ...prev, [which]: false }))
        copyTimeoutRef.current[which] = null
      }, 1500)
    } catch {}
  }

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current.transport) clearTimeout(copyTimeoutRef.current.transport)
      if (copyTimeoutRef.current.user) clearTimeout(copyTimeoutRef.current.user)
      copyTimeoutRef.current = {}
    }
  }, [])

  const handleApproveRequest = useCallback(async (request: Nip46RequestApi, options?: RequestActionOptions) => {
    await performRequestAction([request], 'approve', options)
  }, [performRequestAction])

  const handleDenyRequest = useCallback(async (request: Nip46RequestApi, options?: RequestActionOptions) => {
    await performRequestAction([request], 'deny', options)
  }, [performRequestAction])

  const handleApproveMany = useCallback(async (targets: Nip46RequestApi[], options?: RequestActionOptions) => {
    await performRequestAction(targets, 'approve', options)
  }, [performRequestAction])

  const handleDenyMany = useCallback(async (targets: Nip46RequestApi[], options?: RequestActionOptions) => {
    await performRequestAction(targets, 'deny', options)
  }, [performRequestAction])

  const policyBySession = useMemo(() => {
    const map: Record<string, PermissionPolicy> = {}
    sessions.forEach(session => {
      map[session.pubkey] = {
        methods: { ...(session.policy?.methods ?? {}) },
        kinds: { ...(session.policy?.kinds ?? {}) }
      }
    })
    return map
  }, [sessions])

  const handleRevokeSession = async (pubkey: string) => {
    await fetch(`/api/nip46/sessions/${pubkey}`, {
      method: 'DELETE',
      headers
    })
    await fetchSessions()
  }

  const handleUpdateSessionPolicy = useCallback(async (pubkey: string, policy: PermissionPolicy) => {
    await fetch(`/api/nip46/sessions/${pubkey}/policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        methods: policy.methods,
        kinds: policy.kinds
      })
    })
    await fetchSessions()
  }, [headers, fetchSessions])

  const handleAddRelay = async (relay: string) => {
    setRelaysError(null)
    setRelaySaving(true)
    try {
      const res = await fetch('/api/nip46/relays', {
        method: 'POST',
        headers,
        body: JSON.stringify({ relays: [relay] })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to add relay')
        throw new Error(text)
      }
      await fetchRelays()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add relay'
      setRelaysError(message)
    } finally {
      setRelaySaving(false)
    }
  }

  const handleRemoveRelay = async (relay: string) => {
    setRelaysError(null)
    setRelaySaving(true)
    try {
      const next = nip46Relays.filter(r => r !== relay)
      const res = await fetch('/api/nip46/relays', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ relays: next })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to remove relay')
        throw new Error(text)
      }
      await fetchRelays()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove relay'
      setRelaysError(message)
    } finally {
      setRelaySaving(false)
    }
  }

  const submitConnect = useCallback(async (value: string) => {
    if (connecting) return
    const target = value.trim()
    if (!target) {
      setConnectError('Enter a nostrconnect:// URI to connect.')
      return
    }
    if (!target.toLowerCase().startsWith('nostrconnect://')) {
      setConnectError('URI must start with nostrconnect://')
      return
    }

    setConnecting(true)
    setConnectError(null)
    setConnectSuccess(null)
    try {
      const res = await fetch('/api/nip46/connect', {
        method: 'POST',
        headers,
        body: JSON.stringify({ uri: target })
      })

      if (!res.ok) {
        let message = 'Failed to connect'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          const text = await res.text().catch(() => '')
          if (text) message = text
        }
        throw new Error(message)
      }

      const data = await res.json().catch(() => ({}))
      const session = data?.session ?? {}
      const displayName = session.profile?.name || session.profile?.url || truncate(session.pubkey, 8) || 'client'
      setConnectSuccess(`Connection request sent to ${displayName}. Awaiting approval.`)
      setConnectUri('')
      setShowScanner(false)
      await Promise.all([fetchSessions(), fetchRequests(), fetchRelays()])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect'
      setConnectError(message)
    } finally {
      setConnecting(false)
    }
  }, [connecting, headers, fetchSessions, fetchRequests, fetchRelays])

  const handleConnectSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitConnect(connectUri)
  }

  const handleScanResult = useCallback((uri: string) => {
    setConnectUri(uri)
    setShowScanner(false)
    void submitConnect(uri)
  }, [submitConnect])

  const handleScannerError = useCallback((error: Error) => {
    setConnectError(error.message)
  }, [])

  if (sessionsLoading && requestsLoading && relaysLoading) {
    return (
      <div className="space-y-6">
            <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
              <Spinner label="Loading NIP-46..." size="md" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
        <div className="flex flex-col gap-2 md:gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              <StatusIndicator status={isConnected ? 'success' : 'idle'} label={isConnected ? 'NIP-46 Ready' : 'NIP-46 Disconnected'} />
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-blue-400" />
                  <span className="text-gray-400">{sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Bell className="h-4 w-4 text-blue-400" />
                  <span className="text-gray-400">{requests.filter(r => r.status === 'pending').length} pending requests</span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowFullKeys(v => !v)}>
              {showFullKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          {transportKey && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
              <div className="flex items-center gap-1">
                <span>Transport</span>
                <HelpCircle className="h-3.5 w-3.5 text-blue-400" />
                <span className="font-mono text-blue-200 bg-blue-900/30 px-2 py-0.5 rounded">
                  {showFullKeys ? transportKey : truncate(transportKey, 8)}
                </span>
                <Button variant="ghost" size="icon" onClick={() => handleCopy('transport', transportKey)}>
                  {copied.transport ? <CheckIcon className="h-4 w-4 text-green-400" /> : <CopyIcon className="h-4 w-4 text-blue-300" />}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-blue-200">Add Signing Client</h3>
            <p className="text-xs text-gray-400">Paste a nostrconnect:// URI or scan a QR code to register a client.</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowScanner(prev => !prev)}
              aria-label={showScanner ? 'Hide QR scanner' : 'Show QR scanner'}
            >
              {showScanner ? <CloseIcon className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
              <span className="sr-only">{showScanner ? 'Hide QR scanner' : 'Show QR scanner'}</span>
            </Button>
          </div>
        </div>
        <form className="flex flex-col sm:flex-row gap-2" onSubmit={handleConnectSubmit}>
          <Input
            value={connectUri}
            onChange={(event) => setConnectUri(event.target.value)}
            placeholder="nostrconnect://..."
            className="bg-gray-900/40 border-blue-900/30 font-mono text-xs sm:text-sm"
            spellCheck={false}
          />
          <Button type="submit" disabled={connecting || !connectUri.trim()}>
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </form>
        {connectError && (
          <Alert variant="error" onClose={() => setConnectError(null)} dismissAfterMs={10000}>
            {connectError}
          </Alert>
        )}
        {connectSuccess && (
          <Alert variant="success" onClose={() => setConnectSuccess(null)} dismissAfterMs={6000}>
            {connectSuccess}
          </Alert>
        )}
        {showScanner && (
          <div className="border border-blue-900/30 rounded-lg p-3 bg-gray-900/40">
            <QRScanner onResult={handleScanResult} onError={handleScannerError} />
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 mb-4 bg-gray-800/50 w-full">
          <TabsTrigger value="sessions" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
            <Users className="h-4 w-4 mr-2" />
            Sessions
            <Badge variant="info" className="ml-2">{sessions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="requests" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
            <Bell className="h-4 w-4 mr-2" />
            Requests
            <Badge variant="warning" className="ml-2">{requests.filter(r => r.status === 'pending').length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="relays" className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200">
            <Radio className="h-4 w-4 mr-2" />
            Relays
            <Badge className="ml-2">{nip46Relays.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" forceMount className="p-2 sm:p-4">
          <Sessions
            sessions={sessions}
            loading={sessionsLoading}
            onRevoke={handleRevokeSession}
            onUpdatePolicy={handleUpdateSessionPolicy}
          />
        </TabsContent>

        <TabsContent value="requests" forceMount className="p-2 sm:p-4">
          <Requests
            requests={requests}
            loading={requestsLoading}
            actionPending={requestActionPending}
            error={requestsError}
            policies={policyBySession}
            onApprove={handleApproveRequest}
            onDeny={handleDenyRequest}
            onApproveMany={handleApproveMany}
            onDenyMany={handleDenyMany}
          />
        </TabsContent>

        <TabsContent value="relays" className="p-2 sm:p-4">
          <RelaySettings
            relays={nip46Relays}
            loading={relaysLoading}
            saving={relaySaving}
            error={relaysError}
            onAdd={handleAddRelay}
            onRemove={handleRemoveRelay}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
