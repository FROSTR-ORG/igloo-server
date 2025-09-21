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

      // Defensive check: Verify critical tables exist and recreate if missing
      // This handles cases where migrations partially failed
      verifyAndCreateMissingTables()
    })
  }
  return initializationPromise
}

// Defensive function to ensure critical NIP46 tables exist
function verifyAndCreateMissingTables(): void {
  const requiredTables = [
    {
      name: 'nip46_sessions',
      sql: `CREATE TABLE IF NOT EXISTS nip46_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_pubkey TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')) DEFAULT 'pending',
        profile_name TEXT,
        profile_url TEXT,
        profile_image TEXT,
        relays TEXT,
        policy_methods TEXT,
        policy_kinds TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME,
        UNIQUE(user_id, client_pubkey)
      )`
    },
    {
      name: 'nip46_session_events',
      sql: `CREATE TABLE IF NOT EXISTS nip46_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_pubkey TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('created','status_change','grant_method','grant_kind','revoke_method','revoke_kind','upsert')),
        detail TEXT,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'nip46_transport_keys',
      sql: `CREATE TABLE IF NOT EXISTS nip46_transport_keys (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        transport_sk TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    }
  ]

  for (const table of requiredTables) {
    try {
      // Check if table exists
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table.name)

      if (!exists) {
        console.log(`[nip46] Creating missing table: ${table.name}`)
        db.exec(table.sql)

        // Create associated indexes
        if (table.name === 'nip46_sessions') {
          db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_sessions_user ON nip46_sessions(user_id)')
        } else if (table.name === 'nip46_session_events') {
          db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_events_user_pub ON nip46_session_events(user_id, client_pubkey, created_at)')
        }
      }
    } catch (error) {
      console.error(`[nip46] Failed to verify/create table ${table.name}:`, error)
      // Don't throw - let the application continue with degraded functionality
    }
  }
}

// Maximum size for JSON fields to prevent memory exhaustion
// Increased from 10KB to 50KB to accommodate larger relay lists and policies
const MAX_JSON_FIELD_SIZE = 50000 // 50KB per field

