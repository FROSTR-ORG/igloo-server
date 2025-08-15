import React, { useState, useEffect } from 'react'
import { SignerSession, PermissionPolicy } from './types'
import { NIP46Controller } from './controller'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { Alert } from '../ui/alert'
import { cn } from '../../lib/utils'
import { Copy, ExternalLink, Shield, Eye, EyeOff, Trash2, QrCode } from 'lucide-react'

interface SessionsProps {
  controller: NIP46Controller | null
}

export function Sessions({ controller }: SessionsProps) {
  const [activeSessions, setActiveSessions] = useState<SignerSession[]>([])
  const [pendingSessions, setPendingSessions] = useState<SignerSession[]>([])
  const [connectString, setConnectString] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expandedPermissions, setExpandedPermissions] = useState<Set<string>>(new Set())
  const [editingPermissions, setEditingPermissions] = useState<Record<string, PermissionPolicy>>({})
  const [copiedPubkey, setCopiedPubkey] = useState<string | null>(null)
  const [showQRInput, setShowQRInput] = useState(false)

  useEffect(() => {
    if (!controller) return

    const updateSessions = () => {
      setActiveSessions(controller.getActiveSessions())
      setPendingSessions(controller.getPendingSessions())
    }

    updateSessions()

    controller.on('session:new', updateSessions)
    controller.on('session:updated', updateSessions)
    controller.on('session:revoked', updateSessions)

    return () => {
      controller.off('session:new', updateSessions)
      controller.off('session:updated', updateSessions)
      controller.off('session:revoked', updateSessions)
    }
  }, [controller])


  const handleConnect = async () => {
    if (!controller || !connectString) {
      console.log('[Sessions] Cannot connect - missing controller or connection string')
      return
    }

    console.log('[Sessions] Attempting to connect with string:', connectString)
    try {
      setError(null)
      await controller.connectToClient(connectString)
      setConnectString('')
      console.log('[Sessions] Connection initiated successfully')
    } catch (err) {
      console.error('[Sessions] Connection failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to connect')
    }
  }

  const handleRevokeSession = (pubkey: string) => {
    if (!controller) return
    controller.revokeSession(pubkey)
  }

  const togglePermissions = (pubkey: string) => {
    const newExpanded = new Set(expandedPermissions)
    if (newExpanded.has(pubkey)) {
      newExpanded.delete(pubkey)
      delete editingPermissions[pubkey]
    } else {
      newExpanded.add(pubkey)
      const session = [...activeSessions, ...pendingSessions].find(s => s.pubkey === pubkey)
      if (session) {
        setEditingPermissions(prev => ({
          ...prev,
          [pubkey]: { ...(session.policy || {}) }
        }))
      }
    }
    setExpandedPermissions(newExpanded)
  }

  const handleUpdatePermissions = (pubkey: string) => {
    if (!controller) return
    const permissions = editingPermissions[pubkey]
    if (permissions) {
      controller.updateSession(pubkey, permissions)
      togglePermissions(pubkey)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPubkey(text)
    setTimeout(() => setCopiedPubkey(null), 2000)
  }

  const allSessions = [
    ...activeSessions.map(s => ({ ...s, status: 'active' as const })),
    ...pendingSessions.map(s => ({ ...s, status: 'pending' as const }))
  ]

  return (
    <div className="space-y-6">
      {/* Connection Input */}
      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-300 mb-3">Connect to Client</h3>
        <div className="flex gap-2">
          <Input
            value={connectString}
            onChange={(e) => setConnectString(e.target.value)}
            placeholder="Paste nostrconnect:// string here"
            className="bg-gray-900/50 border-blue-900/30 text-blue-100"
          />
          <Button
            onClick={handleConnect}
            className="bg-blue-600 hover:bg-blue-700 text-blue-100"
          >
            Connect
          </Button>
        </div>
        {error && (
          <Alert variant="error" className="mt-3">
            {error}
          </Alert>
        )}
      </div>


      {/* Sessions List */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-blue-300">Active Sessions</h3>
        
        {allSessions.length === 0 ? (
          <div className="bg-gray-800/30 border border-blue-900/20 rounded-lg p-8 text-center">
            <p className="text-gray-400">No active sessions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allSessions.map((session) => {
              const truncatedPubkey = session.pubkey.slice(0, 12) + '...' + session.pubkey.slice(-12)
              const isExpanded = expandedPermissions.has(session.pubkey)
              
              return (
                <div
                  key={session.pubkey}
                  className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4 space-y-3"
                >
                  {/* Session Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {session.profile.image && (
                        <img
                          src={session.profile.image}
                          alt={session.profile.name || 'App'}
                          className="w-10 h-10 rounded-lg"
                        />
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-blue-200">
                            {session.profile.name || 'Unknown App'}
                          </span>
                          <Badge variant={session.status === 'active' ? 'success' : 'warning'}>
                            {session.status}
                          </Badge>
                        </div>
                        {session.profile.url && (
                          <a
                            href={session.profile.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            {new URL(session.profile.url).hostname}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 font-mono">
                            {truncatedPubkey}
                          </span>
                          <button
                            onClick={() => copyToClipboard(session.pubkey)}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            {copiedPubkey === session.pubkey ? (
                              <span className="text-xs text-green-400">✓</span>
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">
                          Connected: {new Date(session.created_at * 1000).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => togglePermissions(session.pubkey)}
                        variant="ghost"
                        size="sm"
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
                      >
                        {isExpanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        onClick={() => handleRevokeSession(session.pubkey)}
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Permissions (Expanded) */}
                  {isExpanded && (
                    <div className="border-t border-blue-900/20 pt-3 space-y-3">
                      <div className="flex items-center gap-2 text-sm text-blue-300">
                        <Shield className="h-4 w-4" />
                        <span className="font-medium">Permissions</span>
                      </div>
                      
                      {/* Methods */}
                      <div className="space-y-2">
                        <span className="text-xs text-gray-400">Allowed Methods:</span>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(editingPermissions[session.pubkey]?.methods || {})
                            .filter(([_, allowed]) => allowed)
                            .map(([method]) => (
                              <Badge key={method} variant="info">
                                {method}
                              </Badge>
                            ))}
                        </div>
                      </div>

                      {/* Event Kinds */}
                      {editingPermissions[session.pubkey]?.kinds && (
                        <div className="space-y-2">
                          <span className="text-xs text-gray-400">Allowed Event Kinds:</span>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(editingPermissions[session.pubkey]?.kinds || {})
                              .filter(([_, allowed]) => allowed)
                              .map(([kind]) => (
                                <Badge key={kind} variant="purple">
                                  Kind {kind}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      )}

                      <Button
                        onClick={() => handleUpdatePermissions(session.pubkey)}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-blue-100"
                      >
                        Update Permissions
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}