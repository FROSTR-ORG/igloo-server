# Igloo Server Environment Variables Reference

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

### CORS Security

| Variable | Purpose | Both Modes Usage | Default | Security Warning |
|----------|---------|------------------|---------|------------------|
| `ALLOWED_ORIGINS` | CORS allowed origins (CSV) | Identical parsing | `*` | Warns in production if unset (`src/routes/utils.ts`) |

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
| `CONNECTIVITY_PING_TIMEOUT_MS` | Keepalive ping timeout (ms) | Identical behavior | `10000` | 1000ms - 120000ms | `src/node/manager.ts` |

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

When `TRUST_PROXY=true`, the server trusts these headers (in order): `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`. Required for accurate rate limiting behind reverse proxies.

### System Environment

| Variable | Purpose | Both Modes Usage | Impact |
|----------|---------|------------------|--------|
| `NODE_ENV` | Environment mode | Controls caching behavior and security warnings | `production` enables aggressive caching |

### Internal/Derived Variables

| Variable | Purpose | Headless Mode | Database Mode | Usage |
|----------|---------|---------------|---------------|--------|
| `CREDENTIALS_SAVED_AT` | Timestamp marker | Set when env creds detected | Set when DB creds saved | Tracks credential freshness |

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

### 3. CORS Security Warnings

Production security warning (`src/routes/utils.ts`):
```typescript
if (!allowedOriginsEnv) {
  headers['Access-Control-Allow-Origin'] = '*';
  if (process.env.NODE_ENV === 'production') {
    console.warn('SECURITY WARNING: ALLOWED_ORIGINS not configured in production. Using wildcard (*) for CORS.');
  }
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
