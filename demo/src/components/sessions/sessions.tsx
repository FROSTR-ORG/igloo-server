import { useState, useEffect } from 'react'
import '@/styles/sessions.css'

import { PermissionPolicy, SignerSession } from '@/types/index.js'
import { InviteEncoder } from '@/index.js'
import { useClientCtx }  from '@/demo/context/client.js'
import { PermissionsDropdown } from './permissions.js'
import { QRScanner } from '@/demo/components/util/scanner.js'

export function SessionsView () {
  const ctx = useClientCtx()

  const [activeSessions, setActiveSessions]   = useState<SignerSession[]>([])
  const [pendingSessions, setPendingSessions] = useState<SignerSession[]>([])
  const [connectString, setConnectString]     = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expandedPermissions, setExpandedPermissions] = useState<Set<string>>(new Set())
  const [editingPermissions, setEditingPermissions] = useState<Record<string, PermissionPolicy>>({})
  const [newEventKind, setNewEventKind] = useState<Record<string, string>>({})
  const [copiedPubkey, setCopiedPubkey] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState<boolean>(false)

  // Update sessions when they change
  useEffect(() => {
    const updateSessions = () => {
      // Add null check for ctx.client and ctx.client.session
      if (!ctx.client || !ctx.client.session) {
        setActiveSessions([])
        setPendingSessions([])
        return
      }
      
      setActiveSessions(ctx.client.session.active   || [])
      setPendingSessions(ctx.client.session.pending || [])
    }

    // Initial update
    updateSessions()

    // Listen for session changes only if client and session exist
    if (ctx.client && ctx.client.session) {
      ctx.client.session.on('activated', updateSessions)
      ctx.client.session.on('pending',   updateSessions)
      ctx.client.session.on('updated',   updateSessions)
      ctx.client.session.on('revoked',   updateSessions)

      return () => {
        // Add null check in cleanup too
        if (ctx.client && ctx.client.session) {
          ctx.client.session.off('activated', updateSessions)
          ctx.client.session.off('pending',   updateSessions)
          ctx.client.session.off('updated',   updateSessions)
          ctx.client.session.off('revoked',   updateSessions)
        }
      }
    }
  }, [ctx.client])

  const handleRevokeSession = (pubkey: string) => {
    if (!ctx.client || !ctx.client.session) return
    ctx.client.session.revoke(pubkey)
  }

  const handleActivateSession = async () => {
    if (!ctx.client || !ctx.client.session) return
    
    try {
      setError(null)
      const token = InviteEncoder.decode(connectString)
      await ctx.client.session.join(token)
      setConnectString('')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to activate session')
    }
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
    if (!ctx.client || !ctx.client.session) return
    
    try {
      const session = [...activeSessions, ...pendingSessions].find(s => s.pubkey === pubkey)
      if (!session) return

      const updatedSession = {
        ...session,
        policy: editingPermissions[pubkey] || {}
      }

      ctx.client.session.update(updatedSession)
      
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
    setTimeout(() => setCopiedPubkey(null), 2000) // Reset after 2 seconds
  }

  // Show locked state if client is locked
  if (ctx.status === 'locked') {
    return (
      <div className="sessions-container">
        <h2 className="section-header">Client Sessions</h2>
        <p className="session-error">🔒 Please unlock your client to view and manage sessions</p>
      </div>
    )
  }

  // Show loading state if client is null but not locked
  if (!ctx.client) {
    return (
      <div className="sessions-container">
        <h2 className="section-header">Client Sessions</h2>
        <p className="session-empty">Loading...</p>
      </div>
    )
  }

  // Combine active and pending sessions
  const allSessions = [
    ...activeSessions.map(s => ({ ...s, status: 'active' as const })),
    ...pendingSessions.map(s => ({ ...s, status: 'pending' as const }))
  ]

  return (
    <div className="sessions-container">
      <h2 className="section-header">Client Sessions</h2>

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
                          />
                        )}
                        <span className="session-name">{session.profile.name ?? 'unknown'}</span>
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
                  {/* Revoke/Cancel button in bottom-right */}
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
            <img 
              src="/qrcode.png" 
              alt="QR Code" 
              className="qr-icon"
            />
          </button>
        </div>
        <button
          onClick={handleActivateSession}
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
                onResult={(result: string) => {
                  setConnectString(result.trim())
                  setIsScanning(false)
                }}
                onError={(error: Error) => {
                  console.error('QR scan error:', error)
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