// NIP-46 Controller (signer side) – isolates @cmdcode/nostr-connect
import { ServerSigner } from './server-signer'
import type { NIP46Config, PermissionPolicy, PermissionRequest, SignerSession } from './types'

type NostrConnectLib = typeof import('@cmdcode/nostr-connect')

type Handler = (...args: any[]) => void

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i;
const normalizePubkey = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !PUBKEY_HEX_RE.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
};

class Emitter {
  private m = new Map<string, Set<Handler>>()
  on(e: string, h: Handler) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e)!.add(h) }
  off(e: string, h: Handler) { this.m.get(e)?.delete(h) }
  emit(e: string, ...a: any[]) { 
    this.m.get(e)?.forEach(h => { 
      try { 
        h(...a) 
      } catch (err) {
        console.error(`Error in event handler for '${e}':`, err);
      }
    });
  }
}

export class NIP46Controller extends Emitter {
  private lib: NostrConnectLib | null = null
  private agent: any | null = null
  private transport: any | null = null
  private serverSigner: ServerSigner
  private config: NIP46Config
  private authHeaders: Record<string, string> = {}

  private identityPubkey: string | null = null
  private requests: PermissionRequest[] = []
  private reqById = new Map<string, any>()
  private activeSessions: SignerSession[] = []
  private pendingSessions: SignerSession[] = []
  private promotionChains = new Map<string, Promise<void>>()
  private zodLoggedOnce = false

  // Connectivity resilience
  private knownRelays = new Set<string>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(config: NIP46Config) {
    super()
    this.config = config
    this.serverSigner = new ServerSigner()
  }

