import React, { useState, useEffect } from 'react'
import { SignerSession, PermissionPolicy } from './types'
import { NIP46Controller } from './controller'
import { PermissionsDropdown } from './Permissions'
import { QRScanner } from './QRScanner'
import { isValidImageUrl } from './utils'
import { QrCode } from 'lucide-react'
import { Input } from '../ui/input'

interface SessionsProps { controller: NIP46Controller | null }

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
  const [history, setHistory] = useState<Record<string, { recent_kinds?: string[]; recent_methods?: string[]; last_active_at?: string; status?: string }>>({})

  useEffect(() => {
    if (!controller) return
    let lastA = 0, lastP = 0
    const update = () => {
      const a = controller.getActiveSessions()
      const p = controller.getPendingSessions()
      if (a.length !== lastA || p.length !== lastP) { lastA = a.length; lastP = p.length }
      setActiveSessions(a)
      setPendingSessions(p)
    }
    update()
    controller.on('session:active', update)
    controller.on('session:pending', update)
    controller.on('session:updated', update)
    return () => {
      controller.off('session:active', update)
      controller.off('session:pending', update)
      controller.off('session:updated', update)
    }
  }, [controller])

  // Fetch compact session history: last_active, recent approvals, revoked list
  async function fetchHistory() {
    try {
      const res = await fetch('/api/nip46/history', { headers: { 'Content-Type': 'application/json' } })
      if (!res.ok) return
      const data = await res.json()
      const sessions: any[] = Array.isArray(data.sessions) ? data.sessions : []
      const map: Record<string, any> = {}
      for (const s of sessions) {
        map[s.pubkey] = { recent_kinds: s.recent_kinds, recent_methods: s.recent_methods, last_active_at: s.last_active_at, status: s.status }
      }
      setHistory(map)
    } catch {}
  }

  useEffect(() => {
    fetchHistory()
    if (!controller) return
    const refresh = () => fetchHistory()
    controller.on('session:active', refresh)
    controller.on('session:updated', refresh)
    return () => {
      controller.off('session:active', refresh)
      controller.off('session:updated', refresh)
    }
  }, [controller])

  const handleConnect = async () => {
    if (!controller || !connectString) return
    try { setError(null); await controller.connectToClient(connectString); setConnectString('') } catch (err: any) { setError(err?.message || 'Failed to connect') }
  }
  const handleRevokeSession = (pubkey: string) => controller?.revokeSession(pubkey)

  const togglePermissionsDropdown = (pubkey: string) => {
    const s = new Set(expandedPermissions)
    if (s.has(pubkey)) {
      s.delete(pubkey)
      const e = { ...editingPermissions }; delete e[pubkey]; setEditingPermissions(e)
      const n = { ...newEventKind }; delete n[pubkey]; setNewEventKind(n)
    } else {
      s.add(pubkey)
      const session = [...activeSessions, ...pendingSessions].find(s => s.pubkey === pubkey)
      if (session) setEditingPermissions(prev => ({ ...prev, [pubkey]: { ...(session.policy || { methods: {}, kinds: {} }) } }))
    }
    setExpandedPermissions(s)
  }

  const handlePermissionChange = (pubkey: string, permissions: PermissionPolicy) => {
    setEditingPermissions(prev => ({ ...prev, [pubkey]: permissions }))
  }
  const handleEventKindChange = (pubkey: string, kind: string) => setNewEventKind(prev => ({ ...prev, [pubkey]: kind }))
  const handleUpdateSession = async (pubkey: string) => {
    const session = [...activeSessions, ...pendingSessions].find(s => s.pubkey === pubkey)
    if (!controller || !session) return
    const updated = editingPermissions[pubkey] || { methods: {}, kinds: {} }
    controller.updateSession(pubkey, updated)
    const s = new Set(expandedPermissions); s.delete(pubkey); setExpandedPermissions(s)
    const e = { ...editingPermissions }; delete e[pubkey]; setEditingPermissions(e)
    const n = { ...newEventKind }; delete n[pubkey]; setNewEventKind(n)
  }

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); setCopiedPubkey(text); setTimeout(() => setCopiedPubkey(null), 2000) }
  const handleScanResult = (result: string) => { setConnectString(result); setIsScanning(false) }

  const allSessions = [
    ...activeSessions.map(s => ({ ...s, status: 'active' as const })),
    ...pendingSessions.map(s => ({ ...s, status: 'pending' as const }))
  ].filter(s => /^[0-9a-f]{64}$/i.test(s.pubkey))

  return (
    <div className="sessions-container">
      <h2 className="text-lg font-semibold text-blue-300 mb-4">Client Sessions</h2>

      <div className="sessions-section">
        {allSessions.length === 0 ? (
          <p className="session-empty">No sessions</p>
        ) : (
          <div className="sessions-list">
            {allSessions.map((session) => {
              const truncated = session.pubkey.slice(0, 12) + '...' + session.pubkey.slice(-12)
              return (
                <div key={session.pubkey} className="session-card">
                  <span className={`session-badge ${session.status}`}>{session.status}</span>
                  <div className="session-header">
                    <div className="session-info">
                      <div className="session-name-container">
                        {session.profile.image && isValidImageUrl(session.profile.image) && (
                          <img src={session.profile.image} alt={`${session.profile.name || 'Unknown'} icon`} className="session-icon" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        )}
                        <span className="session-name">{session.profile.name ?? 'Unknown'}</span>
                      </div>
                      {session.profile.url && (
                        <a href={session.profile.url} target="_blank" rel="noopener noreferrer" className="session-url">{new URL(session.profile.url).hostname}</a>
                      )}
                      <div className="session-pubkey-container">
                        <span className="session-pubkey">{truncated}</span>
                        <button onClick={() => copyToClipboard(session.pubkey)} className="copy-pubkey-btn" title="Copy full public key">
                          {copiedPubkey === session.pubkey ? '✓' : '📋'}
                        </button>
                      </div>
                      <span className="session-created">Created: {new Date(session.created_at * 1000).toLocaleString()}</span>
                      {history[session.pubkey]?.last_active_at && (
                        <span className="session-created">Last Active: {new Date(history[session.pubkey]!.last_active_at!).toLocaleString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="session-permissions-toggle">
                    <button onClick={() => togglePermissionsDropdown(session.pubkey)} className="session-permissions-btn">
                      {expandedPermissions.has(session.pubkey) ? 'Hide' : 'Show'} Permissions
                    </button>
                  </div>

                  {(history[session.pubkey]?.recent_kinds?.length || history[session.pubkey]?.recent_methods?.length) && (
                    <div className="mt-2 text-xs text-gray-400">
                      {history[session.pubkey]?.recent_kinds?.length ? (
                        <div>
                          <span className="text-gray-500 mr-1">Recent kinds approved:</span>
                          {history[session.pubkey]!.recent_kinds!.map((k: string) => (
                            <span key={k} className="inline-block bg-purple-900/40 text-purple-200 rounded px-1.5 py-0.5 mr-1">{k}</span>
                          ))}
                        </div>
                      ) : null}
                      {history[session.pubkey]?.recent_methods?.length ? (
                        <div className="mt-1">
                          <span className="text-gray-500 mr-1">Recent methods:</span>
                          {history[session.pubkey]!.recent_methods!.map((m: string) => (
                            <span key={m} className="inline-block bg-blue-900/40 text-blue-200 rounded px-1.5 py-0.5 mr-1">{m}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {expandedPermissions.has(session.pubkey) && (
                    <PermissionsDropdown
                      session={session}
                      editingPermissions={editingPermissions[session.pubkey] || session.policy || { methods: {}, kinds: {}}}
                      newEventKind={newEventKind[session.pubkey] || ''}
                      onPermissionChange={(p) => handlePermissionChange(session.pubkey, p)}
                      onEventKindChange={(k) => handleEventKindChange(session.pubkey, k)}
                      onUpdateSession={() => handleUpdateSession(session.pubkey)}
                    />
                  )}

                  <div className="session-card-actions-bottom">
                    <button onClick={() => handleRevokeSession(session.pubkey)} className="session-revoke-btn">Revoke</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sessions-section">
        <div className="session-input-row">
          <Input type="text" value={connectString} onChange={(e) => setConnectString(e.target.value)} placeholder="Paste nostrconnect:// string here" className="session-input bg-gray-900/60 border-blue-900/30" />
          <button onClick={() => setIsScanning(true)} className="qr-scan-btn" disabled={isScanning} title="Scan QR Code">
            <QrCode className="h-5 w-5 text-blue-200" />
          </button>
        </div>
        <button onClick={handleConnect} className="session-btn-primary">Connect</button>
        {error && <p className="session-error">{error}</p>}

        {isScanning && (
          <div className="scanner-modal">
            <div className="scanner-overlay" onClick={() => setIsScanning(false)} />
            <div className="scanner-container-modal">
              <QRScanner
                onResult={(r) => handleScanResult(r)}
                onError={(e) => { console.error('QR scan error:', e); setError(e.message) }}
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

      {/* Revoked sessions are not persisted anymore; no separate section */}
    </div>
  )
}
