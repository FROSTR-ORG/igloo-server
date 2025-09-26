import { HEADLESS } from '../const.js'
import { getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody } from './utils.js'
import type { PrivilegedRouteContext, RequestAuth } from './types.js'
import { listSessionEvents, listSessions, logSessionEvent, upsertSession, updatePolicy, updateStatus, deleteSession, countUserSessionsInWindow, initializeNip46DB, type Nip46Policy, type Nip46Profile, getTransportKey, setTransportKey, getNip46Relays, setNip46Relays, mergeNip46Relays, listNip46Requests, updateNip46RequestStatus, deleteNip46Request, type Nip46RequestStatus, getSession, getNip46RequestById } from '../db/nip46.js'
import { getNip46Service } from '../nip46/index.js'

const DEFAULT_NIP46_SESSION_RATE_LIMIT_MAX = HEADLESS ? 30 : 120;
const DEFAULT_NIP46_SESSION_RATE_LIMIT_WINDOW_SECONDS = 3600; // Keep a 1 hour window by default

// Rate limiting configuration for NIP-46 session creation
const NIP46_RATE_LIMIT = {
  // Slightly relaxed default for headless/local testing, significantly higher default once persisted to the database
  MAX: parseInt(process.env.NIP46_SESSION_RATE_LIMIT_MAX || String(DEFAULT_NIP46_SESSION_RATE_LIMIT_MAX)),
  WINDOW_MS: parseInt(process.env.NIP46_SESSION_RATE_LIMIT_WINDOW || String(DEFAULT_NIP46_SESSION_RATE_LIMIT_WINDOW_SECONDS)) * 1000
}

const MAX_NIP46_RELAYS = 32;

interface PolicyPatch {
  methods?: Record<string, boolean>
  kinds?: Record<string, boolean>
}

function isValidHex(str: string): boolean {
  return /^[0-9a-f]{64}$/i.test(str)
}

function parsePubkeyFromPath(pathname: string): string | null {
  // /api/nip46/sessions/:pubkey[/...]
  const parts = pathname.split('/').filter(Boolean)
  const idx = parts.findIndex(p => p === 'sessions')
  if (idx >= 0 && parts.length > idx + 1) return parts[idx + 1]
  return null
}

function canonicalizeRelayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
    if (url.pathname === '/' && !url.search && !url.hash) {
      return `${url.protocol}//${url.host}`
    }
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function normalizeRelayPayload(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const canonical = canonicalizeRelayUrl(trimmed)
    if (!canonical) continue
    if (seen.has(canonical)) continue
    seen.add(canonical)
    normalized.push(canonical)
    if (normalized.length >= MAX_NIP46_RELAYS) break
  }
  return normalized
}

function parsePolicyPatch(value: unknown): PolicyPatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const patch: PolicyPatch = {}

  if (value && typeof (value as any).methods === 'object' && !Array.isArray((value as any).methods)) {
    const methods: Record<string, boolean> = {}
    for (const [name, flag] of Object.entries((value as any).methods)) {
      if (typeof flag === 'boolean' && name.trim()) {
        methods[name.trim()] = flag
      }
    }
    if (Object.keys(methods).length) patch.methods = methods
  }

  if (value && typeof (value as any).kinds === 'object' && !Array.isArray((value as any).kinds)) {
    const kinds: Record<string, boolean> = {}
    for (const [rawKind, flag] of Object.entries((value as any).kinds)) {
      if (typeof flag === 'boolean') {
        const key = String(rawKind).trim()
        if (!key) continue
        if (/^\d+$/.test(key) || key === '*') {
          kinds[key] = flag
        }
      }
    }
    if (Object.keys(kinds).length) patch.kinds = kinds
  }

  return Object.keys(patch).length ? patch : null
}

function applyPolicyPatch(current: Nip46Policy | null | undefined, patch: PolicyPatch): Nip46Policy {
  const baseMethods = { ...(current?.methods ?? {}) }
  const baseKinds = { ...(current?.kinds ?? {}) }
  const result: Nip46Policy = {}

  if (patch.methods) {
    for (const [name, allow] of Object.entries(patch.methods)) {
      if (allow) baseMethods[name] = true
      else delete baseMethods[name]
    }
    result.methods = baseMethods
  }

  if (patch.kinds) {
    for (const [kind, allow] of Object.entries(patch.kinds)) {
      if (allow) baseKinds[kind] = true
      else delete baseKinds[kind]
    }
    result.kinds = baseKinds
  }

  if (result.methods && Object.keys(result.methods).length === 0) {
    result.methods = {}
  }
  if (result.kinds && Object.keys(result.kinds).length === 0) {
    result.kinds = {}
  }

  return result
}

