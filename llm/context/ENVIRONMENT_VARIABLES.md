# Igloo Server Environment Variables Reference

Last verified: 2026-02-09

## ⚠️ CRITICAL SECURITY NOTE

**SESSION_SECRET must NEVER be exposed via any API endpoint**. It is strictly server-only and is explicitly excluded from:
- All API read operations (GET endpoints)
- All API write operations (POST/PUT/DELETE endpoints)
- The ALLOWED_ENV_KEYS whitelist
- The PUBLIC_ENV_KEYS set

When session auth is enabled, this secret is automatically generated and stored in a secure file with restricted permissions (0600). Any attempt to expose SESSION_SECRET via API would compromise the entire session security model.

## Overview

Igloo Server operates in two distinct modes with different environment variable usage patterns. This document provides a comprehensive reference for all environment variables and their behavior across both operation modes.

## Mode Architecture

### Operation Modes
- **Database Mode** (`HEADLESS` unset or false): Multi-user operation with encrypted credential storage in SQLite. This is the default.
- **Headless Mode** (`HEADLESS=true|1|yes`): Single-user operation with environment variable-based configuration. DB-only routes (`/api/user`, `/api/admin`, `/api/nip46`) are disabled.

### Key Architectural Differences
1. **Credential Storage**: Plain text environment variables (Headless) vs encrypted database storage (Database). Env creds can still boot the node in DB mode but are not persisted until saved via the UI/API.
2. **User Model**: Environment-auth users (API key/Basic) vs database users (numeric IDs) with different API access patterns.
3. **Session Persistence**: DB users get persisted sessions in SQLite; env-auth sessions are in-memory only. In headless mode with `API_KEY` set, sessions are disabled entirely.
4. **API Surface**: `/api/user`, `/api/admin`, and `/api/nip46` are available only in DB mode.

## Complete Environment Variables Reference

### Mode Control

| Variable | Purpose | Headless Mode | Database Mode | Default | Notes |
|----------|---------|---------------|---------------|---------|-------|
| `HEADLESS` | Controls operation mode | `true` | `false` | `false` | Truthy values: `true`, `1`, `yes` (case-insensitive) |

### Credential Storage

| Variable | Purpose | Headless Mode | Database Mode | Default | Security Impact |
|----------|---------|---------------|---------------|---------|-----------------|
| `GROUP_CRED` | FROSTR group credential | **REQUIRED** - stored as plain text env | **OPTIONAL** - if set, boots node from env but is not persisted until saved | - | ⚠️ **CRITICAL**: Plain text env vs encrypted DB storage |
| `SHARE_CRED` | FROSTR share credential | **REQUIRED** - stored as plain text env | **OPTIONAL** - if set, boots node from env but is not persisted until saved | - | ⚠️ **CRITICAL**: Plain text env vs encrypted DB storage |
| `ADMIN_SECRET` | Initial setup secret | **IGNORED** | **REQUIRED** on first setup only | - | Enforced only when DB is uninitialized |

### Database Configuration

| Variable | Purpose | Headless Mode | Database Mode | Default | Implementation |
|----------|---------|---------------|---------------|---------|----------------|
| `DB_PATH` | Database file/directory location | **IGNORED** | Active | `./data` | File or directory. Also controls `.session-secret` location |

### Network Configuration

| Variable | Purpose | Both Modes Usage | Default | Source |
|----------|---------|------------------|---------|--------|
| `HOST_NAME` | Server bind address | Identical behavior | `localhost` | `src/const.ts` |
| `HOST_PORT` | Server port | Identical behavior | `8002` | `src/const.ts` |
| `RELAYS` | Relay URLs (JSON array or CSV) | Identical parsing logic | `[]` | `src/const.ts` |
| `GROUP_NAME` | Display name for signing group | Identical behavior | - | Optional metadata |

### Authentication & Security

