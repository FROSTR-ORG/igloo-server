import db from './database.js'
import { runMigrations } from './migrator.js'
import { randomBytes } from 'node:crypto'

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
    initializationPromise = (async () => {
      try {
        // runMigrations is synchronous, returns array of applied migrations
        const applied = runMigrations('src/db/migrations')
        if (applied.length > 0) {
          console.log(`[nip46] Applied ${applied.length} migration(s):`, applied.join(', '))
        }

        // Defensive check: Verify critical tables exist and recreate if missing
        // This handles cases where migrations partially failed
        verifyAndCreateMissingTables()
      } catch (error) {
        initializationPromise = null
        throw error
      }
    })()
  }
  return initializationPromise
}

function normalizeClientPubkey(clientPubkey: string): string {
  return (clientPubkey || '').trim().toLowerCase()
}

function hasTableColumn(tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>
  return rows.some((row) => row.name === columnName)
}

function hasIndex(indexName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name = ?"
  ).get(indexName) as { name?: string } | undefined
  return row?.name === indexName
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
    },
    {
      name: 'nip46_relays',
      sql: `CREATE TABLE IF NOT EXISTS nip46_relays (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        relays TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    },
    {
      name: 'nip46_requests',
      sql: `CREATE TABLE IF NOT EXISTS nip46_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_pubkey TEXT NOT NULL,
        client_request_id TEXT,
        method TEXT NOT NULL,
        params TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','completed','failed','expired')) DEFAULT 'pending',
        result TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
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
      }

      if (table.name === 'nip46_sessions') {
        db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_sessions_user ON nip46_sessions(user_id)')
      } else if (table.name === 'nip46_session_events') {
        db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_events_user_pub ON nip46_session_events(user_id, client_pubkey, created_at)')
      } else if (table.name === 'nip46_requests') {
        if (!hasTableColumn('nip46_requests', 'client_request_id')) {
          db.exec('ALTER TABLE nip46_requests ADD COLUMN client_request_id TEXT')
        }
        db.exec('CREATE INDEX IF NOT EXISTS idx_nip46_requests_user_status ON nip46_requests(user_id, status, created_at DESC)')
        db.exec(`
          UPDATE nip46_requests
          SET client_request_id = TRIM(CAST(json_extract(params, '$.id') AS TEXT))
          WHERE client_request_id IS NULL
            AND json_valid(params)
            AND json_type(params, '$.id') IS NOT NULL
        `)
        db.exec(`
          DELETE FROM nip46_requests
          WHERE rowid IN (
            SELECT older.rowid
            FROM nip46_requests AS older
            JOIN nip46_requests AS newer
              ON newer.user_id = older.user_id
             AND newer.session_pubkey = older.session_pubkey
             AND newer.client_request_id = older.client_request_id
             AND newer.status = 'pending'
             AND older.status = 'pending'
             AND newer.client_request_id IS NOT NULL
             AND (
               newer.created_at > older.created_at
               OR (newer.created_at = older.created_at AND newer.id > older.id)
             )
          )
        `)
        if (hasIndex('idx_nip46_requests_dedupe')) {
          db.exec('DROP INDEX idx_nip46_requests_dedupe')
        }
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_nip46_requests_pending_dedupe
            ON nip46_requests(user_id, session_pubkey, client_request_id)
            WHERE status = 'pending' AND client_request_id IS NOT NULL
        `)
      }
    } catch (error) {
      console.error(`[nip46] Failed to verify/create table ${table.name}:`, error)
      // Don't throw - let the application continue with degraded functionality
    }
  }
}

// Maximum number of relays to persist for the NIP-46 transport pool
const MAX_NIP46_RELAYS = 32;

// Maximum size for JSON fields to prevent memory exhaustion
// Increased from 10KB to 50KB to accommodate larger relay lists and policies
export const MAX_JSON_FIELD_SIZE = 50000 // 50KB per field
export type Nip46RequestStatus = 'pending' | 'approved' | 'denied' | 'completed' | 'failed' | 'expired'

export interface Nip46RequestRecord {
  id: string
  user_id: number | bigint
  session_pubkey: string
  client_request_id?: string | null
  method: string
  params: string
  status: Nip46RequestStatus
  result?: string | null
  error?: string | null
  created_at: string
  updated_at: string
  expires_at?: string | null
}

function parseRelayArray(raw: string): string[] {
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('[nip46] Data integrity violation: relays must be an array')
  }
  const relays: string[] = []
  for (const value of parsed) {
    if (typeof value !== 'string') {
      throw new Error('[nip46] Data integrity violation: relay entries must be strings')
    }
    relays.push(value)
  }
  return relays
}

function normalizeClientRequestId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function parseBooleanMap(raw: string, label: string): Record<string, boolean> {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[nip46] Data integrity violation: ${label} must be an object`)
  }
  const normalized: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'boolean') {
      throw new Error(`[nip46] Data integrity violation: ${label}.${key} must be a boolean`)
    }
    normalized[key] = value
  }
  return normalized
}

