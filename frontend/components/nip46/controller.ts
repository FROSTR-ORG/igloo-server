// NIP-46 Controller (signer side) – isolates @cmdcode/nostr-connect
import { ServerSigner } from './server-signer'
import type { NIP46Config, PermissionPolicy, PermissionRequest, SignerSession } from './types'

type NostrConnectLib = typeof import('@cmdcode/nostr-connect')

type Handler = (...args: any[]) => void

class Emitter {
  private m = new Map<string, Set<Handler>>()
  on(e: string, h: Handler) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e)!.add(h) }
  off(e: string, h: Handler) { this.m.get(e)?.delete(h) }
  emit(e: string, ...a: any[]) { this.m.get(e)?.forEach(h => { try { h(...a) } catch {} }) }
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

  constructor(config: NIP46Config) {
    super()
    this.config = config
    this.serverSigner = new ServerSigner()
  }

  async initialize(hexPrivateKey?: string, authHeaders?: Record<string, string>) {
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
      // pass through socket timeouts
      sub_timeout: Math.min(Math.max((this.config.timeout ?? 30) / 2, 10), 30),
      req_timeout: Math.min(Math.max((this.config.timeout ?? 30) / 3, 8), 20)
    })

    // Map socket lifecycle to controller events
    this.agent.socket?.on?.('ready', () => this.emit('connected'))
    this.agent.socket?.on?.('closed', () => this.emit('disconnected'))
    // Filter noisy zod interop errors; 'bounced' handler will take over
    this.agent.socket?.on?.('error', (e: any) => {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg && msg.includes('_parse is not a function')) {
        // swallow and let 'bounced' path handle it
        console.warn('[NIP46] Ignored zod interop error:', msg)
        return
      }
      this.emit('error', e instanceof Error ? e : new Error(String(e)))
    })
    // When schema validation fails inside the lib, we decrypt + handle manually
    this.agent.socket?.on?.('bounced', async (event: any, reason: any) => {
      try {
        const payload = await this.decryptEnvelope(event)
        const msg = JSON.parse(payload)
        // Normalize to request shape the rest of the controller expects
        const req = { id: msg?.id, method: msg?.method, params: msg?.params || [], env: { pubkey: event?.pubkey }, pubkey: event?.pubkey }
        // CONNECT: ack + promote session
        if (req.method === 'connect') {
          try { await this.agent.socket.send({ id: req.id, result: 'ack' }, event?.pubkey) } catch {}
          const sess = this.sessionFromReq(req)
          this.pendingSessions = this.pendingSessions.filter(s => s.pubkey !== sess.pubkey)
          if (!this.activeSessions.find(s => s.pubkey === sess.pubkey)) {
            const active = { ...sess, status: 'active', policy: this.config.policy }
            this.activeSessions.push(active)
            // Persist
            this.saveSession(active).catch(() => {})
            this.updateSessionStatus(active.pubkey, 'active', true).catch(() => {})
          }
          this.emit('session:active')
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
          this.saveSession(pending).catch(() => {})
          this.emit('session:pending')
        }

        // CONNECT is auto-acked per NIP-46
        if (req.method === 'connect') {
          try { await this.agent.socket.accept(req, 'ack') } catch {}
          // Promote session to active on connect
          this.pendingSessions = this.pendingSessions.filter(s => s.pubkey !== sess.pubkey)
          this.activeSessions.push({ ...sess, status: 'active', policy: this.config.policy })
          this.emit('session:active')
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

    await this.agent.connect(this.config.relays)
    try { this.identityPubkey = await this.serverSigner.loadPublicKey().then(() => this.serverSigner.get_pubkey()) } catch {}
    // Load any persisted sessions
    try { await this.loadPersistedSessions() } catch {}
    // If socket already ready, connected already fired; otherwise the above will emit soon.
  }

  async disconnect() {
    try { this.agent?.close?.() } finally { this.agent = null; this.emit('disconnected') }
  }

  getIdentityPubkey() { return this.identityPubkey }

  getPendingRequests(): PermissionRequest[] { return [...this.requests] }
  getActiveSessions(): SignerSession[] { return [...this.activeSessions] }
  getPendingSessions(): SignerSession[] { return [...this.pendingSessions] }

  async approveRequest(id: string) {
    const idx = this.requests.findIndex(r => r.id === id)
    if (idx === -1) return
    const req = this.requests[idx]

    try {
      if (!this.lib || !this.agent) throw new Error('Signer not initialized')
      const original = this.reqById.get(id)
      await this.processRequest(original)
      const pubkey = this.getReqPubkey(original)
      if (pubkey) this.autoGrantOnApprove(pubkey, req)
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
    const upd = (arr: SignerSession[]) => {
      const i = arr.findIndex(s => s.pubkey === pubkey)
      if (i >= 0) arr[i] = { ...arr[i], policy }
    }
    upd(this.activeSessions)
    upd(this.pendingSessions)
    // propagate to library session manager if available (per-session only)
    try {
      const libSess = this.agent?.session?.get?.(pubkey)
      if (libSess) this.agent.session.update({ ...libSess, policy })
    } catch {}
    // Persist policy for this session
    this.api(`/api/nip46/sessions/${pubkey}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ methods: policy.methods || {}, kinds: policy.kinds || {} })
    }).catch(() => {})
    this.emit('session:updated')
  }

  async connectToClient(connectString: string) {
    await this.loadLib()
    const { InviteEncoder } = this.lib as any
    if (!this.agent) throw new Error('Signer not initialized')
    // Decode separately so we can surface accurate errors
    let invite: any
    try {
      invite = InviteEncoder.decode(connectString)
    } catch (e: any) {
      const msg = e?.message || 'invalid'
      throw new Error(`Invalid nostrconnect string: ${msg}`)
    }
    // Attempt handshake: subscribe and send accept(secret)
    try {
      await this.agent.socket.subscribe(invite.relays)
      const accept = { id: invite.secret, result: invite.secret }
      await this.agent.socket.send(accept, invite.pubkey)
      // Track local pending session; will be promoted on first request
      const pending: SignerSession = {
        pubkey: invite.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        profile: { name: invite.profile?.name, url: invite.profile?.url, image: invite.profile?.image },
        policy: this.config.policy,
        status: 'pending'
      }
      if (!this.pendingSessions.find(s => s.pubkey === pending.pubkey) && !this.activeSessions.find(s => s.pubkey === pending.pubkey)) {
        this.pendingSessions.push(pending)
        // Persist pending session with relays
        this.saveSession(pending, Array.isArray(invite.relays) ? invite.relays : undefined).catch(() => {})
        this.emit('session:pending')
      }
      return true
    } catch (e: any) {
      const msg = String(e?.message || e || 'unknown')
      throw new Error(`Failed to connect: ${msg}`)
    }
  }

  revokeSession(pubkey: string) {
    const f = (arr: SignerSession[]) => arr.filter(s => s.pubkey !== pubkey)
    this.activeSessions = f(this.activeSessions)
    this.pendingSessions = f(this.pendingSessions)
    try { this.agent?.session?.revoke?.(pubkey) } catch {}
    // Remove from persistence instead of marking revoked
    this.api(`/api/nip46/sessions/${pubkey}`, { method: 'DELETE' }).catch(() => {})
    this.emit('session:updated')
  }

  private sessionFromReq(req: any): SignerSession {
    const p = req?.session?.profile || req?.profile || {}
    const k = req?.session?.pubkey || req?.pubkey || req?.env?.pubkey || req?.client_pubkey || 'unknown'
    return { pubkey: k, created_at: Math.floor(Date.now() / 1000), profile: { name: p?.name, url: p?.url, image: p?.image }, policy: this.config.policy }
  }
  private sessionFromJoin(ev: any): SignerSession {
    const k = ev?.pubkey || ev?.client_pubkey || 'unknown'
    const p = ev?.profile || {}
    return { pubkey: k, created_at: Math.floor(Date.now() / 1000), profile: { name: p?.name, url: p?.url, image: p?.image }, policy: this.config.policy, status: 'pending' }
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
    // Ensure we have a session record in memory and persistence (only if pubkey looks valid)
    const pub = this.getReqPubkey(req) || permissionReq.session.pubkey
    const valid = typeof pub === 'string' && /^[0-9a-f]{64}$/i.test(pub)
    if (valid && !this.activeSessions.find(s => s.pubkey === pub) && !this.pendingSessions.find(s => s.pubkey === pub)) {
      const pending = { ...permissionReq.session, pubkey: pub, status: 'pending' as const, policy: permissionReq.session.policy || this.config.policy }
      this.pendingSessions.push(pending)
      this.saveSession(pending).catch(() => {})
      this.emit('session:pending')
    }
    // Evaluate against per-session policy
    const policy = this.getPolicyForPubkey(permissionReq.session.pubkey)
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
    switch (method) {
      case 'get_public_key': {
        const pk = this.serverSigner.get_pubkey() || await this.serverSigner.loadPublicKey()
        await this.agent.socket.send({ id: original.id, result: pk }, this.getReqPubkey(original))
        const pub = this.getReqPubkey(original); if (pub) this.updateSessionStatus(pub, 'active', true).catch(() => {})
        return
      }
      case 'sign_event': {
        const tmpl = JSON.parse(original.params?.[0])
        const signed = await this.serverSigner.sign_event(tmpl)
        await this.agent.socket.send({ id: original.id, result: JSON.stringify(signed) }, this.getReqPubkey(original))
        const pub = this.getReqPubkey(original); if (pub) this.updateSessionStatus(pub, 'active', true).catch(() => {})
        return
      }
      case 'nip44_encrypt': {
        const [peer, plaintext] = original.params || []
        const ct = await this.serverSigner.nip44_encrypt(peer, plaintext)
        await this.agent.socket.send({ id: original.id, result: ct }, this.getReqPubkey(original))
        const pub = this.getReqPubkey(original); if (pub) this.updateSessionStatus(pub, 'active', true).catch(() => {})
        return
      }
      case 'nip44_decrypt': {
        const [peer, ciphertext] = original.params || []
        const pt = await this.serverSigner.nip44_decrypt(peer, ciphertext)
        await this.agent.socket.send({ id: original.id, result: pt }, this.getReqPubkey(original))
        const pub = this.getReqPubkey(original); if (pub) this.updateSessionStatus(pub, 'active', true).catch(() => {})
        return
      }
      case 'nip04_encrypt':
      case 'nip04_decrypt': {
        await this.agent.socket.send({ id: original.id, error: 'NIP-04 not implemented' }, this.getReqPubkey(original))
        return
      }
      default: {
        await this.agent.socket.send({ id: original.id, result: null }, this.getReqPubkey(original))
      }
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
    if (!pubkey) return
    const pending = this.pendingSessions.find(s => s.pubkey === pubkey)
    if (pending) {
      this.pendingSessions = this.pendingSessions.filter(s => s.pubkey !== pubkey)
      const existing = this.activeSessions.find(s => s.pubkey === pubkey)
      const active = { ...pending, status: 'active' as const, policy: pending.policy || this.config.policy }
      if (existing) Object.assign(existing, active)
      else this.activeSessions.push(active)
      // Persist status transition
      this.updateSessionStatus(pubkey, 'active', true).catch(() => {})
      this.emit('session:active')
    }
  }

  // Per-session helpers
  private getReqPubkey(req: any): string | undefined {
    return (req?.env?.pubkey || req?.session?.pubkey || req?.pubkey || undefined)
  }

  private getPolicyForPubkey(pubkey?: string): PermissionPolicy {
    if (!pubkey) return this.config.policy
    const s = this.activeSessions.find(x => x.pubkey === pubkey) || this.pendingSessions.find(x => x.pubkey === pubkey)
    return s?.policy || this.config.policy
  }

  private autoGrantOnApprove(pubkey: string, req: PermissionRequest) {
    const current = { ...this.getPolicyForPubkey(pubkey) }
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
    this.updateSession(pubkey, current)
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
    for (const s of sessions) {
      const sess: SignerSession = {
        pubkey: s.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        profile: s.profile || {},
        policy: s.policy || this.config.policy,
        status: s.status === 'active' ? 'active' : 'pending'
      }
      if (sess.status === 'active') active.push(sess)
      else pending.push(sess)
    }
    this.activeSessions = active
    this.pendingSessions = pending
    if (active.length || pending.length) this.emit('session:updated')
  }

  private async saveSession(session: SignerSession, relays?: string[]) {
    const body = {
      pubkey: session.pubkey,
      status: session.status || 'pending',
      profile: session.profile || {},
      policy: session.policy || this.config.policy,
      relays: relays
    }
    await this.api('/api/nip46/sessions', { method: 'POST', body: JSON.stringify(body) })
  }

  private async updateSessionStatus(pubkey: string, status: 'pending' | 'active' | 'revoked', touch = false) {
    await this.api(`/api/nip46/sessions/${pubkey}/status`, { method: 'PUT', body: JSON.stringify({ status, touch }) })
  }
}
