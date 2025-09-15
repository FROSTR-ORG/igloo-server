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

  async sign_event(event: EventTemplate): Promise<SignedEvent> {
    if (!this.groupPubkey) await this.loadPublicKey()
    const pubkey = this.convertToNostrPubkey(this.groupPubkey!)

    const template = {
      ...event,
      pubkey,
      created_at: event.created_at || Math.floor(Date.now() / 1000)
    }

    const serialized = JSON.stringify([0, template.pubkey, template.created_at, template.kind, template.tags || [], template.content || ''])
    const encoder = new TextEncoder()
    const idBytes = await crypto.subtle.digest('SHA-256', encoder.encode(serialized))
    const id = Array.from(new Uint8Array(idBytes)).map(b => b.toString(16).padStart(2, '0')).join('')

    const res = await fetch('/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders },
      body: JSON.stringify({ message: id })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '[unable to read response]')
      throw new Error(`Server signing failed: ${res.status} ${res.statusText} - ${body}`)
    }
    const { signature } = await res.json()
    return { ...template, id, sig: signature }
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
