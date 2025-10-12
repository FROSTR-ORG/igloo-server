# Igloo Server

A server-based signing device and personal ephemeral relay for the **FROSTR** protocol. Part of the FROSTR ecosystem of k-of-n remote signing clients for Nostr, providing an always-on signing node with optional web UI for configuration and monitoring.

Built on [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core) for reliable FROSTR protocol operations.

## Table of Contents

- [What is FROSTR?](#what-is-frostr)
- [Features](#features)
  - [🔐 FROSTR Signing Node](#-frostr-signing-node)
  - [🌐 Modern Web Interface](#-modern-web-interface)
  - [📡 Ephemeral Nostr Relay](#-ephemeral-nostr-relay)
  - [⚙️ Flexible Operation Modes](#️-flexible-operation-modes)
- [Architecture](#architecture)
- [Health Monitoring & Auto-Restart](#health-monitoring--auto-restart)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation & Setup](#installation--setup)
  - [Configuration Options](#configuration-options)
  - [Docker Deployment](#docker-deployment)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [API Keys](#api-keys)
  - [Environment Management](#environment-management)
  - [Server Status](#server-status)
  - [Peer Management](#peer-management)
  - [Key Recovery](#key-recovery)
  - [Share Management](#share-management)
  - [Real-time Events](#real-time-events)
- [Deployment](#deployment)
  - [Digital Ocean Deployment](#digital-ocean-deployment)
  - [Umbrel Deployment](#umbrel-deployment)
  - [Start9 Deployment](#start9-deployment)
- [Development](#development)
  - [Development Mode](#development-mode)
  - [Development vs Production Caching](#development-vs-production-caching)
  - [Build Commands](#build-commands)
  - [Frontend Structure](#frontend-structure)
- [Built on Igloo-Core](#built-on-igloo-core)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
  - [Common Issues](#common-issues)
  - [Getting Help](#getting-help)
- [Security Configuration](#security-configuration)
  - [🔐 Authentication](#-authentication)
  - [📋 Quick Security Setup](#-quick-security-setup)
  - [🛡️ Security Features](#️-security-features)
- [Security Notes](#security-notes)
- [License](#license)
- [Contributing](#contributing)

## What is FROSTR?

**FROSTR** is a simple k-of-n remote signing and key management protocol for Nostr, using the powers of FROST. It allows you to break up an existing **nsec** into fragments called "shares" and create any kind of multi-signature setup using your shares and signing devices. If one share is compromised, your secret key remains safe, and your **npub** and signatures don't change - nobody knows you're using a multi-sig.

## Features

### 🔐 **FROSTR Signing Node**
- **Always-On Operation**: Persistent signing node that handles Nostr signature requests automatically
- **Share-Based Security**: Uses FROST threshold signatures with your nsec shares - never reconstructs the full private key
- **Multi-Relay Support**: Connects to multiple Nostr relays for redundancy and coordination
- **Real-time Monitoring**: Live peer status tracking and event logging
- **Health Monitoring**: Automatic node health checks with activity tracking every 30 seconds
- **Auto-Restart**: Automatic recovery from silent failures after consecutive connectivity failures (checks every 60s; restarts after 3 failures)
- **Connection Resilience**: Enhanced reconnection logic with exponential backoff and extended timeouts

### 🌐 **Modern Web Interface** 
- **React Frontend**: Modern, responsive UI built with TypeScript and Tailwind CSS
- **Configuration Management**: Set up credentials, manage relays, and monitor status
- **Key Recovery**: Intuitive interface for recovering secrets from threshold shares
- **Live Event Logs**: Real-time visibility into signing operations and network events
- **Peer Management**: Monitor other nodes in your signing group with ping/status tracking
- **Authentication**: Secure login with multiple authentication methods (API key, username/password, sessions)

### 📡 **Ephemeral Nostr Relay**
- **Testing Convenience Only**: Built-in relay for development and integration testing; **not recommended for production deployments**
- **In-Memory Storage**: Temporarily caches events without persistent database
- **WebSocket Support**: Full NIP-01 compliant Nostr relay implementation  
- **Auto-Purging**: Configurable memory cleanup (default: 30 seconds)

### ⚙️ **Flexible Operation Modes**
- **Database Mode (Default)**: Multi-user support with encrypted credential storage
- **Headless Mode**: Single-user operation via environment variables (backward compatible)
- **Web UI**: Full React interface for interactive management
- **API Access**: RESTful endpoints for programmatic control
- **Event Streaming**: WebSocket-based real-time updates with automatic reconnection

## Choosing Your Operation Mode

Igloo Server supports two distinct operation modes to fit different deployment needs:

### 🗄️ Database Mode (Default - HEADLESS=false)
Best for:
- **Multi-user deployments** where different users need their own credentials
- **Teams** collaborating on signing operations
- **Personal use** across multiple devices
- **Enhanced security** with encrypted credential storage

Features:
- ✅ Multiple user accounts with individual credentials
- ✅ Password-protected credential encryption (AES-256)
- ✅ Admin-controlled onboarding with ADMIN_SECRET
- ✅ Per-user credential management
- ✅ SQLite database storage (configurable location)

### 📝 Headless Mode (HEADLESS=true)  
Best for:
- **Single signing nodes** in automated setups
- **Docker deployments** with environment-based config
- **Backward compatibility** with existing setups
- **Simple deployments** without user management needs

Features:
- ✅ Direct environment variable configuration
- ✅ Directional peer policies via `PEER_POLICIES` env var
- ✅ No database dependencies
- ✅ Simpler deployment model
- ✅ Compatible with existing automation
- ❌ Frontend/UI disabled (API-only)

#### Headless Peer Policies
Use the `PEER_POLICIES` environment variable to pre-load deviations from the default `allow`/`allow` policy when the server boots. Provide a JSON array (or single JSON object) with the peer `pubkey` and any directions you want to block (`allowSend:false` and/or `allowReceive:false`). Example:

```
PEER_POLICIES=[{"pubkey":"abcdef...","allowSend":false}]
```

Entries that keep both directions allowed are ignored—only explicit blocks are persisted. At runtime the server also mirrors database-stored policies into `data/peer-policies.json` so headless/API-auth sessions pick up overrides after restarts.

### Mode Selection Guide

| Use Case | Recommended Mode | Why |
|----------|-----------------|-----|
| Personal multi-device | Database | Login-protected access with encrypted credential storage |
| Team collaboration | Database | Per-user accounts and policy persistence |
| Automated signing node | Headless | Minimal env-based config, API-focused |
| Docker/Kubernetes | Headless | Container-friendly env vars |
| High-security setup | Database | Credentials encrypted at rest; peer policies tied to accounts |
| Quick testing | Headless | Fast bootstrap with direct env creds |

To choose your mode, set the `HEADLESS` environment variable:
```bash
# Database mode (default)
HEADLESS=false  # or omit entirely

# Headless mode
HEADLESS=true
```

#### Local Dev (Headless) with API Key

For local headless setups, even if `AUTH_ENABLED=false`, configuration endpoints under `/api/env*` require authentication to avoid exposing secrets. The simplest way is to set an API key and use it in requests:

```bash
export HEADLESS=true
export AUTH_ENABLED=false   # local only; /api/env still requires a key
export API_KEY=dev-local-key

# Start the server
bun run start

# Read public env vars (headless)
curl -sS -H "X-API-Key: $API_KEY" http://localhost:8002/api/env | jq .

# Write env vars (headless)
curl -sS -X POST \
  -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"RATE_LIMIT_MAX":"200"}' \
  http://localhost:8002/api/env | jq .
```

## Architecture

The server provides three integrated services:

1. **FROSTR Signing Node** - Built on igloo-core with bifrost protocol implementation
2. **Web Interface** - React frontend for configuration and monitoring  
3. **Ephemeral Test Relay** - In-memory relay included for development/testing convenience; not suitable for production
4. **Database Module** - SQLite database for multi-user support (included in all builds but only initialized in database mode)

## Health Monitoring & Auto-Restart

Igloo Server includes a comprehensive health monitoring system designed to prevent silent failures and ensure reliable operation during long-running deployments:

### 🔍 **Health Monitoring**
- **Activity Tracking**: Every bifrost message, event, and connection update updates a `lastActivity` timestamp
- **Idle Keepalive**: Updates activity timestamp locally when idle > 45 seconds to maintain healthy status
- **Connectivity Checks**: Tests relay connections every 60 seconds to detect silent failures
- **Real-time Status**: Health information available via `/api/status` endpoint

### ⚡ **Auto-Restart System** 
- **Failure Detection**: Node recreated after 3 consecutive connectivity check failures
- **Null Node Recovery**: Even null/failed nodes trigger proper recovery mechanisms
- **Progressive Retry**: Uses exponential backoff for restart attempts
- **Graceful Recovery**: Maintains peer status and connection state through restarts

### 📊 **Health Metrics**
- **Last Activity**: Timestamp of most recent node activity
- **Last Connectivity Check**: Timestamp of the last connectivity probe
- **Is Connected**: Boolean indicating current connectivity state
- **Consecutive Failures**: Number of consecutive failed connectivity checks
- **Time Since Activity**: Milliseconds since last activity
- **Time Since Connectivity Check**: Milliseconds since last connectivity probe

### 🛡️ **Connection Resilience**
- **Connectivity Monitoring**: Checks relay connections every 60 seconds
- **Idle Handling**: Local timestamp updates when idle > 45 seconds prevent false failures
- **Null Node Handling**: Properly recovers even when node is null or undefined
- **Auto-Recovery**: Recreates node after detecting persistent connectivity issues
- **Clean Logging**: Filters self-pings and reduces log noise for production

This system addresses common issues with long-running deployments where nodes may silently stop responding after extended periods, ensuring your signing node remains operational and responsive.

### 🚨 Error Circuit Breaker

To avoid degraded-long running states from repeated unexpected failures, the server tracks unhandled errors in a sliding window and can exit so a supervisor restarts it.

- Counting window: `ERROR_CIRCUIT_WINDOW_MS` (default 60s)
- Threshold: `ERROR_CIRCUIT_THRESHOLD` errors within the window (default 10)
- Exit code: `ERROR_CIRCUIT_EXIT_CODE` (default 1)

Notes
- Common relay/network rejections are filtered and do not count toward the breaker.
- When tripped, the process requests a graceful shutdown and exits; use a supervisor (e.g., systemd, Docker, k8s) to restart.

## Quick Start

### Prerequisites

- **Bun runtime** (required) - This project uses Bun-specific APIs including `bun:sqlite`, `Bun.file`, and `Bun.password`. Install from [bun.sh](https://bun.sh/)
- **FROSTR credentials** (group + share) from your nsec shares generated by Igloo Desktop (for headless mode)
- **Admin secret** for initial setup (for database mode)

### Installation & Setup

```bash
# Clone the repository
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server

# Install dependencies
bun install

# Build the frontend
bun run build

# Start the server
bun run start
```

The server will be available at **http://localhost:8002**

### Configuration Options

#### Option 1: Database Mode with Web Interface (Default - Recommended)
This mode provides user management with secure credential storage in a SQLite database.

##### Initial Setup (First Time Only)

> ⚠️ **Security Note**: Never store secrets directly in files. Use environment variables or proper secret management tools.

1. Set the `ADMIN_SECRET` environment variable:
   ```bash
   # Option 1: Export to current shell session (recommended for development)
   export ADMIN_SECRET=$(openssl rand -hex 32)
   echo "Your admin secret: $ADMIN_SECRET" # Save this securely!

   # Option 2: Pass directly when starting the server
   ADMIN_SECRET=$(openssl rand -hex 32) bun run start

   # Option 3: For persistent non-production use, create .env (already gitignored)
   # ⚠️ Only use this method if you understand the security implications
   # echo "ADMIN_SECRET=$(openssl rand -hex 32)" >> .env
   ```
2. Start the server: `bun run start` (or with the env var as shown above)
3. Open http://localhost:8002 in your browser
4. Enter the admin secret when prompted
5. Create your admin username and password
6. Login with your new credentials
7. Use the **Configure** tab to enter your FROSTR credentials:
   - **Group Credential** (`bfgroup1...`)
   - **Share Credential** (`bfshare1...`)
   - **Relay URLs** (optional - defaults to `wss://relay.primal.net`)
8. Your credentials are encrypted and stored in the database

Important: `ADMIN_SECRET` behavior and operational guidance

- The startup check for `ADMIN_SECRET` is enforced only on first run (when the database is uninitialized).
- Keep `ADMIN_SECRET` set in production even after initialization. Admin endpoints (`/api/admin/*`) accept either a valid `ADMIN_SECRET` bearer token or a logged‑in admin session. If `ADMIN_SECRET` is unset, you can still use admin APIs with an authenticated admin session.
- Rotate `ADMIN_SECRET` by changing its value and restarting the server. Rotation does not affect existing users or database contents.
- Lost `ADMIN_SECRET` but still have server access: set a new `ADMIN_SECRET` in the environment and restart. If you also need to recreate the first admin user, see “Force first‑run (reinitialize)” below.

Force first-run (reinitialize)

To intentionally trigger the first-run onboarding flow again, delete the SQLite database so the server detects an uninitialized state on next start. The database location is controlled by `DB_PATH`:

- If `DB_PATH` is unset (default): database file is `./data/igloo.db`.
- If `DB_PATH` points to a directory: database file is `$DB_PATH/igloo.db`.
- If `DB_PATH` points to a file (ends with a filename): that file is the database.

Examples (Linux/macOS):

```bash
# Default location
rm -f ./data/igloo.db

# Custom directory
export DB_PATH=/var/lib/igloo/data
sudo rm -f "$DB_PATH/igloo.db"

# Custom explicit file path
export DB_PATH=/var/lib/igloo/app.db
sudo rm -f "$DB_PATH"

# Optional: remove entire data directory (also removes .session-secret)
rm -rf ./data
```

Then set a secure `ADMIN_SECRET` and start the server to run onboarding again.

Note about overrides: There is currently no `--force-first-run` flag in the codebase. If you need to reinitialize without deleting the database, consider implementing a startup override (e.g., `--force-first-run` or `FORCE_FIRST_RUN=true`) that temporarily disables normal routes and only enables the onboarding endpoints until the first user is created.

### Database directory permissions and ownership

Apply the principle of least privilege to the database directory and files. Recommended settings (Linux/macOS):

```bash
# Example: dedicated user and group running the server
sudo chown -R igloo:igloo /var/lib/igloo/data

# Restrictive directory permissions
sudo chmod 700 /var/lib/igloo/data

# Restrictive file permissions (database and secrets)
sudo chmod 600 /var/lib/igloo/data/igloo.db
sudo chmod 600 /var/lib/igloo/data/.session-secret

# If using the default local path
chmod 700 ./data
chmod 600 ./data/igloo.db ./data/.session-secret
```

Ownership should be assigned to the user that runs the `igloo-server` process. For Docker, enforce permissions via the volume’s UID:GID and Dockerfile/entrypoint.

##### Subsequent Access
1. Start the server: `bun run start`
2. Open http://localhost:8002
3. Login with your username and password
4. The signer will start automatically with your stored credentials

**Security Note**: Credentials are encrypted using your password. The server never stores your password in plain text.

#### Option 2: Headless Mode (Environment Variables)
For simple deployments or automation, you can use traditional environment variable configuration:

```bash
# Set configuration via environment variables (recommended)
export HEADLESS=true
export GROUP_CRED="bfgroup1qqsqp...your-group-credential"
export SHARE_CRED="bfshare1qqsqp...your-share-credential"
export RELAYS='["wss://relay.primal.net","wss://relay.damus.io"]'
export GROUP_NAME="my-signing-group"

# Start server (node will start automatically with valid credentials)
bun run start

# Optional: block directions per peer (defaults remain allow/allow unless you set explicit false)
export PEER_POLICIES='[{"pubkey":"02abcdef...","allowSend":false}]'

# Alternative: For development/testing only, you can use .env file
# ⚠️ Remember: .env files are gitignored but still risky for secrets
# cat > .env << EOF
# HEADLESS=true
# GROUP_CRED=bfgroup1qqsqp...your-group-credential
# SHARE_CRED=bfshare1qqsqp...your-share-credential
# RELAYS=["wss://relay.primal.net","wss://relay.damus.io"]
# GROUP_NAME=my-signing-group
# EOF
```

**Notes for headless mode**
- The React frontend is disabled; manage the server via API.
- Leave `GROUP_CRED`/`SHARE_CRED` unset to configure credentials later through the API before the node starts.
- `PEER_POLICIES` only persists entries that set `allowSend:false` or `allowReceive:false`. Saved overrides are mirrored to `data/peer-policies.json` so they survive restarts and are applied for API-key flows.
- API key auth stays env-managed: set `API_KEY` before launch, and note `/api/env` can't create or rotate it—only that one configured value is accepted today.

## API Keys

Igloo Server supports API keys both in headless and database modes:

- Headless mode: supply a single `API_KEY` via environment; HTTP cannot create/rotate it. Attempting to set `API_KEY` via `/api/env` is rejected by design.
- Database mode: manage multiple keys via admin endpoints or the UI “API Keys” tab.

Endpoints (database mode):

- `GET /api/admin/api-keys` — list keys
- `POST /api/admin/api-keys` — create a key `{ label?: string, userId?: number }`
- `POST /api/admin/api-keys/revoke` — revoke `{ apiKeyId: number, reason?: string }`

Authentication:

- Use `Authorization: Bearer <ADMIN_SECRET>`
- Or, if you are logged in as a user with role `admin`, your active session is accepted and you do not need to include `ADMIN_SECRET`. The first account created during onboarding is automatically promoted to `admin`.

Usage notes:

- The full key token is shown only once at creation; the server stores a hash and a short prefix.
- The server records `last_used_at` and `last_used_ip` on successful API‑key auth. For `last_used_ip` behind a proxy, ensure `X‑Forwarded‑For` is forwarded from a trusted hop.

Helper scripts:

- `scripts/api-admin-keys.sh` — list/create/revoke admin keys (requires `jq`)
- `scripts/api-test.sh` — quick API smoke using an issued key

UI:

- Logged-in admin users will see an “API Keys” tab between “NIP‑46” and “Recover”. When logged in as admin, the tab auto-loads without prompting for `ADMIN_SECRET`.

### Docker Deployment

```bash
# Build and run with Docker
docker build -t igloo-server .
# Database mode (with persistent storage)
docker run -p 8002:8002 \
  -v igloo-data:/app/data \
  -e NODE_ENV="production" \
  -e HOST_NAME="0.0.0.0" \
  -e ADMIN_SECRET="your-secure-admin-secret" \
  -e SESSION_SECRET="your-random-64-char-session-secret-here" \
  -e AUTH_ENABLED="true" \
  -e RATE_LIMIT_ENABLED="true" \
  igloo-server

# Optional CI smoke test helper (auto-generates a disposable admin secret)
# docker run -p 8002:8002 \
#   -e AUTO_ADMIN_SECRET="true" \
#   igloo-server

# Or headless mode (traditional)
docker run -p 8002:8002 \
  -e NODE_ENV="production" \
  -e HOST_NAME="0.0.0.0" \
  -e HEADLESS="true" \
  -e GROUP_CRED="bfgroup1qqsqp..." \
  -e SHARE_CRED="bfshare1qqsqp..." \
  -e RELAYS='["wss://relay.primal.net","wss://relay.damus.io"]' \
  -e AUTH_ENABLED="true" \
  -e SESSION_SECRET="your-random-64-char-session-secret-here" \
  -e API_KEY="your-secure-api-key-here" \
  -e BASIC_AUTH_USER="admin" \
  -e BASIC_AUTH_PASS="your-strong-password" \
  -e RATE_LIMIT_ENABLED="true" \
  igloo-server

# Or use Docker Compose (compose.yml)
docker compose up -d
```

> Tip: Persist the database with a volume in Docker Compose
>
> ```yaml
> services:
>   igloo-server:
>     volumes:
>       - ./data:/app/data:rw
> ```

## API Reference

The server provides RESTful APIs for programmatic control.

### 📖 Interactive API Documentation

**Swagger UI**: [http://localhost:8002/api/docs](http://localhost:8002/api/docs) - Interactive API explorer with request testing (self‑hosted assets; run `bun run docs:vendor` if assets are missing)
**OpenAPI Spec**:
- JSON: [http://localhost:8002/api/docs/openapi.json](http://localhost:8002/api/docs/openapi.json)
- YAML: [http://localhost:8002/api/docs/openapi.yaml](http://localhost:8002/api/docs/openapi.yaml)

💡 **Note**: Documentation requires authentication in production environments for security.

### API Endpoints

### Authentication
```bash
# Login with username/password or API key
POST /api/auth/login
Content-Type: application/json
{
  "username": "admin",
  "password": "your-password"
}
# OR
{
  "apiKey": "your-api-key"
}

# Logout (clear session)
POST /api/auth/logout

# Get authentication status
GET /api/auth/status
```

### Admin API (database mode)
```bash
# Check admin session (used by UI). Returns 200 when caller is admin.
GET /api/admin/whoami

# List API keys (requires ADMIN_SECRET or admin session)
GET /api/admin/api-keys

# Create a new API key (token returned once in response)
POST /api/admin/api-keys
# EITHER send ADMIN_SECRET
#   Authorization: Bearer $ADMIN_SECRET
# OR rely on an authenticated admin session (UI path)
Content-Type: application/json
{
  "label": "automation bot",
  "userId": 1
}

# Revoke an API key by id
POST /api/admin/api-keys/revoke
# EITHER Authorization: Bearer $ADMIN_SECRET or admin session
Content-Type: application/json
{
  "apiKeyId": 3,
  "reason": "rotating credentials"
}
```
> ⚠️ Admin-issued tokens are only shown in the creation response—store them securely.

Admin session behavior
- In database mode, successful logins create a minimal record in SQLite so sessions survive dev restarts. Only the session id, user id, IP, and timestamps are stored; no passwords or derived keys are persisted.
- UI uses `GET /api/admin/whoami` to detect admin privileges instead of assuming user id `1`.

### Environment Management
```bash
# Get current configuration
GET /api/env

# Update configuration (database mode): requires admin session or ADMIN_SECRET
POST /api/env
Content-Type: application/json
{
  "GROUP_CRED": "bfgroup1...",
  "SHARE_CRED": "bfshare1...",
  "RELAYS": "[\"wss://relay.primal.net\"]"
}
# Note: Only FROSTR credentials and relay settings can be updated via API
# Authentication settings must be configured via environment variables

# Delete configuration keys (database mode): requires admin session or ADMIN_SECRET
POST /api/env/delete
Content-Type: application/json
{
  "keys": ["GROUP_CRED", "SHARE_CRED"]
}

# Headless specifics
# - All /api/env* routes require authentication in headless
# - Writes require API key or Basic Auth (sessions alone are not sufficient)

# Example: headless write with API key
POST /api/env
X-API-Key: <YOUR_API_KEY>
Content-Type: application/json
{
  "GROUP_CRED": "bfgroup1...",
  "SHARE_CRED": "bfshare1..."
}
```

### Server Status
```bash
# Get server and node status
GET /api/status

# Response:
{
  "serverRunning": true,
  "nodeActive": true,
  "hasCredentials": true,
  "relayCount": 2,
  "relays": ["wss://relay.primal.net", "wss://relay.damus.io"],
  "timestamp": "2025-01-20T12:00:00.000Z",
  "health": {
    "isConnected": true,
    "lastActivity": "2025-01-20T11:59:30.000Z",
    "lastConnectivityCheck": "2025-01-20T12:00:00.000Z",
    "consecutiveConnectivityFailures": 0,
    "timeSinceLastActivity": 30000,
    "timeSinceLastConnectivityCheck": 5000
  }
}
```

### Peer Management
```bash
# List peers in signing group
GET /api/peers

# Get self public key
GET /api/peers/self

# Ping specific peer
POST /api/peers/ping
Content-Type: application/json
{
  "target": "02abcd1234...peer-pubkey"
}

# Ping all peers
POST /api/peers/ping
Content-Type: application/json
{
  "target": "all"
}
```

### Key Recovery
```bash
# Recover secret key from threshold shares
POST /api/recover
Content-Type: application/json
{
  "groupCredential": "bfgroup1...",
  "shareCredentials": ["bfshare1...", "bfshare1..."]
}

# Validate group or share credentials
POST /api/recover/validate
Content-Type: application/json
{
  "type": "group", // or "share"
  "credential": "bfgroup1..."
}
```

### Share Management (Headless mode)
```bash
# Get stored shares
GET /api/env/shares

# Store new share
POST /api/env/shares  # Requires API key or Basic Auth in headless
Content-Type: application/json
{
  "shareCredential": "bfshare1...",
  "groupCredential": "bfgroup1..."
}
```

> ℹ️ `/api/env` is available in both headless and database modes. In headless, all env endpoints require authentication; writes require API key or Basic Auth. `/api/env/shares` is headless‑only and returns metadata by default (no raw credentials). For local/dev debugging only, you may opt‑in to include raw credentials (`shareCredential`, `groupCredential`) by setting `ENV_SHARES_INCLUDE_RAW=true` in a non‑production environment and accessing via an authenticated session (not API key or Basic). This endpoint is not available in database mode.

### Real-time Events
Subscribe to live server events via WebSocket:

```
ws://localhost:8002/api/events
wss://yourdomain.com/api/events
```

Authentication and security
- Browser UI uses the session cookie after login.
- Programmatic clients can pass credentials via headers or Sec-WebSocket-Protocol hints:
  - `apikey.<TOKEN>` or `api-key.<TOKEN>` → `X-API-Key: <TOKEN>`
  - `bearer.<TOKEN>` → `Authorization: Bearer <TOKEN>`
  - `session.<ID>` → `X-Session-ID: <ID>`

Legacy compatibility
- `?apiKey=` and `?sessionId=` query params are still accepted for existing clients. Prefer headers or subprotocol hints for new integrations.

Example (Node/Bun):

```ts
const proto = ['apikey.' + process.env.MY_API_KEY];
const ws = new WebSocket('wss://yourdomain.com/api/events', proto);
ws.onmessage = (ev) => console.log(ev.data);
```

Origin policy
- In production, set explicit `ALLOWED_ORIGINS` (comma-separated) and ensure your client Origin matches exactly.
- Wildcard `*` is rejected for WebSocket upgrades in production.

Event payloads resemble:
```
{"type":"sign","message":"Signature request received","timestamp":"12:34:56","id":"abc123"}
{"type":"bifrost","message":"Peer connected","timestamp":"12:34:57","id":"def456"}
{"type":"system","message":"Connected to event stream","timestamp":"12:34:58","id":"ghi789"}
```

💡 HTTP fallbacks for `/api/events` are not supported; use WebSockets.

### Crypto: Sign and Encrypt
```bash
# Threshold sign a Nostr event id
POST /api/sign
Content-Type: application/json
{ "message": "<32-byte-hex-id>" }
# or
{ "event": { "pubkey": "<64-hex>", "kind": 1, "created_at": 1734300000, "content": "...", "tags": [] } }

# NIP-44 encrypt/decrypt
POST /api/nip44/encrypt  { "peer_pubkey": "<x-only or compressed>", "content": "plaintext" }
POST /api/nip44/decrypt  { "peer_pubkey": "<x-only or compressed>", "content": "ciphertext" }

# NIP-04 encrypt/decrypt (legacy; use NIP-44 when possible)
POST /api/nip04/encrypt  { "peer_pubkey": "<x-only or compressed>", "content": "plaintext" }
POST /api/nip04/decrypt  { "peer_pubkey": "<x-only or compressed>", "content": "ciphertext" }
```
Timeouts: these endpoints honor `FROSTR_SIGN_TIMEOUT` (preferred) or `SIGN_TIMEOUT_MS` (default 30000ms; bounds 1000–120000ms). On timeout, HTTP 504 is returned.

### NIP‑46 Sessions
```bash
# List sessions
GET /api/nip46/sessions

# Create/update a session
POST /api/nip46/sessions
{ "pubkey": "<64-hex>", "status": "pending", "profile": {"name": "App"}, "relays": ["wss://..."], "policy": {"methods": {}, "kinds": {}} }

# Update policy for a session
PUT /api/nip46/sessions/{pubkey}/policy
{ "methods": {"get_public_key": true}, "kinds": {"1": true} }

# Update status (revoked deletes the session)
PUT /api/nip46/sessions/{pubkey}/status
{ "status": "revoked" }

# Delete session
DELETE /api/nip46/sessions/{pubkey}

# Compact history (recent kinds/methods summary)
GET /api/nip46/history
```

## Deployment

### Digital Ocean Deployment

Deploy Igloo Server on Digital Ocean using Docker for a production-ready setup:

#### 1. Create a Digital Ocean Droplet
```bash
# Create a new droplet (Ubuntu 22.04 recommended)
# Minimum: 1GB RAM, 1 vCPU, 25GB SSD
# Recommended: 2GB RAM, 2 vCPU, 50GB SSD
```

#### 2. Install Docker
```bash
# Connect to your droplet via SSH
ssh root@your-droplet-ip

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 3. Deploy with Docker Compose

> 🔒 **Production Security**: Use Docker secrets or environment variables for sensitive data. Never commit credentials to version control.

```bash
# Clone the repository
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server

# Copy example configuration
cp .env.example .env

# Edit .env for non-sensitive configuration
nano .env  # Configure HOST_NAME, ALLOWED_ORIGINS, etc.

# Set sensitive environment variables (don't store in files!)
export GROUP_CRED="bfgroup1qqsqp...your-group-credential"
export SHARE_CRED="bfshare1qqsqp...your-share-credential"
export API_KEY="$(openssl rand -hex 32)"
export BASIC_AUTH_USER="admin"
export BASIC_AUTH_PASS="$(openssl rand -base64 32)"

# Deploy with Docker Compose using environment variables
docker-compose up -d

# Alternative: Use Docker secrets (recommended for production)
# See Docker documentation for setting up secrets management
```

#### 4. Configure Firewall
```bash
# Allow HTTP/HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 22
sudo ufw allow 8002  # If accessing directly without reverse proxy

# Enable firewall
sudo ufw enable
```

#### 5. Set Up Reverse Proxy (Recommended)
```bash
# Install nginx
sudo apt update
sudo apt install nginx

# Configure nginx for SSL termination
sudo nano /etc/nginx/sites-available/igloo-server
```

```nginx
# Put this map in http { } context (e.g., /etc/nginx/nginx.conf)
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 443 ssl;  # add http2 if desired: "ssl http2"
  server_name yourdomain.com www.yourdomain.com;

  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  location / {
    proxy_pass http://127.0.0.1:8002;
    proxy_http_version 1.1;

    # WebSocket upgrade for /api/events and relay
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    # Preserve host and client info
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;

    # Long-lived WS connections
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;

    proxy_cache_bypass $http_upgrade;
  }
}

server {
  listen 80;
  server_name yourdomain.com www.yourdomain.com;
  return 301 https://$host$request_uri;
}
```

```bash
# Enable site and restart nginx
sudo ln -s /etc/nginx/sites-available/igloo-server /etc/nginx/sites-enabled/
sudo systemctl restart nginx

# Add SSL with Let's Encrypt (optional)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

#### Production Environment Checklist

- `NODE_ENV=production`
- `ADMIN_SECRET` is a strong random value (required on first run)
- `ALLOWED_ORIGINS` lists your exact UI origins (e.g., `https://yourdomain.com,https://www.yourdomain.com`)
- `TRUST_PROXY=true` when running behind nginx or another reverse proxy
- WebSocket upgrade headers are forwarded (see nginx config above)
- Database is persisted (Docker volume or host path mounted to `/app/data`)
- Only expose ports 80/443 publicly; keep 8002 internal when using a proxy

#### 6. Monitor and Maintain
```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f

# Update deployment
git pull
docker compose --env-file .env up -d --build
```

### Umbrel Deployment
*Coming Soon* - One-click installation through the Umbrel App Store.

### Start9 Deployment  
*Coming Soon* - Native Start9 service package for sovereign server deployments.

## Development

### Development Mode
```bash
# Terminal 1: frontend builders in watch mode
bun run dev

# Terminal 2: start the server
bun run start

# Notes:
# - The `dev` script watches frontend JS/CSS only.
# - Use an external watcher (e.g., nodemon) if you want server auto‑restart.
```

### Development vs Production Caching

The server automatically adjusts caching behavior based on the `NODE_ENV` environment variable:

**Development Mode** (`NODE_ENV !== 'production'`):
- JS/CSS are served with no‑cache headers to avoid stale assets
- Assets are read from disk each request

**Production Mode** (`NODE_ENV=production`):
- Cache headers are set for assets (JS/CSS: 24h; images: long‑lived)
- HTML is served with no‑cache to keep the shell fresh

```bash
# Force development mode (recommended for local development)
NODE_ENV=development bun start

# Force production mode
NODE_ENV=production bun start
```

### Build Commands
```bash
# Production build
bun run build          # Minified JS + CSS

# Development build (recommended for local development)
bun run build:dev      # Unminified for debugging, no server caching

# Individual builds
bun run build:js       # Frontend JavaScript only
bun run build:css     # Tailwind CSS compilation only
# Vendor Swagger UI assets for API docs (self-hosted)
bun run docs:vendor
```

**💡 Tip**: Use `bun run build:dev` during development to avoid caching issues. The server will automatically detect non-production builds and disable static file caching.

### Tests
```bash
# Run all tests
bun test

# Run only API key/auth tests
bun test tests/routes/*api-keys*.spec.ts
```
Tests are designed to be deterministic and self-contained; they spawn isolated processes with temporary SQLite DBs and clean up automatically.

### Frontend Structure
```
frontend/
├── index.tsx          # React app entry point
├── App.tsx           # Main app component with routing
├── components/       # Core components
│   ├── Configure.tsx # Credential configuration
│   ├── Signer.tsx    # Signing node management
│   ├── Recover.tsx   # Key recovery interface
│   └── EventLog.tsx  # Live event monitoring
├── components/ui/    # Reusable UI components
├── types/           # TypeScript definitions
└── lib/             # Utilities and helpers
```

## Built on Igloo-Core

This server leverages [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core) for all FROSTR protocol operations, providing:

- **Share Management** - Decode and validate FROSTR group and share credentials  
- **Bifrost Node Operations** - Enhanced connection handling with automatic retries
- **Peer Discovery & Monitoring** - Automatic peer extraction and status tracking from group credentials
- **Comprehensive Validation** - Built-in validation for all FROSTR credential types
- **Strong TypeScript Support** - Full type safety throughout the application

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| **Mode Selection** | | | |
| `HEADLESS` | Enable headless mode (env-based config) | `false` | ❌ |
| **Database Mode** | | | |
| `ADMIN_SECRET` | Admin secret for initial setup | - | Required on first run; must remain set in production for admin API access (admin endpoints return 401 if unset); rotate by changing value and restarting |
| `DB_PATH` | Database storage location | `./data` | ❌ |
| **Headless Mode** | | | |
| `GROUP_CRED` | FROSTR group credential | - | ✅ (Headless) |
| `SHARE_CRED` | Your secret share | - | ✅ (Headless) |
| `RELAYS` | JSON array of relay URLs | `["wss://relay.primal.net"]` | ❌ |
| `GROUP_NAME` | Display name for signing group | - | ❌ |
| `PEER_POLICIES` | JSON array of peer policy objects applied on startup (headless) | - | ❌ |
| **Server Configuration** | | | |
| `HOST_NAME` | Server bind address | `localhost` | ❌ |
| `HOST_PORT` | Server port | `8002` | ❌ |
| **Security** | | | |
| `AUTH_ENABLED` | Enable authentication | `true` | ⚠️ |
| `API_KEY` | Headless-mode API key for programmatic access (database mode uses admin-issued keys) | - | ❌ |
| `BASIC_AUTH_USER` | Basic auth username | - | ❌ |
| `BASIC_AUTH_PASS` | Basic auth password | - | ❌ |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `*` in development; unset blocks CORS in production | ⚠️ (Production) |
| `SESSION_SECRET` | Secret for session cookies (auto-generated if not provided) | Auto-generated | ❌ |
| `SESSION_TIMEOUT` | Session timeout in seconds | `3600` | ❌ |
| `TRUST_PROXY` | Trust X-Forwarded-For headers when behind a proxy (used for rate limiting and logs) | `false` | ❌ |
| **Crypto Timeouts** | | | |
| `FROSTR_SIGN_TIMEOUT` / `SIGN_TIMEOUT_MS` | Timeout (ms) for signing and ECDH crypto endpoints | `30000` | ❌ |
| **Ephemeral Derived Keys** | | | |
| `AUTH_DERIVED_KEY_TTL_MS` | Derived key vault TTL (ms) | `120000` | ❌ |
| `AUTH_DERIVED_KEY_MAX_READS` | Max one‑time reads per session | `100` | ❌ |
| **Rate Limiting** | | | |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `true` | ❌ |
| `RATE_LIMIT_WINDOW` | Rate limit window in seconds | `900` | ❌ |
| `RATE_LIMIT_MAX` | Max requests per window | `300` (headless) / `600` (database) | ❌ |
| **Node Restart** | | | |
| `NODE_RESTART_DELAY` | Initial delay before node restart (ms) | `30000` | ❌ |
| `NODE_MAX_RETRIES` | Maximum number of restart attempts | `5` | ❌ |
| `NODE_BACKOFF_MULTIPLIER` | Exponential backoff multiplier | `1.5` | ❌ |
| `NODE_MAX_RETRY_DELAY` | Maximum delay between retries (ms) | `300000` | ❌ |
| **Error Circuit Breaker** | | | |
| `ERROR_CIRCUIT_WINDOW_MS` | Window length for counting unhandled errors (ms) | `60000` | ❌ |
| `ERROR_CIRCUIT_THRESHOLD` | Number of unhandled errors in window to trip breaker | `10` | ❌ |
| `ERROR_CIRCUIT_EXIT_CODE` | Process exit code when breaker trips | `1` | ❌ |

**💡 Network Configuration**: 
- **Local development**: Use `HOST_NAME=localhost` (default)
- **Docker deployment**: Use `HOST_NAME=0.0.0.0` to allow external connections

**🔄 Node Restart Configuration**: 
- **Main Restart System**: Handles manual restarts and major failures with configurable retry attempts
  - **Exponential Backoff**: Restart delays increase with each failure using the backoff multiplier
  - **Max Retries**: After reaching the maximum retry attempts, the node restart is abandoned
  - **Example**: With defaults, retry delays would be: 30s, 45s, 67s, 100s, 150s (max 5 attempts)
- **Health-Based Restart System**: Handles automatic restarts from health monitoring watchdog timeouts
  - **Separate Limits**: Independent restart count and backoff to prevent infinite health restarts
  - **Auto-Reset**: Restart count resets when node becomes healthy again
  - **Example**: With defaults, health restart delays would be: 60s, 120s, 240s (max 3 attempts)

## Migration Between Modes

### Migrating from Headless to Database Mode

If you're currently using headless mode and want to switch to database mode for multi-user support:

1. **Start with your existing headless setup**:
   ```bash
   HEADLESS=true
   GROUP_CRED=bfgroup1...
   SHARE_CRED=bfshare1...
   ```

2. **Switch to database mode**:
   ```bash
   # Update your .env file (non-sensitive config only)
   echo "HEADLESS=false" > .env

   # Set admin secret via environment variable
   export ADMIN_SECRET=$(openssl rand -hex 32)
   echo "Save this admin secret securely: $ADMIN_SECRET"

   # Remove GROUP_CRED and SHARE_CRED from env
   unset GROUP_CRED SHARE_CRED
   ```

3. **Complete onboarding**:
   - Restart the server
   - Navigate to web UI
   - Enter admin secret
   - Create your first user
   - Login and configure credentials via the Configure tab

### Migrating from Database to Headless Mode

If you need to switch back to headless mode:

1. **Export your credentials** (manual process):
   - Login to the web UI
   - Navigate to Configure tab
   - Copy your credentials

2. **Update environment**:
   ```bash
   HEADLESS=true
   GROUP_CRED=<copied-group-cred>
   SHARE_CRED=<copied-share-cred>
   ```

3. **Optional cleanup**:
   ```bash
   # Remove database file if no longer needed
   rm -rf data/igloo.db
   ```

### Best Practices for Migration

- **Backup first**: Always backup your database file before migration
- **Test credentials**: Verify credentials work in new mode before removing old setup
- **Update automation**: Update any scripts or CI/CD pipelines for the new mode
- **Document changes**: Keep track of which mode you're using for each deployment

## Troubleshooting

### Common Issues

**Build required error**: 
- Frontend build artifacts are not committed to git
- Run `bun run build` to generate required static files

**Server won't start with credentials**:
- Verify `GROUP_CRED` and `SHARE_CRED` are valid FROSTR credentials
- Check that credentials start with `bfgroup1` and `bfshare1` respectively
- Ensure relay URLs are accessible WebSocket endpoints

**Peer connection issues**:
- Verify all signers use at least one common relay
- Check firewall settings for outbound WebSocket connections  
- Timeout errors are normal when peers are offline

**Frontend not loading or changes not appearing**:
- Ensure you've run `bun run build` before starting the server
- Check that static files exist in the `static/` directory
- **For development**: Use `bun run build:dev` and `NODE_ENV=development bun start` to disable caching
- **If changes aren't showing**: The server caches static files differently in development vs production:
  - Development mode: Files read fresh from disk each time (no caching)
  - Production mode: Files cached in memory and browser for performance
- **Clear browser cache only if running in production mode** (Ctrl+F5 / Cmd+Shift+R)
- Restart the server after rebuilding if running in production mode

**SQLiteError: duplicate column name: role (fresh install)**:
- You are likely running a pre-October 2025 image where a migration attempted to add `users.role` that startup code already created, aborting later migrations.
- Fix: update to the latest build (role is now part of the base schema; the conflicting migration was removed). Rebuild your image and restart.
- If you still see the error, ensure no stale container/image is used. As a last resort, mark the migration as applied and restart:
  ```bash
  docker exec -it igloo-server sh -lc 'cat >/app/fix-migrations.js <<"JS"
  import { Database } from "bun:sqlite";
  const db = new Database("/app/data/igloo.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    INSERT OR IGNORE INTO schema_migrations (name)
      VALUES ("20250916_0002_add_user_role_system.sql");
  `);
  console.log("ok");
  JS
  bun /app/fix-migrations.js'
  docker restart igloo-server
  ```

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/FROSTR-ORG/igloo-server/issues)
- **FROSTR Ecosystem**: [FROSTR Organization](https://github.com/FROSTR-ORG)
- **Core Library**: [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core)
- **Bifrost Reference**: [Bifrost Implementation](https://github.com/FROSTR-ORG/bifrost)

## Security Configuration

Igloo Server includes comprehensive security features to protect your FROSTR credentials and signing operations:

### 🔐 **Authentication**
- **Multiple Auth Methods**: API Key, Basic Auth, Session-based authentication
- **Configurable Security**: Enable/disable authentication for development vs production
- **Rate Limiting**: IP-based request limiting to prevent abuse
- **Session Management**: Secure cookie-based sessions with configurable timeouts
- **Proxy Trust**: When behind a reverse proxy (nginx, Cloudflare, etc.), set `TRUST_PROXY=true` to correctly identify client IPs for rate limiting

### 📋 **Quick Security Setup**

**Production (Secure)**:
```bash
AUTH_ENABLED=true
API_KEY=your-secure-api-key-here
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=your-strong-password
# SESSION_SECRET is auto-generated if not provided
# SESSION_SECRET=your-custom-secret-here  # Optional override
RATE_LIMIT_ENABLED=true
```

**Development (Local only)**:
```bash
AUTH_ENABLED=false  # Only for local development
# SESSION_SECRET is auto-generated if not set
```

Note for headless mode: even when `AUTH_ENABLED=false`, all `/api/env*` endpoints still require authentication (API key or Basic) to prevent accidental exposure of configuration. For local testing in headless mode, set an API key:

```bash
HEADLESS=true
AUTH_ENABLED=false
API_KEY=dev-local-key   # use a throwaway value locally
```

### 🛡️ **Security Features**
- **Timing-safe authentication** to prevent timing attacks
- **Environment variable whitelisting** for configuration endpoints
- **Automatic session cleanup** and timeout management
- **Comprehensive rate limiting** with configurable windows and limits
- **Secure headers** and CORS configuration
- **Automatic SESSION_SECRET** generation with secure persistence in `data/.session-secret`

See [SECURITY.md](SECURITY.md) for complete security configuration guide.

### CSP and External Assets

The production UI sets a strict Content Security Policy (CSP) in the server (see `src/routes/static.ts`). Defaults are designed to allow only what the app needs by default and block everything else.

- Effective policy (production):
  - `default-src 'self'`
  - `script-src 'self'`  – blocks third‑party and inline scripts (browser extensions may still log warnings for their own injections)
  - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`  – allow Google Fonts CSS
  - `font-src 'self' https://fonts.gstatic.com data:`  – allow Google Fonts font files and data URIs
  - `img-src 'self' data: https:`  – allow HTTPS images so NIP‑46 profile icons and Gravatar fallbacks can render
  - `connect-src 'self' wss://…`  – your WSS relays are appended based on `RELAYS`

- Why allow these:
  - Google Fonts: the UI imports the Share Tech Mono font.
  - HTTPS images: apps often provide remote icons/avatars; restricting to `https:` avoids mixed‑content HTTP and keeps S3/CDNs working.

- Hardening/alternatives:
  - Self‑host fonts: vendor the font files under `static/`, update CSS to load locally, then remove `https://fonts.googleapis.com` and `https://fonts.gstatic.com` from CSP.
  - Restrict image sources: replace `img-src 'self' data: https:` with an explicit allow‑list (e.g., `img-src 'self' data: https://www.gravatar.com https://app.example.com`), or proxy icons via your server so you can keep `img-src 'self' data:`.
  - Inline scripts: we keep `script-src 'self'`. Extension console warnings are benign; the app itself does not rely on inline scripts.

## Security Notes

### Secret Management Best Practices

**Never store secrets in files that could be committed to version control:**
- ❌ Don't put secrets directly in `.env` files (even if gitignored)
- ❌ Don't hardcode secrets in your code
- ✅ Use environment variables for development
- ✅ Use proper secret management tools for production (Docker Secrets, Kubernetes Secrets, AWS Secrets Manager, etc.)

**Recommended approach for different environments:**

```bash
# Development - Use environment variables
export ADMIN_SECRET="dev-secret-here"
export API_KEY="dev-api-key"
bun run start

# Docker - Use secrets or env vars
docker run -e ADMIN_SECRET="$ADMIN_SECRET" igloo-server

# Production - Use secret management service
# Example with AWS Secrets Manager
ADMIN_SECRET=$(aws secretsmanager get-secret-value --secret-id prod/igloo/admin --query SecretString --output text)
```

### General Security Guidelines

- **Share credentials are sensitive**: Store `SHARE_CRED` securely - it's part of your nsec fragments
- **Network security**: Use WSS (secure WebSocket) relays in production
- **Authentication required**: Configure authentication for any non-local deployment
- **CORS security**: Set `ALLOWED_ORIGINS` to specific domains in production (avoid wildcard `*`)
- **SESSION_SECRET auto-generated**: Automatically generates and persists a secure `SESSION_SECRET` if not provided
- **Memory management**: The relay auto-purges events to prevent memory leaks
- **HTTPS recommended**: Use a reverse proxy with TLS for production deployments
- **File permissions**: Ensure proper permissions on data directory (700) and database files (600)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch  
3. Make your changes with tests
4. Submit a pull request

For major changes, please open an issue first to discuss the proposed changes.