| Variable | Purpose | Headless Mode | Database Mode | Default | Key Differences |
|----------|---------|---------------|---------------|---------|-----------------|
| `AUTH_ENABLED` | Enable authentication | Same behavior | Same behavior | `true` | Applies to all modes |
| `API_KEY` | API authentication key | **Used** (env API key) | **Ignored** (use DB API keys instead) | - | Headless only; disables sessions when set |
| `BASIC_AUTH_USER` | Basic auth username | Creates **env auth user** | Creates **env auth user** | - | Env-auth users are not DB users |
| `BASIC_AUTH_PASS` | Basic auth password | Creates **env auth user** | Creates **env auth user** | - | Env-auth users are not DB users |
| `SESSION_SECRET` | Session enablement secret (⚠️ NEVER exposed via API) | Auto-generated in `.session-secret` | Auto-generated in `.session-secret` | Auto-generated | Location is `{DB_PATH}` (file or dir) or `./data` |
| `SESSION_TIMEOUT` | Session expiration (seconds) | Same behavior | Same behavior | `3600` | Applies to DB + ephemeral sessions |
| `AUTH_DERIVED_KEY_TTL_MS` | Derived-key vault TTL (ms) | Same behavior | Same behavior | `120000` | Session derived key vault |
| `AUTH_DERIVED_KEY_MAX_READS` | Derived-key vault max reads | Same behavior | Same behavior | `100` | Session derived key vault |
| `AUTH_DERIVED_KEY_MAX_REHYDRATIONS` | Max rehydrate attempts | Same behavior | Same behavior | `3` | Session derived key cache |
| `VAULT_CLEANUP_INTERVAL_MS` | Vault cleanup interval (ms) | Same behavior | Same behavior | `120000` | Runs in-session cleanup |

### Rate Limiting

| Variable | Purpose | Both Modes Usage | Default | Source |
|----------|---------|------------------|---------|--------|
| `RATE_LIMIT_ENABLED` | Enable rate limiting | Identical behavior | `true` | `src/routes/auth.ts` |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | Identical behavior | `900` | `src/routes/auth.ts` |
| `RATE_LIMIT_MAX` | Max requests per window | Headless: `300`, Database: `600` | Mode-dependent | `src/routes/auth.ts` |
| `NIP46_SESSION_RATE_LIMIT_MAX` | NIP-46 session create max | Headless: `30`, Database: `120` | Mode-dependent | Applies to `/api/nip46/sessions` |
| `NIP46_SESSION_RATE_LIMIT_WINDOW` | NIP-46 session rate limit window (seconds) | Identical behavior | `3600` | Applies to `/api/nip46/sessions` |

### WebSocket Upgrade Abuse Protection

| Variable | Purpose | Both Modes Usage | Default | Notes | Source |
|----------|---------|------------------|---------|-------|--------|
| `RATE_LIMIT_WS_UPGRADE_WINDOW` | WebSocket upgrade limiter window (seconds) | Identical behavior | Falls back to `RATE_LIMIT_WINDOW` (`900`) | Applies to `/api/events` and `/` WebSocket upgrades | `src/server.ts` |
| `RATE_LIMIT_WS_UPGRADE_MAX` | WebSocket upgrade limiter max attempts per window | Identical behavior | `30` | Applies to `/api/events` and `/` WebSocket upgrades | `src/server.ts` |
| `WS_MAX_CONNECTIONS_PER_IP` | Max concurrent WebSocket connections per IP | Identical behavior | `5` | Applies to `/api/events` and `/` WebSocket upgrades | `src/server.ts` |
| `WS_MSG_RATE` | WebSocket message rate limit (tokens/sec) | Identical behavior | `20` | Burst is controlled by `WS_MSG_BURST` | `src/server.ts` |
| `WS_MSG_BURST` | WebSocket message burst capacity (tokens) | Identical behavior | `40` (min `WS_MSG_RATE`) | Token bucket capacity | `src/server.ts` |

### Update Checks

