import React, { useState, useEffect } from 'react'
import { PermissionRequest, NIP46Request } from './types'
import { NIP46Controller } from './controller'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Alert } from '../ui/alert'
import { cn } from '../../lib/utils'
import { Check, X, ChevronDown, ChevronUp, Clock, Shield, FileSignature, Key, Lock, Unlock } from 'lucide-react'

interface RequestsProps {
  controller: NIP46Controller | null
}

function transformRequest(req: PermissionRequest): NIP46Request {
  const request_type = req.method === 'sign_event' ? 'note_signature' : 'base'
  
  let content: any = undefined
  if (req.params && req.params.length > 0) {
    if (req.method === 'sign_event') {
      try {
        content = JSON.parse(req.params[0])
      } catch {
        content = req.params[0]
      }
    } else {
      content = { params: req.params }
    }
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
    status: 'pending'
  }
}

export function Requests({ controller }: RequestsProps) {
  const [pendingRequests, setPendingRequests] = useState<NIP46Request[]>([])
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!controller) return

    const updateRequests = () => {
      const rawRequests = controller.getPendingRequests()
      setPendingRequests(rawRequests.map(transformRequest))
    }

    updateRequests()

    controller.on('request:new', updateRequests)
    controller.on('request:approved', updateRequests)
    controller.on('request:denied', updateRequests)

    return () => {
      controller.off('request:new', updateRequests)
      controller.off('request:approved', updateRequests)
      controller.off('request:denied', updateRequests)
    }
  }, [controller])

  const handleApprove = (requestId: string) => {
    if (!controller) return
    controller.approveRequest(requestId)
  }

  const handleDeny = (requestId: string) => {
    if (!controller) return
    controller.denyRequest(requestId, 'Denied by user')
  }

  const handleApproveAll = () => {
    if (!controller) return
    pendingRequests.forEach(req => {
      controller.approveRequest(req.id)
    })
  }

  const handleDenyAll = () => {
    if (!controller) return
    pendingRequests.forEach(req => {
      controller.denyRequest(req.id, 'Denied by user')
    })
  }

  const toggleExpanded = (requestId: string) => {
    const newExpanded = new Set(expandedRequests)
    if (newExpanded.has(requestId)) {
      newExpanded.delete(requestId)
    } else {
      newExpanded.add(requestId)
    }
    setExpandedRequests(newExpanded)
  }

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'sign_event':
        return <FileSignature className="h-4 w-4" />
      case 'get_public_key':
        return <Key className="h-4 w-4" />
      case 'nip04_encrypt':
      case 'nip44_encrypt':
        return <Lock className="h-4 w-4" />
      case 'nip04_decrypt':
      case 'nip44_decrypt':
        return <Unlock className="h-4 w-4" />
      default:
        return <Shield className="h-4 w-4" />
    }
  }

  const getMethodDescription = (method: string): string => {
    switch (method) {
      case 'sign_event':
        return 'Sign a Nostr event'
      case 'get_public_key':
        return 'Access your public key'
      case 'nip04_encrypt':
        return 'Encrypt a message (NIP-04)'
      case 'nip44_encrypt':
        return 'Encrypt a message (NIP-44)'
      case 'nip04_decrypt':
        return 'Decrypt a message (NIP-04)'
      case 'nip44_decrypt':
        return 'Decrypt a message (NIP-44)'
      case 'ping':
        return 'Test connection'
      default:
        return `Execute ${method}`
    }
  }

  return (
    <div className="space-y-6">
      {/* Bulk Actions */}
      {pendingRequests.length > 0 && (
        <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-blue-300">
                {pendingRequests.length} pending {pendingRequests.length === 1 ? 'request' : 'requests'}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleApproveAll}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-green-100"
              >
                Approve All
              </Button>
              <Button
                onClick={handleDenyAll}
                size="sm"
                variant="destructive"
              >
                Deny All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Requests List */}
      {pendingRequests.length === 0 ? (
        <div className="bg-gray-800/30 border border-blue-900/20 rounded-lg p-8 text-center">
          <Shield className="h-12 w-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No pending permission requests</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingRequests.map((request) => {
            const isExpanded = expandedRequests.has(request.id)
            
            return (
              <div
                key={request.id}
                className="bg-gray-800/50 border border-blue-900/30 rounded-lg overflow-hidden"
              >
                {/* Request Header */}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {request.session_origin.image && (
                        <img
                          src={request.session_origin.image}
                          alt={request.source}
                          className="w-10 h-10 rounded-lg"
                        />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-blue-200">
                            {request.source}
                          </span>
                          <Badge variant="warning">
                            Pending
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {getMethodIcon(request.method)}
                          <span>{getMethodDescription(request.method)}</span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(request.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => toggleExpanded(request.id)}
                      className="text-blue-400 hover:text-blue-300 p-1"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && request.content && (
                    <div className="border-t border-blue-900/20 pt-3 space-y-3">
                      {request.request_type === 'note_signature' && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Event Details:</span>
                          <div className="bg-gray-900/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Kind:</span>
                              <Badge variant="purple">
                                {request.content.kind}
                              </Badge>
                            </div>
                            {request.content.content && (
                              <div className="space-y-1">
                                <span className="text-xs text-gray-500">Content:</span>
                                <p className="text-sm text-blue-100 font-mono bg-gray-900/70 rounded p-2 break-all">
                                  {request.content.content}
                                </p>
                              </div>
                            )}
                            {request.content.tags && request.content.tags.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-xs text-gray-500">Tags:</span>
                                <div className="text-xs text-gray-400 font-mono">
                                  {request.content.tags.map((tag: string[], i: number) => (
                                    <div key={i}>[{tag.join(', ')}]</div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {request.request_type === 'base' && request.content.params && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Parameters:</span>
                          <div className="bg-gray-900/50 rounded-lg p-3">
                            <pre className="text-xs text-gray-400 font-mono overflow-x-auto">
                              {JSON.stringify(request.content.params, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="bg-gray-900/30 border-t border-blue-900/20 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Shield className="h-3 w-3" />
                    <span>Requires your approval</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleApprove(request.id)}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-green-100"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      onClick={() => handleDeny(request.id)}
                      size="sm"
                      variant="destructive"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Deny
                    </Button>
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