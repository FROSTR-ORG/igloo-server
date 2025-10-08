import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import type { ServerBifrostNode } from '../routes/types.js'
import {
  createNip46Request,
  getSession,
  getNip46RequestById,
  getNip46Relays,
  getTransportKey,
  mergeNip46Relays,
  Nip46Policy,
  Nip46RequestRecord,
  setNip46Relays,
  setTransportKey,
  upsertSession,
  updateStatus,
  updateNip46RequestStatus,
} from '../db/nip46.js'
import { logSessionEvent } from '../db/nip46.js'
import { deriveSharedSecret, xOnly } from '../routes/crypto-utils.js'
import { getOpTimeoutMs, withTimeout } from '../routes/utils.js'
import { getEventHash, nip44 } from 'nostr-tools'

const DEFAULT_RELAYS = ['wss://relay.primal.net']

interface Nip46ServiceDeps {
  addServerLog: (type: string, message: string, data?: any) => void
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void
  getNode: () => ServerBifrostNode | null
}

let NostrConnectLib: typeof import('@cmdcode/nostr-connect') | null = null
async function loadNostrConnect() {
  if (!NostrConnectLib) {
    NostrConnectLib = await import('@cmdcode/nostr-connect')
  }
  return NostrConnectLib
}

function generateTransportKey(): string {
  return randomBytes(32).toString('hex')
}

function normalizePubkey(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !/^[0-9a-f]{64}$/.test(trimmed)) return undefined
  return trimmed
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function normalizeRequestedPolicy(input: any): Nip46Policy | null {
  if (!input) return null

  const methods: Record<string, boolean> = {}
  const kinds: Record<string, boolean> = {}

  if (typeof input === 'object' && !Array.isArray(input)) {
    if (input.methods && typeof input.methods === 'object') {
      for (const key of Object.keys(input.methods)) {
        if (input.methods[key]) methods[key] = true
      }
    }
    if (input.kinds && typeof input.kinds === 'object') {
      for (const key of Object.keys(input.kinds)) {
        if (input.kinds[key]) kinds[key] = true
      }
    }
  } else if (typeof input === 'string') {
    const tokens = input.split(',').map(token => token.trim()).filter(Boolean)
    for (const token of tokens) {
      const [name, arg] = token.split(':')
      if (!name) continue
      if (name === 'sign_event') {
        if (arg && /^\d+$/.test(arg)) {
          kinds[arg] = true
        } else {
          methods[name] = true
        }
      } else {
        methods[name] = true
      }
    }
  } else if (Array.isArray(input)) {
    return normalizeRequestedPolicy(input.join(','))
  } else {
    return null
  }

  const policy: Nip46Policy = {}
  if (Object.keys(methods).length > 0) {
    policy.methods = methods
  }
  if (Object.keys(kinds).length > 0) {
    policy.kinds = kinds
  }
  return Object.keys(policy).length > 0 ? policy : null
}

function parseRequestedPolicyFromUri(uri: string, invite?: any): Nip46Policy | null {
  const fromInvite = normalizeRequestedPolicy(invite?.policy)
  if (fromInvite) return fromInvite

  if (typeof uri !== 'string' || !uri.startsWith('nostrconnect://')) return null
  try {
    const httpish = 'http://' + uri.slice('nostrconnect://'.length)
    const parsed = new URL(httpish)
    const perms = parsed.searchParams.get('perms')
    if (!perms) return null
    return normalizeRequestedPolicy(perms)
  } catch {
    return null
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function hexToUint8(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) throw new Error('Invalid hex string')
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)))
}

function nip04EncryptInternal(plaintext: string, sharedSecretHex: string): string {
  const key = createHash('sha256').update(Buffer.from(sharedSecretHex, 'hex')).digest()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]).toString('base64')
  return `${encrypted}?iv=${iv.toString('base64')}`
}

