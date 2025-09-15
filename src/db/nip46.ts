import db from './database.js'

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

// Create sessions table if it doesn't exist
function createNip46Tables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nip46_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_pubkey TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')) DEFAULT 'pending',
      profile_name TEXT,
      profile_url TEXT,
      profile_image TEXT,
      relays TEXT,          -- JSON array string
      policy_methods TEXT,  -- JSON object string
      policy_kinds TEXT,    -- JSON object string
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME,
      UNIQUE(user_id, client_pubkey)
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_sessions_user ON nip46_sessions(user_id)')

  // Session events audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS nip46_session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_pubkey TEXT NOT NULL,
      event_type TEXT NOT NULL, -- created | status_change | grant_method | grant_kind | revoke_method | revoke_kind | upsert
      detail TEXT,              -- method name or kind number as text
      value TEXT,               -- new status/value if relevant
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_events_user_pub ON nip46_session_events(user_id, client_pubkey, created_at)')
}

createNip46Tables()

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
  const rows = db.prepare(
    `SELECT * FROM nip46_sessions WHERE user_id = ? ${opts?.includeRevoked ? '' : "AND status != 'revoked'"} ORDER BY updated_at DESC, id DESC`
  ).all(userId) as any[]
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

