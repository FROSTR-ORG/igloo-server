/**
 * ServerSigner - FROSTR Identity Signer for NIP-46
 * 
 * This class implements the SignerDeviceAPI interface required by nostr-connect
 * but delegates all cryptographic operations to the server where FROSTR operations
 * are performed using the Bifrost node and igloo-core.
 * 
 * Key responsibilities:
 * 1. Fetch and cache the FROSTR group public key (not individual share pubkey)
 * 2. Sign Nostr events using FROSTR threshold signatures via /api/sign
 * 3. Perform NIP-44 encryption/decryption using FROSTR ECDH via /api/nip44/*
 * 
 * Important: This signer represents the FROSTR multisig identity, not any individual share.
 * All operations require threshold participation from other FROSTR nodes.
 */

// SignerDeviceAPI interface from nostr-connect library
// We must implement this interface to be compatible with the library
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

interface SignerDeviceAPI {
  get_methods(): string[]
  get_pubkey(): string
  sign_event(event: EventTemplate): Promise<SignedEvent>
  nip04_encrypt(pubkey: string, plaintext: string): Promise<string>
  nip04_decrypt(pubkey: string, ciphertext: string): Promise<string>
  nip44_encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44_decrypt(pubkey: string, ciphertext: string): Promise<string>
}

/**
 * Server-integrated signer that uses existing FROSTR infrastructure
 * All cryptographic operations are performed on the server using the Bifrost node
 */
export class ServerSigner implements SignerDeviceAPI {
  private groupPubkey: string | null = null
  private authHeaders: Record<string, string>

  constructor(authHeaders?: Record<string, string>) {
    this.authHeaders = authHeaders || {}
    console.log('[ServerSigner] Initialized with server integration')
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
    if (!this.groupPubkey) {
      throw new Error('Public key not loaded - call loadPublicKey() first')
    }
    // Convert compressed pubkey to Nostr format (32-byte hex without compression prefix)
    // FROSTR returns compressed format like "03..." or "02..." (33 bytes)
    // Nostr expects just the X coordinate (32 bytes)
    return this.convertToNostrPubkey(this.groupPubkey)
  }
  
  /**
   * Convert compressed secp256k1 pubkey to Nostr format
   * Strips the compression prefix (02 or 03) to get just the X coordinate
   */
  private convertToNostrPubkey(compressedPubkey: string): string {
    // Remove any whitespace and convert to lowercase
    const cleaned = compressedPubkey.trim().toLowerCase()
    
    // If it starts with 02 or 03 (compressed format), strip the prefix
    if (cleaned.length === 66 && (cleaned.startsWith('02') || cleaned.startsWith('03'))) {
      return cleaned.slice(2)
    }
    
    // If it's already 64 chars, return as-is
    if (cleaned.length === 64) {
      return cleaned
    }
    
    // Otherwise, there's an issue with the format
    console.warn('[ServerSigner] Unexpected pubkey format:', compressedPubkey)
    return cleaned
  }

  /**
   * Load the group public key from the server
   */
  async loadPublicKey(): Promise<string> {
    try {
      // Get the actual group pubkey, not the individual share pubkey
      const response = await fetch('/api/peers/group', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders
        }
      })
      
      if (!response.ok) {
        throw new Error('Failed to load group public key from server')
      }
      
      const data = await response.json()
      if (!data.pubkey || typeof data.pubkey !== 'string') {
        throw new Error('Invalid response from server - no group pubkey found')
      }
      
      this.groupPubkey = data.pubkey
      console.log('[ServerSigner] Loaded FROSTR group pubkey from server:', this.groupPubkey)
      console.log('[ServerSigner] Threshold:', data.threshold, 'Total shares:', data.totalShares)
      return this.groupPubkey as string
    } catch (error) {
      console.error('[ServerSigner] Failed to load group public key:', error)
      throw error
    }
  }

  async sign_event(event: EventTemplate): Promise<SignedEvent> {
    console.log('[ServerSigner] Signing event via server:', event)
    
    try {
      // Ensure we have the pubkey and convert to Nostr format
      if (!this.groupPubkey) {
        await this.loadPublicKey()
      }
      const pubkey = this.convertToNostrPubkey(this.groupPubkey!)
      
      // Format the event with our group pubkey (in Nostr format)
      const eventTemplate = {
        ...event,
        pubkey,
        created_at: event.created_at || Math.floor(Date.now() / 1000)
      }
      
      // Calculate event ID (Nostr standard)
      const serialized = JSON.stringify([
        0,
        eventTemplate.pubkey,
        eventTemplate.created_at,
        eventTemplate.kind,
        eventTemplate.tags || [],
        eventTemplate.content || ''
      ])
      
      // Hash to get the ID
      const encoder = new TextEncoder()
      const data = encoder.encode(serialized)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const id = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      
      // Request signature from server using existing endpoint
      const response = await fetch('/api/sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders
        },
        body: JSON.stringify({ message: id })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Server signing failed')
      }
      
      const { signature } = await response.json()
      
      // Return the complete signed event
      const signedEvent: SignedEvent = {
        ...eventTemplate,
        id,
        sig: signature
      }
      
      console.log('[ServerSigner] Event signed successfully via server')
      return signedEvent
      
    } catch (error) {
      console.error('[ServerSigner] Sign event error:', error)
      throw error
    }
  }

  async nip44_encrypt(peer_pubkey: string, plaintext: string): Promise<string> {
    console.log('[ServerSigner] Encrypting via server NIP-44 for peer:', peer_pubkey.slice(0, 8) + '...')
    
    try {
      const response = await fetch('/api/nip44/encrypt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders
        },
        body: JSON.stringify({ 
          peer_pubkey,
          content: plaintext 
        })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Server NIP-44 encryption failed')
      }
      
      const { result } = await response.json()
      console.log('[ServerSigner] NIP-44 encryption successful')
      return result
      
    } catch (error) {
      console.error('[ServerSigner] NIP-44 encrypt error:', error)
      throw error
    }
  }

  async nip44_decrypt(peer_pubkey: string, ciphertext: string): Promise<string> {
    console.log('[ServerSigner] Decrypting via server NIP-44 from peer:', peer_pubkey.slice(0, 8) + '...')
    
    try {
      const response = await fetch('/api/nip44/decrypt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders
        },
        body: JSON.stringify({ 
          peer_pubkey,
          content: ciphertext 
        })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Server NIP-44 decryption failed')
      }
      
      const { result } = await response.json()
      console.log('[ServerSigner] NIP-44 decryption successful')
      return result
      
    } catch (error) {
      console.error('[ServerSigner] NIP-44 decrypt error:', error)
      throw error
    }
  }

  // NIP-04 methods - not implemented for FROSTR
  async nip04_encrypt(_pubkey: string, _plaintext: string): Promise<string> {
    throw new Error('NIP-04 encryption not implemented for FROSTR signer')
  }

  async nip04_decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
    throw new Error('NIP-04 decryption not implemented for FROSTR signer')
  }
}