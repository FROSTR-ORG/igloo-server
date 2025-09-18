import { HEADLESS } from '../const.js'
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js'
import type { PrivilegedRouteContext, RequestAuth } from './types.js'
import { listSessionEvents, listSessions, logSessionEvent, upsertSession, updatePolicy, updateStatus, deleteSession, countUserSessionsInWindow, initializeNip46DB, type Nip46Policy, getTransportKey, setTransportKey } from '../db/nip46.js'

// Rate limiting configuration for NIP-46 session creation
const NIP46_RATE_LIMIT = {
  // Slightly relaxed default for local testing; override in production via env
  MAX: parseInt(process.env.NIP46_SESSION_RATE_LIMIT_MAX || '30'),
  WINDOW_MS: parseInt(process.env.NIP46_SESSION_RATE_LIMIT_WINDOW || '3600') * 1000 // Default: 1 hour
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

/**
 * Aggregates recent grant events (kinds and methods) for a session.
 * Extracts the last N approved kinds and methods from the session's event history.
 */
function aggregateSessionHistory(
  session: { client_pubkey: string; [key: string]: any },
  userId: number | bigint,
  limit = 5
): { recent_kinds: string[]; recent_methods: string[] } {
  const events = listSessionEvents(userId, session.client_pubkey, 50)
  const kinds: string[] = []
  const methods: string[] = []
  const seenKinds = new Set<string>()
  const seenMethods = new Set<string>()

  for (const ev of events) {
    if (ev.event_type === 'grant_kind' && ev.detail) {
      if (!seenKinds.has(ev.detail)) {
        kinds.push(ev.detail)
        seenKinds.add(ev.detail)
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

    // Extract and validate profile data (do not force defaults here).
    // Leaving fields undefined allows the DB upsert to preserve existing
    // values instead of overwriting with placeholders on partial updates.
    const profile = typeof body?.profile === 'object' && body.profile ? {
      name: typeof body.profile.name === 'string' ? body.profile.name : undefined,
      url: typeof body.profile.url === 'string' ? body.profile.url : undefined,
      image: typeof body.profile.image === 'string' ? body.profile.image : undefined,
    } : {}

    const relays = Array.isArray(body?.relays) ? body.relays.filter((r: any) => typeof r === 'string') : null
    const policy: Nip46Policy = {
      methods: body?.policy?.methods && typeof body.policy.methods === 'object' ? body.policy.methods : {},
      kinds: body?.policy?.kinds && typeof body.policy.kinds === 'object' ? body.policy.kinds : {},
    }
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
    const policy: Nip46Policy = {
      methods: body?.methods && typeof body.methods === 'object' ? body.methods : {},
      kinds: body?.kinds && typeof body.kinds === 'object' ? body.kinds : {},
    }
    const session = updatePolicy(userId, pubkey.toLowerCase(), policy)
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
