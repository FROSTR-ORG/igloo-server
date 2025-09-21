/**
 * ServerSigner - FROSTR Identity Signer for NIP-46
 * Delegates cryptographic ops to server endpoints.
 */

interface EventTemplate {
  kind: number
  content: string
  tags: string[][]
  created_at: number
}

interface SignedEvent extends EventTemplate {
  id: string
  pubkey: string
  sig: string
}

export class ServerSigner {
  private groupPubkey: string | null = null
  private authHeaders: Record<string, string>

  constructor(authHeaders?: Record<string, string>) {
    this.authHeaders = authHeaders || {}
  }

  get_methods(): string[] {
    return [
      'sign_event',
      'get_public_key',
      'nip44_encrypt',
      'nip44_decrypt',
      'nip04_encrypt',
      'nip04_decrypt',
      'ping'
    ]
  }

  get_pubkey(): string {
    if (!this.groupPubkey) throw new Error('Public key not loaded')
    return this.convertToNostrPubkey(this.groupPubkey)
  }

  private convertToNostrPubkey(hex: string): string {
    const h = hex.trim().toLowerCase()
    if (h.length === 66 && (h.startsWith('02') || h.startsWith('03'))) return h.slice(2)
    return h
  }

  async loadPublicKey(): Promise<string> {
    const res = await fetch('/api/peers/group', { headers: { 'Content-Type': 'application/json', ...this.authHeaders } })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`Failed to load group pubkey: ${res.status} ${res.statusText} - ${body}`)
    }
    const data = await res.json()
    if (!data.pubkey) {
      const snippet = JSON.stringify(data).slice(0, 200)
      throw new Error(`Invalid group pubkey response (missing pubkey field): ${snippet}`)
    }
    this.groupPubkey = data.pubkey
    return this.groupPubkey
  }

  private validateAndNormalizeEvent(template: any): {
    pubkey: string
    created_at: number
    kind: number
    tags: string[][]
    content: string
  } {
    // Validate and normalize pubkey (64 hex chars)
    const pubkey = template.pubkey.replace(/^0x/i, '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      throw new Error('Invalid pubkey format: must be 64 hex characters')
    }

    // Ensure Unix seconds timestamp (not milliseconds)
    const ts = Math.floor(Number(template.created_at))
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new Error('Invalid timestamp: must be positive Unix seconds')
    }
    // Convert millisecond timestamps to seconds when necessary
    const created_at = ts > 1_000_000_000_000 ? Math.floor(ts / 1000) : ts

    // Normalize tags to string arrays, filtering out null/undefined
    const tags = (template.tags || []).map((tag: any[]) =>
      Array.isArray(tag) ? tag.map(item => String(item || '')) : []
    )

    // Validate content is string
    const content = typeof template.content === 'string' ? template.content : ''

    const kindNum = Number(template.kind)
    if (!Number.isInteger(kindNum) || kindNum < 0) {
      throw new Error('Invalid kind: must be a non-negative integer')
    }

    return { pubkey, created_at, kind: kindNum, tags, content }
  }

  async sign_event(event: EventTemplate): Promise<SignedEvent> {
    if (!this.groupPubkey) await this.loadPublicKey()
    const pubkey = this.convertToNostrPubkey(this.groupPubkey!)

    const template = {
      ...event,
      pubkey,
      created_at: event.created_at || Math.floor(Date.now() / 1000)
    }

    // Validate and normalize event data for NIP-01 compliance
    const normalized = this.validateAndNormalizeEvent(template)

    const serialized = JSON.stringify([0, normalized.pubkey, normalized.created_at, normalized.kind, normalized.tags, normalized.content])
    const encoder = new TextEncoder()
    const idBytes = await crypto.subtle.digest('SHA-256', encoder.encode(serialized))
    const id = Array.from(new Uint8Array(idBytes)).map(b => b.toString(16).padStart(2, '0')).join('')

    const res = await fetch('/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ message: id })
    })
    if (!res.ok) {
      const requestId = res.headers.get('X-Request-ID') || undefined
      let msg = `${res.status} ${res.statusText}`
      let bodyText: string | undefined

      try {
        bodyText = await res.text()
      } catch {
        bodyText = undefined
      }

      if (bodyText && bodyText.length > 0) {
        try {
          const data = JSON.parse(bodyText)
          if (data?.code === 'SIGN_TIMEOUT' || res.status === 504) {
            msg = `Signing timed out${data?.error ? `: ${data.error}` : ''}`
          } else if (data?.error) {
            msg = data.error
          } else {
            msg = `${res.status} ${res.statusText} - ${bodyText}`
          }
        } catch {
          msg = `${res.status} ${res.statusText} - ${bodyText}`
        }
      } else if (res.status === 504) {
        msg = 'Signing timed out'
      } else {
        msg = `${res.status} ${res.statusText} - [unable to read response]`
      }

      throw new Error(`Server signing failed${requestId ? ` [${requestId}]` : ''}: ${msg}`)
    }
    const { signature } = await res.json()
    return { ...normalized, id, sig: signature }
  }

  async nip44_encrypt(peer_pubkey: string, plaintext: string): Promise<string> {
    const res = await fetch('/api/nip44/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ peer_pubkey, content: plaintext })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`NIP-44 encrypt failed: ${res.status} ${res.statusText} - ${body}`)
    }
    const { result } = await res.json()
    return result
  }

  async nip44_decrypt(peer_pubkey: string, ciphertext: string): Promise<string> {
    const res = await fetch('/api/nip44/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ peer_pubkey, content: ciphertext })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`NIP-44 decrypt failed: ${res.status} ${res.statusText} - ${body}`)
    }
    const { result } = await res.json()
    return result
  }

  async nip04_encrypt(peer_pubkey: string, plaintext: string): Promise<string> {
    const res = await fetch('/api/nip04/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ peer_pubkey, content: plaintext })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`NIP-04 encrypt failed: ${res.status} ${res.statusText} - ${body}`)
    }
    const { result } = await res.json()
    return result
  }

  async nip04_decrypt(peer_pubkey: string, ciphertext: string): Promise<string> {
    const res = await fetch('/api/nip04/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ peer_pubkey, content: ciphertext })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`NIP-04 decrypt failed: ${res.status} ${res.statusText} - ${body}`)
    }
    const { result } = await res.json()
    return result
  }
}