function rowToSession(row: any): Nip46Session {
  let relays: string[] | null = null

  if (row.relays) {
    // Check size before parsing to prevent DoS and ensure data integrity
    if (row.relays.length > MAX_JSON_FIELD_SIZE) {
      // Generic error message to prevent information disclosure
      throw new Error('[nip46] Data integrity violation: Relay data exceeds maximum size')
    }
    try {
      relays = JSON.parse(row.relays)
    } catch (e) {
      // Log for debugging but don't expose error details to client
      console.error('[nip46] Failed to parse relays JSON, using null:', e)
      relays = null
    }
  }

  let methods: Record<string, boolean> | undefined
  let kinds: Record<string, boolean> | undefined

  if (row.policy_methods) {
    // Check size before parsing
    if (row.policy_methods.length > MAX_JSON_FIELD_SIZE) {
      // Generic error message to prevent information disclosure
      throw new Error('[nip46] Data integrity violation: Policy methods data exceeds maximum size')
    }
    try {
      methods = JSON.parse(row.policy_methods)
    } catch (e) {
      // Log for debugging but don't expose error details to client
      console.error('[nip46] Failed to parse policy_methods JSON, using empty:', e)
      methods = {}
    }
  }

  if (row.policy_kinds) {
    // Check size before parsing
    if (row.policy_kinds.length > MAX_JSON_FIELD_SIZE) {
      // Generic error message to prevent information disclosure
      throw new Error('[nip46] Data integrity violation: Policy kinds data exceeds maximum size')
    }
    try {
      kinds = JSON.parse(row.policy_kinds)
    } catch (e) {
      // Log for debugging but don't expose error details to client
      console.error('[nip46] Failed to parse policy_kinds JSON, using empty:', e)
      kinds = {}
    }
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

// Transport key persistence (per-user)
export function getTransportKey(userId: number | bigint): string | null {
  const row = db.prepare('SELECT transport_sk FROM nip46_transport_keys WHERE user_id = ?').get(userId) as { transport_sk?: string } | undefined
  if (!row || typeof row.transport_sk !== 'string') return null
  const sk = row.transport_sk.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(sk) ? sk : null
}

export function setTransportKey(userId: number | bigint, sk: string): string {
  const key = (sk || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error('Invalid transport key format')
  }
  db.prepare(`
    INSERT INTO nip46_transport_keys (user_id, transport_sk)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET transport_sk = excluded.transport_sk, updated_at = CURRENT_TIMESTAMP
  `).run(userId, key)
  return key
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

  const normalizedKey = (client_pubkey || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalizedKey)) {
    throw new Error('Invalid client pubkey format; expected 64-character hex string')
  }

  // Validate and stringify JSON fields with size limits
  let relays: string | null = null
  if (params.relays) {
    relays = JSON.stringify(params.relays)
    if (relays.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Relay data too large (${relays.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

  let policy_methods: string | null = null
  if (params.policy && params.policy.methods !== undefined) {
    policy_methods = JSON.stringify(params.policy.methods)
    if (policy_methods.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy methods data too large (${policy_methods.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

  let policy_kinds: string | null = null
  if (params.policy && params.policy.kinds !== undefined) {
    policy_kinds = JSON.stringify(params.policy.kinds)
    if (policy_kinds.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy kinds data too large (${policy_kinds.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

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
        -- Preserve existing profile fields when the incoming value is NULL
        profile_name = COALESCE(excluded.profile_name, nip46_sessions.profile_name),
        profile_url = COALESCE(excluded.profile_url, nip46_sessions.profile_url),
        profile_image = COALESCE(excluded.profile_image, nip46_sessions.profile_image),
        -- Preserve existing relays when not provided
        relays = COALESCE(excluded.relays, nip46_sessions.relays),
        -- Policies are explicit; always update with provided JSON
        policy_methods = COALESCE(excluded.policy_methods, nip46_sessions.policy_methods),
        policy_kinds = COALESCE(excluded.policy_kinds, nip46_sessions.policy_kinds),
        updated_at = CURRENT_TIMESTAMP,
        last_active_at = COALESCE(excluded.last_active_at, nip46_sessions.last_active_at)
    `).run(
      userId,
      normalizedKey,
      status,
      params.profile?.name ?? null,
      params.profile?.url ?? null,
      params.profile?.image ?? null,
      relays,
      policy_methods,
      policy_kinds,
      params.touchLastActive ? now : null
    )

    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, normalizedKey)
    // Convert row to session object BEFORE committing transaction
    // This ensures any errors in rowToSession will properly rollback
    const session = rowToSession(row)
    db.exec('COMMIT')

    // Log event after successful commit (non-critical, failures ignored)
    try { logSessionEvent(userId, normalizedKey, 'upsert') } catch {}
    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function updatePolicy(userId: number | bigint, client_pubkey: string, policy: Nip46Policy): Nip46Session | null {
  // Use transaction to ensure atomicity between UPDATE and SELECT
  db.exec('BEGIN')
  try {
    // Diff against existing to record grants/revocations
    const existing = db.prepare('SELECT policy_methods, policy_kinds FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey) as { policy_methods: string | null, policy_kinds: string | null } | undefined

    // Return early if session doesn't exist (prevents orphan audit records)
    if (!existing) {
      db.exec('ROLLBACK')
      return null;
    }

    const prevMethods = existing.policy_methods ? safeParseJSON(existing.policy_methods, {}) as Record<string, boolean> : {}
    const prevKinds = existing.policy_kinds ? safeParseJSON(existing.policy_kinds, {}) as Record<string, boolean> : {}

    const nextMethods = policy.methods === undefined ? prevMethods : policy.methods
    const nextKinds = policy.kinds === undefined ? prevKinds : policy.kinds

    // Validate size before storing when new values provided
    const methodsValue = policy.methods === undefined ? null : JSON.stringify(nextMethods)
    if (methodsValue && methodsValue.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy methods data too large (${methodsValue.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }

    const kindsValue = policy.kinds === undefined ? null : JSON.stringify(nextKinds)
    if (kindsValue && kindsValue.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy kinds data too large (${kindsValue.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }

    // Update the session, preserving existing values when undefined
    db.prepare(`
      UPDATE nip46_sessions
      SET
        policy_methods = COALESCE(?, policy_methods),
        policy_kinds = COALESCE(?, policy_kinds),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND client_pubkey = ?
    `).run(methodsValue, kindsValue, userId, client_pubkey)

    // Fetch the updated session within the transaction to ensure consistency
    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey)
    const session = row ? rowToSession(row) : null

    // Commit the transaction
    db.exec('COMMIT')

    // Log changes (grants/revokes) after successful commit
    // This is non-critical so we do it outside the transaction
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

    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function updateStatus(userId: number | bigint, client_pubkey: string, status: Nip46Status, touchActive = false): Nip46Session | null {
  // Use transaction to ensure atomicity between UPDATE and SELECT
  db.exec('BEGIN')
  try {
    // Update the session status
    db.prepare(`
      UPDATE nip46_sessions
      SET status = ?, updated_at = CURRENT_TIMESTAMP, last_active_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_active_at END
      WHERE user_id = ? AND client_pubkey = ?
    `).run(status, touchActive ? 1 : 0, userId, client_pubkey)

    // Check if UPDATE affected any rows before logging events
    const changed = db.query('SELECT changes() as c').get() as { c: number } | null
    if (!changed || changed.c === 0) {
      db.exec('ROLLBACK')
      return null; // No session was updated
    }

    // Fetch the updated session within the transaction to ensure consistency
    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, client_pubkey)
    const session = row ? rowToSession(row) : null

    // Commit the transaction
    db.exec('COMMIT')

    // Log the status change after successful commit (non-critical)
    try { logSessionEvent(userId, client_pubkey, 'status_change', undefined, status) } catch {}

    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
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
  const key = (client_pubkey || '').trim().toLowerCase()
  const rows = db.prepare(
    'SELECT * FROM nip46_session_events WHERE user_id = ? AND client_pubkey = ? ORDER BY created_at DESC, id DESC LIMIT ?'
  ).all(userId, key, limit) as any[]
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
