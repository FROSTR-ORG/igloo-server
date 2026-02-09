# NIP-46 (Nostr Connect) Implementation Guide

This document describes how NIP-46 remote signing works in Igloo Server. It covers the architecture, data model, API endpoints, and request processing flow.

## 1. Overview

Igloo Server implements NIP-46 (Nostr Connect) as a remote signer that allows Nostr clients to request signatures without exposing private keys. The implementation uses FROSTR threshold signatures, meaning the full private key never exists in any single location.

**Key Components:**
- **Transport Layer**: `@cmdcode/nostr-connect` library handles relay connections and NIP-46 protocol
- **Backend Service**: `Nip46Service` class manages sessions, requests, and signing operations
- **Database**: SQLite tables store sessions, policies, requests, and transport keys
- **Frontend UI**: React components for session management, request approval, and relay configuration

**Availability**
- NIP-46 routes are enabled only in **Database Mode**. Headless mode returns 404 for `/api/nip46/*`.
- Requests require an authenticated **DB user** (numeric user id). Env-auth users (API key/Basic) cannot access NIP-46.

## 2. Architecture

### Dual-Key Model

1. **Transport Key**: Per-user 32-byte private key used only for NIP-44 encryption of NIP-46 messages between client and server. Stored in `nip46_transport_keys` table.

2. **Identity Key**: FROSTR group public key (threshold identity). All signing and ECDH operations happen server-side via Bifrost; private shares never exist in the browser.

### Core Files

| Component | Location |
|-----------|----------|
| Service | `src/nip46/service.ts` |
| Database | `src/db/nip46.ts` |
| API Routes | `src/routes/nip46.ts` |
| Crypto Utils | `src/routes/crypto-utils.ts` |
| Main UI | `frontend/components/NIP46.tsx` |
| Session UI | `frontend/components/nip46/Sessions.tsx` |
| Request UI | `frontend/components/nip46/Requests.tsx` |
| Policy UI | `frontend/components/nip46/Permissions.tsx` |

## 3. Database Schema

### nip46_sessions

Stores client sessions with their connection state and permissions.

```sql
CREATE TABLE nip46_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_pubkey TEXT NOT NULL,  -- 64-char hex, lowercase
  status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')) DEFAULT 'pending',
  profile_name TEXT,
  profile_url TEXT,
  profile_image TEXT,
  relays TEXT,           -- JSON array string
  policy_methods TEXT,   -- JSON object: { "sign_event": true, ... }
  policy_kinds TEXT,     -- JSON object: { "1": true, "*": true, ... }
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME,
  UNIQUE(user_id, client_pubkey)
);
```
Notes:
- `revoked` remains in the schema for compatibility, but revoked sessions are deleted and excluded from listings.

### nip46_requests

Queue of pending and processed signing requests.

```sql
CREATE TABLE nip46_requests (
  id TEXT PRIMARY KEY,              -- UUID or random hex
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_pubkey TEXT NOT NULL,     -- 64-char hex
  method TEXT NOT NULL,             -- sign_event, nip44_encrypt, etc.
  params TEXT NOT NULL,             -- JSON: { id, method, params, session }
  status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','completed','failed','expired')),
  result TEXT,                      -- Response payload
  error TEXT,                       -- Error message
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);
```

### nip46_transport_keys

Per-user transport signing key for NIP-46 envelope encryption.

