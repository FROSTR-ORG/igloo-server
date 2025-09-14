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
    if (authHeaders) this.serverSigner = new ServerSigner(authHeaders)
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
        const req = { id: msg?.id, method: msg?.method, params: msg?.params || [], env: { pubkey: event?.pubkey } }
        // CONNECT: ack + promote session
        if (req.method === 'connect') {
          try { await this.agent.socket.send({ id: req.id, result: 'ack' }, event?.pubkey) } catch {}
          const sess = this.sessionFromReq(req)
          this.pendingSessions = this.pendingSessions.filter(s => s.pubkey !== sess.pubkey)
          if (!this.activeSessions.find(s => s.pubkey === sess.pubkey)) this.activeSessions.push({ ...sess, status: 'active', policy: this.config.policy })
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
        if (!this.activeSessions.find(s => s.pubkey === sess.pubkey) && !this.pendingSessions.find(s => s.pubkey === sess.pubkey)) {
          this.pendingSessions.push({ ...sess, status: 'pending' })
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
    // also update controller policy baseline
    this.config.policy = { ...this.config.policy, methods: { ...this.config.policy.methods, ...policy.methods }, kinds: { ...this.config.policy.kinds, ...policy.kinds } }
    // propagate to library session manager if available
    try {
      const libSess = this.agent?.session?.get?.(pubkey)
      if (libSess) this.agent.session.update({ ...libSess, policy })
    } catch {}
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
    this.emit('session:updated')
  }

  private sessionFromReq(req: any): SignerSession {
    const p = req?.session?.profile || req?.profile || {}
    const k = req?.session?.pubkey || req?.pubkey || 'unknown'
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
    // Default deny kinds for sign_event unless explicitly allowed in baseline policy
    if (permissionReq.method === 'sign_event') {
      try {
        const tmpl = JSON.parse(permissionReq.params[0] || '{}')
        const kindAllowed = !!this.config.policy.kinds?.[String(tmpl?.kind)]
        if (!kindAllowed) permissionReq.deniedReason = `sign_event kind ${tmpl?.kind} not allowed by policy`
      } catch {}
    } else if (!this.config.policy.methods?.[permissionReq.method]) {
      permissionReq.deniedReason = `${permissionReq.method} not allowed by policy`
    }
    this.requests.push(permissionReq)
    this.reqById.set(permissionReq.id, req)
    this.emit('request:new')
  }

  private isAllowedByPolicy(req: any): boolean | null {
    try {
      if (req?.method === 'sign_event') {
        const tmpl = JSON.parse(req?.params?.[0] || '{}')
        const v = this.config.policy.kinds?.[String(tmpl?.kind)]
        if (v === true) return true; if (v === false) return false; return null
      } else {
        const v = this.config.policy.methods?.[req?.method]
        if (v === true) return true; if (v === false) return false; return null
      }
    } catch {}
    return null
  }

  private async processRequest(original: any) {
    if (!this.agent) throw new Error('Signer not initialized')
    const method = original?.method
    this.ensureActive(original?.env?.pubkey)
    switch (method) {
      case 'get_public_key': {
        const pk = this.serverSigner.get_pubkey() || await this.serverSigner.loadPublicKey()
        await this.agent.socket.send({ id: original.id, result: pk }, original.env?.pubkey)
        return
      }
      case 'sign_event': {
        const tmpl = JSON.parse(original.params?.[0])
        const signed = await this.serverSigner.sign_event(tmpl)
        await this.agent.socket.send({ id: original.id, result: JSON.stringify(signed) }, original.env?.pubkey)
        return
      }
      case 'nip44_encrypt': {
        const [peer, plaintext] = original.params || []
        const ct = await this.serverSigner.nip44_encrypt(peer, plaintext)
        await this.agent.socket.send({ id: original.id, result: ct }, original.env?.pubkey)
        return
      }
      case 'nip44_decrypt': {
        const [peer, ciphertext] = original.params || []
        const pt = await this.serverSigner.nip44_decrypt(peer, ciphertext)
        await this.agent.socket.send({ id: original.id, result: pt }, original.env?.pubkey)
        return
      }
      case 'nip04_encrypt':
      case 'nip04_decrypt': {
        await this.agent.socket.send({ id: original.id, error: 'NIP-04 not implemented' }, original.env?.pubkey)
        return
      }
      default: {
        await this.agent.socket.send({ id: original.id, result: null }, original.env?.pubkey)
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
      this.emit('session:active')
    }
  }
}
