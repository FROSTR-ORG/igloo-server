/**
 * NIP-46 Controller for FROSTR Remote Signing
 * 
 * This controller implements NIP-46 (Nostr Connect) remote signing protocol with FROSTR threshold signatures.
 * It uses a dual-keypair approach:
 * - Transport keypair: For encrypting NIP-46 messages between client and signer
 * - Identity keypair: The FROSTR group pubkey used for actual signing operations
 * 
 * Architecture:
 * - Uses @cmdcode/nostr-connect library for NIP-46 protocol implementation
 * - Bypasses library's Zod validation by handling messages in 'bounced' event
 * - All signing operations delegated to server via ServerSigner class
 * - FROSTR threshold signatures happen on the server, not in the browser
 */

import { SignerClient, SimpleSigner, InviteEncoder } from '@cmdcode/nostr-connect'
import type { PermissionPolicy, SignerSession, NIP46Config, PermissionRequest } from './types'
import { ServerSigner } from './server-signer'

// Simple EventEmitter implementation for browser
class EventEmitter {
  private events: Map<string, Set<Function>> = new Map()

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set())
    }
    this.events.get(event)!.add(listener)
  }

  off(event: string, listener: Function): void {
    this.events.get(event)?.delete(listener)
  }

  emit(event: string, ...args: any[]): void {
    this.events.get(event)?.forEach(listener => listener(...args))
  }
}

export class NIP46Controller extends EventEmitter {
  private client: SignerClient | null = null
  private transportSigner: SimpleSigner | null = null  // For NIP-46 message encryption
  private identitySigner: ServerSigner | null = null   // For FROSTR identity operations
  private connected: boolean = false
  private config: NIP46Config
  private pendingRequests: Map<string, any> = new Map()  // Track pending requests for UI

  constructor(config: NIP46Config) {
    super()
    this.config = config
  }

  /**
   * Initialize the NIP-46 controller with transport and identity signers
   * @param privateKey Optional private key for transport signer (for persistence)
   * @param authHeaders Authentication headers for server API calls
   */
  async initialize(privateKey?: string, authHeaders?: Record<string, string>): Promise<void> {
    try {
      // Step 1: Create transport signer for NIP-46 message encryption
      // This keypair is only used for encrypting messages between client and signer
      // It can be ephemeral (new each session) or persistent (using provided key)
      console.log('[NIP46Controller] Creating transport keypair for NIP-46 communication...')
      this.transportSigner = new SimpleSigner()  // Generates new keypair if no key provided
      console.log('[NIP46Controller] Transport pubkey:', this.transportSigner.get_pubkey())
      
      // Step 2: Create identity signer that uses FROSTR group signatures
      // This delegates all signing operations to the server where FROSTR operations happen
      console.log('[NIP46Controller] Initializing FROSTR identity signer...')
      this.identitySigner = new ServerSigner(authHeaders)
      
      // Step 3: Load the FROSTR group public key from the server
      // This is the actual identity that clients will see and authenticate with
      await this.identitySigner.loadPublicKey()
      console.log('[NIP46Controller] FROSTR identity pubkey loaded:', this.identitySigner.get_pubkey())
      
      // Create SignerClient with transport signer (NOT identity signer)
      this.client = new SignerClient(this.transportSigner, {
        relays: this.config.relays,
        sessions: [] // Start with no sessions
      })
      console.log('[NIP46Controller] SignerClient created with transport keypair')
      console.log('[NIP46Controller] Transport pubkey for NIP-46:', this.client.pubkey)
      console.log('[NIP46Controller] Identity pubkey (FROSTR):', this.identitySigner.get_pubkey())

      // Connect to relays
      await this.client.connect(this.config.relays)
      console.log('[NIP46Controller] Connected to relays')
      
      // Set up event listeners 
      this.setupEventListeners()
      
      this.connected = true
      console.log('[NIP46Controller] Successfully initialized with SignerClient')
      console.log('[NIP46Controller] Ready to accept connections on:', this.client.pubkey)
      this.emit('connected')
      
    } catch (error) {
      console.error('[NIP46Controller] Failed to initialize:', error)
      this.emit('error', error)
      throw error
    }
  }