| Variable | Purpose | Both Modes Usage | Default | Notes | Source |
|----------|---------|------------------|---------|-------|--------|
| `UPDATE_CHECK_DISABLED` | Disable update checks | Identical behavior | `false` | When true, `GET /api/update` is disabled | `src/routes/update.ts` |
| `MANAGED_DEPLOYMENT` | Mark deployment as managed | Identical behavior | `false` | Also treated as managed when `HEADLESS=true` or `SKIP_ADMIN_SECRET_VALIDATION=true` | `src/routes/update.ts` |
| `UPDATE_CHECK_TIMEOUT_MS` | Timeout for upstream update check (ms) | Identical behavior | `5000` | Aborts upstream request | `src/routes/update.ts` |
| `UPDATE_CHECK_TTL_MS` | Cache TTL for successful update checks (ms) | Identical behavior | `21600000` | 6 hours | `src/routes/update.ts` |
| `UPDATE_CHECK_FAILURE_TTL_MS` | Cache TTL after failed update checks (ms) | Identical behavior | `900000` | 15 minutes | `src/routes/update.ts` |
| `APP_VERSION` | Override app version reported by `/api/update` | Identical behavior | Unset | Intended for packaged builds | `src/routes/update.ts` |
| `GITHUB_TOKEN` | Token for GitHub API requests | Identical behavior | Unset | Used to avoid rate limits when checking releases | `src/routes/update.ts` |

### CORS Security

| Variable | Purpose | Both Modes Usage | Default | Security Notes |
|----------|---------|------------------|---------|----------------|
| `ALLOWED_ORIGINS` | Browser origin allowlist (CSV) | Applies to HTTP CORS headers and WebSocket Origin checks | Unset | In production, leaving this unset blocks browser cross-origin HTTP (CORS) and restricts browser WebSockets to same-host; wildcard `*` is rejected for WebSocket upgrades in production (`src/routes/utils.ts`). |

**Important nuance:** `ALLOWED_ORIGINS` is used by two different mechanisms with different semantics:
- **HTTP CORS** uses exact origin matching (or `*`) and does **not** understand `@self`.
- **WebSocket Origin checks** support a special token `@self` (host match, port-agnostic) and explicitly reject `*` in production.

See “Origin Enforcement (HTTP vs WebSocket)” below for details.

### Node Restart Configuration

| Variable | Purpose | Both Modes Usage | Default | Range | Source |
|----------|---------|------------------|---------|-------|--------|
| `NODE_RESTART_DELAY` | Initial restart delay (ms) | Identical behavior | `30000` | 1ms - 1 hour | `src/server.ts` |
| `NODE_MAX_RETRIES` | Max restart attempts | Identical behavior | `5` | 1 - 100 | `src/server.ts` |
| `NODE_BACKOFF_MULTIPLIER` | Exponential backoff multiplier | Identical behavior | `1.5` | 1.0 - 10.0 | `src/server.ts` |
| `NODE_MAX_RETRY_DELAY` | Max delay between retries (ms) | Identical behavior | `300000` | 1ms - 2 hours | `src/server.ts` |

### Operation Timeouts

| Variable | Purpose | Both Modes Usage | Default | Range | Source |
|----------|---------|------------------|---------|-------|--------|
| `FROSTR_SIGN_TIMEOUT` | Signing operation timeout (ms) | Identical behavior | `30000` | 1000ms - 120000ms | `src/routes/utils.ts`, `src/node/manager.ts` |
| `SIGN_TIMEOUT_MS` | Legacy alias for signing timeout (ms) | Identical behavior | `30000` | 1000ms - 120000ms | `src/routes/utils.ts` |
| `CONNECTIVITY_PING_TIMEOUT_MS` | Keepalive ping timeout (ms) | Identical behavior | `10000` | 1000ms - 120000ms | `src/node/manager.ts` |
| `PING_TIMEOUT_MS` | Legacy alias for keepalive ping timeout (ms) | Identical behavior | `10000` | 1000ms - 120000ms | `src/node/manager.ts` |
| `PUBLISH_EVENT_TIMEOUT_MS` | Relay publish receipt timeout (ms) | Identical behavior | `30000` | 1000ms - 120000ms | `src/node/manager.ts` |
| `RELAY_PUBLISH_TIMEOUT` | Legacy alias for relay publish receipt timeout (ms) | Identical behavior | `30000` | 1000ms - 120000ms | `src/node/manager.ts` |
| `SELF_ECHO_TIMEOUT_MS` | Startup echo timeout (ms) | Identical behavior | `10000` | 1000ms - 60000ms | `src/node/manager.ts` |
| `ECHO_TIMEOUT_MS` | Legacy alias for startup echo timeout (ms) | Identical behavior | `10000` | 1000ms - 60000ms | `src/node/manager.ts` |

### Relay Probing & Startup Performance