function nip04DecryptInternal(ciphertextWithIv: string, sharedSecretHex: string): string {
  const match = ciphertextWithIv.match(/^(.*)\?iv=([^&]+)$/)
  if (!match) throw new Error('Invalid NIP-04 ciphertext format')
  const [, ciphertextB64, ivB64] = match
  const key = createHash('sha256').update(Buffer.from(sharedSecretHex, 'hex')).digest()
  const iv = decodeBase64Strict(ivB64, 'IV')
  if (iv.length !== 16) throw new Error('IV must be 16 bytes')
  const ciphertext = decodeBase64Strict(ciphertextB64, 'ciphertext')
  if (ciphertext.length === 0) throw new Error('Ciphertext must not be empty')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  try {
    const result = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return result
  } catch {
    throw new Error('Decryption failed')
  }
}

function decodeBase64Strict(value: string, label: string): Buffer {
  const normalized = value.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`Invalid base64 ${label}`)
  }
  const buf = Buffer.from(normalized, 'base64')
  if (buf.length === 0 && normalized.length > 0) {
    throw new Error(`Invalid base64 ${label}`)
  }
  const reencoded = buf.toString('base64').replace(/=+$/, '')
  const normalizedInput = normalized.replace(/=+$/, '')
  if (reencoded !== normalizedInput) {
    throw new Error(`Invalid base64 ${label}`)
  }
  return buf
}

export class Nip46Service {
  private readonly deps: Nip46ServiceDeps
  private signer: any | null = null
  private agent: any | null = null
  private activeUserId: number | bigint | null = null
  private currentRelays: string[] = []
  private starting = false
  private stopping = false
  private started = false
  private readonly onRequestBound: (req: any) => void
  private readonly onBouncedBound: (event: any, reason: any) => void
  private readonly onErrorBound: (err: any) => void
  private readonly onClosedBound: () => void
  private processing = new Set<string>()

  constructor(deps: Nip46ServiceDeps) {
    this.deps = deps
    this.onRequestBound = this.handleSocketRequest.bind(this)
    this.onBouncedBound = this.handleSocketBounced.bind(this)
    this.onErrorBound = this.handleSocketError.bind(this)
    this.onClosedBound = this.handleSocketClosed.bind(this)
  }

  get isRunning(): boolean {
    return this.started && !this.stopping
  }

  getRelays(): string[] {
    return [...this.currentRelays]
  }