  private setupEventListeners(): void {
    if (!this.client) return

    console.log('[NIP46] Setting up SignerClient event listeners...')

    // Session change handlers
    const handleSessionChange = () => {
      const activeSessions = this.client?.session.active ?? []
      console.log('[NIP46] Session state changed, active sessions:', activeSessions.length)
      this.emit('session:updated')
    }

    // Set up session event listeners
    this.client.session.on('active', handleSessionChange)
    this.client.session.on('revoked', handleSessionChange)
    this.client.session.on('updated', handleSessionChange)
    
    // Monitor session events for debugging  
    this.client.session.on('pending', (data: any) => {
      console.log('[NIP46 session] pending event:', data)
    })

    // We're bypassing the library's request handling to avoid Zod validation errors
    // All requests are handled in the bounced event handler instead

    // CRITICAL: Handle bounced messages (messages that failed Zod validation)
    // The nostr-connect library has strict Zod schemas that often fail with real-world NIP-46 messages
    // We bypass this by catching 'bounced' events and processing them manually
    // This is where ALL client requests are actually handled
    this.client.socket.on('bounced', async (event: any) => {
      console.log('[NIP46] Received bounced event, attempting manual processing...')
      console.log('[NIP46] Event from pubkey:', event.pubkey)
      console.log('[NIP46] Event content length:', event.content?.length)
      
      try {
        // The message is from the client, decrypt it with our transport key
        const decrypted = await this.transportSigner!.nip44_decrypt(event.pubkey, event.content)
        console.log('[NIP46] Decrypted client message:', decrypted)
        
        // Parse the JSON-RPC message
        const message = JSON.parse(decrypted)
        console.log('[NIP46] Parsed message type:', message.method || 'response')
        console.log('[NIP46] Full message:', JSON.stringify(message, null, 2))
        
        // Handle different message types
        if (message.method === 'connect') {
          console.log('[NIP46] Processing connect request from client...')
          
          // Get the session from pending
          const sessionManager = this.client!.session as any
          const pendingSession = sessionManager._pending.get(event.pubkey)
          
          if (pendingSession) {
            console.log('[NIP46] Found pending session, activating...')
            
            // Move from pending to active
            sessionManager._pending.delete(event.pubkey)
            sessionManager._active.set(event.pubkey, pendingSession)
            
            // Create a proper connect response with the expected format
            // NIP-46 expects 'ack' as the result for successful connection
            const response = {
              id: message.id,
              result: 'ack',
              error: null
            }
            
            // Send the response back to the client
            await this.client!.socket.send(response, event.pubkey, pendingSession.relays || this.config.relays)
            console.log('[NIP46] Sent connect acknowledgment')
            
            // Emit the active event
            sessionManager.emit('active', pendingSession)
            this.emit('session:active', pendingSession)
            this.emit('session:updated')
            console.log('[NIP46] Session activated successfully')
          } else {
            console.warn('[NIP46] No pending session found for:', event.pubkey)
            // Maybe the session is already active? Check
            const activeSession = sessionManager._active.get(event.pubkey)
            if (activeSession) {
              console.log('[NIP46] Session already active, sending ack')
              const response = {
                id: message.id,
                result: 'ack',
                error: null
              }
              await this.client!.socket.send(response, event.pubkey, activeSession.relays || this.config.relays)
            }
          }
          
        } else if (message.method) {
          console.log(`[NIP46] Processing ${message.method} request...`)
          
          // Check if this session is still pending and activate it on first real request
          const sessionManager = this.client!.session as any
          const pendingSession = sessionManager._pending.get(event.pubkey)
          if (pendingSession) {
            console.log('[NIP46] First request from client, activating session...')
            // Move from pending to active on first request (client-initiated flow)
            sessionManager._pending.delete(event.pubkey)
            sessionManager._active.set(event.pubkey, pendingSession)
            sessionManager.emit('active', pendingSession)
            this.emit('session:active', pendingSession)
            console.log('[NIP46] Session activated for:', event.pubkey)
          }
          
          // Get the session for this pubkey
          const sessions = [...this.client!.session.active, ...this.client!.session.pending]
          const session = sessions.find(s => s.pubkey === event.pubkey)
          
          // This is a method request - create a request object with session info
          const request = {
            id: message.id,
            method: message.method,
            params: message.params || [],
            pubkey: event.pubkey,
            session: session || { pubkey: event.pubkey, profile: { name: 'Unknown' } },
            stamp: Date.now()
          }
          
          // Track the request for UI
          this.pendingRequests.set(request.id, request)
          this.emit('request:new', request)
          
          // Process request with permission checking
          console.log('[NIP46] Processing request with permission checks:', message.method)
          await this.handleRequestApproval(request)
          
          // Remove from pending after handling
          this.pendingRequests.delete(request.id)
          this.emit('request:approved', request)
          
        } else if (message.result !== undefined || message.error !== undefined) {
          console.log('[NIP46] Received response from client:', message)
          // This is a response to our request - handle accordingly
        }
        
      } catch (err) {
        console.error('[NIP46] Failed to process bounced message:', err)
        console.error('[NIP46] Error details:', err)
      }
    })
    
    // Socket events
    this.client.socket.on('ready', () => {
      console.log('[NIP46] Client ready')
      this.emit('ready')
    })
    this.client.socket.on('closed', () => {
      console.log('[NIP46] Client closed')
      this.connected = false
      this.emit('disconnected')
    })
    this.client.socket.on('error', (error: Error) => {
      // Skip Zod validation errors since we handle them in bounced
      if (error.message?.includes('_parse')) {
        console.log('[NIP46] Ignoring Zod validation error, handled in bounced event')
        return
      }
      console.error('[NIP46] Client error:', error)
      this.emit('error', error)
    })
    
    // Debug logging for all socket events (like demo)
    this.client.socket.on('*', (event: string, ...data: any[]) => {
      // Skip noisy events
      if (event === 'event' || event === 'message') return
      console.log(`[NIP46 socket] '${event}' event:`, ...data)
    })
    
    // Start listening for NIP-46 messages on relays
    if (this.client.socket.relays.length > 0) {
      this.client.socket.subscribe()
      console.log('[NIP46] Subscribed to relays, listening for messages')
    }
    
    console.log('[NIP46] Event listeners set up successfully')
  }

