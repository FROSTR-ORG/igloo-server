import React, { useMemo, useState } from 'react'
import type { Nip46RequestApi, PermissionPolicy, PolicyPatch } from './types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Alert } from '../ui/alert'
import { ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, Sparkles, Ban, Layers } from 'lucide-react'
import { getFallbackAvatar, isValidImageUrl } from './utils'

interface RequestsProps {
  requests: Nip46RequestApi[]
  loading?: boolean
  actionPending?: boolean
  error?: string | null
  policies: Record<string, PermissionPolicy | undefined>
  onApprove: (request: Nip46RequestApi, options?: { policyPatch?: PolicyPatch }) => Promise<void>
  onDeny: (request: Nip46RequestApi, options?: { policyPatch?: PolicyPatch }) => Promise<void>
  onApproveMany: (requests: Nip46RequestApi[], options?: { policyPatch?: PolicyPatch }) => Promise<void>
  onDenyMany: (requests: Nip46RequestApi[], options?: { policyPatch?: PolicyPatch }) => Promise<void>
}

interface ParsedRequest {
  record: Nip46RequestApi
  method: string
  params: any[]
  session: any
  sessionName: string
  sessionImage?: string
  sessionUrl?: string
  eventKind: number | null
  eventTemplate: Record<string, any> | null
  contentPreview: string | null
}

const DEFAULT_POLICY: PermissionPolicy = { methods: {}, kinds: {} }

const truncate = (hex?: string | null, size = 8) => {
  if (!hex) return ''
  return hex.length <= size * 2 ? hex : `${hex.slice(0, size)}...${hex.slice(-size)}`
}

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString()
}

const parseRequest = (record: Nip46RequestApi): ParsedRequest => {
  let method = record.method
  let params: any[] = []
  let session: any = null

  try {
    const payload = JSON.parse(record.params)
    if (payload && typeof payload === 'object') {
      method = typeof payload.method === 'string' ? payload.method : method
      params = Array.isArray(payload.params) ? payload.params : []
      session = payload.session || null
    }
  } catch {
    // fall back to defaults
  }

  const profile = session?.profile || {}
  const sessionName = typeof profile?.name === 'string' ? profile.name : 'Unknown application'
  const sessionImage = typeof profile?.image === 'string' ? profile.image : undefined
  const sessionUrl = typeof profile?.url === 'string' ? profile.url : undefined

  let eventKind: number | null = null
  let eventTemplate: Record<string, any> | null = null
  if (method === 'sign_event') {
    const rawEvent = typeof params[0] === 'string' ? params[0] : null
    if (rawEvent) {
      try {
        const parsed = JSON.parse(rawEvent)
        if (parsed && typeof parsed === 'object') {
          eventTemplate = parsed
          const parsedKind = Number(parsed.kind)
          eventKind = Number.isFinite(parsedKind) ? parsedKind : null
        }
      } catch {
        // ignore bad payloads
      }
    }
  }

  const contentPreview = eventTemplate && typeof eventTemplate.content === 'string'
    ? eventTemplate.content.trim().slice(0, 160)
    : null

  return {
    record,
    method,
    params,
    session,
    sessionName,
    sessionImage,
    sessionUrl,
    eventKind,
    eventTemplate,
    contentPreview
  }
}

const allowKindPatch = (kind: number): PolicyPatch => ({
  methods: { sign_event: true },
  kinds: { [String(kind)]: true }
})

const denyKindPatch = (kind: number): PolicyPatch => ({
  kinds: { [String(kind)]: false }
})

const allowMethodPatch = (method: string): PolicyPatch => ({
  methods: { [method]: true }
})

const denyMethodPatch = (method: string): PolicyPatch => ({
  methods: { [method]: false }
})

