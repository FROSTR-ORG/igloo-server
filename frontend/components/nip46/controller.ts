import { SignerAgent, SimpleSigner, InviteEncoder } from '@cmdcode/nostr-connect'
import type { PermissionPolicy, SessionProfile, SignerSession, PermissionRequest, NIP46Config } from './types'

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
  private agent: SignerAgent | null = null
  private signer: SimpleSigner | null = null
  private sessions: Map<string, SignerSession> = new Map()
  private requests: Map<string, PermissionRequest> = new Map()
  private pendingConnections: Map<string, { secret: string, name?: string }> = new Map()
  private connected: boolean = false
  private config: NIP46Config

  constructor(config: NIP46Config) {
    super()
    this.config = config
  }

  async initialize(privateKey: string): Promise<void> {
    try {
      console.log('[NIP46Controller] Initializing with private key...')
      
      // Create signer with the provided private key (from FROSTR share)
      this.signer = new SimpleSigner(privateKey)
      console.log('[NIP46Controller] SimpleSigner created')
      
      // Create the signing agent
      this.agent = new SignerAgent(this.signer, {
        policy: this.config.policy,
        profile: this.config.profile,
        timeout: this.config.timeout || 30
      })
      console.log('[NIP46Controller] SignerAgent created')
      console.log('[NIP46Controller] Agent public key:', this.agent.pubkey)

      // Set up event listeners
      this.setupEventListeners()

      // Connect to relays
      console.log('[NIP46Controller] Connecting to relays:', this.config.relays)
      await this.agent.connect(this.config.relays)
      
      this.connected = true
      console.log('[NIP46Controller] Successfully connected to relays')
      console.log('[NIP46Controller] Listening for messages to:', this.agent.pubkey)
      this.emit('connected')
    } catch (error) {
      console.error('[NIP46Controller] Failed to initialize:', error)
      this.emit('error', error)
      throw error
    }
  }

  private setupEventListeners(): void {
    if (!this.agent) return

    console.log('[NIP46] Setting up event listeners...')

    // Listen for all socket events
    this.agent.socket.on('*', (event: string, ...args: any[]) => {
      // Don't log 'subscribed' events as they're too noisy
      if (event !== 'subscribed') {
        console.log('[NIP46 Socket Event]', event, args)
      }
    })

    // Listen for incoming events (raw Nostr events)
    this.agent.socket.on('event', (event: any) => {
      console.log('[NIP46] Received Nostr event:', event)
      // Check if this is an encrypted message to us
      if (event && event.pubkey && event.content) {
        console.log('[NIP46] Event from:', event.pubkey)
        console.log('[NIP46] Event kind:', event.kind)
        console.log('[NIP46] Event tags:', event.tags)
        
        // Check if we have a pending connection for this pubkey
        if (this.pendingConnections.has(event.pubkey)) {
          console.log('[NIP46] Event from pending connection client!')
        }
        
        // Check if this is a NIP-46 encrypted message (kind 24133)
        if (event.kind === 24133) {
          console.log('[NIP46] Got encrypted NIP-46 message, tags:', event.tags)
          // Check if it's tagged to us
          const pTags = event.tags.filter((t: any[]) => t[0] === 'p')
          console.log('[NIP46] P-tags:', pTags)
          if (pTags.some((t: any[]) => t[1] === this.agent?.pubkey)) {
            console.log('[NIP46] Message is for us!')
          }
        }
      }
      // The agent should automatically decrypt and process NIP-46 messages
    })

    // Listen for incoming messages (decrypted NIP-46 messages)
    this.agent.socket.on('message', (msg: any) => {
      console.log('[NIP46] Received decrypted message:', msg)
      
      // Check if this is a connect request
      if (msg && msg.method === 'connect') {
        console.log('[NIP46] Connect request detected:', msg)
        this.handleIncomingConnect(msg)
      }
    })

    // Listen for request events from the agent's request handler
    this.agent.socket.on('request', (request: any) => {
      console.log('[NIP46] Received request event:', request)
      if (request && request.method === 'connect') {
        console.log('[NIP46] Connect request from client:', request)
        this.handleIncomingConnect(request)
      }
    })
    
    // Also listen on the agent itself for request events if available
    if (this.agent.request && typeof this.agent.request.on === 'function') {
      this.agent.request.on('*', (event: string, ...args: any[]) => {
        console.log('[NIP46 Agent Request Event]', event, args)
      })
    } else {
      console.log('[NIP46] Agent request handler not available in this version')
    }

    // Listen for new session connections
    this.agent.invite.on('join', (event: any) => {
      console.log('[NIP46] Client joined:', event)
      const session: SignerSession = {
        pubkey: event.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        profile: event.profile || {},
        policy: event.policy,
        status: 'pending'
      }
      this.sessions.set(event.pubkey, session)
      this.emit('session:new', session)
    })

    // Listen for permission requests (check if the event system supports this)
    try {
      this.agent.on('/request/prompt', (request: any) => {
        console.log('[NIP46] Permission request:', request)
        const permRequest: PermissionRequest = {
          id: request.id,
          method: request.method,
          params: request.params || [],
          session: this.sessions.get(request.pubkey) || {
            pubkey: request.pubkey,
            created_at: Math.floor(Date.now() / 1000),
            profile: {}
          },
          stamp: Date.now()
        }
        this.requests.set(request.id, permRequest)
        this.emit('request:new', permRequest)
      })
    } catch (err) {
      console.log('[NIP46] Permission request listener not supported:', err)
    }

    // Listen for agent events
    this.agent.on('ready', () => {
      console.log('[NIP46] Agent ready')
      this.emit('ready')
    })
    this.agent.on('close', () => {
      console.log('[NIP46] Agent closed')
      this.connected = false
      this.emit('disconnected')
    })
    this.agent.on('error', (error: Error) => {
      console.error('[NIP46] Agent error:', error)
      this.emit('error', error)
    })
  }

  // Create an invitation for clients to connect
  createInvite(customPolicy?: PermissionPolicy): string {
    if (!this.agent) {
      throw new Error('Agent not initialized')
    }

    const invite = this.agent.invite.create({
      relays: this.config.relays,
      policy: customPolicy || this.config.policy
    })

    return InviteEncoder.encode(invite)
  }

  // Process a client connection request (nostrconnect:// string from client)
  async connectToClient(connectionString: string): Promise<void> {
    if (!this.agent) {
      throw new Error('Agent not initialized')
    }

    try {
      console.log('Processing client connection string:', connectionString)
      
      // Parse the nostrconnect:// string
      const url = new URL(connectionString)
      const clientPubkey = url.hostname
      const params = new URLSearchParams(url.search)
      
      // Extract connection parameters
      const relays = params.getAll('relay')
      const secret = params.get('secret')
      const name = params.get('name')
      const perms = params.get('perms')
      
      console.log('Client connection request:', {
        clientPubkey,
        relays,
        secret,
        name,
        perms
      })

      // Connect to the relays the client specified
      if (relays.length > 0) {
        console.log('Connecting to client relays:', relays)
        // Add relays to our existing connection
        await this.agent.socket.subscribe(relays)
      }

      // Store pending connection info for verification
      if (secret) {
        this.pendingConnections.set(clientPubkey, {
          secret,
          name: name || undefined
        })
        console.log(`Stored pending connection for ${clientPubkey} with secret`)
      }

      // Create initial session (will be activated when connect request is received)
      const session: SignerSession = {
        pubkey: clientPubkey,
        created_at: Math.floor(Date.now() / 1000),
        profile: {
          name: name || 'Unknown Client',
          url: params.get('url') || undefined,
          image: params.get('image') || undefined
        },
        policy: this.parsePermissions(perms),
        status: 'pending'  // Set to pending until handshake completes
      }
      
      this.sessions.set(clientPubkey, session)
      
      console.log('Subscribed to client relays, waiting for connect request...')
      console.log('Client should now send encrypted connect request to our pubkey')
      
      // Store the session locally
      this.emit('session:new', session)
      
      // Send an initial "ack" message to the client to establish the connection
      // This is needed for client-initiated connections
      if (secret) {
        console.log('Sending initial ack to client with secret:', secret)
        try {
          // Send a connect response message to the client
          const connectMessage = {
            id: Date.now().toString(),
            method: 'connect',
            params: [this.agent.pubkey, secret]
          }
          
          const receipt = await this.agent.socket.send(connectMessage, clientPubkey, relays)
          console.log('Initial ack sent to client:', receipt)
          
          // Update session to active after sending ack
          session.status = 'active'
          this.sessions.set(clientPubkey, session)
          this.emit('session:updated', session)
        } catch (err) {
          console.error('Failed to send initial ack:', err)
        }
      }
      
    } catch (error) {
      console.error('Failed to process client connection:', error)
      this.emit('error', error)
      throw error
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
        policy.kinds = policy.kinds || {}
        policy.kinds[param] = true
      } else {
        policy.methods = policy.methods || {}
        policy.methods[method] = true
      }
    }

    return policy
  }

  // Approve a permission request
  approveRequest(requestId: string): void {
    if (!this.agent) return
    
    const request = this.requests.get(requestId)
    if (request) {
      // Check if the agent has a request handler
      if (this.agent.request && typeof this.agent.request.approve === 'function') {
        this.agent.request.approve(request as any)
      } else {
        console.log('[NIP46] Request approval not available, marking as approved locally')
      }
      this.requests.delete(requestId)
      this.emit('request:approved', request)
    }
  }

  // Deny a permission request
  denyRequest(requestId: string, reason?: string): void {
    if (!this.agent) return
    
    const request = this.requests.get(requestId)
    if (request) {
      // Check if the agent has a request handler
      if (this.agent.request && typeof this.agent.request.deny === 'function') {
        this.agent.request.deny(request as any, reason || 'Denied by user')
      } else {
        console.log('[NIP46] Request denial not available, marking as denied locally')
      }
      this.requests.delete(requestId)
      this.emit('request:denied', request)
    }
  }

  // Update session permissions
  updateSession(pubkey: string, policy: PermissionPolicy): void {
    const session = this.sessions.get(pubkey)
    if (session) {
      session.policy = policy
      this.sessions.set(pubkey, session)
      this.emit('session:updated', session)
    }
  }

  // Revoke a session
  revokeSession(pubkey: string): void {
    if (!this.agent) return
    
    // Check if the agent has a session manager
    if (this.agent.session && typeof this.agent.session.revoke === 'function') {
      try {
        this.agent.session.revoke(pubkey)
      } catch (err) {
        console.error('[NIP46] Failed to revoke session via agent:', err)
      }
    } else {
      console.log('[NIP46] Session revocation not available in agent, removing locally')
    }
    
    // Always remove the session locally
    this.sessions.delete(pubkey)
    this.emit('session:revoked', pubkey)
    console.log(`[NIP46] Session revoked for ${pubkey}`)
  }

  // Get all active sessions
  getActiveSessions(): SignerSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active')
  }

  // Get all pending sessions
  getPendingSessions(): SignerSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'pending')
  }

  // Get all pending requests
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.requests.values())
  }

  // Disconnect and cleanup
  disconnect(): void {
    if (this.agent) {
      this.agent.close()
      this.agent = null
    }
    this.signer = null
    this.sessions.clear()
    this.requests.clear()
    this.connected = false
    this.emit('disconnected')
  }

  isConnected(): boolean {
    return this.connected
  }

  getPublicKey(): string | null {
    return this.agent ? this.agent.pubkey : null
  }

  // Handle incoming connect request from a client
  private async handleIncomingConnect(request: any): Promise<void> {
    console.log('[NIP46] Handling incoming connect request:', request)
    
    if (!this.agent || !this.agent.socket) {
      console.error('[NIP46] No agent or socket available')
      return
    }
    
    try {
      // Extract parameters - could be in different formats depending on the message type
      let clientPubkey: string
      let secret: string | undefined
      let perms: string | undefined
      
      if (request.params && Array.isArray(request.params)) {
        [clientPubkey, secret, perms] = request.params
      } else if (request.pubkey) {
        clientPubkey = request.pubkey
        secret = request.secret
      } else {
        console.error('[NIP46] Invalid connect request format:', request)
        return
      }
      
      console.log('[NIP46] Connect params:', { clientPubkey, secret, perms })
      
      // Check if we have a pending connection for this client
      const pendingConnection = this.pendingConnections.get(clientPubkey)
      if (pendingConnection) {
        console.log('[NIP46] Found pending connection for client')
        // Use the secret from the pending connection if not provided in the request
        if (!secret) {
          secret = pendingConnection.secret
        }
      }
      
      // Update or create session
      let session = this.sessions.get(clientPubkey)
      if (session) {
        // Update existing session to active
        session.status = 'active'
        console.log('[NIP46] Activating existing session')
      } else {
        // Create new session
        session = {
          pubkey: clientPubkey,
          created_at: Math.floor(Date.now() / 1000),
          profile: pendingConnection?.name ? { name: pendingConnection.name } : {},
          policy: perms ? this.parsePermissions(perms) : this.config.policy,
          status: 'active'
        }
        this.sessions.set(clientPubkey, session)
        console.log('[NIP46] Created new active session')
      }
      
      // Send connect response using the socket's accept method
      if (request.id && clientPubkey) {
        const result = secret || 'ack'
        console.log(`[NIP46] Sending accept response with result: ${result}`)
        
        try {
          // Use the socket's accept method to send the encrypted response
          const receipt = await this.agent.socket.accept(request, result)
          console.log('[NIP46] Connect response sent:', receipt)
          
          // Remove from pending connections after successful handshake
          this.pendingConnections.delete(clientPubkey)
        } catch (err) {
          console.error('[NIP46] Failed to send accept response:', err)
        }
      }
      
      this.emit('session:updated', session)
    } catch (error) {
      console.error('[NIP46] Error handling connect request:', error)
      
      // Try to send an error response if we have the request details
      if (request.id && this.agent.socket) {
        try {
          await this.agent.socket.reject(request, 'Failed to process connect request')
        } catch (err) {
          console.error('[NIP46] Failed to send reject response:', err)
        }
      }
    }
  }
}