  setActiveUser(userId: number | bigint | null) {
    if (this.activeUserId === userId) return
    this.activeUserId = userId
    if (userId == null) {
      void this.stop()
    } else {
      void this.ensureStarted()
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.activeUserId == null) return
    if (this.started || this.starting) return
    this.starting = true
    try {
      await this.startInternal()
    } catch (error) {
      this.log('error', 'Failed to start NIP-46 service', { error: this.serializeError(error) })
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    if (!this.agent || this.stopping) return
    this.stopping = true
    try {
      try {
        await this.agent.close?.()
      } catch (error) {
        this.log('warn', 'Error closing NIP-46 agent', { error: this.serializeError(error) })
      }
      this.removeAgentListeners()
      this.agent = null
      this.signer = null
      this.started = false
    } finally {
      this.stopping = false
    }
  }

  async reloadRelays(): Promise<void> {
    if (!this.agent || this.activeUserId == null) return
    const relays = await this.loadRelays(this.activeUserId)
    if (!arraysEqual(relays, this.currentRelays)) {
      try {
        await this.agent.connect(relays)
        this.currentRelays = relays
        this.log('info', 'Reloaded NIP-46 relays', { relays })
      } catch (error) {
        this.log('error', 'Failed to reload NIP-46 relays', { error: this.serializeError(error) })
      }
    }
  }

  async connectFromUri(userId: number | bigint, uri: string) {
    const trimmed = typeof uri === 'string' ? uri.trim() : ''
    if (!trimmed) throw new Error('Connect string is required')
    if (!trimmed.toLowerCase().startsWith('nostrconnect://')) {
      throw new Error('Connect string must start with nostrconnect://')
    }

    if (this.activeUserId !== userId) {
      this.setActiveUser(userId)
    }

    await this.ensureStarted()

    if (!this.agent?.socket) {
      throw new Error('NIP-46 service is not ready')
    }

    const lib = await loadNostrConnect()
    const { InviteEncoder } = lib as any

    let invite: any
    try {
      invite = InviteEncoder.decode(trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unable to decode'
      throw new Error(`Invalid nostrconnect string: ${message}`)
    }

    const normalizedPubkey = normalizePubkey(invite?.pubkey)
    if (!normalizedPubkey) {
      throw new Error('Invalid client pubkey in connect string')
    }

    const relays = Array.isArray(invite?.relays)
      ? invite.relays.filter((relay: any) => typeof relay === 'string' && relay.startsWith('ws'))
      : []

    if (relays.length) {
      try {
        await this.agent.socket.subscribe(relays)
        this.currentRelays = Array.from(new Set([...this.currentRelays, ...relays]))
      } catch (error) {
        this.log('warn', 'Failed to subscribe to relays from connect string', { error: this.serializeError(error), relays })
      }
      try {
        mergeNip46Relays(userId, relays)
      } catch (error) {
        this.log('warn', 'Failed to persist relays from connect string', { error: this.serializeError(error) })
      }
    }

    const secret = typeof invite?.secret === 'string' && invite.secret.length > 0 ? invite.secret : 'ack'
    try {
      await this.agent.socket.send({ id: invite?.secret ?? null, result: secret }, normalizedPubkey)
    } catch (error) {
      this.log('warn', 'Failed to send connect acknowledgement', { error: this.serializeError(error) })
    }

    const profileName = typeof invite?.profile?.name === 'string' ? invite.profile.name : (typeof invite?.name === 'string' ? invite.name : undefined)
    const profileUrl = typeof invite?.profile?.url === 'string' ? invite.profile.url : (typeof invite?.url === 'string' ? invite.url : undefined)
    const profileImage = typeof invite?.profile?.image === 'string' ? invite.profile.image : (typeof invite?.image === 'string' ? invite.image : undefined)

    const policy = parseRequestedPolicyFromUri(trimmed, invite) ?? undefined

    let session
    try {
      session = upsertSession({
        userId,
        client_pubkey: normalizedPubkey,
        status: 'pending',
        profile: {
          name: profileName,
          url: profileUrl,
          image: profileImage
        },
        relays: relays.length ? relays : undefined,
        policy
      })
      logSessionEvent(userId, normalizedPubkey, 'created')
    } catch (error) {
      this.log('error', 'Failed to persist NIP-46 session from connect string', { error: this.serializeError(error) })
      throw new Error('Failed to persist session for invite')
    }

    this.broadcast('nip46:session_pending', 'NIP-46 session created', {
      session: session.client_pubkey,
      status: session.status,
      profile: session.profile,
      relays
    })

    return {
      session: {
        pubkey: session.client_pubkey,
        status: session.status,
        profile: session.profile,
        relays: session.relays,
        policy: session.policy
      }
    }
  }

  private async startInternal(): Promise<void> {
    if (this.activeUserId == null) return
    const [lib, relays] = await Promise.all([
      loadNostrConnect(),
      this.loadRelays(this.activeUserId)
    ])
    const { SignerAgent, SimpleSigner } = lib as any

    let transportSk = getTransportKey(this.activeUserId)
    if (!transportSk) {
      transportSk = generateTransportKey()
      setTransportKey(this.activeUserId, transportSk)
    }

    this.signer = new SimpleSigner(transportSk)
    const config = {
      policy: {
        methods: {
          sign_event: true,
          get_public_key: true,
          nip44_encrypt: true,
          nip44_decrypt: true,
          nip04_encrypt: false,
          nip04_decrypt: false
        },
        kinds: {} as Record<string, boolean>
      },
      profile: {
        name: 'Igloo Server',
        url: undefined,
        image: undefined
      },
      timeout: 60
    }

    this.agent = new SignerAgent(this.signer, config)
    this.registerAgentListeners()

    await this.agent.connect(relays)
    this.started = true
    this.currentRelays = relays
    this.log('info', 'NIP-46 service started', { relays })
  }

  private async loadRelays(userId: number | bigint): Promise<string[]> {
    const stored = getNip46Relays(userId)
    if (stored.length > 0) return stored
    setNip46Relays(userId, DEFAULT_RELAYS)
    return [...DEFAULT_RELAYS]
  }

  private registerAgentListeners() {
    if (!this.agent?.socket) return
    const socket = this.agent.socket
    socket.on?.('ready', () => this.log('info', 'NIP-46 socket ready'))
    socket.on?.('request', this.onRequestBound)
    socket.on?.('bounced', this.onBouncedBound)
    socket.on?.('error', this.onErrorBound)
    socket.on?.('closed', this.onClosedBound)
  }

  private removeAgentListeners() {
    if (!this.agent?.socket) return
    const socket = this.agent.socket
    socket.off?.('request', this.onRequestBound)
    socket.off?.('bounced', this.onBouncedBound)
    socket.off?.('error', this.onErrorBound)
    socket.off?.('closed', this.onClosedBound)
  }

  private async handleSocketRequest(req: any) {
    if (this.activeUserId == null) return
    const session = this.sessionFromReq(req)
    const pubkey = session.pubkey
    if (!pubkey) {
      this.log('warn', 'Received NIP-46 request without valid pubkey', { req })
      return
    }

    try {
      upsertSession({
        userId: this.activeUserId,
        client_pubkey: pubkey,
        status: 'active',
        profile: session.profile,
        relays: session.relays,
        policy: session.policy ?? undefined,
        touchLastActive: true
      })
    } catch (error) {
      this.log('error', 'Failed to upsert NIP-46 session', { error: this.serializeError(error) })
    }

    if (req.method === 'connect') {
      await this.respondConnect(req, pubkey)
      return
    }

    if (req.method === 'ping') {
      await this.sendSocketResponse(req, pubkey, { result: 'pong' })
      return
    }

    if (req.method === 'get_public_key') {
      const identity = this.getIdentityPubkey()
      if (!identity) {
        this.log('warn', 'Unable to resolve identity pubkey for get_public_key')
        await this.sendSocketResponse(req, pubkey, { error: 'IDENTITY_UNAVAILABLE' })
        return
      }
      await this.sendSocketResponse(req, pubkey, { result: identity })
      return
    }

    const existing = getNip46RequestById(String(req.id))
    if (existing) {
      this.log('info', 'Ignoring duplicate NIP-46 request', { id: req.id })
      return
    }

    const payload = {
      id: req.id,
      method: req.method,
      params: Array.isArray(req.params) ? req.params : [],
      session: session
    }

    const record = createNip46Request({
      userId: this.activeUserId,
      session_pubkey: pubkey,
      method: req.method,
      payload
    })

    const policy = this.resolveSessionPolicy(pubkey, session.policy)
    if (this.shouldAutoApprove(record, payload, policy)) {
      const updated = updateNip46RequestStatus(record.id, 'approved')
      if (updated) {
        this.log('info', 'Auto-approved NIP-46 request via policy', { id: record.id, method: record.method })
        this.onRequestStatusUpdated(updated)
      }
      return
    }

    this.log('info', 'Queued NIP-46 request', { id: record.id, method: record.method })
    this.broadcast('nip46:request', 'New NIP-46 request', {
      requestId: record.id,
      method: record.method,
      session: pubkey
    })
  }

  private async respondConnect(req: any, pubkey: string) {
    let secret: string | undefined
    try {
      secret = Array.isArray(req.params) && typeof req.params[1] === 'string' ? req.params[1] : undefined
    } catch {}
    const result = secret && secret.length > 0 ? secret : 'ack'
    await this.sendSocketResponse(req, pubkey, { result })
    try {
      updateStatus(this.activeUserId!, pubkey, 'active', true)
      logSessionEvent(this.activeUserId!, pubkey, 'status_change', undefined, 'active')
    } catch (error) {
      this.log('warn', 'Failed to mark session active', { error: this.serializeError(error) })
    }
  }

  private async sendSocketResponse(req: any, pubkey: string, payload: { result?: any; error?: any }) {
    if (!this.agent?.socket?.send) return
    try {
      await this.agent.socket.send({ id: req.id ?? null, ...payload }, pubkey)
    } catch (error) {
      this.log('error', 'Failed to send NIP-46 response', { error: this.serializeError(error), id: req.id })
    }
  }

  private async handleSocketBounced(event: any, reason: any) {
    const reasonString = typeof reason === 'string' ? reason : ''

    if (reasonString.includes('_parse is not a function')) {
      try {
        const payload = await this.decryptEnvelope(event)
        const message = JSON.parse(payload)
        const req = {
          id: message?.id ?? null,
          method: message?.method,
          params: Array.isArray(message?.params) ? message.params : [],
          session: event?.session,
          pubkey: event?.pubkey,
          env: { pubkey: event?.pubkey }
        }

        if (req.method === 'connect') {
          const normalized = normalizePubkey(req.pubkey) || event?.pubkey
          if (normalized) {
            await this.respondConnect(req, normalized)
          }
          return
        }

        await this.handleSocketRequest(req)
        return
      } catch (error) {
        this.log('warn', 'Failed to decode bounced NIP-46 message', { error: this.serializeError(error) })
      }
    }

    this.log('warn', 'NIP-46 message bounced', { event, reason })
  }

  private handleSocketError(err: any) {
    const serialized = this.serializeError(err)
    const message = typeof serialized === 'object' && serialized?.message ? serialized.message : String(serialized)
    if (message && message.includes('_parse is not a function')) {
      // Library emits a noisy zod parse error; already handled via bounced path.
      return
    }
    this.log('error', 'NIP-46 socket error', { error: serialized })
  }

  private handleSocketClosed() {
    this.log('warn', 'NIP-46 socket closed, attempting restart')
    if (this.stopping) {
      return
    }

    // Drop existing agent state so ensureStarted() performs a full restart.
    this.removeAgentListeners()
    this.agent = null
    this.signer = null
    this.started = false

    if (this.activeUserId != null) {
      void this.ensureStarted()
    }
  }

  onRequestStatusUpdated(record: Nip46RequestRecord) {
    if (!record) return
    if (record.status === 'approved') {
      void this.processApprovedRequest(record)
      return
    }

    if (record.status === 'denied' || record.status === 'failed') {
      void this.processFailure(record)
    }

    this.broadcast('nip46:request_status', 'NIP-46 request status updated', {
      requestId: record.id,
      status: record.status,
      session: record.session_pubkey
    })
  }

  private async processApprovedRequest(record: Nip46RequestRecord) {
    if (this.processing.has(record.id)) return
    if (this.activeUserId == null) return
    this.processing.add(record.id)

    try {
      if (!this.isRunning) {
        await this.ensureStarted()
      }
      const payload = this.parseStoredPayload(record)
      if (!payload) {
        throw new Error('Invalid stored request payload')
      }

      const pubkey = record.session_pubkey
      const method = payload.method
      let resultPayload: string | null = null
      let eventId: string | null = null

      switch (method) {
        case 'sign_event': {
          const { signedEventJson, eventId: computedEventId } = await this.handleSignEvent(payload, pubkey, record.id)
          resultPayload = signedEventJson
          eventId = computedEventId
          break
        }
        case 'nip44_encrypt':
          resultPayload = await this.handleNip44Encrypt(payload)
          break
        case 'nip44_decrypt':
          resultPayload = await this.handleNip44Decrypt(payload)
          break
        case 'nip04_encrypt':
          resultPayload = await this.handleNip04Encrypt(payload)
          break
        case 'nip04_decrypt':
          resultPayload = await this.handleNip04Decrypt(payload)
          break
        default:
          throw new Error(`Unsupported method ${method}`)
      }

      if (resultPayload == null) {
        throw new Error('Empty result payload')
      }

      const responseId = payload.id ?? record.id
      await this.sendSocketResponse({ id: responseId }, pubkey, { result: resultPayload })
      if (method === 'sign_event') {
        let kind: number | undefined
        if (Array.isArray(payload?.params) && typeof payload.params[0] === 'string') {
          try {
            const parsed = JSON.parse(payload.params[0])
            if (typeof parsed?.kind === 'number') {
              kind = parsed.kind
            }
          } catch {}
        }

        this.log('sign', 'Sent signature response to session', {
          requestId: record.id,
          session: pubkey,
          eventId,
          kind
        })
      }
      this.touchSessionActivity(pubkey)

      const completed = updateNip46RequestStatus(record.id, 'completed', { result: resultPayload })
      if (completed) {
        this.broadcast('nip46:request_status', 'NIP-46 request completed', {
          requestId: completed.id,
          status: completed.status,
          session: completed.session_pubkey
        })
      }
    } catch (error) {
      const message = this.serializeError(error)
      const reason = typeof message === 'object' && message?.message ? message.message : String(message)
      updateNip46RequestStatus(record.id, 'failed', { error: reason })
      const payload = this.parseStoredPayload(record)
      const responseId = payload?.id ?? record.id
      await this.sendSocketResponse({ id: responseId }, record.session_pubkey, { error: reason })
      this.broadcast('nip46:request_status', 'NIP-46 request failed', {
        requestId: record.id,
        status: 'failed',
        session: record.session_pubkey
      })
    } finally {
      this.processing.delete(record.id)
    }
  }

  private async processFailure(record: Nip46RequestRecord) {
    const payload = this.parseStoredPayload(record)
    const responseId = payload?.id ?? record.id
    const message = record.error || (record.status === 'denied' ? 'Request denied' : 'Request failed')
    await this.sendSocketResponse({ id: responseId }, record.session_pubkey, { error: message })
    this.broadcast('nip46:request_status', 'NIP-46 request updated', {
      requestId: record.id,
      status: record.status,
      session: record.session_pubkey
    })
  }

  private parseStoredPayload(record: Nip46RequestRecord): any | null {
    try {
      return JSON.parse(record.params)
    } catch {
      return null
    }
  }

  private sessionFromReq(req: any) {
    const profile = req?.session?.profile || req?.profile || {}
    const rawKey = req?.session?.pubkey || req?.pubkey || req?.env?.pubkey || req?.client_pubkey
    const normalizedKey = normalizePubkey(rawKey ?? undefined)
    const relays = Array.isArray(req?.session?.relays) ? req.session.relays.filter((r: any) => typeof r === 'string') : []
    if (relays.length && this.activeUserId != null) {
      try {
        mergeNip46Relays(this.activeUserId, relays)
      } catch (error) {
        this.log('warn', 'Failed to merge relays from session', { error: this.serializeError(error) })
      }
    }
    return {
      pubkey: normalizedKey,
      profile: {
        name: typeof profile?.name === 'string' ? profile.name : undefined,
        url: typeof profile?.url === 'string' ? profile.url : undefined,
        image: typeof profile?.image === 'string' ? profile.image : undefined
      },
      relays,
      policy: req?.policy || undefined
    }
  }

  private resolveSessionPolicy(pubkey: string, candidate?: Nip46Policy | null): Nip46Policy | null {
    const inline = normalizeRequestedPolicy(candidate)
    if (inline) return inline
    if (this.activeUserId == null) return null
    try {
      const session = getSession(this.activeUserId, pubkey)
      if (!session) return null
      return normalizeRequestedPolicy(session.policy)
    } catch (error) {
      this.log('warn', 'Failed to resolve NIP-46 session policy', {
        pubkey,
        error: this.serializeError(error)
      })
      return null
    }
  }

  private shouldAutoApprove(record: Nip46RequestRecord, payload: any, policy: Nip46Policy | null): boolean {
    if (!policy) return false
    const methods = policy.methods || {}
    if (record.method === 'sign_event') {
      if (!methods.sign_event) return false
      const kind = this.extractEventKind(payload)
      if (kind == null) return false
      const kinds = policy.kinds || {}
      if (kinds['*']) return true
      return kinds[String(kind)] === true
    }
    return methods[record.method] === true
  }

  private extractEventKind(payload: any): number | null {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const eventJson = typeof params[0] === 'string' ? params[0] : null
    if (!eventJson) return null
    try {
      const event = JSON.parse(eventJson)
      const kind = Number(event?.kind)
      return Number.isInteger(kind) ? kind : null
    } catch {
      return null
    }
  }

  private async decryptEnvelope(event: any): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer transport unavailable')
    }

    if (typeof this.signer.nip44_decrypt === 'function') {
      try {
        return await this.signer.nip44_decrypt(event.pubkey, event.content)
      } catch {}
    }

    if (typeof this.signer.nip04_decrypt === 'function') {
      return await this.signer.nip04_decrypt(event.pubkey, event.content)
    }

    throw new Error('Unable to decrypt envelope (unsupported signer capabilities)')
  }