export function Requests({
  requests,
  loading = false,
  actionPending = false,
  error,
  policies,
  onApprove,
  onDeny,
  onApproveMany,
  onDenyMany
}: RequestsProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { pendingRequests, parsedRequests, kindMap } = useMemo(() => {
    const pending = requests.filter(req => req.status === 'pending')
    const map = new Map<number, Nip46RequestApi[]>()
    const parsed = pending.map(record => {
      const parsedRecord = parseRequest(record)
      if (parsedRecord.method === 'sign_event' && parsedRecord.eventKind != null) {
        const list = map.get(parsedRecord.eventKind) ?? []
        list.push(record)
        map.set(parsedRecord.eventKind, list)
      }
      return parsedRecord
    })
    return { pendingRequests: pending, parsedRequests: parsed, kindMap: map }
  }, [requests])

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return <div className="text-sm text-gray-400">Loading requests...</div>
  }

  if (!pendingRequests.length) {
    return <div className="text-sm text-gray-500 italic">No pending requests.</div>
  }

  const allTargets = parsedRequests.map(entry => entry.record)

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="error" dismissAfterMs={7000}>
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={actionPending}
          onClick={() => void onApproveMany(allTargets)}
          className="gap-1 bg-blue-600 text-blue-100 hover:bg-blue-500 border border-blue-500/60"
        >
          <Sparkles className="h-4 w-4" />
          Approve All
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={actionPending}
          onClick={() => void onDenyMany(allTargets)}
          className="gap-1 bg-red-600 text-red-100 hover:bg-red-500 border border-red-500/60"
        >
          <Ban className="h-4 w-4" />
          Deny All
        </Button>
      </div>

      {parsedRequests.map(entry => {
        const { record, method, sessionName, sessionImage, sessionUrl, eventKind, eventTemplate, params, contentPreview } = entry
        const policy = policies[record.session_pubkey] ?? DEFAULT_POLICY
        const methodAllowed = policy.methods?.[method] === true
        const wildcardKind = policy.kinds?.['*'] === true
        const kindAllowed = method === 'sign_event' && eventKind != null
          ? methodAllowed && (wildcardKind || policy.kinds?.[String(eventKind)] === true)
          : false
        const allowedByPolicy = method === 'sign_event' ? kindAllowed : methodAllowed
        const isExpanded = expanded.has(record.id)
        const sameKindTargets = eventKind != null ? (kindMap.get(eventKind) ?? []) : []
        const avatarUrl = sessionImage && isValidImageUrl(sessionImage) ? sessionImage : getFallbackAvatar(record.session_pubkey)

        return (
          <div key={record.id} className="rounded-md border border-blue-900/30 bg-gray-900/35 p-4 space-y-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <img
                    src={avatarUrl}
                    alt={`${sessionName} icon`}
                    className="h-8 w-8 rounded"
                    onError={event => {
                      const fallback = getFallbackAvatar(record.session_pubkey)
                      if (event.currentTarget.src !== fallback) {
                        event.currentTarget.src = fallback
                      }
                    }}
                  />
                  <div>
                    <div className="text-sm font-semibold text-blue-100">{sessionName}</div>
                    <div className="text-xs text-gray-400 font-mono">{truncate(record.session_pubkey)}</div>
                    {(() => {
                      if (!sessionUrl) return null;
                      try {
                        const parsed = new URL(sessionUrl);
                        const allowed = parsed.protocol === 'http:' || parsed.protocol === 'https:';
                        if (allowed) {
                          return (
                            <a
                              href={sessionUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-400 transition hover:text-blue-300"
                            >
                              {sessionUrl}
                            </a>
                          );
                        }
                      } catch {
                        // Ignore parsing errors and fall through to render plain text
                      }
                      return (
                        <span className="text-[11px] text-gray-400">{sessionUrl}</span>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <span className="uppercase tracking-wide text-gray-500">Method</span>
                  <Badge variant="info" className="bg-blue-900/30">{method}</Badge>
                  {method === 'sign_event' && eventKind != null ? (
                    <Badge variant="purple" className="bg-purple-900/30">Kind {eventKind}</Badge>
                  ) : null}
                  <span className="ml-2">Created {formatTimestamp(record.created_at)}</span>
                  {allowedByPolicy ? (
                    <Badge variant="success" className="flex items-center gap-1 bg-green-900/30">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Allowed by policy
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="flex items-center gap-1 bg-yellow-900/30">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Manual approval required
                    </Badge>
                  )}
                </div>

                {contentPreview ? (
                  <div className="text-xs italic text-gray-300">{contentPreview}{eventTemplate?.content && eventTemplate.content.length > 160 ? '…' : ''}</div>
                ) : null}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleExpanded(record.id)}
                className="shrink-0"
              >
                {isExpanded ? <><ChevronUp className="h-4 w-4" /><span className="sr-only">Collapse</span></> : <><ChevronDown className="h-4 w-4" /><span className="sr-only">Expand</span></>}
              </Button>
            </div>

            {isExpanded ? (
              <div className="space-y-3 text-xs text-gray-300">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Params</div>
                  <pre className="overflow-auto rounded border border-blue-900/30 bg-gray-950/50 p-2 text-[11px]">{JSON.stringify(params, null, 2)}</pre>
                </div>
                {eventTemplate ? (
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Event Template</div>
                    <pre className="overflow-auto rounded border border-blue-900/30 bg-gray-950/50 p-2 text-[11px]">{JSON.stringify(eventTemplate, null, 2)}</pre>
                  </div>
                ) : null}
                {entry.session ? (
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Session Payload</div>
                    <pre className="overflow-auto rounded border border-blue-900/30 bg-gray-950/50 p-2 text-[11px]">{JSON.stringify(entry.session, null, 2)}</pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={actionPending}
                onClick={() => void onApprove(record)}
                className="bg-blue-600 text-blue-100 hover:bg-blue-500 border border-blue-500/60"
              >
                Approve
              </Button>
              {method === 'sign_event' && eventKind != null ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={actionPending || kindAllowed}
                  onClick={() => void onApprove(record, { policyPatch: allowKindPatch(eventKind) })}
                  className="bg-gray-800/80 text-blue-100 hover:bg-blue-900/40 border border-blue-900/40"
                >
                  Remember kind {eventKind}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={actionPending || methodAllowed}
                  onClick={() => void onApprove(record, { policyPatch: allowMethodPatch(method) })}
                  className="bg-gray-800/80 text-blue-100 hover:bg-blue-900/40 border border-blue-900/40"
                >
                  Remember method
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={actionPending}
                onClick={() => void onDeny(record)}
                className="bg-red-600 text-red-100 hover:bg-red-500 border border-red-500/60"
              >
                Deny
              </Button>
              {method === 'sign_event' && eventKind != null ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={actionPending || !kindAllowed}
                  onClick={() => void onDeny(record, { policyPatch: denyKindPatch(eventKind) })}
                  className="border border-blue-900/40 text-blue-200 hover:bg-blue-900/20"
                >
                  Block kind {eventKind}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={actionPending || !methodAllowed}
                  onClick={() => void onDeny(record, { policyPatch: denyMethodPatch(method) })}
                  className="border border-blue-900/40 text-blue-200 hover:bg-blue-900/20"
                >
                  Block method
                </Button>
              )}
              {method === 'sign_event' && eventKind != null ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={actionPending || sameKindTargets.length === 0}
                    onClick={() => void onApproveMany(sameKindTargets, { policyPatch: allowKindPatch(eventKind) })}
                    className="gap-1 text-blue-200 hover:text-blue-100 hover:bg-blue-900/20"
                  >
                    <Layers className="h-4 w-4" />
                    Approve all kind {eventKind}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={actionPending || sameKindTargets.length === 0}
                    onClick={() => void onDenyMany(sameKindTargets, { policyPatch: denyKindPatch(eventKind) })}
                    className="gap-1 text-blue-200 hover:text-blue-100 hover:bg-blue-900/20"
                  >
                    <Layers className="h-4 w-4" />
                    Deny all kind {eventKind}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