function rowToSession(row: any): Nip46Session {
  let relays: string[] | null = null

  if (row.relays) {
    // Check size before parsing to prevent DoS and ensure data integrity
    if (row.relays.length > MAX_JSON_FIELD_SIZE) {
      // Generic error message to prevent information disclosure
      throw new Error('[nip46] Data integrity violation: Relay data exceeds maximum size')
    }
    try {
      relays = parseRelayArray(row.relays)
    } catch (e) {
      if (e instanceof Error && e.message.includes('Data integrity violation')) {
        throw e
      }
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
      methods = parseBooleanMap(row.policy_methods, 'policy_methods')
    } catch (e) {
      if (e instanceof Error && e.message.includes('Data integrity violation')) {
        throw e
      }
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
      kinds = parseBooleanMap(row.policy_kinds, 'policy_kinds')
    } catch (e) {
      if (e instanceof Error && e.message.includes('Data integrity violation')) {
        throw e
      }
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

export function getSession(userId: number | bigint, client_pubkey: string): Nip46Session | null {
  const key = normalizeClientPubkey(client_pubkey)
  if (!key || !/^[0-9a-f]{64}$/.test(key)) return null
  const row = db
    .prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?')
    .get(userId, key)
  return row ? rowToSession(row) : null
}

export function getNip46Relays(userId: number | bigint): string[] {
  const row = db.prepare('SELECT relays FROM nip46_relays WHERE user_id = ?').get(userId) as { relays?: string } | undefined
  if (!row || typeof row.relays !== 'string') return []
  if (row.relays.length > MAX_JSON_FIELD_SIZE) {
    console.error('[nip46] Relay list exceeds maximum size; ignoring stored value')
    return []
  }
  try {
    const parsed = JSON.parse(row.relays)
    if (!Array.isArray(parsed)) return []
    const relays = parsed.filter((value: unknown): value is string => typeof value === 'string')
    return relays.slice(0, MAX_NIP46_RELAYS)
  } catch (error) {
    console.error('[nip46] Failed to parse stored relay list:', error)
    return []
  }
}

export function setNip46Relays(userId: number | bigint, relays: string[]): string[] {
  const cleaned = Array.from(new Set(relays.filter(r => typeof r === 'string'))).slice(0, MAX_NIP46_RELAYS)
  const payload = JSON.stringify(cleaned)
  if (payload.length > MAX_JSON_FIELD_SIZE) {
    throw new Error('[nip46] Relay payload exceeds maximum allowed size')
  }

  db.prepare(`
    INSERT INTO nip46_relays (user_id, relays)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET relays = excluded.relays, updated_at = CURRENT_TIMESTAMP
  `).run(userId, payload)

  return cleaned
}

export function mergeNip46Relays(userId: number | bigint, relays: string[]): string[] {
  const current = new Set(getNip46Relays(userId))
  for (const relay of relays) {
    if (typeof relay === 'string') current.add(relay)
  }
  const merged = Array.from(current).slice(0, MAX_NIP46_RELAYS)
  setNip46Relays(userId, merged)
  return merged
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return randomBytes(16).toString('hex')
}

export function createNip46Request(params: {
  userId: number | bigint
  session_pubkey: string
  method: string
  payload: Record<string, unknown> | string
  expiresAt?: Date
}): Nip46RequestRecord {
  const id = randomRequestId()
  let payloadObject: Record<string, unknown> | null = null
  if (typeof params.payload === 'string') {
    try {
      const parsed = JSON.parse(params.payload) as unknown
      payloadObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      throw new Error('Request payload must be valid JSON')
    }
  } else {
    payloadObject = params.payload
  }
  const payload = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload)
  if (payload.length > MAX_JSON_FIELD_SIZE) {
    throw new Error('Request payload too large to persist')
  }

  const normalizedPubkey = params.session_pubkey.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalizedPubkey)) {
    throw new Error('Invalid session pubkey for request')
  }

  const expires = params.expiresAt ? params.expiresAt.toISOString() : null
  const clientRequestId = normalizeClientRequestId(
    payloadObject && typeof payloadObject === 'object'
      ? (payloadObject as { id?: unknown }).id
      : null
  )

  try {
    db.prepare(`
      INSERT INTO nip46_requests (id, user_id, session_pubkey, client_request_id, method, params, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, params.userId, normalizedPubkey, clientRequestId, params.method, payload, expires)
  } catch (error) {
    const candidate = error as { code?: string; message?: string }
    const message = candidate?.message ?? ''
    if (
      clientRequestId &&
      (candidate?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        message.includes('UNIQUE constraint failed') ||
        message.includes('idx_nip46_requests_pending_dedupe'))
    ) {
      const existing = getPendingNip46RequestByClientId(params.userId, normalizedPubkey, clientRequestId)
      if (existing) return existing
    }
    throw error
  }

  return getNip46RequestById(id) as Nip46RequestRecord
}

export function getNip46RequestById(id: string): Nip46RequestRecord | null {
  const row = db.prepare('SELECT * FROM nip46_requests WHERE id = ?').get(id) as Nip46RequestRecord | undefined
  return row ?? null
}

export function getPendingNip46RequestByClientId(
  userId: number | bigint,
  sessionPubkey: string,
  clientRequestId: string
): Nip46RequestRecord | null {
  const normalizedPubkey = normalizeClientPubkey(sessionPubkey)
  const normalizedClientRequestId = normalizeClientRequestId(clientRequestId)
  if (!normalizedPubkey || !/^[0-9a-f]{64}$/.test(normalizedPubkey) || !normalizedClientRequestId) {
    return null
  }

  const row = db.prepare(
    `SELECT * FROM nip46_requests
     WHERE user_id = ? AND session_pubkey = ? AND client_request_id = ? AND status = 'pending'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).get(userId, normalizedPubkey, normalizedClientRequestId) as Nip46RequestRecord | undefined
  return row ?? null
}

export function listNip46Requests(
  userId: number | bigint,
  opts?: {
    status?: Nip46RequestStatus[]
    limit?: number
    before?: { createdAt: string; id: string }
  }
): Nip46RequestRecord[] {
  const statuses = opts?.status && opts.status.length ? opts.status : null
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500)
  const clauses: string[] = ['user_id = ?']
  const params: Array<number | bigint | string> = [userId]

  if (statuses) {
    const placeholders = statuses.map(() => '?').join(',')
    clauses.push(`status IN (${placeholders})`)
    params.push(...statuses)
  }

  const before = opts?.before
  if (before && typeof before.createdAt === 'string' && typeof before.id === 'string' && before.createdAt.trim() && before.id.trim()) {
    // Stable cursor using (created_at, id) tuple for deterministic pagination.
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    params.push(before.createdAt, before.createdAt, before.id)
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`
  const stmt = db.prepare(
    `SELECT * FROM nip46_requests ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ?`
  )
  return stmt.all(...params, limit) as Nip46RequestRecord[]
}

export function updateNip46RequestStatus(
  id: string,
  status: Nip46RequestStatus,
  options?: { result?: string | null; error?: string | null }
): Nip46RequestRecord | null {
  db.prepare(`
    UPDATE nip46_requests
    SET status = ?,
        result = COALESCE(?, result),
        error = COALESCE(?, error),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, options?.result ?? null, options?.error ?? null, id)
  return getNip46RequestById(id)
}