  private touchSessionActivity(pubkey: string) {
    if (this.activeUserId == null) return
    try {
      updateStatus(this.activeUserId, pubkey, 'active', true)
    } catch (error) {
      this.log('warn', 'Failed to update session activity', { error: this.serializeError(error) })
    }
  }

  private async handleSignEvent(
    payload: any,
    sessionPubkey: string,
    requestId: number | string
  ): Promise<{ signedEventJson: string; eventId: string }> {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const eventJson = typeof params[0] === 'string' ? params[0] : null
    if (!eventJson) throw new Error('Missing event payload')

    let template: any
    try {
      template = JSON.parse(eventJson)
    } catch {
      throw new Error('Invalid event template')
    }

    const identity = this.getIdentityPubkey()
    if (!identity) throw new Error('Identity pubkey unavailable')

    const createdAt = typeof template.created_at === 'number' ? Math.floor(template.created_at) : Math.floor(Date.now() / 1000)
    const normalized = {
      pubkey: identity,
      kind: Number(template.kind ?? 1),
      created_at: createdAt,
      content: typeof template.content === 'string' ? template.content : '',
      tags: Array.isArray(template.tags) ? template.tags.filter((tag: any) => Array.isArray(tag)).map((tag: any[]) => tag.map(v => String(v ?? ''))) : []
    }

    const unsignedEvent = {
      pubkey: normalized.pubkey,
      kind: normalized.kind,
      created_at: normalized.created_at,
      content: normalized.content,
      tags: normalized.tags
    }

    const eventId = getEventHash(unsignedEvent as any)
    this.log('sign', 'Dispatching signature request to signer node', {
      requestId,
      session: sessionPubkey,
      kind: normalized.kind,
      eventId
    })
    const node = this.deps.getNode()
    if (!node) throw new Error('Signing node unavailable')

    const timeoutMs = getOpTimeoutMs()
    const safeSignPromise = node.req.sign(eventId)
      .then((res: any) => res)
      .catch((error: unknown) => ({ ok: false, err: error instanceof Error ? error.message : String(error) }))

    const signResult = await withTimeout(safeSignPromise, timeoutMs, 'SIGN_TIMEOUT')
    if (!signResult || signResult.ok !== true) {
      const reason = signResult?.err || (signResult?.error ?? 'Signing failed')
      throw new Error(typeof reason === 'string' ? reason : 'Signing failed')
    }

    let signatureHex: string | null = null
    try {
      if (Array.isArray(signResult.data)) {
        const entry = signResult.data.find((e: unknown) => Array.isArray(e) && e[0] === eventId) || signResult.data[0]
        signatureHex = Array.isArray(entry) ? entry[2] : null
      }
    } catch (error) {
      this.log('error', 'NIP-46: error extracting signature', { error: this.serializeError(error) })
    }

    if (!signatureHex) throw new Error('Invalid signature response from node')

    const signedEvent = {
      ...normalized,
      id: eventId,
      sig: signatureHex
    }

    return {
      signedEventJson: JSON.stringify(signedEvent),
      eventId
    }
  }

