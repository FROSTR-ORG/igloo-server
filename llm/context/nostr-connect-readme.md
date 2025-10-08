# nostr-connect

A TypeScript implementation of the [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) Nostr Connect protocol for remote signing. This library enables secure communication between Nostr clients and remote signing devices, allowing users to keep their private keys isolated while still being able to sign events and perform cryptographic operations.

## Features

* **Full NIP-46 Implementation** - Complete support for the Nostr Connect protocol
* **Secure Communication** - All messages encrypted using NIP-44 encryption
* **Flexible Architecture** - Support for both client and signer implementations  
* **Session Management** - Built-in session handling with permission controls
* **URI Scheme Support** - Full support for `nostrconnect://` and `bunker://` URI schemes
* **Event-Driven** - Comprehensive event system for monitoring all operations
* **TypeScript First** - Full type safety with TypeScript definitions
* **Automatic Reconnection** - Resilient connection handling with auto-reconnect

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Connection Flows](#connection-flows)
- [Session Management](#session-management)
- [Available Methods](#available-methods)
- [Advanced Usage](#advanced-usage)
- [Examples](#examples)
- [Security Considerations](#security-considerations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install @cmdcode/nostr-connect
```

```bash
yarn add @cmdcode/nostr-connect
```

```bash
pnpm add @cmdcode/nostr-connect
```

## Quick Start

### Setting up a Remote Signer (Bunker)

```typescript
import { SignerAgent, SimpleSigner, InviteEncoder } from '@cmdcode/nostr-connect'

// Create a signer with a private key (or generate a new one)
const signer = new SimpleSigner('your-private-key-hex')

// Create the signing agent
const agent = new SignerAgent(signer, {
  policy: {
    // Define which methods are allowed
    methods: { 
      'sign_event': true, 
      'get_public_key': true,
      'nip44_encrypt': true,
      'nip44_decrypt': true
    },
    // Define which event kinds can be signed
    kinds: { 
      '1': true,  // Regular notes
      '4': true   // DMs
    }
  },
  profile: {
    name: 'My Signer',
    url: 'https://mysigner.com',
    image: 'https://mysigner.com/icon.png'
  }
})

// Connect to Nostr relays
await agent.connect(['wss://relay.damus.io', 'wss://nos.lol'])

// Create an invitation for clients to connect
const invite = agent.invite.create({
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  policy: {
    methods: { 'sign_event': true },
    kinds: { '1': true }
  }
})

// Generate connection URI for the client
const connectionURI = InviteEncoder.encode(invite)
console.log('Connection URI:', connectionURI)
// Output: bunker://pubkey?relay=wss://relay.damus.io&secret=...
```

### Connecting from a Client Application

```typescript
import { SignerClient, SimpleSigner, InviteEncoder } from '@cmdcode/nostr-connect'

// Client needs its own keys for communication (not the signing keys)
const clientSigner = new SimpleSigner()

// Create the client
const client = new SignerClient(clientSigner, {
  queue_timeout: 30,      // Request timeout in seconds
  negotiate_timeout: 5    // Connection negotiation timeout
})

// Parse the connection URI from the signer
const connectionURI = 'bunker://...' // From the signer
const invite = InviteEncoder.decode(connectionURI)

// Connect to the remote signer
await client.session.join(invite)

// Now you can request signatures
const eventTemplate = {
  kind: 1,
  content: 'Hello Nostr!',
  tags: [],
  created_at: Math.floor(Date.now() / 1000)
}

// Request the remote signer to sign the event
const response = await client.socket.request({
  method: 'sign_event',
  params: [JSON.stringify(eventTemplate)]
}, signerPubkey)

if (response.type === 'accept') {
  const signedEvent = JSON.parse(response.result)
  console.log('Signed event:', signedEvent)
}
```

## Core Concepts

### Terminology

Based on NIP-46, this library uses the following terminology:

- **Client**: The application requesting signatures (e.g., a Nostr web app)
- **Remote Signer/Bunker**: The service or device holding the private keys
- **Client Keypair**: Temporary keys used by the client for encrypted communication
- **Remote Signer Keypair**: Keys used by the signer for encrypted communication
- **User Keypair**: The actual Nostr identity keys used for signing events

### Architecture

```
┌─────────────┐         Encrypted Messages          ┌──────────────┐
│   Client    │ <---------------------------------> │ Remote Signer│
│ Application │         (over Nostr relays)         │   (Bunker)   │
└─────────────┘                                     └──────────────┘
      │                                                     │
      │ Requests:                                          │ Holds:
      │ - sign_event                                       │ - User private key
      │ - get_public_key                                   │ - Permission policies
      │ - nip44_encrypt                                    │ - Session management
      └─────────────────────────────────────────────────────┘
```

## API Reference

### SignerAgent

The remote signer implementation that holds private keys and responds to signing requests.

```typescript
class SignerAgent extends EventEmitter {
  constructor(
    signer: SignerDeviceAPI,
    options?: SignerAgentOptions
  )

  // Connect to Nostr relays
  async connect(relays: string[]): Promise<void>

  // Create an invitation for clients
  invite.create(options: InviteOptions): Invite

  // Close all connections
  close(): void

  // Event emitters
  on('ready', () => void)
  on('close', () => void)
  on('error', (error: Error) => void)
}
```

#### SignerAgentOptions

```typescript
interface SignerAgentOptions {
  policy?: PermissionPolicy      // Default permission policy
  profile?: {
    name?: string                // Signer name
    url?: string                 // Signer URL
    image?: string               // Signer icon
  }
  timeout?: number               // Session timeout in seconds (default: 30)
}
```

### SignerClient

The client implementation that requests signatures from remote signers.

```typescript
class SignerClient extends EventEmitter {
  constructor(
    signer: SignerDeviceAPI,
    options?: SignerClientOptions
  )

  // Join a session using an invitation
  session.join(invite: Invite): Promise<void>

  // Request operations from the signer
  socket.request(
    request: RequestMessage,
    pubkey: string
  ): Promise<ResponseMessage>

  // Manage pending requests
  request.approve(request: Request): void
  request.deny(request: Request, reason?: string): void
  request.resolve(request: Request, result: string): void

  // Close the client
  close(): void
}
```

#### SignerClientOptions

```typescript
interface SignerClientOptions {
  queue_timeout?: number         // Request timeout in seconds
  negotiate_timeout?: number     // Connection negotiation timeout
}
```

### SimpleSigner

A basic signer implementation for both client and remote signer use.

```typescript
class SimpleSigner implements SignerDeviceAPI {
  constructor(seckey?: string | Uint8Array)  // Optional private key

  // Required SignerDeviceAPI methods
  get_methods(): string[]
  get_pubkey(): string
  sign_event(event: EventTemplate): Promise<SignedEvent>
  nip04_encrypt(pubkey: string, plaintext: string): Promise<string>
  nip04_decrypt(pubkey: string, ciphertext: string): Promise<string>
  nip44_encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44_decrypt(pubkey: string, ciphertext: string): Promise<string>
}
```

### InviteEncoder

Utility for encoding/decoding connection URIs.

```typescript
class InviteEncoder {
  // Encode an invitation to a URI string
  static encode(invite: Invite): string

  // Decode a URI string to an invitation
  static decode(uri: string): Invite
}
```

## Connection Flows

### Direct Connection (Client-Initiated)

1. **Client generates a connection URI** with `nostrconnect://` scheme
2. **User provides URI to the signer** (QR code, copy/paste, etc.)
3. **Signer sends connect response** to the client
4. **Client validates the response** using the secret

```typescript
// Client creates connection request
const connectionURI = `nostrconnect://${clientPubkey}?` +
  `relay=${encodeURIComponent('wss://relay.example.com')}&` +
  `secret=${randomSecret}&` +
  `perms=sign_event:1,sign_event:4&` +
  `name=MyApp`

// Signer processes the URI and responds
// Client receives and validates the response
```

### Direct Connection (Signer-Initiated)

1. **Signer generates a bunker URI** with connection details
2. **User provides URI to the client**
3. **Client sends connect request** to the signer
4. **Connection established** after signer approval

```typescript
// Signer creates invitation
const bunkerURI = `bunker://${signerPubkey}?` +
  `relay=${encodeURIComponent('wss://relay.example.com')}&` +
  `secret=${optionalSecret}`

// Client connects using the URI
const invite = InviteEncoder.decode(bunkerURI)
await client.session.join(invite)
```

## Session Management

### Permission Policies

Control what operations clients can perform:

```typescript
interface PermissionPolicy {
  methods: {
    [method: string]: boolean  // Which methods are allowed
  }
  kinds: {
    [kind: string]: boolean    // Which event kinds can be signed
  }
}

// Example: Allow only posting notes and reactions
const policy: PermissionPolicy = {
  methods: {
    'sign_event': true,
    'get_public_key': true
  },
  kinds: {
    '1': true,   // Text notes
    '7': true    // Reactions
  }
}
```

### Session Lifecycle

Sessions go through several states:

```typescript
// Monitor session state changes
client.session.on('pending', (session) => {
  console.log('Session pending approval')
})

client.session.on('active', (session) => {
  console.log('Session activated')
})

client.session.on('expired', (session) => {
  console.log('Session expired')
})

client.session.on('revoked', (session) => {
  console.log('Session revoked')
})
```

### Request Approval Flow

Handle requests that need manual approval:

```typescript
// On the signer side
agent.on('/request/prompt', (request) => {
  // Show approval UI to user
  if (userApproves) {
    agent.request.approve(request)
  } else {
    agent.request.deny(request, 'User rejected')
  }
})

// Auto-approve certain operations
agent.on('/request/prompt', (request) => {
  if (request.method === 'get_public_key') {
    agent.request.approve(request)
  }
})
```

## Available Methods

### Core Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `connect` | `[pubkey, secret?, perms?]` | `"ack"` or secret | Establish connection |
| `get_public_key` | `[]` | User public key | Get the signer's public key |
| `ping` | `[]` | `"pong"` | Test connectivity |
| `sign_event` | `[event_json]` | Signed event JSON | Sign a Nostr event |

### Encryption Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `nip04_encrypt` | `[pubkey, plaintext]` | Ciphertext | Encrypt using NIP-04 |
| `nip04_decrypt` | `[pubkey, ciphertext]` | Plaintext | Decrypt using NIP-04 |
| `nip44_encrypt` | `[pubkey, plaintext]` | Ciphertext | Encrypt using NIP-44 |
| `nip44_decrypt` | `[pubkey, ciphertext]` | Plaintext | Decrypt using NIP-44 |

## Advanced Usage

### Custom Signer Implementation

Implement your own signer for hardware wallets or custom signing logic:

```typescript
class CustomSigner implements SignerDeviceAPI {
  get_methods(): string[] {
    return ['sign_event', 'get_public_key']
  }

  get_pubkey(): string {
    // Return the public key
    return myPublicKey
  }

  async sign_event(event: EventTemplate): Promise<SignedEvent> {
    // Custom signing logic (e.g., hardware wallet)
    const signature = await hardwareWallet.sign(event)
    return { ...event, sig: signature, pubkey: this.get_pubkey() }
  }

  // Implement other required methods...
}

const agent = new SignerAgent(new CustomSigner())
```

### Event Monitoring

Monitor all events in the system:

```typescript
// Monitor all socket events
client.on('/socket/*', (event) => {
  console.log('Socket event:', event)
})

// Monitor all request events
client.on('/request/*', (event) => {
  console.log('Request event:', event)
})

// Monitor all session events
client.on('/session/*', (event) => {
  console.log('Session event:', event)
})
```

### Multiple Relay Support

Connect to multiple relays for redundancy:

```typescript
const relays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine'
]

await agent.connect(relays)
```

### Auth Challenges

Handle authentication challenges from signers:

```typescript
client.on('/socket/response', (response) => {
  if (response.result === 'auth_url' && response.error) {
    // Display auth URL to user
    window.open(response.error, '_blank')
    // Wait for authentication to complete
  }
})
```

## Examples

### Complete Client Example

```typescript
import { SignerClient, SimpleSigner, InviteEncoder } from '@cmdcode/nostr-connect'

async function setupClient() {
  // Create client
  const clientSigner = new SimpleSigner()
  const client = new SignerClient(clientSigner)

  // Handle request approval
  client.request.on('prompt', (req) => {
    console.log(`Approve request: ${req.method}?`)
    client.request.approve(req)
  })

  client.request.on('approve', async (req) => {
    if (req.method === 'sign_event') {
      const template = JSON.parse(req.params[0])
      const signed = await clientSigner.sign_event(template)
      client.request.resolve(req, JSON.stringify(signed))
    }
  })

  // Connect to signer
  const uri = 'bunker://...'  // Get from signer
  const invite = InviteEncoder.decode(uri)
  await client.session.join(invite)

  // Request operations
  const pubkey = await client.socket.request({
    method: 'get_public_key',
    params: []
  }, signerPubkey)

  console.log('Connected to signer:', pubkey.result)
  
  return client
}
```

### Complete Signer Example

```typescript
import { SignerAgent, SimpleSigner } from '@cmdcode/nostr-connect'

async function setupSigner() {
  // Create signer with private key
  const signer = new SimpleSigner('private-key-hex')
  
  const agent = new SignerAgent(signer, {
    policy: {
      methods: {
        'sign_event': true,
        'get_public_key': true,
        'nip44_encrypt': true,
        'nip44_decrypt': true
      },
      kinds: {
        '1': true,
        '4': true,
        '7': true
      }
    },
    profile: {
      name: 'My Secure Signer',
      url: 'https://mysigner.com'
    },
    timeout: 60
  })

  // Handle new connections
  agent.invite.on('join', (event) => {
    console.log('New client connected:', event.pubkey)
  })

  // Connect to relays
  await agent.connect([
    'wss://relay.damus.io',
    'wss://nos.lol'
  ])

  // Create invitation
  const invite = agent.invite.create({
    relays: ['wss://relay.damus.io'],
    policy: {
      methods: { 'sign_event': true },
      kinds: { '1': true }
    }
  })

  const uri = InviteEncoder.encode(invite)
  console.log('Connection URI:', uri)

  return agent
}
```

## Security Considerations

### Private Key Management

- **Never expose private keys** in client applications
- **Use hardware signers** when possible for maximum security
- **Implement secure key storage** in production signers
- **Rotate client keys** regularly as they're ephemeral

### Connection Security

- **All messages are encrypted** using NIP-44 by default
- **Validate connection secrets** to prevent spoofing
- **Use multiple relays** to prevent single points of failure
- **Implement rate limiting** in production signers

### Permission Management

- **Principle of least privilege** - only grant necessary permissions
- **Review permission requests** carefully before approving
- **Implement timeout policies** for inactive sessions
- **Log all signing operations** for audit purposes

### Best Practices

1. **Always validate event templates** before signing
2. **Implement user confirmation** for sensitive operations
3. **Use secure communication channels** for sharing connection URIs
4. **Monitor for suspicious activity** in signing patterns
5. **Keep the library updated** for security patches

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/cmdcode/nostr-connect
cd nostr-connect

# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test
```

### Running Tests

```bash
# Run full test suite
npm test

# Run specific test file
npm run script test/case/ping.test.ts

# Run test relay
npm run relay

# Run test client
npm run test:client

# Run test signer
npm run test:signer
```

### Demo Application

A full demo application is included:

```bash
# Run demo in development mode
npm run demo:dev

# Build demo for production
npm run demo:build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Guidelines

1. Ensure all tests pass
2. Update documentation for API changes
3. Follow the existing code style
4. Add tests for new features
5. Keep commits atomic and well-described

## License

MIT License - see [LICENSE](LICENSE) file for details
