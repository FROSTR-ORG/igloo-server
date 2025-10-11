import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Alert } from './ui/alert'
import { Badge } from './ui/badge'
import ConfirmModal from './ui/ConfirmModal'
import Spinner from './ui/spinner'
import { cn } from '../lib/utils'
import { Copy, KeyRound, Lock, RefreshCw, Shield, Trash2, Eye, EyeOff } from 'lucide-react'

interface ApiKeysProps {
  authHeaders?: Record<string, string>
  headlessMode?: boolean
  isAdminUser?: boolean
}

interface ApiKeyRecord {
  id: number | string
  prefix: string
  label: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  revokedAt: string | null
  revokedReason: string | null
  createdByUserId: number | string | null
  createdByAdmin: boolean
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

const ApiKeys: React.FC<ApiKeysProps> = ({ authHeaders = {}, headlessMode = false, isAdminUser = false }) => {
  const [adminSecret, setAdminSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [revokePending, setRevokePending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [userId, setUserId] = useState('')
  const [issuedKey, setIssuedKey] = useState<{ token: string; prefix: string; label?: string | null } | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  // Track copy timeout to avoid leaks if component unmounts before it fires
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const combinedHeaders = useCallback(
    (contentType = true) => {
      const headers: Record<string, string> = { ...authHeaders }
      if (contentType) {
        headers['Content-Type'] = 'application/json'
      }
      if (adminSecret.trim().length > 0) {
        headers['Authorization'] = `Bearer ${adminSecret.trim()}`
      }
      return headers
    },
    [authHeaders, adminSecret]
  )

  const loadKeys = useCallback(async () => {
    if (headlessMode) {
      setError('API key management is environment-driven in headless mode.')
      setKeys([])
      return
    }
    if (!adminSecret.trim() && !isAdminUser) {
      setError('Enter the ADMIN_SECRET to manage API keys.')
      setKeys([])
      return
    }
    setLoading(true)
    setError(null)
    setFeedback(null)
    try {
      const headers = (adminSecret.trim().length > 0 || isAdminUser)
        ? combinedHeaders(false)
        : authHeaders
      const res = await fetch('/api/admin/api-keys', {
        headers
      })
      if (!res.ok) {
        if (res.status === 401 && !isAdminUser) {
          throw new Error('Admin secret rejected. Double-check the value and try again.')
        }
        throw new Error(`Failed to load API keys (status ${res.status}).`)
      }
      const data = await res.json()
      const records: ApiKeyRecord[] = Array.isArray(data.apiKeys) ? data.apiKeys : []
      setKeys(records)
      if (!records.length) {
        setFeedback('No API keys found yet. Generate one below to get started.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load API keys.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [adminSecret, combinedHeaders, headlessMode, isAdminUser, authHeaders])

  const handleIssueKey = useCallback(async () => {
    if (headlessMode) return
    if (!adminSecret.trim() && !isAdminUser) {
      setError('Enter the ADMIN_SECRET to create API keys.')
      return
    }
    setIssuing(true)
    setError(null)
    setFeedback(null)
    try {
      const payload: Record<string, any> = {}
      if (label.trim()) {
        payload.label = label.trim()
      }
      if (userId.trim()) {
        const numericUserId = Number(userId.trim())
        payload.userId = Number.isNaN(numericUserId) ? userId.trim() : numericUserId
      }

      const headers = (adminSecret.trim().length > 0 || isAdminUser)
        ? combinedHeaders()
        : { ...authHeaders, 'Content-Type': 'application/json' }
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        if (res.status === 401 && !isAdminUser) {
          throw new Error('Admin secret rejected. Key was not created.')
        }
        const text = await res.text().catch(() => '')
        throw new Error(text || 'Failed to create API key.')
      }
      const data = await res.json()
      setIssuedKey({ token: data?.apiKey?.token, prefix: data?.apiKey?.prefix, label: data?.apiKey?.label })
      setFeedback('API key created. Copy the secret now—it will not be shown again.')
      setLabel('')
      setUserId('')
      await loadKeys()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create API key.'
      setError(message)
    } finally {
      setIssuing(false)
    }
  }, [adminSecret, combinedHeaders, headlessMode, label, loadKeys, userId, authHeaders, isAdminUser])

  const confirmRevoke = useCallback(async () => {
    if (!revokeTarget || revokePending) return
    if (!adminSecret.trim() && !isAdminUser) {
      setError('Enter the ADMIN_SECRET to revoke an API key.')
      return
    }
    setRevokePending(true)
    setError(null)
    setFeedback(null)
    try {
      const headers = (adminSecret.trim().length > 0 || isAdminUser)
        ? combinedHeaders()
        : { ...authHeaders, 'Content-Type': 'application/json' }
      const res = await fetch('/api/admin/api-keys/revoke', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          apiKeyId: revokeTarget.id,
          reason: revokeReason.trim() || undefined
        })
      })
      if (!res.ok) {
        if (res.status === 401 && !isAdminUser) {
          throw new Error('Admin secret rejected. Key was not revoked.')
        }
        const text = await res.text().catch(() => '')
        throw new Error(text || 'Failed to revoke API key.')
      }
      setFeedback(`API key ${revokeTarget.prefix} revoked.`)
      setRevokeTarget(null)
      setRevokeReason('')
      await loadKeys()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to revoke API key.'
      setError(message)
    } finally {
      setRevokePending(false)
    }
  }, [adminSecret, combinedHeaders, loadKeys, revokeReason, revokeTarget, isAdminUser, authHeaders, revokePending])

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => setCopiedField(prev => (prev === field ? null : prev)), 1500)
    } catch (err) {
      console.error('Clipboard error:', err)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
        copyTimeoutRef.current = null
      }
    }
  }, [])

  const activeKeys = useMemo(() => keys.filter(key => !key.revokedAt), [keys])
  const revokedKeys = useMemo(() => keys.filter(key => key.revokedAt), [keys])

  useEffect(() => {
    if (isAdminUser) {
      loadKeys().catch(err => console.error('Failed to load keys:', err))
    }
  }, [isAdminUser, loadKeys])

  if (headlessMode) {
    return (
      <div className="space-y-4">
        <Alert variant="info" title="Headless mode">
          API key management is configured through environment variables. Set or rotate the `API_KEY` value in your deployment environment, then restart the server to apply changes.
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!isAdminUser && (
        <div className="space-y-3">
          <label className="text-sm text-blue-200 flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-400" /> Admin Secret
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={adminSecret}
                onChange={e => setAdminSecret(e.target.value)}
                placeholder="Enter ADMIN_SECRET"
                className="bg-gray-900/60 border-blue-900/40 text-blue-100 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret(prev => !prev)}
                className="absolute inset-y-0 right-2 flex items-center text-blue-300/70 hover:text-blue-200"
                aria-label={showSecret ? 'Hide admin secret' : 'Show admin secret'}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              onClick={loadKeys}
              className="bg-blue-600 hover:bg-blue-700 text-blue-100"
              disabled={loading}
            >
              {loading && <Spinner size="sm" />} Fetch Keys
            </Button>
          </div>
          <p className="text-xs text-gray-400">
            The admin secret is never stored. It is used only for the current session to authenticate administrative actions.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-400 hover:text-blue-200 hover:bg-blue-900/30"
          onClick={loadKeys}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {feedback && (
        <Alert variant="info" onClose={() => setFeedback(null)}>
          {feedback}
        </Alert>
      )}

      {issuedKey?.token && (
        <div className="space-y-2 border border-green-800/30 bg-green-900/20 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-200">
            <KeyRound className="h-4 w-4" /> New API key issued
          </div>
          <p className="text-xs text-green-100/80">
            Copy and store this token securely. It will not be shown again.
          </p>
          <div className="flex items-center gap-3 bg-gray-900/60 border border-green-800/30 rounded-md p-3">
            <code className="font-mono text-sm text-green-200 break-all flex-1">
              {issuedKey.token}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="text-green-300 hover:text-green-200 hover:bg-green-900/30"
              onClick={() => handleCopy(issuedKey.token, 'issued-token')}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copiedField === 'issued-token' && (
              <span className="text-xs text-green-300">Copied</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 border border-blue-900/30 bg-gray-900/40 rounded-lg p-4">
        <h3 className="text-blue-200 text-lg font-semibold">Create API key</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs uppercase tracking-wide text-gray-400">Label (optional)</label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="automation-bot"
              className="bg-gray-900/60 border-blue-900/40 text-blue-100"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-gray-400">User ID (optional)</label>
            <Input
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="1"
              className="bg-gray-900/60 border-blue-900/40 text-blue-100"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-blue-100"
            onClick={handleIssueKey}
            disabled={issuing || (!adminSecret.trim() && !isAdminUser)}
          >
            {issuing ? <Spinner size="sm" /> : <KeyRound className="h-4 w-4" />} Issue key
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-blue-200 text-lg font-semibold flex items-center gap-2">
          <Lock className="h-4 w-4 text-blue-400" /> Active keys
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-blue-400 hover:text-blue-200 hover:bg-blue-900/30"
          onClick={loadKeys}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Spinner label="Loading API keys…" />
        </div>
      )}

      {!loading && !keys.length && !error && (
        <Alert variant="info">
          No API keys found. Create your first key above to get started.
        </Alert>
      )}

      {!loading && keys.length > 0 && (
        <div className="space-y-4">
          {[activeKeys, revokedKeys].map((collection, index) => {
            if (!collection.length) return null
            const title = index === 0 ? 'Active' : 'Revoked'
            return (
              <div key={title} className="space-y-3">
                <h4 className="text-sm text-gray-300 uppercase tracking-wide">{title}</h4>
                <div className="space-y-3">
                  {collection.map(key => {
                    const isRevoked = Boolean(key.revokedAt)
                    const statusBadge = isRevoked ? (
                      <Badge variant="error">Revoked</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )
                    return (
                      <div
                        key={key.id}
                        className="border border-blue-900/30 rounded-lg bg-gray-900/40 p-4 space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div>
                            <div className="font-mono text-sm text-blue-200 flex items-center gap-2">
                              {key.prefix}
                              <Badge variant={key.createdByAdmin ? 'info' : 'default'}>
                                {key.createdByAdmin ? 'Admin-issued' : 'User-issued'}
                              </Badge>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Label: {key.label || '—'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {statusBadge}
                            {!isRevoked && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-300 hover:text-blue-100 hover:bg-blue-900/30"
                                onClick={() => handleCopy(key.prefix, `prefix-${key.id}`)}
                              >
                                <Copy className="h-4 w-4" />
                                <span className="sr-only">Copy prefix</span>
                              </Button>
                            )}
                            {copiedField === `prefix-${key.id}` && (
                              <span className="text-xs text-blue-300">Copied</span>
                            )}
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2 text-xs text-blue-100/80">
                          <div>Created: {formatDate(key.createdAt)}</div>
                          <div>Updated: {formatDate(key.updatedAt)}</div>
                          <div>Last used: {formatDate(key.lastUsedAt)}</div>
                          {key.lastUsedIp && <div>Last IP: {key.lastUsedIp}</div>}
                          <div>Revoked at: {formatDate(key.revokedAt)}</div>
                          <div>Revoked reason: {key.revokedReason || '—'}</div>
                          <div>User ID: {key.createdByUserId ?? '—'}</div>
                        </div>
                        <div className="flex justify-end gap-2">
                          {!isRevoked && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="bg-red-600 hover:bg-red-700 text-red-100"
                              onClick={() => {
                                setRevokeTarget(key)
                                setRevokeReason('')
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(revokeTarget)}
        title="Revoke API key"
        body={(
          <div className="space-y-4 text-sm text-blue-100/80">
            <p>
              Revoking API key <span className="font-mono text-blue-200">{revokeTarget?.prefix}</span> will immediately block its access.
            </p>
            <div>
              <label className="text-xs uppercase tracking-wide text-gray-400 mb-1 block">
                Reason (optional)
              </label>
              <textarea
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                rows={3}
                className="w-full rounded-md bg-gray-900/60 border border-blue-900/40 px-3 py-2 text-sm text-blue-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Rotating credentials, lost device, etc."
              />
            </div>
            {revokePending && (
              <div className="flex items-center gap-2 text-xs text-blue-300">
                <Spinner size="sm" /> Revoking…
              </div>
            )}
          </div>
        )}
        onConfirm={confirmRevoke}
        onCancel={() => {
          if (!revokePending) {
            setRevokeTarget(null)
            setRevokeReason('')
          }
        }}
      />
    </div>
  )
}

export default ApiKeys
