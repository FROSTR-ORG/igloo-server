import React, { useState, useEffect } from 'react'
import { SignerSession, PermissionPolicy } from './types'
import { NIP46Controller } from './controller'
import { PermissionsDropdown } from './Permissions'
import { QRScanner } from './QRScanner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { Alert } from '../ui/alert'
import { cn } from '../../lib/utils'
import { Copy, ExternalLink, Shield, Eye, EyeOff, Trash2, QrCode } from 'lucide-react'
import '../../styles/nip46.css'

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
  const [newEventKind, setNewEventKind] = useState<Record<string, string>>({})
  const [isScanning, setIsScanning] = useState(false)

  useEffect(() => {
    if (!controller) return

    let lastActiveCount = 0
    let lastPendingCount = 0

    const updateSessions = () => {
      const active = controller.getActiveSessions()
      const pending = controller.getPendingSessions()
      
      // Only log when there's an actual change
      if (active.length !== lastActiveCount || pending.length !== lastPendingCount) {
        console.log('[Sessions] Sessions changed - Active:', active.length, 'Pending:', pending.length)
        lastActiveCount = active.length
        lastPendingCount = pending.length
      }
      
      setActiveSessions(active)
      setPendingSessions(pending)
    }

    // Initial update
    updateSessions()

    // Listen for the events that the controller actually emits
    controller.on('session:active', updateSessions)
    controller.on('session:pending', updateSessions)
    controller.on('session:updated', updateSessions)

    // No polling needed - events should be sufficient

    return () => {
      controller.off('session:active', updateSessions)
      controller.off('session:pending', updateSessions)
      controller.off('session:updated', updateSessions)
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

  const togglePermissionsDropdown = (pubkey: string) => {
    const newExpanded = new Set(expandedPermissions)
    if (newExpanded.has(pubkey)) {
      newExpanded.delete(pubkey)
      // Clear editing state when closing
      const newEditing = { ...editingPermissions }
      delete newEditing[pubkey]
      setEditingPermissions(newEditing)
      // Clear new event kind input
      const newEventKinds = { ...newEventKind }
      delete newEventKinds[pubkey]
      setNewEventKind(newEventKinds)
    } else {
      newExpanded.add(pubkey)
      // Initialize editing state with current permissions
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

  const handlePermissionChange = (pubkey: string, permissions: PermissionPolicy) => {
    setEditingPermissions(prev => ({
      ...prev,
      [pubkey]: permissions
    }))
  }

  const handleEventKindChange = (pubkey: string, eventKind: string) => {
    setNewEventKind(prev => ({ ...prev, [pubkey]: eventKind }))
  }

  const handleUpdateSession = async (pubkey: string) => {
    if (!controller) return
    
    try {
      const session = [...activeSessions, ...pendingSessions].find(s => s.pubkey === pubkey)
      if (!session) return

      const updatedPolicy = editingPermissions[pubkey] || {}
      controller.updateSession(pubkey, updatedPolicy)
      
      // Close the dropdown after successful update
      const newExpanded = new Set(expandedPermissions)
      newExpanded.delete(pubkey)
      setExpandedPermissions(newExpanded)
      
      // Clear editing state
      const newEditing = { ...editingPermissions }
      delete newEditing[pubkey]
      setEditingPermissions(newEditing)
      
      // Clear new event kind input
      const newEventKinds = { ...newEventKind }
      delete newEventKinds[pubkey]
      setNewEventKind(newEventKinds)
    } catch (err) {
      console.error('Failed to update session:', err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPubkey(text)
    setTimeout(() => setCopiedPubkey(null), 2000)
  }

  const handleScanResult = (result: string) => {
    setConnectString(result)
    setIsScanning(false)
  }

  // Combine active and pending sessions
  const allSessions = [
    ...activeSessions.map(s => ({ ...s, status: 'active' as const })),
    ...pendingSessions.map(s => ({ ...s, status: 'pending' as const }))
  ]

  return (
    <div className="sessions-container">
      <h2 className="text-lg font-semibold text-blue-300 mb-4">Client Sessions</h2>


      {/* Combined Active and Pending Sessions */}
      <div className="sessions-section">
        {allSessions.length === 0 ? (
          <p className="session-empty">No sessions</p>
        ) : (
          <div className="sessions-list">
            {allSessions.map((session) => {
              const truncatedPubkey = session.pubkey.slice(0, 12) + '...' + session.pubkey.slice(-12)
              
              return (
                <div key={session.pubkey} className="session-card">
                  {/* Badge in top-right */}
                  <span className={`session-badge ${session.status}`}>{session.status}</span>
                  <div className="session-header">
                    <div className="session-info">
                      <div className="session-name-container">
                        {session.profile.image && (
                          <img 
                            src={session.profile.image} 
                            alt={`${session.profile.name || 'Unknown'} icon`}
                            className="session-icon"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        )}
                        <span className="session-name">{session.profile.name ?? 'Unknown'}</span>
                      </div>
                      {session.profile.url && (
                        <a 
                          href={session.profile.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="session-url"
                        >
                          {new URL(session.profile.url).hostname}
                        </a>
                      )}
                      <div className="session-pubkey-container">
                        <span className="session-pubkey">{truncatedPubkey}</span>
                        <button
                          onClick={() => copyToClipboard(session.pubkey)}
                          className="copy-pubkey-btn"
                          title="Copy full public key"
                        >
                          {copiedPubkey === session.pubkey ? '✓' : '📋'}
                        </button>
                      </div>
                      <span className="session-created">Created: {new Date(session.created_at * 1000).toLocaleString()}</span>
                    </div>
                  </div>
                  {/* Permissions Toggle */}
                  <div className="session-permissions-toggle">
                    <button
                      onClick={() => togglePermissionsDropdown(session.pubkey)}
                      className="session-permissions-btn"
                    >
                      {expandedPermissions.has(session.pubkey) ? 'Hide' : 'Show'} Permissions
                    </button>
                  </div>
                  {/* Permissions Dropdown */}
                  {expandedPermissions.has(session.pubkey) && (
                    <PermissionsDropdown
                      session={session}
                      editingPermissions={editingPermissions[session.pubkey] || session.policy || {}}
                      newEventKind={newEventKind[session.pubkey] || ''}
                      onPermissionChange={(permissions) => handlePermissionChange(session.pubkey, permissions)}
                      onEventKindChange={(eventKind) => handleEventKindChange(session.pubkey, eventKind)}
                      onUpdateSession={() => handleUpdateSession(session.pubkey)}
                    />
                  )}
                  {/* Revoke button in bottom-right */}
                  <div className="session-card-actions-bottom">
                    <button
                      onClick={() => handleRevokeSession(session.pubkey)}
                      className="session-revoke-btn"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Register Session */}
      <div className="sessions-section">
        <div className="session-input-row">
          <input
            type="text"
            value={connectString}
            onChange={(e) => setConnectString(e.target.value)}
            placeholder="Paste nostrconnect:// string here"
            className="session-input"
          />
          <button
            onClick={() => setIsScanning(true)}
            className="qr-scan-btn"
            disabled={isScanning}
            title="Scan QR Code"
          >
            <QrCode className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={handleConnect}
          className="session-btn-primary"
        >
          Connect
        </button>
        {error && <p className="session-error">{error}</p>}
        
        {isScanning && (
          <div className="scanner-modal">
            <div className="scanner-overlay" onClick={() => setIsScanning(false)} />
            <div className="scanner-container-modal">
              <QRScanner
                onResult={handleScanResult}
                onError={(error: Error) => {
                  console.error('QR scan error:', error)
                  setError(error.message)
                }}
              />
              <div className="qr-reticule">
                <div className="qr-corner qr-corner-tl"></div>
                <div className="qr-corner qr-corner-tr"></div>
                <div className="qr-corner qr-corner-bl"></div>
                <div className="qr-corner qr-corner-br"></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}