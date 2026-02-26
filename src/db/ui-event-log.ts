import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import db from './database.js'

export type UiEventLogStreamEntry = {
  type: string
  message: string
  data?: unknown
  timestamp: string
  id: string
}

export type UiEventLogListItem = {
  seq: number
  createdAt: string
  createdAtMs: number
  type: string
  message: string
  timestamp: string
  id: string
  dataHash: string | null
  dataPreview: unknown | null
  dataBytes: number | null
}

export type UiEventLogListResult = {
  entries: UiEventLogListItem[]
  nextBeforeSeq: number | null
}

export type UiEventLogExportRow = {
  seq: number
  createdAtMs: number
  type: string
  message: string
  dataHash: string | null
  dataBytes: number | null
  data: unknown | null
}

export type UiEventLogPruneResult = {
  cutoffMs: number
  deletedEntries: number
  deletedBlobs: number
}

function safeJsonStringify(value: unknown): string | null {
  if (value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    try {
      return JSON.stringify({ _error: 'non_serializable', preview: String(value) })
    } catch {
      return null
    }
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

const DATA_PREVIEW_MAX_BYTES = 2048
const MAX_PERSISTED_DATA_BYTES = 200_000

const REDACTED = '[REDACTED]'

function looksSensitiveKey(key: string): boolean {
  const k = key.trim().toLowerCase()
  if (!k) return false
  // Common secret-bearing keys. Keep this conservative: redact when we're confident.
  if (k === 'authorization' || k === 'cookie' || k === 'set-cookie') return true
  if (k === 'x-api-key' || k === 'api-key' || k === 'apikey' || k === 'api_key') return true
  if (k === 'x-session-id' || k === 'session-id' || k === 'session_id' || k === 'sessionid') return true
  if (k === 'password' || k === 'passwd' || k === 'pwd') return true
  if (k === 'admin_secret' || k === 'adminsecret') return true
  if (k === 'share_cred' || k === 'group_cred' || k === 'sharecred' || k === 'groupcred') return true
  if (k === 'transport_sk' || k === 'transportkey' || k === 'transport_key') return true
  if (k === 'session_secret' || k === 'sessionsecret') return true
  if (k === 'derived_key' || k === 'derivedkey') return true
  if (k.includes('secret') || k.includes('token')) return true
  return false
}

function truncateString(value: string, max = 4096): string {
  if (value.length <= max) return value
  const head = value.slice(0, Math.max(0, max - 64))
  const tail = value.slice(-48)
  return `${head}…[truncated ${value.length - head.length - tail.length} chars]…${tail}`
}

function sanitizeForPersistence(value: unknown): unknown {
  const seen = new WeakSet<object>()
  const MAX_DEPTH = 10
  const MAX_KEYS = 5000
  const MAX_ARRAY = 5000

  let keyCount = 0

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v
    if (depth > MAX_DEPTH) return { _truncated: true, reason: 'max_depth' }

    const t = typeof v
    if (t === 'string') return truncateString(v as string)
    if (t === 'number' || t === 'boolean') return v
    if (t === 'bigint') return v.toString()
    if (t === 'function' || t === 'symbol') return String(v)

    if (v instanceof Error) {
      return {
        name: v.name,
        message: v.message,
        stack: typeof v.stack === 'string' ? truncateString(v.stack, 8192) : undefined,
      }
    }

    if (Array.isArray(v)) {
      const out: unknown[] = []
      const n = Math.min(v.length, MAX_ARRAY)
      for (let i = 0; i < n; i++) out.push(walk(v[i], depth + 1))
      if (v.length > n) out.push({ _truncated: true, reason: 'max_array', originalLength: v.length })
      return out
    }

    if (t === 'object') {
      const obj = v as Record<string, unknown>
      if (seen.has(obj)) return { _circular: true }
      seen.add(obj)

      const out: Record<string, unknown> = {}
      for (const [k, rawVal] of Object.entries(obj)) {
        keyCount++
        if (keyCount > MAX_KEYS) {
          out._truncated = true
          out._truncatedReason = 'max_keys'
          break
        }
        if (looksSensitiveKey(k)) {
          out[k] = REDACTED
          continue
        }
        out[k] = walk(rawVal, depth + 1)
      }
      return out
    }

    return String(v)
  }

  return walk(value, 0)
}

export function ensureUiEventLogSchema(dbConn: Database): void {
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS ui_event_log_blobs (
      hash TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
  dbConn.exec(`
    CREATE TABLE IF NOT EXISTS ui_event_log_entries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data_hash TEXT REFERENCES ui_event_log_blobs(hash),
      data_preview TEXT,
      data_bytes INTEGER,
      source_id TEXT
    );
  `)
  dbConn.exec('CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_created_at_ms ON ui_event_log_entries(created_at_ms DESC)')
  dbConn.exec('CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_type_seq ON ui_event_log_entries(type, seq DESC)')
  dbConn.exec('CREATE INDEX IF NOT EXISTS idx_ui_event_log_entries_seq ON ui_event_log_entries(seq DESC)')
}

type EventLogEntryRow = {
  seq: number
  created_at: string
  created_at_ms: number | string
  type: string
  message: string
  data_hash: string | null
  data_preview: string | null
  data_bytes: number | null
}

type EventLogExportRow = EventLogEntryRow & {
  data_json: string | null
}

export function createUiEventLogStore(dbConn: Database) {
  ensureUiEventLogSchema(dbConn)

  const insertBlob = dbConn.prepare(`
    INSERT OR IGNORE INTO ui_event_log_blobs (hash, json, byte_length)
    VALUES (?, ?, ?)
  `)

  const insertEntry = dbConn.prepare(`
    INSERT INTO ui_event_log_entries (
      created_at_ms, type, message, data_hash, data_preview, data_bytes, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const selectEntriesBase = (whereSql: string) => `
    SELECT
      seq,
      created_at,
      created_at_ms,
      type,
      message,
      data_hash,
      data_preview,
      data_bytes
    FROM ui_event_log_entries
    ${whereSql}
    ORDER BY seq DESC
    LIMIT ?
  `

  const selectBlob = dbConn.prepare('SELECT json, byte_length FROM ui_event_log_blobs WHERE hash = ?')

  const deleteOldEntries = dbConn.prepare('DELETE FROM ui_event_log_entries WHERE created_at_ms < ?')
  const deleteOrphanBlobs = dbConn.prepare(`
    DELETE FROM ui_event_log_blobs
    WHERE NOT EXISTS (
      SELECT 1 FROM ui_event_log_entries e
      WHERE e.data_hash = ui_event_log_blobs.hash
    )
  `)

  return {
    append(entry: UiEventLogStreamEntry): { seq: number; dataHash: string | null } {
      const nowMs = Date.now()

      const type = String(entry.type || '').trim() || 'info'
      const message = String(entry.message || '').trim()

      let dataHash: string | null = null
      let dataPreview: string | null = null
      let dataBytes: number | null = null

      const sanitizedData = sanitizeForPersistence(entry.data)
      const json = safeJsonStringify(sanitizedData)
      if (json !== null) {
        const bytes = Buffer.byteLength(json, 'utf8')
        if (bytes > MAX_PERSISTED_DATA_BYTES) {
          const originalSha256 = sha256Hex(json)
          const summary = {
            _truncated: true,
            reason: 'max_persist_bytes',
            originalBytes: bytes,
            originalSha256,
            preview: json.slice(0, DATA_PREVIEW_MAX_BYTES),
          }
          const summaryJson = safeJsonStringify(summary)
          if (summaryJson) {
            const summaryHash = sha256Hex(summaryJson)
            insertBlob.run(summaryHash, summaryJson, Buffer.byteLength(summaryJson, 'utf8'))
            dataHash = summaryHash
            dataPreview = summaryJson
            // Track original size for operators and UI.
            dataBytes = bytes
          }
        } else {
          dataBytes = bytes
          dataHash = sha256Hex(json)
          insertBlob.run(dataHash, json, dataBytes)
          if (dataBytes <= DATA_PREVIEW_MAX_BYTES) {
            dataPreview = json
          } else {
            dataPreview = json.slice(0, DATA_PREVIEW_MAX_BYTES)
          }
        }
      }

      const result = insertEntry.run(
        nowMs,
        type,
        message,
        dataHash,
        dataPreview,
        dataBytes,
        entry.id ?? null
      )

      const seq = Number(result.lastInsertRowid)
      return { seq, dataHash }
    },

    list(opts?: { limit?: number; beforeSeq?: number; types?: string[] }): UiEventLogListResult {
      const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500)
      const beforeSeq = opts?.beforeSeq
      const types = opts?.types?.filter(t => typeof t === 'string' && t.trim().length > 0).map(t => t.trim()) ?? []

      const clauses: string[] = []
      const params: (number | string)[] = []

      if (typeof beforeSeq === 'number' && Number.isFinite(beforeSeq) && beforeSeq > 0) {
        clauses.push('seq < ?')
        params.push(beforeSeq)
      }

      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',')
        clauses.push(`type IN (${placeholders})`)
        params.push(...types)
      }

      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const stmt = dbConn.prepare(selectEntriesBase(whereSql))
      const rows = stmt.all(...params, limit) as EventLogEntryRow[]

      const entries: UiEventLogListItem[] = rows.map(r => {
        const createdAtMs = typeof r.created_at_ms === 'number' ? r.created_at_ms : Number(r.created_at_ms)
        if (!Number.isFinite(createdAtMs)) {
          console.warn(`[ui-event-log] Invalid created_at_ms for seq=${r.seq}, falling back to Date.now()`)
        }
        const createdAtIso = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : String(r.created_at ?? '')
        let preview: unknown | null = null
        if (typeof r.data_preview === 'string' && r.data_preview.trim().length > 0) {
          try { preview = JSON.parse(r.data_preview) } catch { preview = r.data_preview }
        }
        return {
          seq: Number(r.seq),
          createdAt: createdAtIso,
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
          type: String(r.type ?? ''),
          message: String(r.message ?? ''),
          // Emit ISO timestamps so the browser can localize display consistently.
          timestamp: createdAtIso,
          id: String(r.seq),
          dataHash: typeof r.data_hash === 'string' ? r.data_hash : null,
          dataPreview: preview,
          dataBytes: typeof r.data_bytes === 'number' ? r.data_bytes : (r.data_bytes == null ? null : Number(r.data_bytes)),
        }
      })

      const nextBeforeSeq = entries.length === limit ? entries[entries.length - 1].seq : null
      return { entries, nextBeforeSeq }
    },

    getBlob(hash: string): { data: unknown; byteLength: number } | null {
      const key = (hash || '').trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(key)) return null
      const row = selectBlob.get(key) as { json: string; byte_length: number } | undefined
      if (!row || typeof row.json !== 'string') return null
      try {
        return { data: JSON.parse(row.json), byteLength: row.byte_length }
      } catch {
        return { data: row.json, byteLength: row.byte_length }
      }
    }
    ,

    exportChunk(opts?: { afterSeq?: number; untilSeq?: number; limit?: number; types?: string[] }): { rows: UiEventLogExportRow[]; nextAfterSeq: number | null } {
      const limit = Math.min(Math.max(opts?.limit ?? 1000, 1), 5000)
      const afterSeq = typeof opts?.afterSeq === 'number' && Number.isFinite(opts.afterSeq) && opts.afterSeq >= 0 ? opts.afterSeq : 0
      const untilSeq = typeof opts?.untilSeq === 'number' && Number.isFinite(opts.untilSeq) && opts.untilSeq > 0 ? opts.untilSeq : null
      const types = opts?.types?.filter(t => typeof t === 'string' && t.trim().length > 0).map(t => t.trim()) ?? []

      const clauses: string[] = ['e.seq > ?']
      const params: (number | string)[] = [afterSeq]

      if (untilSeq) {
        clauses.push('e.seq <= ?')
        params.push(untilSeq)
      }

      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',')
        clauses.push(`e.type IN (${placeholders})`)
        params.push(...types)
      }

      const whereSql = `WHERE ${clauses.join(' AND ')}`
      const stmt = dbConn.prepare(`
        SELECT
          e.seq as seq,
          e.created_at_ms as created_at_ms,
          e.type as type,
          e.message as message,
          e.data_hash as data_hash,
          e.data_bytes as data_bytes,
          b.json as data_json
        FROM ui_event_log_entries e
        LEFT JOIN ui_event_log_blobs b ON e.data_hash = b.hash
        ${whereSql}
        ORDER BY e.seq ASC
        LIMIT ?
      `)
      const raw = stmt.all(...params, limit) as EventLogExportRow[]
      const rows: UiEventLogExportRow[] = raw.map(r => {
        let parsed: unknown | null = null
        if (typeof r.data_json === 'string' && r.data_json.length > 0) {
          try { parsed = JSON.parse(r.data_json) } catch { parsed = r.data_json }
        }
        const createdAtMs = typeof r.created_at_ms === 'number' ? r.created_at_ms : Number(r.created_at_ms)
        return {
          seq: Number(r.seq),
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
          type: String(r.type ?? ''),
          message: String(r.message ?? ''),
          dataHash: typeof r.data_hash === 'string' ? r.data_hash : null,
          dataBytes: typeof r.data_bytes === 'number' ? r.data_bytes : (r.data_bytes == null ? null : Number(r.data_bytes)),
          data: parsed
        }
      })
      const nextAfterSeq = rows.length === limit ? rows[rows.length - 1].seq : null
      return { rows, nextAfterSeq }
    }

    ,

    prune(opts?: { retentionDays?: number }): UiEventLogPruneResult | null {
      const retentionDays = opts?.retentionDays
      if (typeof retentionDays !== 'number' || !Number.isFinite(retentionDays) || retentionDays <= 0) return null

      // Keep rows newer than cutoff.
      const cutoffMs = Date.now() - Math.floor(retentionDays * 86400000)
      if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) return null

      // Delete in two phases: entries first (to avoid FK issues), then orphan blobs.
      const r1 = deleteOldEntries.run(cutoffMs)
      const r2 = deleteOrphanBlobs.run()
      return {
        cutoffMs,
        deletedEntries: Number(r1.changes) || 0,
        deletedBlobs: Number(r2.changes) || 0,
      }
    }
  }
}

let defaultStore: ReturnType<typeof createUiEventLogStore> | null = null

function getDefaultStore(): ReturnType<typeof createUiEventLogStore> {
  if (!defaultStore) defaultStore = createUiEventLogStore(db)
  return defaultStore
}

export function appendUiEventLogEntry(entry: UiEventLogStreamEntry): { seq: number; dataHash: string | null } {
  return getDefaultStore().append(entry)
}

export function listUiEventLogEntries(opts?: { limit?: number; beforeSeq?: number; types?: string[] }): UiEventLogListResult {
  return getDefaultStore().list(opts)
}

export function getUiEventLogBlob(hash: string): { data: unknown; byteLength: number } | null {
  return getDefaultStore().getBlob(hash)
}

export function exportUiEventLogChunk(opts?: {
  afterSeq?: number;
  untilSeq?: number;
  limit?: number;
  types?: string[];
}): { rows: UiEventLogExportRow[]; nextAfterSeq: number | null } {
  return getDefaultStore().exportChunk(opts)
}

export function pruneUiEventLog(opts?: { retentionDays?: number }): UiEventLogPruneResult | null {
  return getDefaultStore().prune(opts)
}