| Variable | Purpose | Both Modes Usage | Default | Notes | Source |
|----------|---------|------------------|---------|-------|--------|
| `SKIP_RELAY_PROBE` | Skip relay probing during node creation | Identical behavior | `false` | Faster startup; uses relays without testing support | `src/const.ts` |
| `DEFER_RELAY_PROBE` | Defer relay probing to background | Identical behavior | `false` | Ignored when `SKIP_RELAY_PROBE=true` | `src/const.ts`, `src/node/manager.ts` |
| `SKIP_STARTUP_ECHO` | Skip headless startup echo broadcasts | Identical behavior | `false` | Perf option for cold start | `src/const.ts` |
| `INITIAL_CONNECTIVITY_DELAY` | Delay before initial connectivity check (ms) | Identical behavior | `5000` | Used during node creation; invalid values fall back to default | `src/node/manager.ts` |
| `MAX_PEER_STATUS_ENTRIES` | Bound peer status memory (FIFO eviction) | Identical behavior | `1000` | Prevents unbounded growth in long-running servers | `src/const.ts` |
| `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` | Swallow benign relay publish errors | Identical behavior | `true` | Alias: `RELAY_ALLOW_BENIGN_SWALLOW` | `src/node/manager.ts` |
| `RELAY_ALLOW_BENIGN_SWALLOW` | Legacy alias for benign publish swallow | Identical behavior | `true` | Prefer `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` | `src/node/manager.ts` |
| `NODE_PUBLISH_METRICS` | Enable relay publish failure metrics | Identical behavior | `true` (DB mode), `false` (headless) | Set to `false` to disable; defaults off in headless mode | `src/node/manager.ts` |

### Error Circuit Breaker

| Variable | Purpose | Both Modes Usage | Default | Range | Source |
|----------|---------|------------------|---------|-------|--------|
| `ERROR_CIRCUIT_WINDOW_MS` | Time window for error counting | Identical behavior | `60000` | 1s - 1 hour | `src/server.ts` |
| `ERROR_CIRCUIT_THRESHOLD` | Errors before circuit trips | Identical behavior | `10` | 1 - 1000 | `src/server.ts` |
| `ERROR_CIRCUIT_EXIT_CODE` | Exit code when circuit trips | Identical behavior | `1` | 0 - 255 | `src/server.ts` |

### Proxy Configuration

| Variable | Purpose | Both Modes Usage | Default | Source |
|----------|---------|------------------|---------|--------|
| `TRUST_PROXY` | Trust proxy headers for client IP | Identical behavior | `false` | `src/routes/utils.ts` |

When `TRUST_PROXY=true`, the server trusts these headers (in order): `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`. This is required for accurate rate limiting behind reverse proxies.

`TRUST_PROXY=true` also affects WebSocket Origin enforcement: the server will prefer `X-Forwarded-Host` (when present) over `Host` when evaluating “same-host” and `@self` Origin matches for browser WebSockets (`src/routes/utils.ts`).

### Onboarding Hardening (Database Mode Only)

| Variable | Purpose | Both Modes Usage | Default | Notes | Source |
|----------|---------|------------------|---------|-------|--------|
| `FINGERPRINT_SECRET` | Secret salt for stable per-client identifiers | DB mode only | Unset | Improves stability across restarts; leave unset to use best-effort fallback | `src/routes/onboarding.ts` |
| `CLIENT_ID_TTL_MS` | TTL for client-id cache entries (ms) | DB mode only | `86400000` | Clamped to 10m..7d | `src/routes/onboarding.ts` |
| `LOG_FINGERPRINT_FALLBACK` | Log fingerprint fallback details | DB mode only | `false` | Use only for troubleshooting | `src/routes/onboarding.ts` |

### System Environment

| Variable | Purpose | Both Modes Usage | Impact |
|----------|---------|------------------|--------|
| `NODE_ENV` | Environment mode | Controls caching behavior and security warnings | `production` enables aggressive caching |

### Internal/Derived Variables

| Variable | Purpose | Headless Mode | Database Mode | Usage |
|----------|---------|---------------|---------------|--------|
| `CREDENTIALS_SAVED_AT` | Timestamp marker | Set when env creds detected | Set when DB creds saved | Tracks credential freshness |

### Managed Installs & CI (Advanced)

