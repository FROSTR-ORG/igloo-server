import React, { useEffect, useMemo, useState } from 'react'
import type { Nip46SessionApi, PermissionPolicy } from './types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { PermissionsDropdown } from './Permissions'
import { getFallbackAvatar, isValidImageUrl } from './utils'
import { cn } from '../../lib/utils'

interface SessionsProps {
  sessions: Nip46SessionApi[]
  loading?: boolean
  onRevoke: (pubkey: string) => Promise<void>
  onUpdatePolicy: (pubkey: string, policy: PermissionPolicy) => Promise<void>
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'N/A'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString()
}

const truncate = (hex: string, size = 12) =>
  hex.length <= size * 2 ? hex : `${hex.slice(0, size)}...${hex.slice(-size)}`

const normalizePolicy = (policy?: PermissionPolicy | null): PermissionPolicy => ({
  methods: { ...(policy?.methods ?? {}) },
  kinds: { ...(policy?.kinds ?? {}) }
})

export function Sessions({ sessions, loading = false, onRevoke, onUpdatePolicy }: SessionsProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingPolicies, setEditingPolicies] = useState<Record<string, PermissionPolicy>>({})
  const [newEventKinds, setNewEventKinds] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [copiedPubkey, setCopiedPubkey] = useState<string | null>(null)

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
  }, [sessions])

  useEffect(() => {
    setEditingPolicies(prev => {
      const next = { ...prev }
      expanded.forEach(pubkey => {
        if (!next[pubkey]) {
          const session = sortedSessions.find(s => s.pubkey === pubkey)
          if (session) {
            next[pubkey] = normalizePolicy(session.policy)
          }
        }
      })
      return next
    })
  }, [expanded, sortedSessions])

  const collapse = (pubkey: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.delete(pubkey)
      return next
    })
    setEditingPolicies(prev => {
      const { [pubkey]: _omit, ...rest } = prev
      return rest
    })
    setNewEventKinds(prev => {
      const { [pubkey]: _omit, ...rest } = prev
      return rest
    })
  }

  const toggleExpanded = (pubkey: string, policy?: PermissionPolicy) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(pubkey)) {
        next.delete(pubkey)
      } else {
        next.add(pubkey)
      }
      return next
    })
    setEditingPolicies(prev => {
      if (prev[pubkey]) return prev
      return { ...prev, [pubkey]: normalizePolicy(policy) }
    })
    setNewEventKinds(prev => ({ ...prev, [pubkey]: prev[pubkey] ?? '' }))
  }

  const handleSavePolicy = async (pubkey: string, session: Nip46SessionApi) => {
    const policy = normalizePolicy(editingPolicies[pubkey] ?? session.policy)
    setSaving(prev => ({ ...prev, [pubkey]: true }))
    try {
      await onUpdatePolicy(pubkey, policy)
      collapse(pubkey)
    } catch (error) {
      console.error('Failed to update NIP-46 policy', error)
    } finally {
      setSaving(prev => ({ ...prev, [pubkey]: false }))
    }
  }

  const handleCopyPubkey = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedPubkey(value)
      setTimeout(() => {
        setCopiedPubkey(prev => (prev === value ? null : prev))
      }, 1600)
    } catch (error) {
      console.error('Failed to copy session pubkey', error)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400">Loading sessions...</div>
  }

  if (!sortedSessions.length) {
    return <div className="text-sm text-gray-500 italic">No active sessions.</div>
  }

  return (
    <div className="space-y-3">
      {sortedSessions.map(session => {
        const { pubkey, profile, relays, status, recent_kinds, recent_methods } = session
        const imageSrc = profile?.image && isValidImageUrl(profile.image)
          ? profile.image
          : getFallbackAvatar(pubkey)
        const isExpanded = expanded.has(pubkey)
        const editingPolicy = editingPolicies[pubkey] ?? normalizePolicy(session.policy)
        const newKindValue = newEventKinds[pubkey] ?? ''
        const sessionPolicy = normalizePolicy(session.policy)
        const autoMethods = Object.entries(sessionPolicy.methods || {})
          .filter(([, value]) => value)
          .map(([method]) => method)
          .sort()
        const wildcardKinds = sessionPolicy.kinds?.['*'] === true
        const specificAutoKinds = Object.entries(sessionPolicy.kinds || {})
          .filter(([key, value]) => key !== '*' && value)
          .map(([key]) => Number(key))
          .filter(value => Number.isFinite(value))
          .sort((a, b) => a - b)
        const hasPolicySummary = autoMethods.length > 0 || wildcardKinds || specificAutoKinds.length > 0
        const relayList = Array.isArray(relays) ? relays.filter(relay => typeof relay === 'string' && relay.trim().length > 0) : []
        const visibleRelays = relayList.slice(0, 2)
        const extraRelays = Math.max(0, relayList.length - visibleRelays.length)
        const statusVariant: 'success' | 'warning' | 'default' =
          status === 'active' ? 'success' : status === 'pending' ? 'warning' : 'default'
        const isSaving = saving[pubkey] === true

        const cardClasses = cn(
          'rounded-md border border-blue-900/30 bg-gray-900/30 p-4 transition-colors',
          isExpanded ? 'border-blue-500/40 bg-gray-900/40 shadow-lg' : 'hover:border-blue-500/40 hover:bg-blue-900/15'
        )

        return (
          <article
            key={pubkey}
            className={cardClasses}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <img
                  src={imageSrc}
                  onError={(event) => {
                    const target = event.currentTarget
                    const fallback = getFallbackAvatar(pubkey)
                    if (target.src !== fallback) {
                      target.src = fallback
                    }
                  }}
                  alt={profile?.name ? `${profile.name} icon` : 'session icon'}
                  className="h-10 w-10 rounded-md border border-blue-900/40 object-cover"
                />
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-blue-100">
                      {profile?.name || 'Unknown application'}
                    </span>
                    <Badge variant={statusVariant}>{status.toUpperCase()}</Badge>
                  </div>
                  {profile?.url ? (
                    <a
                      href={profile.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-400 transition hover:text-blue-300"
                    >
                      {profile.url}
                    </a>
                  ) : null}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="font-mono text-blue-200">{truncate(pubkey)}</span>
                    <button
                      type="button"
                      className="rounded border border-blue-900/40 px-2 py-0.5 text-[11px] uppercase tracking-wide text-blue-200 transition hover:border-blue-500/60 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      onClick={() => handleCopyPubkey(pubkey)}
                    >
                      {copiedPubkey === pubkey ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isSaving ? <Badge variant="info">Saving…</Badge> : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => (isExpanded ? collapse(pubkey) : toggleExpanded(pubkey, session.policy))}
                >
                  {isExpanded ? 'Close permissions' : 'Edit permissions'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onRevoke(pubkey)}
                  disabled={isSaving}
                >
                  Revoke
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 text-xs text-gray-400 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Created</div>
                <div>{formatTimestamp(session.created_at)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Last activity</div>
                <div>{formatTimestamp(session.last_active_at)}</div>
              </div>
            </div>

            {relayList.length ? (
              <div className="mt-3 text-xs text-gray-400">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Relays</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {visibleRelays.map(relay => (
                    <Badge key={`${pubkey}-relay-${relay}`} variant="info" className="bg-blue-900/30">
                      {relay}
                    </Badge>
                  ))}
                  {extraRelays > 0 ? (
                    <Badge variant="default">+{extraRelays} more</Badge>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasPolicySummary ? (
              <div className="mt-3 text-xs text-gray-400 space-y-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Auto-approved methods</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {autoMethods.length ? (
                      autoMethods.map(method => (
                        <Badge key={`${pubkey}-method-${method}`} variant="info">{method}</Badge>
                      ))
                    ) : (
                      <span className="italic text-gray-500">None</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Auto-approved kinds</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {wildcardKinds ? (
                      <Badge variant="info">All kinds</Badge>
                    ) : specificAutoKinds.length ? (
                      specificAutoKinds.map(kind => (
                        <Badge key={`${pubkey}-kind-${kind}`} variant="purple">{kind}</Badge>
                      ))
                    ) : (
                      <span className="italic text-gray-500">None</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

                {isExpanded ? (
                  <div className="mt-4 rounded-md border border-blue-900/30 bg-gray-900/40 p-4">
                    <PermissionsDropdown
                      session={session}
                      editingPolicy={editingPolicy}
                  newEventKind={newKindValue}
                  saving={isSaving}
                  onPolicyChange={(policy) => setEditingPolicies(prev => ({ ...prev, [pubkey]: policy }))}
                  onEventKindChange={(value) => setNewEventKinds(prev => ({ ...prev, [pubkey]: value }))}
                  onSave={() => void handleSavePolicy(pubkey, session)}
                  onCancel={() => collapse(pubkey)}
                />
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