  private async computeSharedSecret(peer: string): Promise<string> {
    const normalized = xOnly(peer)
    if (!normalized) throw new Error('Invalid peer pubkey')
    const node = this.deps.getNode()
    if (!node) throw new Error('Signing node unavailable')
    const timeoutMs = getOpTimeoutMs()
    return deriveSharedSecret(node, normalized, timeoutMs)
  }

  private async handleNip44Encrypt(payload: any): Promise<string> {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const peer = typeof params[0] === 'string' ? params[0] : ''
    const plaintext = typeof params[1] === 'string' ? params[1] : ''
    if (!peer || !plaintext) throw new Error('Invalid parameters for nip44_encrypt')
    const secretHex = await this.computeSharedSecret(peer)
    const keyBytes = hexToUint8(secretHex)
    return await nip44.encrypt(plaintext, keyBytes)
  }

  private async handleNip44Decrypt(payload: any): Promise<string> {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const peer = typeof params[0] === 'string' ? params[0] : ''
    const ciphertext = typeof params[1] === 'string' ? params[1] : ''
    if (!peer || !ciphertext) throw new Error('Invalid parameters for nip44_decrypt')
    const secretHex = await this.computeSharedSecret(peer)
    const keyBytes = hexToUint8(secretHex)
    return await nip44.decrypt(ciphertext, keyBytes)
  }