| Variable | Purpose | Both Modes Usage | Default | Notes | Source |
|----------|---------|------------------|---------|-------|--------|
| `SKIP_ADMIN_SECRET_VALIDATION` | Skip onboarding "enter admin secret" step | DB mode only | `false` | Umbrel-style managed installs only; requires `ADMIN_SECRET` to be set out-of-band | `src/const.ts`, `src/routes/onboarding.ts` |
| `AUTO_ADMIN_SECRET` | Auto-generate ephemeral `ADMIN_SECRET` | DB mode only | `false` | Also enabled when `CI=true` or `NODE_ENV=test`; non-production only | `src/const.ts` |
| `CI` | Signals CI environment | DB mode only | Unset | When `CI=true`, enables `AUTO_ADMIN_SECRET` behavior | `src/const.ts` |

## Critical Security & Functional Differences

### 1. Credential Storage Architecture

**Headless Mode:**
```typescript
// Plain text storage in environment
process.env.GROUP_CRED = "bfgroup1qqsqp..."
process.env.SHARE_CRED = "bfshare1qqsqp..."
```

**Database Mode:**
```typescript
// Encrypted storage with two-layer security:
// 1. User authentication: Password hashing uses Argon2id via Bun.password (while still verifying legacy bcrypt hashes).
// 2. Credential encryption: Key derivation and encryption details:
//    - Algorithm: PBKDF2-HMAC-SHA256
//    - Iterations: 200000 (PBKDF2_CONFIG.ITERATIONS)
//    - Key Length: 32 bytes (256 bits, PBKDF2_CONFIG.KEY_LENGTH)
//    - Salt: 32 bytes (256 bits, hex-encoded as 64 chars, SALT_CONFIG.LENGTH)
//    - Encryption: AES-256-GCM with the derived key
// 3. Salt handling:
//    - Database users: Persistent per-user salt stored in database (randomBytes(SALT_CONFIG.LENGTH))
//    - Non-database users: Ephemeral 32-byte session-specific salts
// User's plaintext password (not the Argon2id hash) is used to derive the encryption key
// Credentials never stored in plain text
// See: src/config/crypto.ts, src/db/database.ts, src/routes/auth.ts
```

### 2. User Authentication Models

**Environment Auth Users** (API Key/Basic Auth):
- **User ID Type**: `string`
- **Examples**: Headless API key -> `api-user`, DB API key -> `api-key:<prefix>`, Basic Auth -> `<username>`
- **Salt Type**: Ephemeral session-specific salts
- **Session Storage**: In-memory only (not persisted in SQLite)
- **API Access**: **CANNOT** access `/api/user/*` endpoints
- **Purpose**: API access only, not credential management
- **Security**: Prevents accidental data loss from ephemeral keys

**Database Users** (Created via onboarding):
- **User ID Type**: `number` (database primary key)
- **Salt Type**: Persistent salts stored in database
- **Session Storage**: Persisted in SQLite `sessions` table plus in-memory metadata
- **API Access**: **CAN** access all endpoints including `/api/user/*`
- **Purpose**: Full web UI functionality with credential storage
- **Security**: Consistent key derivation for credential encryption/decryption

### 3. Session Secret Storage

`SESSION_SECRET` is a server-only enablement secret. Session IDs are random 32-byte hex values stored server-side; cookies are not signed.

**File Location Logic** (`src/routes/auth.ts`):
```typescript
function getSessionSecretDir(): string {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) return path.join(process.cwd(), 'data');

  try {
    const stats = statSync(dbPath);
    return stats.isFile() ? path.dirname(dbPath) : dbPath;
  } catch {
    const normalized = path.normalize(dbPath);
    if (normalized.endsWith(path.sep)) return normalized;
    const base = path.basename(normalized);
    const dbExtensions = ['.db', '.sqlite', '.sqlite3'];
    if (dbExtensions.some(ext => base.toLowerCase().endsWith(ext))) {
      return path.dirname(normalized);
    }
    return normalized;
  }
}
```

### 4. API Endpoint Access Control

**CRITICAL SECURITY NOTE**: `SESSION_SECRET` must NEVER be exposed via any API endpoint. It is strictly server-only and excluded from all API read/write operations.