```sql
CREATE TABLE nip46_transport_keys (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  transport_sk TEXT NOT NULL,  -- 64-char hex (32-byte private key)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### nip46_relays

Per-user relay pool for NIP-46 connections.

```sql
CREATE TABLE nip46_relays (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  relays TEXT NOT NULL,  -- JSON array string
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### nip46_session_events

Audit log for session changes.

```sql
CREATE TABLE nip46_session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_pubkey TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created','status_change','grant_method','grant_kind','revoke_method','revoke_kind','upsert'
  )),
  detail TEXT,   -- Method/kind name when granting/revoking
  value TEXT,    -- Additional context (e.g., new status)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 4. API Endpoints

Base path: `/api/nip46/`

### Transport Key

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/transport` | Get or create transport key |
| `PUT` | `/transport` | Set transport key (64-char hex) |

### Relays

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/relays` | List configured relays |
| `POST` | `/relays` | Merge new relays into pool |
| `PUT` | `/relays` | Replace entire relay list |

### Connection

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/connect` | Process `nostrconnect://` URI, create session |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sessions` | List active/pending sessions (`?history=true` adds recent grants) |
| `POST` | `/sessions` | Create/update session manually (rate-limited) |
| `PUT` | `/sessions/:pubkey/policy` | Update session permissions |
| `PUT` | `/sessions/:pubkey/status` | Change session status (`revoked` deletes) |
| `DELETE` | `/sessions/:pubkey` | Delete session |

### Requests

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/requests` | List requests (`?status=pending,approved&limit=100`, max 500) |
| `POST` | `/requests` | Update request status (`action=approve|deny|fail|complete`); optional policy patch |
| `DELETE` | `/requests` | Delete request (body includes `id`) |

### History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/history` | Sessions with recent grant history (`recent_kinds`, `recent_methods`) |

## 5. Request Processing Flow

### Connection Flow

1. User scans/pastes `nostrconnect://pubkey?relay=...&secret=...` URI
2. Frontend calls `POST /api/nip46/connect` with the URI
3. Server decodes invite, extracts client pubkey, relays, requested permissions
4. Server creates a session with status `pending` (marked `active` on connect or activity)
5. Server subscribes to client's relays via `SignerAgent`
6. Server sends connect acknowledgment back to client

### Signing Request Flow

1. Client sends `sign_event` request (NIP-44 encrypted) to relay
2. Server's `SignerAgent` receives request via socket
3. Server upserts session (marks active, updates `last_active_at`)
4. Server checks for duplicate request ID (idempotency)
5. Server creates request record in `nip46_requests` table
6. **Auto-approval check**: If policy allows method + kind, auto-approve
7. If not auto-approved, request stays `pending` for manual approval
8. When approved (auto or manual):
   - Parse event template from params
   - Compute event hash (SHA-256)
   - Call `node.req.sign(eventId)` via Bifrost (threshold signature)
   - Construct signed event with `id` and `sig`
   - Send response back to client via socket
   - Update request status to `completed`

### NIP-44 Encrypt/Decrypt Flow

1. Client sends `nip44_encrypt` or `nip44_decrypt` request
2. Server queues request, checks auto-approval
3. When approved:
   - Extract `peer_pubkey` and `plaintext`/`ciphertext` from params
   - Call `node.req.ecdh(peerPubkey)` via Bifrost to derive shared secret
   - Use `nostr-tools` nip44 module with derived key
   - Return encrypted/decrypted result

## 6. Policy System

### Structure

```typescript
interface Nip46Policy {
  methods?: Record<string, boolean>  // { sign_event: true, nip44_encrypt: true }
  kinds?: Record<string, boolean>    // { "1": true, "4": true, "*": true }
}
```

### Default Policy

- **Stored session policy** is empty unless provided (via `perms` in the connect URI or `/api/nip46/sessions`). Empty policy means **no auto-approval**.
- **SignerAgent base policy** (for the transport layer) is initialized as:

```typescript
{
  methods: {
    sign_event: true,
    get_public_key: true,
    nip44_encrypt: true,
    nip44_decrypt: true,
    nip04_encrypt: false,  // Legacy, disabled
    nip04_decrypt: false
  },
  kinds: {}  // No kinds allowed by default
}
```

### Auto-Approval Logic

A request is auto-approved when:

- **sign_event**: `policy.methods.sign_event === true` AND (`policy.kinds["*"] === true` OR `policy.kinds[kind] === true`)
- **Other methods**: `policy.methods[method] === true`

### Policy from Connect URI

The server prefers an explicit `invite.policy` (from the decoded connect string). If none is provided, it parses the `perms` query string.

The `nostrconnect://` URI can include a `perms` parameter:

```
nostrconnect://pubkey?relay=wss://...&perms=sign_event:1,sign_event:4,nip44_encrypt
```

This is parsed into policy:
- `sign_event:1` -> `kinds["1"] = true`
- `sign_event:4` -> `kinds["4"] = true`
- `nip44_encrypt` -> `methods["nip44_encrypt"] = true`

## 7. Service Lifecycle

### Initialization

```typescript
// In src/nip46/index.ts
initNip46Service({
  addServerLog,    // Logging function
  broadcastEvent,  // WebSocket event broadcaster
  getNode          // Returns Bifrost node or null
})
```

### Startup

1. Service waits for active user (`setActiveUser(userId)`), typically set when a DB user loads credentials or calls NIP-46 endpoints
2. Loads or generates transport key from database
3. Loads relay list (default: `['wss://relay.primal.net']`)
4. Creates `SimpleSigner` with transport key
5. Creates `SignerAgent` with signer
6. Connects to relay pool
7. Registers socket event handlers

### Event Handlers

| Event | Handler | Action |
|-------|---------|--------|
| `ready` | Log ready state | Informational |
| `request` | `handleSocketRequest` | Process incoming NIP-46 request |
| `bounced` | `handleSocketBounced` | Retry with manual decryption |
| `error` | `handleSocketError` | Log errors |
| `closed` | `handleSocketClosed` | Auto-restart connection |

### Shutdown

```typescript
await nip46Service.stop()
// Closes agent, removes listeners, clears state
```

## 8. Frontend Components

### NIP46.tsx (Main Container)

- Tabbed interface: Sessions | Requests | Relays
- Polls requests every 5 seconds
- Listens for `nip46:*` WebSocket events
- Manages transport key display/copy

### Sessions.tsx

- Lists all active/pending sessions
- Shows: avatar, name, pubkey, status, relays, timestamps
- Actions: Edit permissions, Revoke session
- Expandable policy editor via `PermissionsDropdown`

### Requests.tsx

- Lists pending requests awaiting approval
- Shows: method, event kind, content preview, session info
- Actions:
  - Approve/Deny single request
  - Approve/Deny all requests
  - Remember method/kind (updates policy)
  - Block method/kind (updates policy)
  - Bulk approve/deny by kind

### Permissions.tsx

- Toggle individual methods: `sign_event`, `get_public_key`, `nip44_*`, `nip04_*`
- Manage allowed event kinds
- Quick-add common kinds (1, 4, 7)
- Wildcard `*` to allow all kinds
- Apply recommended preset / reset

### RelaySettings.tsx

- Add/remove relays from pool
- Validates `ws://` or `wss://` protocol

## 9. Supported NIP-46 Methods

| Method | Description | Auto-Approvable |
|--------|-------------|-----------------|
| `connect` | Initial connection handshake | Always handled |
| `ping` | Keepalive check | Always responds `pong` |
| `get_public_key` | Return identity pubkey | Yes (if method allowed) |
| `sign_event` | Sign a Nostr event | Yes (if method + kind allowed) |
| `nip44_encrypt` | Encrypt with NIP-44 | Yes (if method allowed) |
| `nip44_decrypt` | Decrypt with NIP-44 | Yes (if method allowed) |
| `nip04_encrypt` | Encrypt with NIP-04 (legacy) | Yes (if method allowed) |
| `nip04_decrypt` | Decrypt with NIP-04 (legacy) | Yes (if method allowed) |

## 10. Security Considerations

- **Transport key isolation**: Transport key is per-user and only used for NIP-46 envelope encryption, never for identity operations
- **Threshold signing**: Identity operations use FROSTR threshold signatures; full private key never exists
- **Policy enforcement**: All requests go through policy check before execution
- **Request queue**: Requests not auto-approved require manual UI approval
- **Session revocation**: Revoked sessions are deleted from database (status not persisted)
- **Rate limiting**: Session creation limited by `NIP46_SESSION_RATE_LIMIT_MAX`/`NIP46_SESSION_RATE_LIMIT_WINDOW` (defaults: 120 per 3600s)
- **Data size limits**: JSON fields limited to 50KB to prevent DoS

## 11. Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FROSTR_SIGN_TIMEOUT` | `30000` | Timeout for signing operations (ms) |
| `NIP46_SESSION_RATE_LIMIT_MAX` | `120` | Max session creates per window |
| `NIP46_SESSION_RATE_LIMIT_WINDOW` | `3600` | Rate limit window in seconds |

### Default Relay

When no relays are configured, the server uses:
```
wss://relay.primal.net
```

### Maximum Relays

Each user can configure up to 32 relays.

## 12. Code References

| Function | Location | Purpose |
|----------|----------|---------|
| `Nip46Service` | `src/nip46/service.ts` | Main service class |
| `handleSocketRequest` | `src/nip46/service.ts` | Process incoming requests |
| `processApprovedRequest` | `src/nip46/service.ts` | Execute approved requests |
| `handleSignEvent` | `src/nip46/service.ts` | Sign event via FROSTR |
| `shouldAutoApprove` | `src/nip46/service.ts` | Policy check logic |
| `upsertSession` | `src/db/nip46.ts` | Create/update session |
| `createNip46Request` | `src/db/nip46.ts` | Queue new request |
| `deriveSharedSecret` | `src/routes/crypto-utils.ts` | ECDH for NIP-44 |
