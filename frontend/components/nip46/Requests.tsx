import React, { useState, useEffect } from 'react'
import { PermissionRequest, NIP46Request } from './types'
import { NIP46Controller } from './controller'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Check, X, ChevronDown, ChevronUp, Clock, Shield, FileSignature, Key, Lock, Unlock } from 'lucide-react'

interface RequestsProps { controller: NIP46Controller | null }

function transformRequest(req: PermissionRequest): NIP46Request {
  const request_type = req.method === 'sign_event' ? 'note_signature' : 'base'
  let content: any
  if (req.params?.length) {
    if (req.method === 'sign_event') {
      try { content = JSON.parse(req.params[0]) } catch { content = req.params[0] }
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

  const handleApprove = (id: string) => controller?.approveRequest(id)
  const handleDeny = (id: string) => controller?.denyRequest(id, 'Denied by user')

  const handleApproveAll = () => pendingRequests.forEach(r => controller?.approveRequest(r.id))
  const handleDenyAll = () => pendingRequests.forEach(r => controller?.denyRequest(r.id, 'Denied by user'))

  const getUniqueEventKinds = (): number[] => {
    const kinds = new Set<number>()
    pendingRequests.forEach(req => { if (req.method === 'sign_event' && req.content?.kind !== undefined) kinds.add(req.content.kind) })
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
      {pendingRequests.length > 0 && (
        <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-blue-300">{pendingRequests.length} pending {pendingRequests.length === 1 ? 'request' : 'requests'}</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleApproveAll} size="sm" className="bg-green-600 hover:bg-green-700 text-green-100">Approve All</Button>
              <Button onClick={handleDenyAll} size="sm" variant="destructive">Deny All</Button>
            </div>
          </div>

          {uniqueKinds.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-blue-900/20">
              {uniqueKinds.map(kind => {
                const kindCount = pendingRequests.filter(r => r.method === 'sign_event' && r.content?.kind === kind).length
                return (
                  <div key={kind} className="flex gap-1">
                    <Button onClick={() => pendingRequests.forEach(r => r.method === 'sign_event' && r.content?.kind === kind && controller?.approveRequest(r.id))} size="sm" className="bg-blue-600 hover:bg-blue-700 text-blue-100 text-xs">Approve All Kind {kind} ({kindCount})</Button>
                    <Button onClick={() => pendingRequests.forEach(r => r.method === 'sign_event' && r.content?.kind === kind && controller?.denyRequest(r.id, 'Denied by user'))} size="sm" className="bg-purple-600 hover:bg-purple-700 text-purple-100 text-xs">Deny All Kind {kind}</Button>
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
            return (
              <div key={req.id} className="bg-gray-800/50 border border-blue-900/30 rounded-lg overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {req.session_origin.image && <img src={req.session_origin.image} alt={req.source} className="w-10 h-10 rounded-lg" />}
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
                      {req.request_type === 'note_signature' && (
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

                      {req.request_type === 'base' && req.content.params && (
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
                    <Button onClick={() => handleApprove(req.id)} size="sm" className="bg-green-600 hover:bg-green-700 text-green-100"><Check className="h-4 w-4 mr-1" />Approve</Button>
                    <Button onClick={() => handleDeny(req.id)} size="sm" variant="destructive"><X className="h-4 w-4 mr-1" />Deny</Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

