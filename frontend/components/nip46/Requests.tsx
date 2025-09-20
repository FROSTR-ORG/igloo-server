import React, { useState, useEffect } from 'react'
import { PermissionRequest, NIP46Request } from './types'
import { NIP46Controller } from './controller'
import { isValidImageUrl } from './utils'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Check, X, ChevronDown, ChevronUp, Clock, Shield, FileSignature, Key, Lock, Unlock } from 'lucide-react'

interface RequestsProps { controller: NIP46Controller | null }

// Type guard for sign_event content
function isSignEventContent(content: unknown): content is { kind: number; content?: string; tags?: string[][] } {
  return (
    typeof content === 'object' &&
    content !== null &&
    !('parseError' in content) &&
    'kind' in content &&
    typeof (content as any).kind === 'number'
  );
}

// Type guard for sign_event content with parse error
function isSignEventError(content: unknown): content is { raw: string; parseError: true } {
  return (
    typeof content === 'object' &&
    content !== null &&
    'parseError' in content &&
    (content as any).parseError === true &&
    'raw' in content
  );
}

// Type guard for base request content
function isBaseRequestContent(content: unknown): content is { params: string[] } {
  return (
    typeof content === 'object' &&
    content !== null &&
    'params' in content &&
    Array.isArray((content as any).params)
  );
}

function transformRequest(req: PermissionRequest): NIP46Request {
  const request_type = req.method === 'sign_event' ? 'note_signature' : 'base'
  let content
  if (req.params?.length) {
    if (req.method === 'sign_event') {
      try { 
        content = JSON.parse(req.params[0])
      } catch {
        // Log parse error or handle invalid JSON case
        console.error('Failed to parse sign_event params:', req.params[0])
        content = { raw: req.params[0], parseError: true }
      }
    } else { content = { params: req.params } }
  }
  const session_origin = {
    name: req.session.profile?.name,
    image: req.session.profile?.image,
    pubkey: req.session.pubkey,
    url: req.session.profile?.url
  }
  return {
    id: req.id,
    method: req.method,
    source: req.session.profile?.name || 'Unknown App',
    content,
    timestamp: req.stamp,
    session_origin,
    request_type,
    status: 'pending',
    deniedReason: req.deniedReason
  }
}