const REQUEST_ACTION_STATUS: Record<string, Nip46RequestStatus> = {
  approve: 'approved',
  deny: 'denied',
  fail: 'failed',
  complete: 'completed'
}

function parseStatusFilter(value: string | null): Nip46RequestStatus[] | null {
  if (!value) return null
  const parts = value.split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
  const statuses: Nip46RequestStatus[] = []
  for (const part of parts) {
    if (part === 'pending' || part === 'approved' || part === 'denied' || part === 'completed' || part === 'failed' || part === 'expired') {
      statuses.push(part)
    }
  }
  return statuses.length ? statuses : null
}

/**
 * Aggregates recent grant events (kinds and methods) for a session.
 * Extracts the last N approved kinds and methods from the session's event history.
 */
function aggregateSessionHistory(
  session: { client_pubkey: string; [key: string]: any },
  userId: number | bigint,
  limit = 5
): { recent_kinds: number[]; recent_methods: string[] } {
  const events = listSessionEvents(userId, session.client_pubkey, 50)
  const kinds: number[] = []
  const methods: string[] = []
  const seenKinds = new Set<number>()
  const seenMethods = new Set<string>()

  for (const ev of events) {
    if (ev.event_type === 'grant_kind' && ev.detail) {
      const parsedKind = Number.parseInt(ev.detail, 10)
      if (!Number.isNaN(parsedKind) && !seenKinds.has(parsedKind)) {
        kinds.push(parsedKind)
        seenKinds.add(parsedKind)
      }
    } else if (ev.event_type === 'grant_method' && ev.detail) {
      if (!seenMethods.has(ev.detail)) {
        methods.push(ev.detail)
        seenMethods.add(ev.detail)
      }
    }
    if (kinds.length >= limit && methods.length >= limit) break
  }

  return { recent_kinds: kinds.slice(0, limit), recent_methods: methods.slice(0, limit) }
}