**Environment Variables API** (`src/routes/utils.ts`):
```typescript
// Security: Whitelist of allowed environment variable keys (for write/validation)
// IMPORTANT: SESSION_SECRET must NEVER be included here - it's strictly server-only
const ALLOWED_ENV_KEYS = new Set([
  'SHARE_CRED',         // Share credential for signing
  'GROUP_CRED',         // Group credential for signing
  'RELAYS',             // Relay URLs configuration
  'GROUP_NAME',         // Display name for the signing group
  'CREDENTIALS_SAVED_AT', // Timestamp when credentials were last saved
  'PEER_POLICIES',      // Optional headless peer policy configuration
  // Advanced settings - server configuration
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'FROSTR_SIGN_TIMEOUT', // Signing timeout in milliseconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'CONNECTIVITY_PING_TIMEOUT_MS', // Keepalive ping timeout override (ms)
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET explicitly excluded - must never be exposed via API
]);

// Public environment variable keys that can be exposed through GET endpoints
// Only include non-sensitive keys. Do NOT include signing credentials.
const PUBLIC_ENV_KEYS = new Set([
  'RELAYS',             // Relay URLs configuration
  'GROUP_NAME',         // Display name for the signing group
  'CREDENTIALS_SAVED_AT', // Timestamp when credentials were last saved
  'PEER_POLICIES',      // Optional headless peer policy configuration
  // Advanced settings - safe to expose for configuration UI
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'FROSTR_SIGN_TIMEOUT', // Signing timeout in milliseconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'CONNECTIVITY_PING_TIMEOUT_MS', // Keepalive ping timeout override (ms)
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET, SHARE_CRED, GROUP_CRED explicitly excluded from public exposure
]);
```

**Endpoint Restrictions**:
- Authentication settings (`API_KEY`, `BASIC_AUTH_*`) must be configured via actual environment variables
- Environment auth users cannot modify credentials via API
- Only database users can save/retrieve encrypted credentials

### 5. Startup Behavior

**Headless Mode** (`src/const.ts`):
```typescript
export const hasCredentials = () => 
  GROUP_CRED !== undefined && SHARE_CRED !== undefined;
// Node starts automatically if credentials present
```

**Database Mode**:
- If `GROUP_CRED`/`SHARE_CRED` are present, the node still boots from env at startup.
- When a DB user loads credentials (`GET /api/user/credentials`) or saves new ones, the node auto-starts (if not already running).
- `ADMIN_SECRET` is required only when the database is uninitialized (onboarding).

## Environment Variable Security Patterns

### 1. Validation and Defaults

Node restart configuration with validation (`src/server.ts`):
```typescript
const parseRestartConfig = () => {
  const initialRetryDelay = parseInt(process.env.NODE_RESTART_DELAY || '30000');
  const maxRetryAttempts = parseInt(process.env.NODE_MAX_RETRIES || '5');
  
  // Validation with safe defaults
  const validatedConfig = {
    INITIAL_RETRY_DELAY: (initialRetryDelay > 0 && initialRetryDelay <= 3600000) 
      ? initialRetryDelay : 30000,
    // ... additional validation
  };
  
  // Log validation warnings if defaults were used
  if (initialRetryDelay !== validatedConfig.INITIAL_RETRY_DELAY) {
    console.warn(`Invalid NODE_RESTART_DELAY: ${initialRetryDelay}. Using default`);
  }
  
  return validatedConfig;
};
```

### 2. Auto-Generation Patterns

