# NIP-46 FROSTR Implementation in Igloo Server

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Components](#key-components)
4. [Connection Flows](#connection-flows)
5. [FROSTR Integration](#frostr-integration)
6. [Permission System](#permission-system)
7. [Security Model](#security-model)
8. [Implementation Details](#implementation-details)
9. [API Endpoints](#api-endpoints)
10. [UI Components](#ui-components)

## Overview

Igloo Server implements NIP-46 (Nostr Connect) remote signing protocol with a unique twist: it uses FROSTR threshold signatures instead of traditional single-key signing. This means the remote signer never holds a complete private key - instead, it uses threshold cryptography where multiple FROSTR shares must cooperate to create signatures.

### Key Innovation: Dual-Keypair Architecture

The implementation uses two distinct keypair systems:

1. **Transport Keypair**: Used for NIP-46 message encryption between client and signer
   - Generated ephemeral or persistent
   - Only used for NIP-44 encryption of protocol messages
   - This is what the `nostrconnect://` or `bunker://` URI contains

2. **Identity Keypair**: The actual FROSTR group public key used for signing
   - Represents the threshold multisig identity
   - Never has a single private key (it's distributed across shares)
   - This is what clients see as the actual Nostr identity

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nostr Client App                          │
│                     (e.g., Coracle, Nostur)                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │ NIP-46 Protocol (Encrypted)
                      │ nostrconnect:// or bunker://
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Igloo Server Frontend                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              NIP46Controller (Orchestrator)               │  │
│  │                                                           │  │
│  │  Transport Signer             Identity Signer             │  │
│  │  (SimpleSigner)               (ServerSigner)              │  │
│  │  - Message encryption         - FROSTR operations         │  │
│  │  - nostr-connect lib          - Delegates to server       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTP API Calls
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Igloo Server Backend                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Bifrost Node (FROSTR Operations)                │  │
│  │                                                           │  │
│  │  /api/sign          - Threshold signatures                │  │
│  │  /api/nip44/*       - Threshold ECDH                      │  │
│  │  /api/peers/group   - Group pubkey retrieval              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────────┘
                      │ FROSTR Protocol
                      ▼
        ┌──────────────────────────────────┐
        │   Other FROSTR Shares/Nodes       │
        │   (Required for threshold ops)     │
        └────────────────────────────────────┘
```

## Key Components

### NIP46Controller (`frontend/components/nip46/controller.ts`)

The core orchestrator that manages the entire NIP-46 implementation:

```typescript
class NIP46Controller extends EventEmitter {
  private client: SignerClient | null        // nostr-connect client
  private transportSigner: SimpleSigner      // For message encryption
  private identitySigner: ServerSigner       // For FROSTR operations
  private pendingRequests: Map<string, any>  // Request queue
}
```

**Key Responsibilities:**
- Manages dual-keypair system
- Handles connection lifecycle
- Bypasses library validation issues via 'bounced' event handler
- Maintains request queue for approval workflow
- Enforces permissions and policies

### ServerSigner (`frontend/components/nip46/server-signer.ts`)

The FROSTR identity signer that delegates all cryptographic operations to the server:

```typescript
class ServerSigner implements SignerDeviceAPI {
  private groupPubkey: string | null  // FROSTR group pubkey
  
  // All operations delegate to server endpoints
  async sign_event(event): Promise<SignedEvent>    // → /api/sign
  async nip44_encrypt(pubkey, text): Promise<string> // → /api/nip44/encrypt
  async nip44_decrypt(pubkey, text): Promise<string> // → /api/nip44/decrypt
}
```

**Key Features:**
- Fetches and caches FROSTR group public key
- Converts between compressed (33-byte) and Nostr (32-byte) pubkey formats
- All crypto operations performed server-side via HTTP APIs
- Never holds private keys

### The "Bounced" Event Workaround

The `@cmdcode/nostr-connect` library has strict Zod validation that often fails with real-world NIP-46 messages. The implementation works around this by:

1. **Library attempts validation** → Fails Zod schema check
2. **Message gets "bounced"** → Emitted as a 'bounced' event
3. **Manual processing** → Controller decrypts and processes manually
4. **Direct socket responses** → Bypasses library's response system

```typescript
this.client.socket.on('bounced', async (event: any) => {
  // Decrypt the message manually
  const decrypted = await this.transportSigner.nip44_decrypt(event.pubkey, event.content)
  const message = JSON.parse(decrypted)
  
  // Process based on method
  if (message.method === 'connect') {
    // Handle connection...
  } else if (message.method === 'sign_event') {
    // Handle signing...
  }
  // ... etc
})
```

## Connection Flows

### Client-Initiated Connection (nostrconnect://)

1. **Client generates URI**: `nostrconnect://[client-pubkey]?relay=...&secret=...`
2. **User provides to signer**: Via QR code or paste
3. **Signer processes**:
   ```typescript
   // Decode the connection string
   const token = InviteEncoder.decode(connectionString)
   
   // Add to pending sessions
   sessionManager._pending.set(token.pubkey, session)
   
   // Send immediate connect response with secret
   const response = {
     id: token.secret,
     result: token.secret,  // Proves we control this signer
     error: null
   }
   await client.socket.send(response, token.pubkey, token.relays)
   ```
4. **Client validates secret** and connection established

### Signer-Initiated Connection (bunker://)

1. **Signer generates URI**: `bunker://[transport-pubkey]?relay=...`
2. **Client connects**: Sends connect request
3. **Signer responds**: With 'ack' message
4. **Session activated**: Ready for signing requests

## FROSTR Integration

### How It Works

Traditional NIP-46 signers have a single private key. Igloo Server's implementation:

1. **No Single Private Key**: The identity is a FROSTR group public key
2. **Threshold Operations**: Every signature requires k-of-n shares to participate
3. **Server Coordination**: All FROSTR operations happen server-side via Bifrost node
4. **Transparent to Clients**: Nostr apps see a normal public key and valid signatures

### Pubkey Format Conversion

FROSTR uses compressed secp256k1 format (33 bytes), while Nostr uses uncompressed X-coordinate only (32 bytes):

```typescript
private convertToNostrPubkey(compressedPubkey: string): string {
  // Strip compression prefix (02 or 03)
  if (cleaned.length === 66 && 
      (cleaned.startsWith('02') || cleaned.startsWith('03'))) {
    return cleaned.slice(2)  // Remove first byte
  }
  return cleaned
}
```

### Server API Integration

All cryptographic operations route through server endpoints:

```typescript
// Signing
POST /api/sign
Body: { message: eventId }
Response: { signature: schnorrSig }

// NIP-44 Encryption/Decryption
POST /api/nip44/encrypt
Body: { peer_pubkey, content }
Response: { result: encrypted }

POST /api/nip44/decrypt
Body: { peer_pubkey, content }
Response: { result: decrypted }

// Get Group Public Key
GET /api/peers/group
Response: { pubkey, threshold, totalShares }
```

## Permission System

### Policy Structure

```typescript
interface PermissionPolicy {
  methods: {
    'sign_event': boolean,
    'get_public_key': boolean,
    'nip44_encrypt': boolean,
    'nip44_decrypt': boolean
  },
  kinds: {
    '1': boolean,  // Text notes
    '4': boolean,  // DMs
    '7': boolean   // Reactions
    // etc...
  }
}
```

### Permission Enforcement

The system enforces permissions at multiple levels:

1. **Method Level**: Check if operation is allowed
   ```typescript
   if (session.policy.methods[method] === false) {
     // Deny or queue for approval
   }
   ```

2. **Event Kind Level**: For signing, check event type
   ```typescript
   if (method === 'sign_event') {
     const event = JSON.parse(params[0])
     if (!session.policy.kinds[event.kind]) {
       // Deny or queue for approval
     }
   }
   ```

3. **Default Deny**: New in the implementation - permissions must be explicitly granted
   ```typescript
   // Changed from checking if false to requiring explicit true
   if (!session.policy.kinds || session.policy.kinds[kindStr] !== true) {
     // Deny by default
   }
   ```

### Request Approval Workflow

When a request is denied by policy:

1. **Auto-Process Flag**: Request marked with `autoProcess: true`
2. **Policy Check**: If denied, request gets `deniedReason`
3. **Queue for Review**: Stays in `pendingRequests` for user approval
4. **User Decision**: Can approve (bypass policy) or deny (send error)

```typescript
// Request denied by policy but kept for review
if (request.autoProcess && !allowed) {
  request.deniedReason = `Event kind ${event.kind} not allowed`
  this.emit('request:denied-pending', request)
  return  // Don't send response yet
}

// User approves later
async approveRequest(requestId: string) {
  request.userApproved = true  // Bypass policy check
  await this.handleRequestApproval(request)
}
```

## Security Model

### Authentication Layers

1. **Server Authentication**: API calls use session/API key auth
2. **NIP-46 Encryption**: All protocol messages encrypted with NIP-44
3. **Connection Secrets**: Random secrets validate connection attempts
4. **Session Management**: Each client connection tracked as a session

### Message Flow Security

```
Client App                    Igloo Server                 FROSTR Network
    │                              │                            │
    ├──[Encrypted Request]────────>│                            │
    │  (NIP-44 with transport key) │                            │
    │                              │                            │
    │                              ├──[Check Permissions]       │
    │                              │                            │
    │                              ├──[FROSTR Sign Request]────>│
    │                              │   (Threshold operation)    │
    │                              │                            │
    │                              │<──[Partial Signatures]─────│
    │                              │                            │
    │                              ├──[Aggregate Signature]     │
    │                              │                            │
    │<──[Encrypted Response]───────│                            │
    │  (Signed event)              │                            │
```

### Trust Model

- **Clients trust**: The signer's identity (FROSTR group pubkey)
- **Signer trusts**: Authenticated server API endpoints
- **Server trusts**: FROSTR shares in the network
- **FROSTR shares trust**: Each other via threshold cryptography

## Implementation Details

### Session State Management

Sessions transition through states:

```typescript
pending → active → expired/revoked

// Pending: Connection initiated but not confirmed
sessionManager._pending.set(pubkey, session)

// Active: Connection confirmed, ready for operations  
sessionManager._active.set(pubkey, session)

// Revoked: Explicitly terminated
sessionManager._revoked.add(pubkey)
```

### Event System

The controller emits events for UI updates:

```typescript
// Connection events
'connected' | 'disconnected' | 'ready' | 'error'

// Session events
'session:pending' | 'session:active' | 'session:updated'

// Request events
'request:new' | 'request:approved' | 'request:denied' | 'request:denied-pending'
```

### Error Handling

Multiple layers of error handling:

1. **Connection Errors**: Relay connectivity issues
2. **Validation Errors**: Caught via 'bounced' events
3. **FROSTR Errors**: Timeout or threshold not met
4. **Permission Errors**: Policy violations

All errors gracefully handled to prevent crashes:

```typescript
try {
  await this.client.socket.send(response, pubkey, relays)
} catch (sendErr) {
  console.error('[NIP46] Failed to send response:', sendErr)
  // Don't throw - prevents crashes from relay issues
}
```

## API Endpoints

### `/api/peers/group`
- **Purpose**: Get FROSTR group public key
- **Method**: GET
- **Response**: `{ pubkey, threshold, totalShares }`

### `/api/sign`
- **Purpose**: Create threshold signature
- **Method**: POST
- **Body**: `{ message: hex_message }`
- **Response**: `{ signature: schnorr_signature }`

### `/api/nip44/encrypt`
- **Purpose**: Encrypt using FROSTR ECDH
- **Method**: POST
- **Body**: `{ peer_pubkey, content }`
- **Response**: `{ result: encrypted_content }`

### `/api/nip44/decrypt`
- **Purpose**: Decrypt using FROSTR ECDH
- **Method**: POST
- **Body**: `{ peer_pubkey, content }`
- **Response**: `{ result: decrypted_content }`

## UI Components

### Main Component (`NIP46.tsx`)
- Initializes controller with FROSTR credentials
- Manages tabs for Sessions and Requests
- Displays connection status and statistics

### Sessions Component (`Sessions.tsx`)
- Lists active and pending sessions
- Allows connection via QR scanner or paste
- Manages permissions per session
- Revoke session functionality

### Requests Component (`Requests.tsx`)
- Shows pending signature requests
- Displays denied requests with reasons
- Approve/deny functionality
- Request details and filtering

### Permissions Component (`Permissions.tsx`)
- Dropdown for editing session permissions
- Method toggles (sign_event, get_public_key, etc.)
- Dynamic event kind management
- Save/update functionality

### QR Scanner Component (`QRScanner.tsx`)
- Scans nostrconnect:// and bunker:// URIs
- Uses qr-scanner library
- Modal interface with camera access

## Configuration

Default NIP-46 configuration in the implementation:

```typescript
const defaultConfig: NIP46Config = {
  relays: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://bucket.coracle.social',
    'wss://relay.nsec.app/'
  ],
  policy: {
    methods: {
      'sign_event': true,
      'get_public_key': true,
      'nip44_encrypt': true,
      'nip44_decrypt': true
    },
    kinds: {}  // No kinds allowed by default
  },
  profile: {
    name: 'Igloo Server',
    url: window.location.origin,
    image: '/assets/frostr-logo-transparent.png'
  },
  timeout: 30
}
```

## Timeout Configuration

The implementation now includes configurable timeouts for FROSTR operations:

```typescript
// Environment variable: FROSTR_SIGN_TIMEOUT (milliseconds)
// Default: 30000ms (30 seconds)

// Applied to both signing and ECDH operations
const response = await Promise.race([
  context.node.req.sign(message),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('FROSTR signing timeout')), TIMEOUT)
  )
])
```

This prevents hanging when FROSTR peers need time to come online.

## Summary

Igloo Server's NIP-46 implementation successfully bridges the gap between traditional Nostr remote signing and FROSTR threshold signatures. Key achievements:

1. **Seamless Integration**: Nostr apps work without modification
2. **Enhanced Security**: No single point of failure for private keys
3. **Flexible Permissions**: Granular control over signing operations
4. **Robust Error Handling**: Graceful degradation and recovery
5. **User-Friendly UI**: Clear session and request management

The implementation cleverly works around library limitations while maintaining full NIP-46 compatibility, making FROSTR threshold signatures accessible to the entire Nostr ecosystem through a familiar protocol.