export async function handleNip46Route(
  req: Request,
  url: URL,
  _context: PrivilegedRouteContext,
  auth: RequestAuth | null
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/nip46/')) return null

  // Only available in non-headless (DB-backed) mode
  if (HEADLESS) {
    return Response.json({ error: 'NIP-46 persistence unavailable in headless mode' }, { status: 404 })
  }

  // Ensure database is initialized before processing any NIP46 requests
  // This prevents race conditions where routes are accessed before migrations complete
  await initializeNip46DB()

  const corsHeaders = getSecureCorsHeaders(req)
  const mergedVary = mergeVaryHeaders(corsHeaders)
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  // Require authenticated DB user
  if (!auth || !auth.authenticated || (typeof auth.userId !== 'number' && (typeof auth.userId !== 'string' || !/^\d+$/.test(auth.userId)))) {
    return Response.json({ error: 'Authentication required' }, { status: 401, headers })
  }
  // Convert string userId to bigint for database operations
  const userId = typeof auth.userId === 'string' ? BigInt(auth.userId) : auth.userId

  // GET /api/nip46/transport – fetch or create a stable transport key
  if (url.pathname === '/api/nip46/transport' && req.method === 'GET') {
    try {
      let sk = getTransportKey(userId)
      if (!sk) {
        // Generate 32-byte hex key using Web Crypto
        const bytes = new Uint8Array(32)
        crypto.getRandomValues(bytes)
        sk = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
        setTransportKey(userId, sk)
      }
      return Response.json({ transport_sk: sk }, { headers })
    } catch (error) {
      console.error('[NIP46] Failed to get transport key:', error)
      return Response.json({ error: 'Failed to get transport key' }, { status: 500, headers })
    }
  }

  // PUT /api/nip46/transport – rotate or set transport key
  if (url.pathname === '/api/nip46/transport' && req.method === 'PUT') {
    try {
      const body = await req.json().catch(() => null) as any
      const sk = typeof body?.transport_sk === 'string' ? body.transport_sk : ''
      const saved = setTransportKey(userId, sk)
      return Response.json({ ok: true, transport_sk: saved }, { headers })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to set transport key'
      return Response.json({ error: msg }, { status: 400, headers })
    }
  }

  if (url.pathname === '/api/nip46/relays') {
    if (req.method === 'GET') {
      const relays = getNip46Relays(userId)
      return Response.json({ relays }, { headers })
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      let body: any
      try {
        body = await parseJsonRequestBody(req)
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400, headers })
      }

      if (!('relays' in body) || (body.relays !== null && !Array.isArray(body.relays))) {
        return Response.json({ error: 'Field "relays" must be an array (or null to clear)' }, { status: 400, headers })
      }

      const sanitized = normalizeRelayPayload(body.relays)
      if (body.relays !== null && sanitized.length === 0 && Array.isArray(body.relays) && body.relays.length > 0) {
        return Response.json({ error: 'All relay URLs must use ws:// or wss:// and be valid URLs' }, { status: 400, headers })
      }

      try {
        const result = req.method === 'PUT'
          ? setNip46Relays(userId, body.relays === null ? [] : sanitized)
          : mergeNip46Relays(userId, sanitized)
        const service = getNip46Service()
        if (service) {
          service.setActiveUser(userId)
          await service.reloadRelays()
        }
        return Response.json({ relays: result }, { headers })
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to update relays'
        return Response.json({ error: msg }, { status: 400, headers })
      }
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
  }

  if (url.pathname === '/api/nip46/requests') {
    if (req.method === 'GET') {
      const statusFilter = parseStatusFilter(url.searchParams.get('status'))
      const limitParam = url.searchParams.get('limit')
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500) : 100
      const requests = listNip46Requests(userId, { status: statusFilter ?? undefined, limit })
      return Response.json({ requests }, { headers })
    }

    if (req.method === 'POST') {
      let body: any
      try {
        body = await parseJsonRequestBody(req)
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400, headers })
      }

      const id = typeof body?.id === 'string' ? body.id.trim() : ''
      if (!id) {
        return Response.json({ error: 'Field "id" is required' }, { status: 400, headers })
      }

      const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''
      const status = REQUEST_ACTION_STATUS[action]
      if (!status) {
        return Response.json({ error: 'Unsupported action. Use approve, deny, fail, or complete.' }, { status: 400, headers })
      }

      const result = typeof body?.result === 'string' ? body.result : null
      const errorMessage = typeof body?.error === 'string' ? body.error : null

       const policyPatch = parsePolicyPatch(body?.policy)
       let existingRecord = policyPatch ? getNip46RequestById(id) : null
       if (policyPatch) {
         if (!existingRecord) {
           return Response.json({ error: 'Request not found' }, { status: 404, headers })
         }
         const recordUserId = typeof existingRecord.user_id === 'bigint'
           ? existingRecord.user_id.toString()
           : String(existingRecord.user_id)
         const requestUserId = typeof userId === 'bigint' ? userId.toString() : String(userId)
         if (recordUserId !== requestUserId) {
           return Response.json({ error: 'Request not found' }, { status: 404, headers })
         }

         const session = getSession(userId, existingRecord.session_pubkey)
         if (!session) {
           return Response.json({ error: 'Session not found for policy update' }, { status: 404, headers })
         }

         try {
           const mergedPolicy = applyPolicyPatch(session.policy, policyPatch)
           updatePolicy(userId, existingRecord.session_pubkey, mergedPolicy)
         } catch (error) {
           const message = error instanceof Error ? error.message : 'Failed to update policy'
           return Response.json({ error: message }, { status: 400, headers })
         }
       }

      const record = updateNip46RequestStatus(id, status, { result, error: errorMessage })
      if (!record) {
        return Response.json({ error: 'Request not found' }, { status: 404, headers })
      }

      const service = getNip46Service()
      service?.onRequestStatusUpdated(record)

      return Response.json({ request: record }, { headers })
    }

    if (req.method === 'DELETE') {
      let body: any
      try {
        body = await parseJsonRequestBody(req)
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid JSON body' }, { status: 400, headers })
      }

      const id = typeof body?.id === 'string' ? body.id.trim() : ''
      if (!id) {
        return Response.json({ error: 'Field "id" is required' }, { status: 400, headers })
      }

      deleteNip46Request(id)
      return Response.json({ ok: true }, { headers })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
  }

  if (url.pathname === '/api/nip46/connect' && req.method === 'POST') {
    let body: any
    try {
      body = await parseJsonRequestBody(req)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON body'
      return Response.json({ error: message }, { status: 400, headers })
    }

    const uriRaw = typeof body?.uri === 'string' ? body.uri.trim() : ''
    if (!uriRaw) {
      return Response.json({ error: 'Field "uri" is required' }, { status: 400, headers })
    }
    if (!uriRaw.toLowerCase().startsWith('nostrconnect://')) {
      return Response.json({ error: 'Field "uri" must be a nostrconnect:// URL' }, { status: 400, headers })
    }

    const service = getNip46Service()
    if (!service) {
      return Response.json({ error: 'NIP-46 service unavailable' }, { status: 503, headers })
    }

    try {
      service.setActiveUser(userId)
      await service.ensureStarted()
      const result = await service.connectFromUri(userId, uriRaw)
      return Response.json(result, { headers })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process connect string'
      return Response.json({ error: message }, { status: 400, headers })
    }
  }

  // GET /api/nip46/sessions
  if (url.pathname === '/api/nip46/sessions' && req.method === 'GET') {
    const includeHistory = url.searchParams.get('history') === 'true'

    try {
      // We do not persist revoked sessions anymore; always exclude
      const sessions = listSessions(userId, { includeRevoked: false })

      // Shape for client consumption
      const payload = sessions.map(s => ({
        pubkey: s.client_pubkey,
        status: s.status,
        profile: s.profile,
        relays: s.relays,
        policy: s.policy,
        created_at: s.created_at,
        updated_at: s.updated_at,
        last_active_at: s.last_active_at,
      }))
      if (!includeHistory) return Response.json({ sessions: payload }, { headers })
      // Attach recent approvals (last 5 per session)
      const withHistory = payload.map(s => {
        const history = aggregateSessionHistory({ client_pubkey: s.pubkey }, userId, 5)
        return { ...s, ...history }
      })
      return Response.json({ sessions: withHistory }, { headers })
    } catch (error) {
      // Handle data integrity violations
      console.error('[NIP46] Error listing sessions:', error)
      if (error instanceof Error && error.message.includes('Data integrity violation')) {
        return Response.json({
          error: 'Data integrity error detected. Please contact administrator.',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined
        }, { status: 500, headers })
      }
      return Response.json({ error: 'Failed to list sessions' }, { status: 500, headers })
    }
  }

  // POST /api/nip46/sessions
  if (url.pathname === '/api/nip46/sessions' && req.method === 'POST') {
    let body: any
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const pubkey = typeof body?.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : ''
    if (!pubkey || !isValidHex(pubkey)) {
      return Response.json({ error: 'Invalid pubkey' }, { status: 400, headers })
    }

    // Rate limit check for session creation
    const recentSessions = countUserSessionsInWindow(userId, NIP46_RATE_LIMIT.WINDOW_MS)
    if (recentSessions >= NIP46_RATE_LIMIT.MAX) {
      const retryAfterSeconds = Math.ceil(NIP46_RATE_LIMIT.WINDOW_MS / 1000)
      console.warn(`[NIP46] Rate limit exceeded for user ${userId}: ${recentSessions} sessions created in ${retryAfterSeconds}s window`)
      return Response.json({
        error: `Rate limit exceeded: maximum ${NIP46_RATE_LIMIT.MAX} sessions per ${retryAfterSeconds} seconds`,
        limit: NIP46_RATE_LIMIT.MAX,
        window: retryAfterSeconds,
        current: recentSessions
      }, {
        status: 429,
        headers: {
          ...headers,
          'Retry-After': retryAfterSeconds.toString(),
          'X-RateLimit-Limit': NIP46_RATE_LIMIT.MAX.toString(),
          'X-RateLimit-Remaining': Math.max(0, NIP46_RATE_LIMIT.MAX - recentSessions).toString(),
          'X-RateLimit-Reset': new Date(Date.now() + NIP46_RATE_LIMIT.WINDOW_MS).toISOString()
        }
      })
    }

    // Only allow 'pending' or 'active'. 'revoked' is not persisted.
    const status = (body?.status === 'active' || body?.status === 'pending') ? body.status : 'pending'

    // Extract and validate profile data. Only send fields that are explicitly provided.
    let profile: Nip46Profile | undefined
    if (body?.profile && typeof body.profile === 'object') {
      const name = typeof body.profile.name === 'string' ? body.profile.name : undefined
      const url = typeof body.profile.url === 'string' ? body.profile.url : undefined
      const image = typeof body.profile.image === 'string' ? body.profile.image : undefined
      if (name || url || image) {
        profile = { name, url, image }
      }
    }

    const relays = Array.isArray(body?.relays) ? body.relays.filter((r: any) => typeof r === 'string') : null
    const policyMethods = body?.policy?.methods && typeof body.policy.methods === 'object' && !Array.isArray(body.policy.methods)
      ? body.policy.methods as Record<string, boolean>
      : undefined
    const policyKinds = body?.policy?.kinds && typeof body.policy.kinds === 'object' && !Array.isArray(body.policy.kinds)
      ? body.policy.kinds as Record<string, boolean>
      : undefined
    const policy: Nip46Policy | undefined =
      policyMethods !== undefined || policyKinds !== undefined
        ? { methods: policyMethods, kinds: policyKinds }
        : undefined
    try {
      const session = upsertSession({ userId, client_pubkey: pubkey, status, profile, relays, policy })
      try {
        logSessionEvent(userId, pubkey, 'created')
      } catch (err) {
        console.error('[NIP46] Database error during logSessionEvent(created)', {
          userId,
          pubkey,
          operation: 'logSessionEvent(created)',
          error: err instanceof Error ? err.message : String(err)
        })
      }
      return Response.json({ ok: true, session: {
        pubkey: session.client_pubkey,
        status: session.status,
        profile: session.profile,
        relays: session.relays,
        policy: session.policy,
        created_at: session.created_at,
        updated_at: session.updated_at,
        last_active_at: session.last_active_at,
      } }, { headers })
    } catch (err) {
      console.error('[NIP46] Database error during upsertSession', {
        userId,
        pubkey,
        operation: 'upsertSession',
        error: err instanceof Error ? err.message : String(err)
      })
      return Response.json({ error: 'Internal server error: failed to create session' }, { status: 500, headers })
    }
  }

  // PUT /api/nip46/sessions/:pubkey/policy
  if (url.pathname.startsWith('/api/nip46/sessions/') && url.pathname.endsWith('/policy') && req.method === 'PUT') {
    const pubkey = parsePubkeyFromPath(url.pathname)
    if (!pubkey || !isValidHex(pubkey)) return Response.json({ error: 'Invalid pubkey' }, { status: 400, headers })
    let body: any
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const methods = body?.methods && typeof body.methods === 'object' && !Array.isArray(body.methods)
      ? body.methods as Record<string, boolean>
      : undefined
    const kinds = body?.kinds && typeof body.kinds === 'object' && !Array.isArray(body.kinds)
      ? body.kinds as Record<string, boolean>
      : undefined

    if (methods === undefined && kinds === undefined) {
      return Response.json({ error: 'No policy changes provided' }, { status: 400, headers })
    }

    const session = updatePolicy(userId, pubkey.toLowerCase(), { methods, kinds })
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404, headers })
    return Response.json({ ok: true }, { headers })
  }

  // PUT /api/nip46/sessions/:pubkey/status
  if (url.pathname.startsWith('/api/nip46/sessions/') && url.pathname.endsWith('/status') && req.method === 'PUT') {
    const pubkey = parsePubkeyFromPath(url.pathname)
    if (!pubkey || !isValidHex(pubkey)) return Response.json({ error: 'Invalid pubkey' }, { status: 400, headers })
    let body: any
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const status = body?.status
    if (status !== 'pending' && status !== 'active' && status !== 'revoked') {
      return Response.json({ error: 'Invalid status' }, { status: 400, headers })
    }
    // If status is 'revoked', delete the session instead of persisting
    if (status === 'revoked') {
      const ok = deleteSession(userId, pubkey.toLowerCase())
      return Response.json({ ok }, { headers })
    }
    const touch = !!body?.touch
    const session = updateStatus(userId, pubkey.toLowerCase(), status, touch)
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404, headers })
    return Response.json({ ok: true }, { headers })
  }

  // DELETE /api/nip46/sessions/:pubkey
  if (url.pathname.startsWith('/api/nip46/sessions/') && req.method === 'DELETE') {
    const pubkey = parsePubkeyFromPath(url.pathname)
    if (!pubkey || !isValidHex(pubkey)) return Response.json({ error: 'Invalid pubkey' }, { status: 400, headers })
    const ok = deleteSession(userId, pubkey.toLowerCase())
    return Response.json({ ok }, { headers })
  }

  // GET /api/nip46/history – compact history view across sessions
  if (url.pathname === '/api/nip46/history' && req.method === 'GET') {
    try {
      // Exclude revoked sessions from history list
      const sessions = listSessions(userId, { includeRevoked: false })
      const result = sessions.map(s => {
        const history = aggregateSessionHistory(s, userId, 5)
        return {
          pubkey: s.client_pubkey,
          status: s.status,
          last_active_at: s.last_active_at,
          profile: s.profile,
          ...history
        }
      })
      return Response.json({ sessions: result }, { headers })
    } catch (error) {
      console.error('[NIP46] Error fetching session history:', error)
      return Response.json({ error: 'Failed to fetch session history' }, { status: 500, headers })
    }
  }

  return Response.json({ error: 'Not Found' }, { status: 404, headers })
}
