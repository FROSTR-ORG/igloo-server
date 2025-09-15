import { HEADLESS } from '../const.js'
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js'
import type { PrivilegedRouteContext, RequestAuth } from './types.js'
import { listSessionEvents, listSessions, logSessionEvent, upsertSession, updatePolicy, updateStatus, deleteSession, type Nip46Policy } from '../db/nip46.js'

function isValidHex(str: string): boolean {
  return /^[0-9a-f]+$/i.test(str)
}

function parsePubkeyFromPath(pathname: string): string | null {
  // /api/nip46/sessions/:pubkey[/...]
  const parts = pathname.split('/').filter(Boolean)
  const idx = parts.findIndex(p => p === 'sessions')
  if (idx >= 0 && parts.length > idx + 1) return parts[idx + 1]
  return null
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
  if (!auth || !auth.authenticated || (typeof auth.userId !== 'number' && typeof auth.userId !== 'bigint')) {
    return Response.json({ error: 'Authentication required' }, { status: 401, headers })
  }
  const userId = auth.userId as number | bigint

  // GET /api/nip46/sessions
  if (url.pathname === '/api/nip46/sessions' && req.method === 'GET') {
    const includeHistory = url.searchParams.get('history') === 'true'
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
      const events = listSessionEvents(userId, s.pubkey, 50)
      const kinds: string[] = []
      const methods: string[] = []
      for (const ev of events) {
        if (kinds.length < 5 && ev.event_type === 'grant_kind' && ev.detail) kinds.push(ev.detail)
        if (methods.length < 5 && ev.event_type === 'grant_method' && ev.detail) methods.push(ev.detail)
        if (kinds.length >= 5 && methods.length >= 5) break
      }
      return { ...s, recent_kinds: kinds, recent_methods: methods }
    })
    return Response.json({ sessions: withHistory }, { headers })
  }

  // POST /api/nip46/sessions
  if (url.pathname === '/api/nip46/sessions' && req.method === 'POST') {
    let body: any
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }) }
    const pubkey = typeof body?.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : ''
    if (!pubkey || !isValidHex(pubkey)) {
      return Response.json({ error: 'Invalid pubkey' }, { status: 400, headers })
    }
    // Only allow 'pending' or 'active'. 'revoked' is not persisted.
    const status = (body?.status === 'active' || body?.status === 'pending') ? body.status : 'pending'
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
    const session = upsertSession({ userId, client_pubkey: pubkey, status, profile, relays, policy })
    try { logSessionEvent(userId, pubkey, 'created') } catch {}
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
    // Exclude revoked sessions from history list
    const sessions = listSessions(userId, { includeRevoked: false })
    const result = sessions.map(s => {
      const events = listSessionEvents(userId, s.client_pubkey, 50)
      const kinds: string[] = []
      const methods: string[] = []
      for (const ev of events) {
        if (kinds.length < 5 && ev.event_type === 'grant_kind' && ev.detail) kinds.push(ev.detail)
        if (methods.length < 5 && ev.event_type === 'grant_method' && ev.detail) methods.push(ev.detail)
        if (kinds.length >= 5 && methods.length >= 5) break
      }
      return {
        pubkey: s.client_pubkey,
        status: s.status,
        last_active_at: s.last_active_at,
        profile: s.profile,
        recent_kinds: kinds,
        recent_methods: methods
      }
    })
    return Response.json({ sessions: result }, { headers })
  }

  return Response.json({ error: 'Not Found' }, { status: 404, headers })
}