  private async handleNip04Encrypt(payload: any): Promise<string> {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const peer = typeof params[0] === 'string' ? params[0] : ''
    const plaintext = typeof params[1] === 'string' ? params[1] : ''
    if (!peer || !plaintext) throw new Error('Invalid parameters for nip04_encrypt')
    const secretHex = await this.computeSharedSecret(peer)
    return nip04EncryptInternal(plaintext, secretHex)
  }

  private async handleNip04Decrypt(payload: any): Promise<string> {
    const params = Array.isArray(payload?.params) ? payload.params : []
    const peer = typeof params[0] === 'string' ? params[0] : ''
    const ciphertext = typeof params[1] === 'string' ? params[1] : ''
    if (!peer || !ciphertext) throw new Error('Invalid parameters for nip04_decrypt')
    const secretHex = await this.computeSharedSecret(peer)
    return nip04DecryptInternal(ciphertext, secretHex)
  }

  private getIdentityPubkey(): string | undefined {
    const node = this.deps.getNode()
    try {
      const pk = node?.group?.group_pk as unknown
      if (typeof pk === 'string') {
        return pk.length === 66 && (pk.startsWith('02') || pk.startsWith('03')) ? pk.slice(2) : pk
      }
      if (isUint8Array(pk)) {
        const hex = Buffer.from(pk).toString('hex')
        return hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03')) ? hex.slice(2) : hex
      }
    } catch (error) {
      this.log('warn', 'Failed to determine identity pubkey', { error: this.serializeError(error) })
    }
    return undefined
  }

  private broadcast(type: string, message: string, data?: any) {
    try {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : randomBytes(12).toString('hex')
      this.deps.broadcastEvent({
        type,
        message,
        data,
        timestamp: new Date().toLocaleTimeString(),
        id
      })
    } catch (error) {
      this.log('warn', 'Failed to broadcast NIP-46 event', { error: this.serializeError(error) })
    }
  }

  private log(type: string, message: string, data?: any) {
    try {
      this.deps.addServerLog(type, message, data)
    } catch {}
  }

  private serializeError(error: any) {
    if (!error) return error
    if (error instanceof Error) {
      return { message: error.message, stack: error.stack }
    }
    return error
  }
}
