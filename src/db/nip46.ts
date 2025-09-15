import db from './database.js'
import { runMigrations } from './migrator.js'

// Types for persisted NIP-46 sessions
export type Nip46Status = 'pending' | 'active' | 'revoked'

export interface Nip46Policy {
  methods?: Record<string, boolean>
  kinds?: Record<string, boolean>
}

export interface Nip46Profile {
  name?: string
  url?: string
  image?: string
}

export interface Nip46Session {
  id: number
  user_id: number | bigint
  client_pubkey: string
  status: Nip46Status
  profile: Nip46Profile
  relays: string[] | null
  policy: Nip46Policy
  created_at: string
  updated_at: string
  last_active_at: string | null
}

// Initialize function to run migrations on demand (avoids side effects on import)
let initializationPromise: Promise<void> | null = null

export async function initializeNip46DB(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      // runMigrations is synchronous, returns array of applied migrations
      const applied = runMigrations('src/db/migrations')
      if (applied.length > 0) {
        console.log(`[nip46] Applied ${applied.length} migration(s):`, applied.join(', '))
      }
    })
  }
  return initializationPromise
}

function rowToSession(row: any): Nip46Session {
  let relays: string[] | null = null
  if (row.relays) {
    try { relays = JSON.parse(row.relays) } catch { relays = null }
  }
  let methods: Record<string, boolean> | undefined
  let kinds: Record<string, boolean> | undefined
  if (row.policy_methods) {
    try { methods = JSON.parse(row.policy_methods) } catch {}
  }
  if (row.policy_kinds) {
    try { kinds = JSON.parse(row.policy_kinds) } catch {}
  }
  return {
    id: row.id,
    user_id: row.user_id,
    client_pubkey: row.client_pubkey,
    status: row.status as Nip46Status,
    profile: { name: row.profile_name || undefined, url: row.profile_url || undefined, image: row.profile_image || undefined },
    relays,
    policy: { methods: methods || {}, kinds: kinds || {} },
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_active_at: row.last_active_at || null,
  }
}

export function listSessions(userId: number | bigint, opts?: { includeRevoked?: boolean }): Nip46Session[] {
  const includeRevoked = !!opts?.includeRevoked
  const rows = db
    .prepare(
      'SELECT * FROM nip46_sessions WHERE user_id = ? AND (? = 1 OR status != ?) ORDER BY updated_at DESC, id DESC'
    )
    .all(userId, includeRevoked ? 1 : 0, 'revoked') as any[]
  return rows.map(rowToSession)
}

export function upsertSession(params: {
  userId: number | bigint
  client_pubkey: string
  status?: Nip46Status
  profile?: Nip46Profile
  relays?: string[] | null
  policy?: Nip46Policy
  touchLastActive?: boolean
}): Nip46Session {
  const { userId, client_pubkey } = params
  const status = params.status || 'pending'
  const profile = params.profile || {}
  const relays = params.relays ? JSON.stringify(params.relays) : null
  const policy_methods = JSON.stringify(params.policy?.methods || {})
  const policy_kinds = JSON.stringify(params.policy?.kinds || {})
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(`
      INSERT INTO nip46_sessions (
        user_id, client_pubkey, status, profile_name, profile_url, profile_image,
        relays, policy_methods, policy_kinds, created_at, updated_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(user_id, client_pubkey) DO UPDATE SET
        status = excluded.status,
        profile_name = excluded.profile_name,
        profile_url = excluded.profile_url,
        profile_image = excluded.profile_image,
        relays = excluded.relays,
        policy_methods = excluded.policy_methods,
        policy_kinds = excluded.policy_kinds,
        updated_at = CURRENT_TIMESTAMP,
        last_active_at = COALESCE(excluded.last_active_at, nip46_sessions.last_active_at)
    `).run(
      userId,
      client_pubkey,
      status,
      profile.name ?? null,
      profile.url ?? null,
      profile.image ?? null,
      relays,
      policy_methods,
      policy_kinds,
      params.touchLastActive ? now : null
    )

    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey)
    db.exec('COMMIT')
    try { logSessionEvent(userId, client_pubkey, 'upsert') } catch {}
    return rowToSession(row)
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function updatePolicy(userId: number | bigint, client_pubkey: string, policy: Nip46Policy): Nip46Session | null {
  // Diff against existing to record grants/revocations
  const existing = db.prepare('SELECT policy_methods, policy_kinds FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey) as { policy_methods: string | null, policy_kinds: string | null } | undefined
  const prevMethods = existing?.policy_methods ? safeParseJSON(existing.policy_methods, {}) as Record<string, boolean> : {}
  const prevKinds = existing?.policy_kinds ? safeParseJSON(existing.policy_kinds, {}) as Record<string, boolean> : {}
  const nextMethods = policy.methods || {}
  const nextKinds = policy.kinds || {}
  const methods = JSON.stringify(nextMethods)
  const kinds = JSON.stringify(nextKinds)
  db.prepare(`
    UPDATE nip46_sessions
    SET policy_methods = ?, policy_kinds = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND client_pubkey = ?
  `).run(methods, kinds, userId, client_pubkey)
  // Log changes (grants/revokes)
  try {
    for (const k of Object.keys({ ...prevMethods, ...nextMethods })) {
      const before = !!prevMethods[k]
      const after = !!nextMethods[k]
      if (before !== after) logSessionEvent(userId, client_pubkey, after ? 'grant_method' : 'revoke_method', k)
    }
    for (const k of Object.keys({ ...prevKinds, ...nextKinds })) {
      const before = !!prevKinds[k]
      const after = !!nextKinds[k]
      if (before !== after) logSessionEvent(userId, client_pubkey, after ? 'grant_kind' : 'revoke_kind', k)
    }
  } catch {}
  const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey)
  return row ? rowToSession(row) : null
}