export function Requests({ controller }: RequestsProps) {
  const [pendingRequests, setPendingRequests] = useState<NIP46Request[]>([])
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set())
  const [actionById, setActionById] = useState<Record<string, 'idle' | 'approving' | 'denying' | 'approved' | 'denied' | 'error'>>({})
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  type BulkState = 'idle' | 'running' | 'success' | 'error'
  const [bulkAll, setBulkAll] = useState<{ approve: BulkState; deny: BulkState }>({ approve: 'idle', deny: 'idle' })
  const [bulkByKind, setBulkByKind] = useState<Record<number, { approve: BulkState; deny: BulkState }>>({})

  useEffect(() => {
    if (!controller) return
    const update = () => setPendingRequests(controller.getPendingRequests().map(transformRequest))
    update()
    controller.on('request:new', update)
    controller.on('request:approved', update)
    controller.on('request:denied', update)
    return () => {
      controller.off('request:new', update)
      controller.off('request:approved', update)
      controller.off('request:denied', update)
    }
  }, [controller])

  const handleApprove = async (id: string, options?: { autoGrant?: boolean }) => {
    setActionById(s => ({ ...s, [id]: 'approving' }))
    try {
      await controller?.approveRequest(id, options)
      setActionById(s => ({ ...s, [id]: 'approved' }))
      setFlash({ kind: 'success', text: 'Request approved' })
      setTimeout(() => setFlash(null), 1500)
    } catch (e: any) {
      console.error('Approve failed:', e)
      setActionById(s => ({ ...s, [id]: 'error' }))
      setFlash({ kind: 'error', text: `Approve failed: ${e?.message || 'Unknown error'}` })
      setTimeout(() => setFlash(null), 2500)
    }
  }

  const handleDeny = async (id: string) => {
    setActionById(s => ({ ...s, [id]: 'denying' }))
    try {
      await controller?.denyRequest(id, 'Denied by user')
      setActionById(s => ({ ...s, [id]: 'denied' }))
      setFlash({ kind: 'success', text: 'Request denied' })
      setTimeout(() => setFlash(null), 1500)
    } catch (e: any) {
      console.error('Deny failed:', e)
      setActionById(s => ({ ...s, [id]: 'error' }))
      setFlash({ kind: 'error', text: `Deny failed: ${e?.message || 'Unknown error'}` })
      setTimeout(() => setFlash(null), 2500)
    }
  }

  const handleApproveAll = async () => {
    setBulkAll(s => ({ ...s, approve: 'running' }))
    try {
      for (const r of pendingRequests) { await handleApprove(r.id) }
      setBulkAll(s => ({ ...s, approve: 'success' }))
      setTimeout(() => setBulkAll(s => ({ ...s, approve: 'idle' })), 1500)
    } catch {
      setBulkAll(s => ({ ...s, approve: 'error' }))
      setTimeout(() => setBulkAll(s => ({ ...s, approve: 'idle' })), 2000)
    }
  }
  const handleDenyAll = async () => {
    setBulkAll(s => ({ ...s, deny: 'running' }))
    try {
      for (const r of pendingRequests) { await handleDeny(r.id) }
      setBulkAll(s => ({ ...s, deny: 'success' }))
      setTimeout(() => setBulkAll(s => ({ ...s, deny: 'idle' })), 1500)
    } catch {
      setBulkAll(s => ({ ...s, deny: 'error' }))
      setTimeout(() => setBulkAll(s => ({ ...s, deny: 'idle' })), 2000)
    }
  }

  const handleApproveAllKind = async (kind: number) => {
    setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), approve: 'running' } }))
    try {
      for (const r of pendingRequests) {
        if (r.method === 'sign_event' && isSignEventContent(r.content) && r.content.kind === kind) {
          await handleApprove(r.id, { autoGrant: true })
        }
      }
      setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), approve: 'success' } }))
      setTimeout(() => setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), approve: 'idle' } })), 1500)
    } catch {
      setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), approve: 'error' } }))
      setTimeout(() => setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), approve: 'idle' } })), 2000)
    }
  }
  const handleDenyAllKind = async (kind: number) => {
    setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), deny: 'running' } }))
    try {
      for (const r of pendingRequests) {
        if (r.method === 'sign_event' && isSignEventContent(r.content) && r.content.kind === kind) {
          await handleDeny(r.id)
        }
      }
      setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), deny: 'success' } }))
      setTimeout(() => setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), deny: 'idle' } })), 1500)
    } catch {
      setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), deny: 'error' } }))
      setTimeout(() => setBulkByKind(s => ({ ...s, [kind]: { ...(s[kind] || { approve: 'idle', deny: 'idle' }), deny: 'idle' } })), 2000)
    }
  }

  const getUniqueEventKinds = (): number[] => {
    const kinds = new Set<number>()
    pendingRequests.forEach(req => {
      if (req.method === 'sign_event' && isSignEventContent(req.content)) {
        kinds.add(req.content.kind)
      }
    })
    return Array.from(kinds).sort((a, b) => a - b)
  }

  const toggleExpanded = (id: string) => {
    const s = new Set(expandedRequests)
    s.has(id) ? s.delete(id) : s.add(id)
    setExpandedRequests(s)
  }

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'sign_event': return <FileSignature className="h-4 w-4" />
      case 'get_public_key': return <Key className="h-4 w-4" />
      case 'nip04_encrypt':
      case 'nip44_encrypt': return <Lock className="h-4 w-4" />
      case 'nip04_decrypt':
      case 'nip44_decrypt': return <Unlock className="h-4 w-4" />
      default: return <Shield className="h-4 w-4" />
    }
  }

  const getMethodDescription = (method: string): string => {
    switch (method) {
      case 'sign_event': return 'Sign a Nostr event'
      case 'get_public_key': return 'Access your public key'
      case 'nip04_encrypt': return 'Encrypt a message (NIP-04)'
      case 'nip44_encrypt': return 'Encrypt a message (NIP-44)'
      case 'nip04_decrypt': return 'Decrypt a message (NIP-04)'
      case 'nip44_decrypt': return 'Decrypt a message (NIP-44)'
      case 'ping': return 'Test connection'
      default: return `Execute ${method}`
    }
  }

  const uniqueKinds = getUniqueEventKinds()

  return (
    <div className="space-y-6">
      {flash && (
        <div role="status" aria-live="polite" className={`${flash.kind === 'success' ? 'bg-green-900/30 text-green-200 border-green-700/30' : 'bg-red-900/30 text-red-200 border-red-700/30'} rounded-md px-3 py-2 text-sm border`}>
          {flash.text}
        </div>
      )}
      {pendingRequests.length > 0 && (
        <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                <span className="text-sm text-blue-300">{pendingRequests.length} pending {pendingRequests.length === 1 ? 'request' : 'requests'}</span>
              </div>
              <div className="flex gap-2">
              <Button onClick={handleApproveAll} size="sm" disabled={bulkAll.approve === 'running'} className={`${bulkAll.approve === 'success' ? 'bg-green-700' : 'bg-green-600'} hover:bg-green-700 text-green-100`}>
                {bulkAll.approve === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                {bulkAll.approve === 'success' ? 'Approved' : bulkAll.approve === 'running' ? 'Approving…' : 'Approve All'}
              </Button>
              <Button onClick={handleDenyAll} size="sm" disabled={bulkAll.deny === 'running'} variant="destructive">
                {bulkAll.deny === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                {bulkAll.deny === 'running' ? 'Denying…' : bulkAll.deny === 'success' ? 'Denied' : 'Deny All'}
              </Button>
              </div>
            </div>

          {uniqueKinds.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-blue-900/20">
              {uniqueKinds.map(kind => {
                const kindCount = pendingRequests.filter(r => r.method === 'sign_event' && isSignEventContent(r.content) && r.content.kind === kind).length
                const state = bulkByKind[kind] || { approve: 'idle', deny: 'idle' }
                return (
                  <div key={kind} className="flex gap-1">
                    <Button onClick={() => handleApproveAllKind(kind)} size="sm" disabled={state.approve === 'running'} className={`${state.approve === 'success' ? 'bg-blue-700' : 'bg-blue-600'} hover:bg-blue-700 text-blue-100 text-xs`}>
                      {state.approve === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      {state.approve === 'success' ? 'Approved' : state.approve === 'running' ? `Approving Kind ${kind}…` : `Approve All Kind ${kind} (${kindCount})`}
                    </Button>
                    <Button onClick={() => handleDenyAllKind(kind)} size="sm" disabled={state.deny === 'running'} className="bg-purple-600 hover:bg-purple-700 text-purple-100 text-xs">
                      {state.deny === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                      {state.deny === 'running' ? `Denying Kind ${kind}…` : `Deny All Kind ${kind}`}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {pendingRequests.length === 0 ? (
        <div className="bg-gray-800/30 border border-blue-900/20 rounded-lg p-8 text-center">
          <Shield className="h-12 w-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No pending permission requests</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingRequests.map((req) => {
            const expanded = expandedRequests.has(req.id)
            const isNoteSig = req.method === 'sign_event' && isSignEventContent(req.content)
            const thisKind = isNoteSig ? (req.content as any).kind as number : undefined
            const sameKindCount = typeof thisKind === 'number' ? pendingRequests.filter(r => r.method === 'sign_event' && isSignEventContent(r.content) && (r.content as any).kind === thisKind).length : 0
            return (
              <div key={req.id} className="bg-gray-800/50 border border-blue-900/30 rounded-lg overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {req.session_origin.image && isValidImageUrl(req.session_origin.image) && (
                        <img src={req.session_origin.image} alt={req.source} className="w-10 h-10 rounded-lg" />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-blue-200">{req.source}</span>
                          <Badge variant={req.deniedReason ? 'destructive' : 'warning'}>{req.deniedReason ? 'Blocked' : 'Pending'}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {getMethodIcon(req.method)}
                          <span>{getMethodDescription(req.method)}</span>
                        </div>
                        {req.deniedReason && (<div className="text-xs text-red-400 font-medium">⚠️ {req.deniedReason}</div>)}
                        <span className="text-xs text-gray-500">{new Date(req.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <button onClick={() => toggleExpanded(req.id)} className="text-blue-400 hover:text-blue-300 p-1">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
                  </div>

                  {expanded && req.content && (
                    <div className="border-t border-blue-900/20 pt-3 space-y-3">
                      {req.request_type === 'note_signature' && isSignEventContent(req.content) && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Event Details:</span>
                          <div className="bg-gray-900/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Kind:</span>
                              <Badge variant="purple">{req.content.kind}</Badge>
                            </div>
                            {req.content.content && (
                              <div className="space-y-1">
                                <span className="text-xs text-gray-500">Content:</span>
                                <p className="text-sm text-blue-100 font-mono bg-gray-900/70 rounded p-2 break-all">{req.content.content}</p>
                              </div>
                            )}
                            {req.content.tags && req.content.tags.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-xs text-gray-500">Tags:</span>
                                <div className="text-xs text-gray-400 font-mono">
                                  {req.content.tags.map((tag: string[], i: number) => (<div key={i}>[{tag.join(', ')}]</div>))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {req.request_type === 'note_signature' && isSignEventError(req.content) && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Event Details (JSON Parse Error):</span>
                          <div className="bg-gray-900/50 rounded-lg p-3 space-y-2">
                            <div className="space-y-1">
                              <span className="text-xs text-gray-500">Raw Content:</span>
                              <p className="text-sm text-red-400 font-mono bg-gray-900/70 rounded p-2 break-all">{req.content.raw}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {req.request_type === 'base' && isBaseRequestContent(req.content) && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Parameters:</span>
                          <div className="bg-gray-900/50 rounded-lg p-3">
                            <pre className="text-xs text-gray-400 font-mono overflow-x-auto">{JSON.stringify(req.content.params, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-gray-900/30 border-t border-blue-900/20 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Shield className="h-3 w-3" />
                    <span>{req.deniedReason ? 'Blocked by policy - update permissions to allow' : 'Requires your approval'}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => handleApprove(req.id)} size="sm" disabled={actionById[req.id] === 'approving' || actionById[req.id] === 'denying'} className={`${actionById[req.id] === 'approved' ? 'bg-green-700' : 'bg-green-600'} hover:bg-green-700 text-green-100`}>
                      {actionById[req.id] === 'approving' ? <Clock className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      {actionById[req.id] === 'approved' ? 'Approved' : actionById[req.id] === 'approving' ? 'Approving...' : 'Approve'}
                    </Button>
                    <Button onClick={() => handleDeny(req.id)} size="sm" disabled={actionById[req.id] === 'approving' || actionById[req.id] === 'denying'} variant="destructive">
                      {actionById[req.id] === 'denying' ? <Clock className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                      {actionById[req.id] === 'denying' ? 'Denying...' : actionById[req.id] === 'denied' ? 'Denied' : 'Deny'}
                    </Button>
                  </div>
                </div>

                {/* Per-request bulk actions */}
                <div className="bg-gray-900/20 border-t border-blue-900/20 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button onClick={handleApproveAll} size="sm" disabled={bulkAll.approve === 'running'} className={`${bulkAll.approve === 'success' ? 'bg-green-700' : 'bg-green-600'} hover:bg-green-700 text-green-100`}>
                      {bulkAll.approve === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      {bulkAll.approve === 'success' ? 'Approved' : bulkAll.approve === 'running' ? 'Approving…' : 'Approve All'}
                    </Button>
                    <Button onClick={handleDenyAll} size="sm" disabled={bulkAll.deny === 'running'} variant="destructive">
                      {bulkAll.deny === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                      {bulkAll.deny === 'running' ? 'Denying…' : bulkAll.deny === 'success' ? 'Denied' : 'Deny All'}
                    </Button>
                  </div>
                  {isNoteSig && sameKindCount > 1 && (
                    <div className="flex gap-2">
                      {(() => { const state = bulkByKind[thisKind!] || { approve: 'idle', deny: 'idle' }; return (
                        <>
                          <Button onClick={() => handleApproveAllKind(thisKind!)} size="sm" disabled={state.approve === 'running'} className={`${state.approve === 'success' ? 'bg-blue-700' : 'bg-blue-600'} hover:bg-blue-700 text-blue-100 text-xs`}>
                            {state.approve === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                            {state.approve === 'success' ? 'Approved' : state.approve === 'running' ? `Approving Kind ${thisKind}…` : `Approve All Kind ${thisKind}`}
                          </Button>
                          <Button onClick={() => handleDenyAllKind(thisKind!)} size="sm" disabled={state.deny === 'running'} className="bg-purple-600 hover:bg-purple-700 text-purple-100 text-xs">
                            {state.deny === 'running' ? <Clock className="h-4 w-4 mr-1" /> : <X className="h-4 w-4 mr-1" />}
                            {state.deny === 'running' ? `Denying Kind ${thisKind}…` : `Deny All Kind ${thisKind}`}
                          </Button>
                        </>
                      )})()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