SESSION_SECRET auto-generation (`src/routes/auth.ts`):
```typescript
function loadOrGenerateSessionSecret(): string | null {
  if (!existsSync(SESSION_SECRET_DIR)) {
    mkdirSync(SESSION_SECRET_DIR, { recursive: true, mode: 0o700 });
  }
  chmodSync(SESSION_SECRET_DIR, 0o700);

  if (existsSync(SESSION_SECRET_FILE)) {
    const secret = readFileSync(SESSION_SECRET_FILE, 'utf-8').trim();
    if (/^[0-9a-f]{64}$/i.test(secret)) return secret;
  }

  const newSecret = randomBytes(32).toString('hex');
  const tempFileName = `.session-secret.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
  const tempFilePath = path.join(SESSION_SECRET_DIR, tempFileName);

  const fd = openSync(tempFilePath, 'wx', 0o600);
  writeSync(fd, newSecret, 0, 'utf8');
  fsyncSync(fd);
  renameSync(tempFilePath, SESSION_SECRET_FILE);
  chmodSync(SESSION_SECRET_FILE, 0o600);

  process.env.SESSION_SECRET = newSecret;
  return newSecret;
}
```
Notes:
- On Windows, chmod and directory fsync are best-effort; warnings are logged.
- In production, a missing/invalid secret that cannot be generated will terminate the process.

### 3. Origin Enforcement (HTTP vs WebSocket)

Igloo Server enforces browser-origin policies in two layers:
- **HTTP CORS headers**: controls whether browsers allow JavaScript to read HTTP responses cross-origin.
- **WebSocket Origin checks**: controls whether browser WebSocket handshakes are accepted based on the `Origin` header.

These layers intentionally behave differently to avoid accidental production exposure while still supporting “same host” LAN/IP/onion access patterns.

### HTTP CORS behavior (`getSecureCorsHeaders`, `src/routes/utils.ts`)
- If `ALLOWED_ORIGINS` is **unset**:
  - In **development** (`NODE_ENV` is not `production`): responds with `Access-Control-Allow-Origin: *`.
  - In **production**: does **not** set `Access-Control-Allow-Origin` (so browsers block cross-origin reads).
- If `ALLOWED_ORIGINS` is **set** (comma-separated):
  - If it contains `*`: responds with `Access-Control-Allow-Origin: *`.
  - Else, if the request’s `Origin` exactly matches one of the configured origins: reflects that origin and sets `Vary: Origin`.
  - Otherwise: no CORS header is set (browser blocks).

Notes:
- Origins must be exact strings like `https://example.com` (include scheme, and include `:port` when non-default).
- `@self` is **not** interpreted for HTTP CORS.

### WebSocket Origin behavior (`isWebSocketOriginAllowed`, `src/routes/utils.ts`)
- If there is **no** `Origin` header: allowed (common for non-browser clients).
- If `ALLOWED_ORIGINS` is **unset/empty**:
  - In **development**: allowed.
  - In **production**: allowed only when `Origin` hostname matches the request hostname (“same-host”); otherwise rejected.
- If `ALLOWED_ORIGINS` is **set**:
  - Special token `@self` allows any `Origin` whose hostname matches the request hostname (ports may differ).
  - In **production**, `*` is explicitly rejected for WebSocket upgrades.
  - Otherwise, the `Origin` must match one of the configured allowed origins exactly.

### Practical guidance
- If your UI and API are served from the same public origin via a reverse proxy (recommended), you typically do not need cross-origin HTTP CORS, but you should still set `ALLOWED_ORIGINS` in production to avoid repeated security errors and to make intent explicit.
- If your UI is on one origin and the API/WS is on another (different host or port), you must set `ALLOWED_ORIGINS` to include the UI origin(s). For browser WebSockets with a host mismatch, either list the exact origins or include `@self` when you want “whatever host the user connected through” semantics.

### Production messaging (`src/routes/utils.ts`)
When `ALLOWED_ORIGINS` is unset in production, the server logs a security error and intentionally omits CORS headers so browsers will block cross-origin reads.

#### Historical note

The behavior below is the current, correct production posture. Older documentation that implied “wildcard CORS in production when unset” is outdated and should not be relied on.

Current production behavior (`src/routes/utils.ts`):
```typescript
if (!allowedOriginsEnv && process.env.NODE_ENV === 'production') {
  // SECURITY: Block browser cross-origin reads in production unless explicitly configured.
  // Intentionally do not set Access-Control-Allow-Origin.
  console.error('SECURITY ERROR: ALLOWED_ORIGINS must be configured in production. CORS requests will be blocked.');
}
```

## Migration Patterns

### Headless -> Database Mode Migration

1. **Preparation**:
   ```bash
   # Current headless setup
   HEADLESS=true
   GROUP_CRED=bfgroup1...
   SHARE_CRED=bfshare1...
   ```

2. **Mode Switch**:
   ```bash
   # Update environment
   HEADLESS=false
   ADMIN_SECRET=$(openssl rand -hex 32)
   # Remove GROUP_CRED and SHARE_CRED from environment
   ```