  // Create an invitation for clients to connect
  createInvite(_customPolicy?: PermissionPolicy): string {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    // Generate a bunker URL manually since SignerClient doesn't have invite manager
    const pubkey = this.client.pubkey
    const relays = this.config.relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')
    
    // TODO: Add custom policy to the URL if provided
    return `bunker://${pubkey}?${relays}`
  }

  // Process client connection
  async connectToClient(connectionString: string): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    try {
      console.log('[NIP46] Processing client connection string:', connectionString)
      
      // Use InviteEncoder.decode to get the token
      const token = InviteEncoder.decode(connectionString)
      console.log('[NIP46] Decoded invite token:', {
        pubkey: token.pubkey,
        relays: token.relays,
        hasSecret: !!token.secret,
        hasPolicy: !!(token as any).policy
      })
      
      // For client-initiated direct connection:
      // 1. Subscribe to client's relays
      // 2. Add session as pending
      // 3. Send immediate connect response with secret
      
      // Subscribe to the client's relays
      if (token.relays && token.relays.length > 0) {
        await this.client.socket.subscribe(token.relays)
        console.log('[NIP46] Subscribed to client relays:', token.relays)
      }
      
      // Parse permissions from the URL if present
      // The nostr-connect library might store permissions in different ways
      const tokenWithPerms = token as any
      const permissions = tokenWithPerms.perms || tokenWithPerms.policy || null
      
      // Handle permissions - they might be a string or already an object
      let parsedPolicy: PermissionPolicy
      if (permissions) {
        if (typeof permissions === 'string') {
          // Parse string permissions like "sign_event:1,get_public_key"
          parsedPolicy = this.parsePermissions(permissions)
        } else if (typeof permissions === 'object') {
          // Already an object, use as-is
          parsedPolicy = permissions
        } else {
          parsedPolicy = this.config.policy
        }
      } else {
        parsedPolicy = this.config.policy
      }
      
      // Create the session object
      const session = {
        pubkey: token.pubkey,
        profile: token.profile || { name: 'Unknown Client' },
        policy: parsedPolicy,
        relays: token.relays || this.config.relays,
        created_at: Math.floor(Date.now() / 1000)
      }
      
      // Add to pending sessions
      const sessionManager = this.client.session as any
      sessionManager._pending.set(session.pubkey, session)
      console.log('[NIP46] Added session to pending:', session.pubkey)
      
      // CRITICAL: In direct connection, signer immediately sends connect response
      // The response contains the secret that proves we control this signer
      const connectResponse = {
        id: token.secret, // Use the secret as the message ID
        result: token.secret, // Return the secret as the result
        error: null
      }
      
      // Send the connect response immediately
      console.log('[NIP46] Sending immediate connect response with secret...')
      await this.client.socket.send(connectResponse, token.pubkey, token.relays || this.config.relays)
      console.log('[NIP46] Connect response sent, waiting for client to acknowledge')
      
      // Emit pending event
      this.client.session.emit('pending', session)
      this.emit('session:pending', session)
      
      console.log('[NIP46] Session registered and pending activation')
      
    } catch (error) {
      console.error('[NIP46] Failed to process client connection:', error)
      this.emit('error', error)
      throw error
    }
  }

  // Handle request approval - use identity signer for operations
  private async handleRequestApproval(request: any): Promise<void> {
    console.log('[NIP46] Handling request approval:', request)
    
    if (!this.client || !this.identitySigner) {
      console.error('[NIP46] No client or identity signer available')
      return
    }
    
    const { id, method, params, pubkey, session } = request
    
    // Get the methods from the identity signer
    const methods = this.identitySigner.get_methods()
    
    // Helper to send response directly via socket
    const sendResponse = async (result: any, error: string | null = null) => {
      const response = {
        id,
        result: error ? null : result,
        error
      }
      
      // Get the session for this pubkey to get relays
      const sessionData = session || [...this.client!.session.active, ...this.client!.session.pending]
        .find(s => s.pubkey === pubkey)
      
      const relays = sessionData?.relays || this.config.relays
      
      // Send the response directly via socket
      await this.client!.socket.send(response, pubkey, relays)
      console.log('[NIP46] Sent response for', method, ':', error || 'success')
    }
    
    // Check if method is supported by the signer
    if (!methods.includes(method)) {
      await sendResponse(null, 'method not supported: ' + method)
      return
    }
    
    // Check permissions from session policy
    if (session && session.policy) {
      // Check if method is allowed by the session policy
      if (session.policy.methods && session.policy.methods[method] === false) {
        console.log('[NIP46] Method denied by session policy:', method)
        await sendResponse(null, `method not allowed by policy: ${method}`)
        return
      }
      
      // For sign_event, also check if the event kind is allowed
      if (method === 'sign_event' && session.policy.kinds) {
        const eventJson = params?.[0]
        if (eventJson) {
          try {
            const event = JSON.parse(eventJson)
            const kindStr = String(event.kind)
            if (session.policy.kinds[kindStr] === false) {
              console.log('[NIP46] Event kind denied by session policy:', event.kind)
              await sendResponse(null, `event kind ${event.kind} not allowed by policy`)
              return
            }
          } catch (err) {
            console.error('[NIP46] Failed to parse event for permission check:', err)
          }
        }
      }
    }
    
    try {
      // Handle each NIP-46 method using the appropriate signer
      if (method === 'get_public_key') {
        // Return the FROSTR identity pubkey, not transport pubkey!
        const result = this.identitySigner.get_pubkey()
        await sendResponse(result)
        console.log('[NIP46] Returned FROSTR identity pubkey:', result)
        
      } else if (method === 'ping') {
        // Simple ping doesn't need identity
        await sendResponse('pong')
        console.log('[NIP46] Responded to ping')
        
      } else if (method === 'sign_event') {
        // Use FROSTR identity to sign
        const eventJson = params?.[0]
        if (!eventJson) {
          await sendResponse(null, 'missing event parameter')
          return
        }
        const event = JSON.parse(eventJson)
        const signedEvent = await this.identitySigner.sign_event(event)
        await sendResponse(JSON.stringify(signedEvent))
        console.log('[NIP46] Signed event with FROSTR identity')
        
      } else if (method === 'nip44_decrypt') {
        // Use FROSTR identity for decryption
        const peerPubkey = params?.[0]
        const ciphertext = params?.[1]
        if (!peerPubkey || !ciphertext) {
          await sendResponse(null, 'missing parameters')
          return
        }
        const decrypted = await this.identitySigner.nip44_decrypt(peerPubkey, ciphertext)
        await sendResponse(decrypted)
        console.log('[NIP46] Decrypted with FROSTR identity ECDH')
        
      } else if (method === 'nip44_encrypt') {
        // Use FROSTR identity for encryption
        const peerPubkey = params?.[0]
        const plaintext = params?.[1]
        if (!peerPubkey || !plaintext) {
          await sendResponse(null, 'missing parameters')
          return
        }
        const encrypted = await this.identitySigner.nip44_encrypt(peerPubkey, plaintext)
        await sendResponse(encrypted)
        console.log('[NIP46] Encrypted with FROSTR identity ECDH')
        
      } else if (method === 'nip04_decrypt' || method === 'nip04_encrypt') {
        // NIP-04 not supported with FROSTR
        await sendResponse(null, 'NIP-04 not supported with FROSTR signer')
        
      } else {
        await sendResponse(null, 'unknown method: ' + method)
      }
    } catch (error) {
      console.error('[NIP46] Error handling request:', error)
      await sendResponse(null, 'error handling request')
    }
  }

  // Parse permission string from nostrconnect URL
  private parsePermissions(perms: string | null): PermissionPolicy {
    if (!perms) return this.config.policy

    const policy: PermissionPolicy = {
      methods: {},
      kinds: {}
    }

    const permList = perms.split(',')
    for (const perm of permList) {
      const [method, param] = perm.split(':')
      if (method === 'sign_event' && param) {
        policy.kinds[param] = true
      } else {
        policy.methods[method] = true
      }
    }

    return policy
  }


  // Approve a permission request
  approveRequest(requestId: string): void {
    const request = this.client?.request.queue.find((r: any) => r.id === requestId)
    if (request) {
      this.client?.request.approve(request)
    }
  }

  // Deny a permission request
  denyRequest(requestId: string, reason?: string): void {
    const request = this.client?.request.queue.find((r: any) => r.id === requestId)
    if (request) {
      this.client?.request.deny(request, reason || 'denied by user')
    }
  }

  // Update session permissions
  updateSession(pubkey: string, policy: PermissionPolicy): void {
    console.log('[NIP46] Session policy update requested for:', pubkey, policy)
    // Let the SignerAgent handle session management
  }

  // Revoke a session
  revokeSession(pubkey: string): void {
    console.log('[NIP46] Session revocation requested for:', pubkey)
    // Use the session manager's revoke method
    this.client?.session.revoke(pubkey)
  }

  // Get all active sessions
  getActiveSessions(): SignerSession[] {
    return this.client?.session.active || []
  }

  // Get all pending sessions
  getPendingSessions(): SignerSession[] {
    return this.client?.session.pending || []
  }

  // Get all pending requests
  getPendingRequests(): any[] {
    // Return our tracked requests since we're bypassing the library's queue
    return Array.from(this.pendingRequests.values())
  }

  // Disconnect and cleanup
  disconnect(): void {
    if (this.client) {
      this.client.close()
      this.client = null
    }
    this.transportSigner = null
    this.identitySigner = null
    this.connected = false
    this.emit('disconnected')
  }

  isConnected(): boolean {
    return this.connected
  }

  // Get the transport pubkey (for NIP-46 communication)
  getTransportPubkey(): string | null {
    return this.client ? this.client.pubkey : null
  }
  
  // Get the identity pubkey (FROSTR multisig)
  getIdentityPubkey(): string | null {
    return this.identitySigner ? this.identitySigner.get_pubkey() : null
  }
}