  async initialize(hexPrivateKey?: string, authHeaders?: Record<string, string>, serverRelays: string[] = []) {
    if (authHeaders) {
      this.authHeaders = authHeaders
      this.serverSigner = new ServerSigner(authHeaders)
    }
    await this.loadLib()
    const { SignerAgent, SimpleSigner, Lib } = this.lib as any
    this.transport = hexPrivateKey ? new SimpleSigner(hexPrivateKey) : new SimpleSigner()

    // Remote signer agent
    this.agent = new SignerAgent(this.transport, {
      policy: this.config.policy,
      profile: this.config.profile,
      timeout: this.config.timeout ?? 30,
      // Pass through socket timeouts (allow a bit more headroom for slow relays)
      sub_timeout: Math.min(Math.max((this.config.timeout ?? 30) * 0.75, 12), 45),
      req_timeout: Math.min(Math.max((this.config.timeout ?? 30) * 0.5, 10), 30)
    })

    // Map socket lifecycle to controller events
    this.agent.socket?.on?.('ready', () => {
      this.reconnectAttempts = 0
      this.emit('connected')
      // Re-subscribe to any relays we know about (persisted or default)
      this.resubscribeKnownRelays().catch(() => {})
    })
    this.agent.socket?.on?.('closed', () => {
      this.emit('disconnected')
      this.scheduleReconnect()
    })
    // Filter noisy zod interop errors; 'bounced' handler will take over
    this.agent.socket?.on?.('error', (e: any) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg && msg.includes('_parse is not a function')) {
        // swallow and let 'bounced' path handle it; log once in development
        if (!this.zodLoggedOnce && process.env.NODE_ENV !== 'production') {
          this.zodLoggedOnce = true
          try { console.debug('[NIP46] Ignored zod interop error:', msg) } catch {}
        }
        return
      }
      this.emit('error', e instanceof Error ? e : new Error(String(e)))
      this.scheduleReconnect()
    })
    // When schema validation fails inside the lib, we decrypt + handle manually
    this.agent.socket?.on?.('bounced', async (event: any, reason: any) => {
      try {
        const payload = await this.decryptEnvelope(event)

        // Add specific error handling for JSON parsing to prevent vulnerability
        let msg;
        try {
          msg = JSON.parse(payload)
        } catch (parseErr) {
          console.error('[NIP46] Failed to parse decrypted payload:', parseErr)
          return  // Exit early without triggering generic error handling
        }

        // Normalize to request shape the rest of the controller expects
        const req = { id: msg?.id, method: msg?.method, params: msg?.params || [], env: { pubkey: event?.pubkey }, pubkey: event?.pubkey }
        // CONNECT: echo provided secret when present; otherwise 'ack'
        if (req.method === 'connect') {
          let secret: string | undefined
          try { secret = Array.isArray(req.params) && typeof req.params[1] === 'string' ? req.params[1] : undefined } catch {}
          const result = secret && secret.length > 0 ? secret : 'ack'
          try { await this.agent.socket.send({ id: req.id, result }, event?.pubkey) } catch {}
          const sess = this.sessionFromReq(req)
          const pub = this.getReqPubkey(req) || sess.pubkey
          await this.promoteToActive(pub, sess)
          return
        }
        const allowed = this.isAllowedByPolicy(req)
        if (allowed === true) {
          await this.processRequest(req as any)
          return
        }
        this.enqueuePermissionRequest(req as any)
      } catch (err) {
        console.error('[NIP46] bounced handler failed:', err)
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      }
    })

    // Handle incoming requests directly from the socket (signer side)
    this.agent.socket?.on?.('request', async (req: any) => {
      try {
        // Create session bookkeeping on first message from a client
        const sess = this.sessionFromReq(req)
        const pub = this.getReqPubkey(req) || sess.pubkey
        const valid = typeof pub === 'string' && /^[0-9a-f]{64}$/i.test(pub)
        if (valid && !this.activeSessions.find(s => s.pubkey === pub) && !this.pendingSessions.find(s => s.pubkey === pub)) {
          const pending = { ...sess, pubkey: pub, status: 'pending' as const }
          this.pendingSessions.push(pending)
          // Persist initial pending session
          this.saveSession(pending).catch((err) => {
            console.error('[NIP46] Failed to persist pending session:', err)
          })
          this.emit('session:pending')
        }

        // CONNECT: echo provided secret when present; otherwise 'ack'
        if (req.method === 'connect') {
          const pub = this.getReqPubkey(req) || sess.pubkey
          let secret: string | undefined
          try { secret = Array.isArray(req.params) && typeof req.params[1] === 'string' ? req.params[1] : undefined } catch {}
          const result = secret && secret.length > 0 ? secret : 'ack'
          try { await this.agent.socket.send({ id: req.id, result }, pub) } catch {}
          await this.promoteToActive(pub, sess)
          return
        }

        // Queue for UI approval; auto-approve if baseline policy allows
        const allowed = this.isAllowedByPolicy(req)
        if (allowed === true) {
          await this.processRequest(req)
          return
        }
        this.enqueuePermissionRequest(req)
      } catch (e) {
        this.emit('error', e instanceof Error ? e : new Error(String(e)))
      }
    })

    // Seed known relays with defaults + server relays (union, cap to 12)
    this.addKnownRelays(serverRelays)
    this.addKnownRelays(this.config.relays)
    const bootRelays = Array.from(this.knownRelays).slice(0, 12)
    await this.agent.connect(bootRelays)
    try { this.identityPubkey = await this.serverSigner.loadPublicKey().then(() => this.serverSigner.get_pubkey()) } catch {}
    // Load any persisted sessions
    try { await this.loadPersistedSessions() } catch {}
    // If socket already ready, connected already fired; otherwise the above will emit soon.
  }

  async disconnect() {
    try {
      this.destroyed = true
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
      this.agent?.close?.()
    } finally {
      this.agent = null
      this.emit('disconnected')
    }
  }

  getIdentityPubkey() { return this.identityPubkey }
  getTransportPubkey(): string | null {
    try {
      const pk = this.transport?.get_pubkey?.()
      return typeof pk === 'string' ? pk : null
    } catch { return null }
  }

  getPendingRequests(): PermissionRequest[] { return [...this.requests] }
  getActiveSessions(): SignerSession[] { return [...this.activeSessions] }
  getPendingSessions(): SignerSession[] { return [...this.pendingSessions] }

  async approveRequest(id: string, options?: { autoGrant?: boolean }) {
    const idx = this.requests.findIndex(r => r.id === id)
    if (idx === -1) return
    const req = this.requests[idx]

    try {
      if (!this.lib || !this.agent) throw new Error('Signer not initialized')
      const original = this.reqById.get(id)
      await this.processRequest(original) // single-serve approval only; does not modify policy
      if (options?.autoGrant) {
        const pubkey = this.getReqPubkey(original) || req.session?.pubkey
        if (pubkey) this.autoGrantOnApprove(pubkey, req)
      }
    } catch (e) {
      this.emit('error', e)
    } finally {
      this.requests.splice(idx, 1)
      this.reqById.delete(id)
      this.emit('request:approved')
    }
  }

  async denyRequest(id: string, reason?: string) {
    const idx = this.requests.findIndex(r => r.id === id)
    if (idx === -1) return
    const original = this.reqById.get(id)
    try {
      await this.agent?.socket?.send?.({ id: original?.id ?? id, error: reason || 'Denied' }, original?.env?.pubkey)
    } catch {}
    this.requests.splice(idx, 1)
    this.reqById.delete(id)
    this.emit('request:denied')
  }

  updateSession(pubkey: string, policy: PermissionPolicy) {
    const normalized = normalizePubkey(pubkey);
    const targetKey = normalized || pubkey;
    const upd = (arr: SignerSession[]) => {
      const i = arr.findIndex(s => normalized ? normalizePubkey(s.pubkey) === normalized : s.pubkey === pubkey)
      if (i >= 0) {
        const current = arr[i];
        arr[i] = { ...current, pubkey: normalized ? normalized : current.pubkey, policy };
      }
    }
    upd(this.activeSessions)
    upd(this.pendingSessions)
    // propagate to library session manager if available (per-session only)
    try {
      const libSess = this.agent?.session?.get?.(targetKey)
      if (libSess) this.agent.session.update({ ...libSess, policy })
    } catch {}
    // Persist policy for this session
    this.api(`/api/nip46/sessions/${targetKey}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ methods: policy.methods || {}, kinds: policy.kinds || {} })
    }).catch((err) => {
      console.error('[NIP46] Failed to persist policy update:', err)
    })
    this.emit('session:updated')
  }

  async connectToClient(connectString: string) {
    await this.loadLib()
    const { InviteEncoder } = this.lib as any
    if (!this.agent) throw new Error('Signer not initialized')

    // Example nostrconnect:// URL with client metadata (per NIP-46):
    // nostrconnect://83f3b2ae6aa368e8275397b9c26cf550101d63ebaab900d19dd4a4429f5ad8f5?
    //   relay=wss%3A%2F%2Frelay.damus.io&
    //   secret=abc123&
    //   name=Damus&
    //   url=https%3A%2F%2Fdamus.io&
    //   image=https%3A%2F%2Fdamus.io%2Fimg%2Flogo.png

    // Decode separately so we can surface accurate errors
    let invite: any
    try {
      invite = InviteEncoder.decode(connectString)
    } catch (e: any) {
      const msg = e?.message || 'invalid'
      throw new Error(`Invalid nostrconnect string: ${msg}`)
    }

    const requestedFromUri = this.parseRequestedFromUri(connectString, invite)

    // Attempt handshake: subscribe and send accept(secret)
    try {
      await this.agent.socket.subscribe(invite.relays)
      this.addKnownRelays(Array.isArray(invite.relays) ? invite.relays : [])
      const accept = { id: invite.secret, result: invite.secret }
      const normalizedPubkey = normalizePubkey(invite.pubkey)
      if (!normalizedPubkey) throw new Error('Invalid client pubkey in invite')
      await this.agent.socket.send(accept, normalizedPubkey)
      // Track local pending session; will be promoted on first request
      // Extract client's profile from the invite (the app that's connecting to us)
      // The library parses NIP-46 client metadata (name, url, image) into invite.profile
      const clientName = invite.profile?.name || invite.name || undefined
      const clientUrl = invite.profile?.url || invite.url || undefined
      const clientImage = invite.profile?.image || invite.image || undefined

      const pending: SignerSession = {
        pubkey: normalizedPubkey,
        created_at: Math.floor(Date.now() / 1000),
        profile: {
          name: clientName,
          url: clientUrl,
          image: clientImage
        },
        policy: this.config.policy,
        requested: requestedFromUri || undefined,
        status: 'pending'
      }
      const alreadyPending = this.pendingSessions.some(s => normalizePubkey(s.pubkey) === normalizedPubkey)
      const alreadyActive = this.activeSessions.some(s => normalizePubkey(s.pubkey) === normalizedPubkey)
      if (!alreadyPending && !alreadyActive) {
        this.pendingSessions.push(pending)
        // Persist pending session with relays
        this.saveSession(pending, Array.isArray(invite.relays) ? invite.relays : undefined).catch((err) => {
          console.error('[NIP46] Failed to persist session from connect string:', err)
        })
        // Merge invite relays into signer defaults (backend) as well
        try {
          const relaysToMerge: string[] = Array.isArray(invite.relays) ? invite.relays.filter((r: any) => typeof r === 'string' && r.startsWith('ws')) : []
          if (relaysToMerge.length) {
            await this.persistRelaysUnion(relaysToMerge)
          }
        } catch {}
        this.emit('session:pending')
      }
      // Promote to active immediately after handshake; some clients don't send a follow-up request right away
      try { await this.promoteToActive(normalizedPubkey, pending) } catch {}
      return true
    } catch (e: any) {
      const msg = String(e?.message || e || 'unknown')
      throw new Error(`Failed to connect: ${msg}`)
    }
  }

  revokeSession(pubkey: string) {
    const normalized = normalizePubkey(pubkey);
    const filterFn = (arr: SignerSession[]) => arr.filter(s => normalized ? normalizePubkey(s.pubkey) !== normalized : s.pubkey !== pubkey)
    this.activeSessions = filterFn(this.activeSessions)
    this.pendingSessions = filterFn(this.pendingSessions)
    const target = normalized || pubkey
    try { this.agent?.session?.revoke?.(target) } catch {}
    // Remove from persistence instead of marking revoked
    this.api(`/api/nip46/sessions/${target}`, { method: 'DELETE' }).catch((err) => {
      console.error('[NIP46] Failed to delete revoked session:', err)
    })
    this.emit('session:updated')
  }

  // Relay management
  private addKnownRelays(relays?: string[] | null) {
    if (!Array.isArray(relays)) return
    for (const r of relays) {
      if (typeof r === 'string' && r.startsWith('ws')) this.knownRelays.add(r)
    }
  }
  private async resubscribeKnownRelays() {
    if (!this.agent?.socket || this.knownRelays.size === 0) return
    try {
      await this.agent.socket.subscribe(Array.from(this.knownRelays))
    } catch (err) {
      console.debug('[NIP46] Re-subscribe failed:', err)
    }
  }

  // Reconnect with exponential backoff + jitter
  private scheduleReconnect() {
    if (this.destroyed) return
    if (this.reconnectTimer) return
    const base = 1000
    const max = 30000
    const attempt = this.reconnectAttempts++
    const backoff = Math.min(base * Math.pow(2, attempt), max)
    const jitter = Math.floor(Math.random() * 1000)
    const delay = backoff + jitter
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.destroyed) return
      try {
        await this.agent?.connect?.(Array.from(this.knownRelays.size ? this.knownRelays : new Set(this.config.relays)))
      } catch (err) {
        // Try again later
        this.scheduleReconnect()
      }
    }, delay)
  }

  // Persist merged relays to backend so the signer (Bifrost) uses them too
  private async persistRelaysUnion(newRelays: string[]) {
    const clean = (arr: string[]) =>
      Array.from(
        new Set(
          arr
            .filter(r => typeof r === 'string')
            .map(r => r.trim())
            .filter(r => r.startsWith('ws'))
        )
      )

    const cap = (arr: string[], max = 12) => arr.slice(0, max)

    try {
      // Try user credentials path first (DB mode)
      const getRes = await this.api('/api/user/relays', { method: 'GET' })
      let merged: string[]
      if (getRes.ok) {
        const data = await getRes.json().catch(() => ({ relays: [] }))
        const current: string[] = Array.isArray(data?.relays) ? data.relays : []
        merged = cap(clean([...current, ...newRelays]))
        await this.api('/api/user/relays', {
          method: 'POST',
          body: JSON.stringify({ relays: merged })
        })
        this.addKnownRelays(merged)
        return
      }
      // Fallback to headless env path
      const status = getRes.status
      if (status === 401 || status === 404 || status === 405) {
        // Pull current env, merge, then POST
        const envRes = await fetch('/api/env', { headers: { 'Content-Type': 'application/json', ...this.authHeaders } })
        let current: string[] = []
        if (envRes.ok) {
          const env = await envRes.json().catch(() => ({}))
          // RELAYS may be array or JSON string; normalize
          const raw = env?.RELAYS
          if (Array.isArray(raw)) current = raw.filter((r: any) => typeof r === 'string')
          else if (typeof raw === 'string') {
            try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) current = parsed.filter((r: any) => typeof r === 'string') } catch {}
          }
        }
        const mergedEnv = cap(clean([...current, ...newRelays]))
        await fetch('/api/env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders },
          body: JSON.stringify({ RELAYS: mergedEnv })
        })
        this.addKnownRelays(mergedEnv)
      }
    } catch {
      // Non-fatal; controller will still use its knownRelays locally
    }
  }

  private sessionFromReq(req: any): SignerSession {
    const p = req?.session?.profile || req?.profile || {}
    const rawKey = req?.session?.pubkey || req?.pubkey || req?.env?.pubkey || req?.client_pubkey || 'unknown'
    const normalizedKey = normalizePubkey(rawKey)
    const k = typeof rawKey === 'string' ? rawKey : 'unknown'
    const requested = this.parseRequestedFromConnectParams(req?.params)
    return {
      pubkey: normalizedKey || k,
      created_at: Math.floor(Date.now() / 1000),
      profile: {
        name: p?.name,
        url: p?.url,
        image: p?.image
      },
      policy: this.config.policy,
      requested: requested || undefined
    }
  }
  private sessionFromJoin(ev: any): SignerSession {
    const rawKey = ev?.pubkey || ev?.client_pubkey || 'unknown'
    const normalizedKey = normalizePubkey(rawKey)
    const k = typeof rawKey === 'string' ? rawKey : 'unknown'
    const p = ev?.profile || {}
    return {
      pubkey: normalizedKey || k,
      created_at: Math.floor(Date.now() / 1000),
      profile: {
        name: p?.name,
        url: p?.url,
        image: p?.image
      },
      policy: this.config.policy,
      status: 'pending'
    }
  }

  // Parse requested permissions from either a nostrconnect URI (perms or policy)
  // or from connect() params[2] which may be a CSV string or policy object.
  private parseRequestedFromUri(uri: string, invite?: any): PermissionPolicy | null {
    // Prefer explicitly-provided policy on the invite if present
    const fromInvite = this.normalizeRequested(invite?.policy)
    if (fromInvite) return fromInvite
    try {
      if (typeof uri !== 'string' || !uri.startsWith('nostrconnect://')) return null
      const httpish = 'http://' + uri.slice('nostrconnect://'.length)
      const u = new URL(httpish)
      const perms = u.searchParams.get('perms')
      if (!perms) return null
      return this.normalizeRequested(perms)
    } catch { return null }
  }

  private parseRequestedFromConnectParams(params: any): PermissionPolicy | null {
    try {
      if (!Array.isArray(params)) return null
      const maybe = params[2]
      return this.normalizeRequested(maybe)
    } catch { return null }
  }

  private normalizeRequested(input: any): PermissionPolicy | null {
    const policy: PermissionPolicy = { methods: {}, kinds: {} }
    if (!input) return null
    // If object in { methods, kinds } shape
    if (typeof input === 'object' && !Array.isArray(input)) {
      if (input.methods && typeof input.methods === 'object') {
        for (const k of Object.keys(input.methods)) if (input.methods[k]) policy.methods[k] = true
      }
      if (input.kinds && typeof input.kinds === 'object') {
        for (const k of Object.keys(input.kinds)) if (input.kinds[k]) policy.kinds[k] = true
      }
      return (Object.keys(policy.methods).length || Object.keys(policy.kinds).length) ? policy : null
    }
    // If string (CSV like "nip44_encrypt,sign_event:1")
    if (typeof input === 'string') {
      const tokens = input.split(',').map(s => s.trim()).filter(Boolean)
      for (const t of tokens) {
        const [name, arg] = t.split(':')
        if (!name) continue
        if (name === 'sign_event') {
          if (arg && /^\d+$/.test(arg)) policy.kinds[arg] = true
          else policy.methods['sign_event'] = true // unspecified kinds; informational only
        } else {
          policy.methods[name] = true
        }
      }
      return (Object.keys(policy.methods).length || Object.keys(policy.kinds).length) ? policy : null
    }
    // If array of strings
    if (Array.isArray(input)) return this.normalizeRequested(input.join(','))
    return null
  }

  private async loadLib() {
    if (this.lib) return this.lib
    // Use a static specifier so bundlers (esbuild) can resolve it.
    // Dynamic variable-based imports with a bare specifier won't be rewritten
    // by the bundler and will fail at runtime in the browser.
    const lib = await import('@cmdcode/nostr-connect').catch(() => null)
    if (!lib) throw new Error('Missing dependency: @cmdcode/nostr-connect')
    this.lib = lib
    return lib
  }

  private enqueuePermissionRequest(req: any) {
    const permissionReq: PermissionRequest = {
      id: req?.id ?? Math.random().toString(36).slice(2),
      method: req?.method ?? 'unknown',
      params: Array.isArray(req?.params) ? req.params : [],
      session: this.sessionFromReq(req),
      stamp: Date.now()
    }
    permissionReq.session.pubkey = normalizePubkey(permissionReq.session.pubkey) || permissionReq.session.pubkey
    // Ensure we have a session record in memory and persistence (only if pubkey looks valid)
    const rawPub = this.getReqPubkey(req) || permissionReq.session.pubkey
    const normalizedPub = normalizePubkey(rawPub)
    const valid = !!normalizedPub && /^[0-9a-f]{64}$/i.test(normalizedPub)
    if (valid && !this.activeSessions.some(s => normalizePubkey(s.pubkey) === normalizedPub) && !this.pendingSessions.some(s => normalizePubkey(s.pubkey) === normalizedPub)) {
      const pending = { ...permissionReq.session, pubkey: normalizedPub!, status: 'pending' as const, policy: permissionReq.session.policy || this.config.policy }
      this.pendingSessions.push(pending)
      this.saveSession(pending).catch((err) => {
        console.error('[NIP46] Failed to persist pending session in enqueue:', err)
      })
      this.emit('session:pending')
    }
    // Evaluate against per-session policy
    const policy = this.getPolicyForPubkey(normalizedPub || permissionReq.session.pubkey)
    if (permissionReq.method === 'sign_event') {
      try {
        const tmpl = JSON.parse(permissionReq.params[0] || '{}')
        const kindAllowed = policy?.kinds?.[String(tmpl?.kind)] === true
        if (!kindAllowed) permissionReq.deniedReason = `sign_event kind ${tmpl?.kind} not allowed by policy`
      } catch {}
    } else if (policy?.methods?.[permissionReq.method] !== true) {
      permissionReq.deniedReason = `${permissionReq.method} not allowed by policy`
    }
    this.requests.push(permissionReq)
    this.reqById.set(permissionReq.id, req)
    this.emit('request:new')
  }

  private isAllowedByPolicy(req: any): boolean | null {
    try {
      const pubkey = this.getReqPubkey(req)
      const policy = this.getPolicyForPubkey(pubkey)
      if (req?.method === 'sign_event') {
        const tmpl = JSON.parse(req?.params?.[0] || '{}')
        const v = policy?.kinds?.[String(tmpl?.kind)]
        if (v === true) return true; if (v === false) return false; return null
      } else {
        const v = policy?.methods?.[req?.method]
        if (v === true) return true; if (v === false) return false; return null
      }
    } catch {}
    return null
  }

  private async processRequest(original: any) {
    if (!this.agent) throw new Error('Signer not initialized')
    const method = original?.method
    this.ensureActive(this.getReqPubkey(original))
    try {
      switch (method) {
        case 'get_public_key': {
          let pk;
          try {
            pk = this.serverSigner.get_pubkey();
          } catch (e) {
            pk = await this.serverSigner.loadPublicKey();
          }
          await this.agent.socket.send({ id: original.id, result: pk }, this.getReqPubkey(original))
          await this.updateSessionActivity(this.getReqPubkey(original))
          return
        }
        case 'sign_event': {
          const tmpl = JSON.parse(original.params?.[0])
          const signed = await this.serverSigner.sign_event(tmpl)
          await this.agent.socket.send({ id: original.id, result: JSON.stringify(signed) }, this.getReqPubkey(original))
          await this.updateSessionActivity(this.getReqPubkey(original))
          return
        }
        case 'nip44_encrypt': {
          const [peer, plaintext] = original.params || []
          const ct = await this.serverSigner.nip44_encrypt(peer, plaintext)
          await this.agent.socket.send({ id: original.id, result: ct }, this.getReqPubkey(original))
          await this.updateSessionActivity(this.getReqPubkey(original))
          return
        }
        case 'nip44_decrypt': {
          const [peer, ciphertext] = original.params || []
          const pt = await this.serverSigner.nip44_decrypt(peer, ciphertext)
          await this.agent.socket.send({ id: original.id, result: pt }, this.getReqPubkey(original))
          await this.updateSessionActivity(this.getReqPubkey(original))
          return
        }
        case 'nip04_encrypt':
        case 'nip04_decrypt': {
          if (method === 'nip04_encrypt') {
            const [peer, plaintext] = original.params || []
            const ct = await this.serverSigner.nip04_encrypt(peer, plaintext)
            await this.agent.socket.send({ id: original.id, result: ct }, this.getReqPubkey(original))
          } else {
            const [peer, ciphertext] = original.params || []
            const pt = await this.serverSigner.nip04_decrypt(peer, ciphertext)
            await this.agent.socket.send({ id: original.id, result: pt }, this.getReqPubkey(original))
          }
          await this.updateSessionActivity(this.getReqPubkey(original))
          return
        }
        default: {
          await this.agent.socket.send({ id: original.id, result: null }, this.getReqPubkey(original))
        }
      }
    } catch (e: any) {
      const msg = e?.message || 'Operation failed'
      try { await this.agent.socket.send({ id: original.id, error: msg }, this.getReqPubkey(original)) } catch {}
      this.emit('error', e instanceof Error ? e : new Error(String(e)))
    }
  }

  private async decryptEnvelope(event: any): Promise<string> {
    // Try NIP-44 first (current lib default), fallback to NIP-04 if iv param present
    try {
      return await this.transport.nip44_decrypt(event.pubkey, event.content)
    } catch {
      try { return await this.transport.nip04_decrypt(event.pubkey, event.content) } catch (e) { throw e }
    }
  }

  private ensureActive(pubkey?: string | null) {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return
    const pending = this.pendingSessions.find(s => normalizePubkey(s.pubkey) === normalized)
    if (pending) {
      this.pendingSessions = this.pendingSessions.filter(s => normalizePubkey(s.pubkey) !== normalized)
      const existing = this.activeSessions.find(s => normalizePubkey(s.pubkey) === normalized)
      const active = { ...pending, pubkey: normalized, status: 'active' as const, policy: pending.policy || this.config.policy }
      if (existing) Object.assign(existing, active)
      else this.activeSessions.push(active)
      // Persist status transition
      this.updateSessionActivity(normalized)
      this.emit('session:active')
    }
  }

  /**
   * Serialize promotion per pubkey and safely promote a session to active.
   * - Removes any pending entry for the pubkey
   * - If an active entry exists, updates its status/policy/profile only if changed, then persists and touches activity
   * - If none exists, creates a new active entry, persists it, and touches activity
   * Calls persistence only when a state change occurred to avoid duplicate writes.
   */
  private async promoteToActive(pubkey: string, base: SignerSession): Promise<void> {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return
    await this.withPromotionLock(normalized, async () => {
      // Remove any pending entry for this pubkey first
      this.pendingSessions = this.pendingSessions.filter(s => normalizePubkey(s.pubkey) !== normalized)

      const existing = this.activeSessions.find(s => normalizePubkey(s.pubkey) === normalized)
      // Preserve any existing per-session policy when promoting again.
      // Falling back only if we truly don't have one.
      const desiredPolicy = existing?.policy || base.policy || this.config.policy
      if (existing) {
        // Compute if anything actually changed (status/policy/profile)
        const statusChanged = existing.status !== 'active'
        const policyChanged = JSON.stringify(existing.policy || {}) !== JSON.stringify(desiredPolicy || {})
        const profileChanged = JSON.stringify(existing.profile || {}) !== JSON.stringify(base.profile || {})
        const anyChanged = statusChanged || policyChanged || profileChanged

        if (anyChanged) {
          Object.assign(existing, { pubkey: normalized, status: 'active', policy: desiredPolicy, profile: base.profile || existing.profile })
          this.saveSession(existing).catch((err) => {
            console.error('[NIP46] Failed to persist updated existing session on CONNECT:', err)
          })
        }
        await this.updateSessionActivity(normalized)
      } else {
        const active: SignerSession = {
          ...base,
          pubkey: normalized,
          status: 'active',
          policy: desiredPolicy
        }
        this.activeSessions.push(active)
        this.saveSession(active).catch((err) => {
          console.error('[NIP46] Failed to persist new active session on CONNECT:', err)
        })
        await this.updateSessionActivity(normalized)
      }
      this.emit('session:active')
    })
  }

  /**
   * Ensures only one promotion per pubkey runs at a time by chaining promises.
   */
  private async withPromotionLock<T>(pubkey: string, fn: () => Promise<T>): Promise<T> {
    const key = normalizePubkey(pubkey) || pubkey
    const prev = this.promotionChains.get(key) || Promise.resolve()
    const current = prev.then(() => fn())
    // Create a chainPromise that will be stored in the map
    const chainPromise = current.then(() => {}).catch(() => {})
    // Set chainPromise so the next caller waits on this one
    this.promotionChains.set(key, chainPromise)
    try {
      const result = await current
      return result
    } finally {
      // Clean up if we're the latest in chain
      const stored = this.promotionChains.get(key)
      if (stored === chainPromise) this.promotionChains.delete(key)
    }
  }

  // Per-session helpers
  private getReqPubkey(req: any): string | undefined {
    const raw = req?.env?.pubkey || req?.session?.pubkey || req?.pubkey || undefined
    return normalizePubkey(raw)
  }

  private getPolicyForPubkey(pubkey?: string): PermissionPolicy {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return this.config.policy
    const s = this.activeSessions.find(x => normalizePubkey(x.pubkey) === normalized) || this.pendingSessions.find(x => normalizePubkey(x.pubkey) === normalized)
    return s?.policy || this.config.policy
  }

  private autoGrantOnApprove(pubkey: string, req: PermissionRequest) {
    const target = normalizePubkey(pubkey) || pubkey
    const current = { ...this.getPolicyForPubkey(target) }
    current.methods = { ...(current.methods || {}) }
    current.kinds = { ...(current.kinds || {}) }
    if (req.method === 'sign_event') {
      try {
        const tmpl = JSON.parse(req.params?.[0] || '{}')
        const k = String(tmpl?.kind)
        if (k) current.kinds![k] = true
      } catch {}
    } else {
      current.methods![req.method] = true
    }
    this.updateSession(target, current)
  }

  private async api(path: string, init?: RequestInit) {
    const headers = { 'Content-Type': 'application/json', ...this.authHeaders }
    return fetch(path, { ...(init || {}), headers })
  }

  private async loadPersistedSessions() {
    const res = await this.api('/api/nip46/sessions', { method: 'GET' })
    if (!res.ok) return
    const data = await res.json()
    const sessions = Array.isArray(data.sessions) ? data.sessions : []
    const active: SignerSession[] = []
    const pending: SignerSession[] = []
    const seen = new Set<string>()
    for (const s of sessions) {
      const normalized = normalizePubkey(s.pubkey)
      const key = normalized || s.pubkey
      if (normalized) {
        if (seen.has(normalized)) continue
        seen.add(normalized)
      }
      const sess: SignerSession = {
        pubkey: key,
        created_at: Math.floor(Date.now() / 1000),
        profile: s.profile || {},
        policy: s.policy || this.config.policy,
        status: s.status === 'active' ? 'active' : 'pending'
      }
      if (sess.status === 'active') active.push(sess)
      else pending.push(sess)
      if (Array.isArray(s.relays)) this.addKnownRelays(s.relays)
    }
    this.activeSessions = active
    this.pendingSessions = pending
    if (active.length || pending.length) this.emit('session:updated')
    // Subscribe to any relays saved with sessions to continue receiving requests after reload
    if (this.knownRelays.size > 0) {
      try { await this.agent?.socket?.subscribe?.(Array.from(this.knownRelays)) } catch (err) {
        console.warn('[NIP46] Failed to subscribe to persisted session relays:', err)
      }
    }
  }

  private async saveSession(session: SignerSession, relays?: string[]) {
    const key = normalizePubkey(session.pubkey) || session.pubkey
    const body = {
      pubkey: key,
      status: session.status || 'pending',
      profile: session.profile || {},
      policy: session.policy || this.config.policy,
      relays: relays
    }
    await this.api('/api/nip46/sessions', { method: 'POST', body: JSON.stringify(body) })
    // Track relays for future reconnects
    this.addKnownRelays(relays)
  }

  private async updateSessionStatus(pubkey: string, status: 'pending' | 'active' | 'revoked', touch = false) {
    const key = normalizePubkey(pubkey) || pubkey
    await this.api(`/api/nip46/sessions/${key}/status`, { method: 'PUT', body: JSON.stringify({ status, touch }) })
  }

  private async updateSessionActivity(pubkey: string | undefined) {
    const key = normalizePubkey(pubkey)
    if (!key) return
    try {
      await this.updateSessionStatus(key, 'active', true)
    } catch (err) {
      console.error('[NIP46] Failed to update session activity:', err)
    }
  }
}