export function deleteNip46Request(id: string): void {
  db.prepare('DELETE FROM nip46_requests WHERE id = ?').run(id)
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

interface UpsertSessionParams {
  userId: number | bigint
  client_pubkey: string
  status?: Nip46Status
  profile?: Nip46Profile
  relays?: string[] | null
  policy?: Nip46Policy
  touchLastActive?: boolean
}

interface PreparedSessionUpsert {
  userId: number | bigint
  clientPubkey: string
  status: Nip46Status
  profileName: string | null
  profileUrl: string | null
  profileImage: string | null
  relays: string | null
  policyMethods: string | null
  policyKinds: string | null
  lastActiveAt: string | null
}

function prepareSessionUpsert(params: UpsertSessionParams): PreparedSessionUpsert {
  const normalizedKey = (params.client_pubkey || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalizedKey)) {
    throw new Error('Invalid client pubkey format; expected 64-character hex string')
  }

  let relays: string | null = null
  if (params.relays) {
    relays = JSON.stringify(params.relays)
    if (relays.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Relay data too large (${relays.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

  let policyMethods: string | null = null
  if (params.policy && params.policy.methods !== undefined) {
    policyMethods = JSON.stringify(params.policy.methods)
    if (policyMethods.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy methods data too large (${policyMethods.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

  let policyKinds: string | null = null
  if (params.policy && params.policy.kinds !== undefined) {
    policyKinds = JSON.stringify(params.policy.kinds)
    if (policyKinds.length > MAX_JSON_FIELD_SIZE) {
      throw new Error(`Policy kinds data too large (${policyKinds.length} bytes, max ${MAX_JSON_FIELD_SIZE})`)
    }
  }

  return {
    userId: params.userId,
    clientPubkey: normalizedKey,
    status: params.status || 'pending',
    profileName: params.profile?.name ?? null,
    profileUrl: params.profile?.url ?? null,
    profileImage: params.profile?.image ?? null,
    relays,
    policyMethods,
    policyKinds,
    lastActiveAt: params.touchLastActive ? new Date().toISOString() : null
  }
}

function upsertSessionInTransaction(params: PreparedSessionUpsert): Nip46Session {
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
    params.userId,
    params.clientPubkey,
    params.status,
    params.profileName,
    params.profileUrl,
    params.profileImage,
    params.relays,
    params.policyMethods,
    params.policyKinds,
    params.lastActiveAt
  )

  const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(
    params.userId,
    params.clientPubkey
  )
  return rowToSession(row)
}

function insertSessionEvent(
  userId: number | bigint,
  client_pubkey: string,
  event_type: string,
  detail?: string,
  value?: string
): void {
  db.prepare(`
    INSERT INTO nip46_session_events (user_id, client_pubkey, event_type, detail, value)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, client_pubkey, event_type, detail ?? null, value ?? null)
}

export function upsertSession(params: UpsertSessionParams): Nip46Session {
  const prepared = prepareSessionUpsert(params)

  db.exec('BEGIN')
  try {
    const session = upsertSessionInTransaction(prepared)
    db.exec('COMMIT')

    // Log event after successful commit (non-critical, failures ignored)
    try { logSessionEvent(prepared.userId, prepared.clientPubkey, 'upsert') } catch {}
    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function createSessionWithCreatedEvent(params: UpsertSessionParams): Nip46Session {
  const prepared = prepareSessionUpsert(params)

  db.exec('BEGIN')
  try {
    const session = upsertSessionInTransaction(prepared)
    insertSessionEvent(prepared.userId, prepared.clientPubkey, 'created')
    db.exec('COMMIT')

    try { logSessionEvent(prepared.userId, prepared.clientPubkey, 'upsert') } catch {}
    return session
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function updatePolicy(userId: number | bigint, client_pubkey: string, policy: Nip46Policy): Nip46Session | null {
  const normalizedKey = normalizeClientPubkey(client_pubkey)
  // Use transaction to ensure atomicity between UPDATE and SELECT
  db.exec('BEGIN')
  try {
    // Diff against existing to record grants/revocations
    const existing = db.prepare('SELECT policy_methods, policy_kinds FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, normalizedKey) as { policy_methods: string | null, policy_kinds: string | null } | undefined

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
    `).run(methodsValue, kindsValue, userId, normalizedKey)

    // Fetch the updated session within the transaction to ensure consistency
    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, normalizedKey)
    const session = row ? rowToSession(row) : null

    // Commit the transaction
    db.exec('COMMIT')

    // Log changes (grants/revokes) after successful commit
    // This is non-critical so we do it outside the transaction
    try {
      for (const k of Object.keys({ ...prevMethods, ...nextMethods })) {
        const before = !!prevMethods[k]
        const after = !!nextMethods[k]
        if (before !== after) logSessionEvent(userId, normalizedKey, after ? 'grant_method' : 'revoke_method', k)
      }
      for (const k of Object.keys({ ...prevKinds, ...nextKinds })) {
        const before = !!prevKinds[k]
        const after = !!nextKinds[k]
        if (before !== after) logSessionEvent(userId, normalizedKey, after ? 'grant_kind' : 'revoke_kind', k)
      }
    } catch {}

    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function updateStatus(userId: number | bigint, client_pubkey: string, status: Nip46Status, touchActive = false): Nip46Session | null {
  const normalizedKey = normalizeClientPubkey(client_pubkey)
  // Use transaction to ensure atomicity between UPDATE and SELECT
  db.exec('BEGIN')
  try {
    // Update the session status
    db.prepare(`
      UPDATE nip46_sessions
      SET status = ?, updated_at = CURRENT_TIMESTAMP, last_active_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_active_at END
      WHERE user_id = ? AND client_pubkey = ?
    `).run(status, touchActive ? 1 : 0, userId, normalizedKey)

    // Check if UPDATE affected any rows before logging events
    const changed = db.query('SELECT changes() as c').get() as { c: number } | null
    if (!changed || changed.c === 0) {
      db.exec('ROLLBACK')
      return null; // No session was updated
    }

    // Fetch the updated session within the transaction to ensure consistency
    const row = db.prepare('SELECT * FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').get(userId, normalizedKey)
    const session = row ? rowToSession(row) : null

    // Commit the transaction
    db.exec('COMMIT')

    // Log the status change after successful commit (non-critical)
    try { logSessionEvent(userId, normalizedKey, 'status_change', undefined, status) } catch {}

    return session
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function deleteSession(userId: number | bigint, client_pubkey: string): boolean {
  const normalizedKey = normalizeClientPubkey(client_pubkey)
  db.prepare('DELETE FROM nip46_sessions WHERE user_id = ? AND client_pubkey = ?').run(userId, normalizedKey)
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
  const cutoffEpochSeconds = Math.floor((Date.now() - windowMs) / 1000)
  const row = db.prepare(
    `SELECT COUNT(*) as count
     FROM nip46_session_events
     WHERE user_id = ?
       AND event_type = 'created'
       AND CAST(strftime('%s', created_at) AS INTEGER) >= ?`
  ).get(userId, cutoffEpochSeconds) as { count: number } | undefined
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
  const normalizedKey = normalizeClientPubkey(client_pubkey)
  insertSessionEvent(userId, normalizedKey, event_type, detail, value)
}

export function listSessionEvents(userId: number | bigint, client_pubkey: string, limit = 50): Nip46SessionEvent[] {
  const key = normalizeClientPubkey(client_pubkey)
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