3. **Database Initialization**:
   - Server starts with uninitialized database
   - `ADMIN_SECRET` enforcement activates
   - Complete web UI onboarding flow
   - Credentials move to encrypted database storage

4. **Security Upgrade**:
   - Plain text env credentials -> AES-256-GCM encrypted storage
   - Environment auth users -> Full database user accounts
   - Session-specific salts -> Persistent salts for consistent key derivation

### Database -> Headless Mode Migration

1. **Credential Export** (manual process):
   - Login to web UI
   - Navigate to Configure tab  
   - Copy `GROUP_CRED` and `SHARE_CRED` values

2. **Environment Setup**:
   ```bash
   HEADLESS=true
   GROUP_CRED=<exported-group-cred>
   SHARE_CRED=<exported-share-cred>
   ```

3. **Database Cleanup** (optional):
   ```bash
   rm -rf data/igloo.db  # Remove database file
   ```

4. **Security Downgrade**:
   - Encrypted database storage -> Plain text env credentials
   - Full user accounts -> Environment auth users
   - Persistent salts -> Ephemeral session-specific salts

## Development Guidelines

### Adding New Environment Variables

1. **Define in `src/const.ts`**:
   ```typescript
   export const NEW_VARIABLE = process.env['NEW_VARIABLE'] ?? 'default-value';
   ```

2. **Add to Whitelists** (if API-modifiable):
   ```typescript
   // src/routes/utils.ts
   const ALLOWED_ENV_KEYS = new Set([
     'NEW_VARIABLE',  // If should be modifiable via API
     // ...
   ]);
   
   const PUBLIC_ENV_KEYS = new Set([
     'NEW_VARIABLE',  // If should be publicly readable (rare)
     // ...
   ]);
   ```

3. **Add Validation** (if needed):
   ```typescript
   const validateNewVariable = () => {
     const value = process.env['NEW_VARIABLE'];
     // Validation logic with safe defaults
     // Log warnings for invalid values
   };
   ```

4. **Document**:
   - Add to this reference document
   - Update README.md environment variables table
   - Add to CLAUDE.md if architecturally significant

### Testing Different Modes

**Local Testing Setup**:
```bash
# Test headless mode
cat > .env.headless << EOF
HEADLESS=true
GROUP_CRED=bfgroup1test...
SHARE_CRED=bfshare1test...
AUTH_ENABLED=false
EOF

# Test database mode
cat > .env.database << EOF
HEADLESS=false
ADMIN_SECRET=$(openssl rand -hex 32)
AUTH_ENABLED=false
EOF

# Switch between modes
cp .env.headless .env  # Test headless
cp .env.database .env  # Test database
```

### Security Considerations

1. **Never commit secrets**:
   ```bash
   # .gitignore patterns
   .env*
   *.key
   *.pem
   data/.session-secret
   ```

2. **Production warnings**:
   - Implement warnings for missing critical security variables
   - Validate environment variable ranges and formats
   - Log validation issues without exposing sensitive values

3. **Access control**:
   - Distinguish between environment auth users and database users
   - Restrict API endpoint access based on user type
   - Filter public vs private environment variables

## Code References

### Key Implementation Files

- **Environment Constants**: `src/const.ts`
- **Authentication Config**: `src/routes/auth.ts`
- **Environment Utils**: `src/routes/utils.ts`
- **Database Config**: `src/db/database.ts`
- **Restart Config**: `src/server.ts`
- **Error Circuit Config**: `src/server.ts`
- **CORS Security**: `src/routes/utils.ts`
- **Proxy/IP Detection**: `src/routes/utils.ts`

### Environment Variable Whitelisting

- **Write/Validation Whitelist**: `src/routes/utils.ts` (`ALLOWED_ENV_KEYS`)
- **Public Read Whitelist**: `src/routes/utils.ts` (`PUBLIC_ENV_KEYS`)
- **Forbidden Keys**: `src/routes/utils.ts` (`FORBIDDEN_ENV_KEYS`)
- **Key Validation**: `src/routes/utils.ts` (`validateEnvKeys`)

This reference serves as the definitive guide for understanding Igloo Server's dual-mode architecture and environment variable system.