export function updateStatus(userId: number | bigint, client_pubkey: string, status: Nip46Status, touchActive = false): Nip46Session | null {
  db.prepare(`
    UPDATE nip46_sessions
    SET status = ?, updated_at = CURRENT_TIMESTAMP, last_active_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_active_at END
    WHERE user_id = ? AND client_pubkey = ?
  `).run(status, touchActive ? 1 : 0, userId, client_pubkey)
  try { logSessionEvent(userId, client_pubkey, 'status_change', undefined, status) } catch {}
  const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey)
  return row ? rowToSession(row) : null
}

export function deleteSession(userId: number | bigint, client_pubkey: string): boolean {
  db.prepare('DELETE FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').run(userId, client_pubkey)
  const changed = db.query('SELECT changes() as c').get() as { c: number } | null
  return !!changed && changed.c > 0
}

/**
 * Count sessions created by a user within a time window for rate limiting
 * @param userId - The user ID to check
 * @param windowMs - Time window in milliseconds
 * @returns Number of sessions created in the window
 */
export function countUserSessionsInWindow(userId: number | bigint, windowMs: number): number {
  const cutoff = new Date(Date.now() - windowMs).toISOString()
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM nip46_sessions WHERE user_id = ? AND created_at >= ?'
  ).get(userId, cutoff) as { count: number } | undefined
  return row?.count || 0
}

// Utility JSON parser with default
function safeParseJSON(text: string | null | undefined, fallback: any) {
  if (!text) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

// Event logging and queries
export interface Nip46SessionEvent {
  id: number
  user_id: number | bigint
  client_pubkey: string
  event_type: string
  detail: string | null
  value: string | null
  created_at: string
}

export function logSessionEvent(userId: number | bigint, client_pubkey: string, event_type: string, detail?: string, value?: string) {
  db.prepare(`
    INSERT INTO nip46_session_events (user_id, client_pubkey, event_type, detail, value)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, client_pubkey, event_type, detail ?? null, value ?? null)
}

export function listSessionEvents(userId: number | bigint, client_pubkey: string, limit = 50): Nip46SessionEvent[] {
  const rows = db.prepare(
    'SELECT * FROM nip46_session_events WHERE user_id = ? AND client_pubkey = ? ORDER BY created_at DESC, id DESC LIMIT ?'
  ).all(userId, client_pubkey, limit) as any[]
  return rows.map(r => ({
    id: r.id,
    user_id: r.user_id,
    client_pubkey: r.client_pubkey,
    event_type: r.event_type,
    detail: r.detail,
    value: r.value,
    created_at: r.created_at,
  }))
}
