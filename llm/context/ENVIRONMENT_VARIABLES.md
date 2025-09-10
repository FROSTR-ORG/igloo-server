# Igloo Server Environment Variables Reference

## ⚠️ CRITICAL SECURITY NOTE

**SESSION_SECRET must NEVER be exposed via any API endpoint**. It is strictly server-only and is explicitly excluded from:
- All API read operations (GET endpoints)
- All API write operations (POST/PUT/DELETE endpoints)
- The ALLOWED_ENV_KEYS whitelist
- The PUBLIC_ENV_KEYS set

This secret is automatically generated and stored in a secure file with restricted permissions (0600). Any attempt to expose SESSION_SECRET via API would compromise the entire session security model.

## Overview

Igloo Server operates in two distinct modes with different environment variable usage patterns. This document provides a comprehensive reference for all environment variables and their behavior across both operation modes.

## Mode Architecture

### Operation Modes
- **Database Mode** (`HEADLESS=false` or unset): Multi-user operation with encrypted credential storage in SQLite database
- **Headless Mode** (`HEADLESS=true`): Single-user operation with environment variable-based configuration

### Key Architectural Differences
1. **Credential Storage**: Plain text environment variables (Headless) vs encrypted database storage (Database)
2. **User Model**: Environment auth users vs database users with different API access patterns
3. **Security Model**: Basic env-based auth vs full user management with persistent salts

## Complete Environment Variables Reference

### Mode Control

| Variable | Purpose | Headless Mode | Database Mode | Default | Notes |
|----------|---------|---------------|---------------|---------|-------|
| `HEADLESS` | Controls operation mode | `true` | `false` | `false` | Core mode selector |

### Credential Storage

| Variable | Purpose | Headless Mode | Database Mode | Default | Security Impact |
|----------|---------|---------------|---------------|---------|-----------------|
| `GROUP_CRED` | FROSTR group credential | **REQUIRED** - stored as plain text | **OPTIONAL** - stored encrypted in DB | - | ⚠️ **CRITICAL**: Plain text vs encrypted |
| `SHARE_CRED` | FROSTR share credential | **REQUIRED** - stored as plain text | **OPTIONAL** - stored encrypted in DB | - | ⚠️ **CRITICAL**: Plain text vs encrypted |
| `ADMIN_SECRET` | Initial setup secret | **IGNORED** | **REQUIRED** on first setup only | - | Only enforced when DB uninitialized |

### Database Configuration

| Variable | Purpose | Headless Mode | Database Mode | Default | Implementation |
|----------|---------|---------------|---------------|---------|----------------|
| `DB_PATH` | Database file/directory location | **IGNORED** | Active | `./data` | Also controls SESSION_SECRET file location |

### Network Configuration

| Variable | Purpose | Both Modes Usage | Default | Source |
|----------|---------|------------------|---------|--------|
| `HOST_NAME` | Server bind address | Identical behavior | `localhost` | `src/const.ts:25` |
| `HOST_PORT` | Server port | Identical behavior | `8002` | `src/const.ts:26` |
| `RELAYS` | Relay URLs (JSON array or CSV) | Identical parsing logic | `[]` | `src/const.ts:2-23` |
| `GROUP_NAME` | Display name for signing group | Identical behavior | - | Optional metadata |

### Authentication & Security

| Variable | Purpose | Headless Mode | Database Mode | Default | Key Differences |
|----------|---------|---------------|---------------|---------|-----------------|
| `AUTH_ENABLED` | Enable authentication | Same behavior | Same behavior | `true` | `src/routes/auth.ts:95` |
| `API_KEY` | API authentication key | Creates **env auth user** | Creates **env auth user** | - | Different user type implications |
| `BASIC_AUTH_USER` | Basic auth username | Creates **env auth user** | Creates **env auth user** | - | Different user type implications |
| `BASIC_AUTH_PASS` | Basic auth password | Creates **env auth user** | Creates **env auth user** | - | Different user type implications |
| `SESSION_SECRET` | Session signing key (⚠️ NEVER exposed via API) | Auto-generated in `data/.session-secret` | Auto-generated in `{DB_PATH}/.session-secret` | Auto-generated | Server-only, excluded from all API operations |
| `SESSION_TIMEOUT` | Session expiration (seconds) | Same behavior | Same behavior | `3600` | `src/routes/auth.ts:104` |

### Rate Limiting

| Variable | Purpose | Both Modes Usage | Default | Source |
|----------|---------|------------------|---------|--------|
| `RATE_LIMIT_ENABLED` | Enable rate limiting | Identical behavior | `true` | `src/routes/auth.ts:107` |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds) | Identical behavior | `900` | `src/routes/auth.ts:108` |
| `RATE_LIMIT_MAX` | Max requests per window | Identical behavior | `100` | `src/routes/auth.ts:109` |

### CORS Security

| Variable | Purpose | Both Modes Usage | Default | Security Warning |
|----------|---------|------------------|---------|------------------|
| `ALLOWED_ORIGINS` | CORS allowed origins (CSV) | Identical parsing | `*` | Warns in production if unset (`src/routes/utils.ts:269-271`) |

### Node Restart Configuration

| Variable | Purpose | Both Modes Usage | Default | Range | Source |
|----------|---------|------------------|---------|-------|--------|
| `NODE_RESTART_DELAY` | Initial restart delay (ms) | Identical behavior | `30000` | 1ms - 1 hour | `src/server.ts:22-29` |
| `NODE_MAX_RETRIES` | Max restart attempts | Identical behavior | `5` | 1 - 100 | `src/server.ts:23-30` |
| `NODE_BACKOFF_MULTIPLIER` | Exponential backoff multiplier | Identical behavior | `1.5` | 1.0 - 10.0 | `src/server.ts:24-31` |
| `NODE_MAX_RETRY_DELAY` | Max delay between retries (ms) | Identical behavior | `300000` | 1ms - 2 hours | `src/server.ts:25-32` |

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
// 2. Credential encryption: Derives a 32-byte key using PBKDF2 with SHA-256 (see `PBKDF2_CONFIG.ITERATIONS` in `src/config/crypto.ts`) before applying AES-256-GCM.
// User's plaintext password (not the Argon2id hash) is used to derive the encryption key
// Credentials never stored in plain text
```

### 2. User Authentication Models

**Environment Auth Users** (API Key/Basic Auth):
- **User ID Type**: `string` (e.g., "api-key-user", "basic-auth-user")  
- **Salt Type**: Ephemeral session-specific salts
- **API Access**: **CANNOT** access `/api/user/*` endpoints
- **Purpose**: API access only, not credential management
- **Security**: Prevents accidental data loss from ephemeral keys

**Database Users** (Created via onboarding):
- **User ID Type**: `number` (database primary key)
- **Salt Type**: Persistent salts stored in database
- **API Access**: **CAN** access all endpoints including `/api/user/*`
- **Purpose**: Full web UI functionality with credential storage
- **Security**: Consistent key derivation for credential encryption/decryption

### 3. Session Secret Storage

**File Location Logic** (`src/routes/auth.ts:31-40`):
```typescript
function getSessionSecretDir(): string {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    return path.join(process.cwd(), 'data');
  }
  // Handle DB_PATH as file or directory
  const isFile = dbPath.endsWith('.db') || path.extname(dbPath) !== '';
  return isFile ? path.dirname(dbPath) : dbPath;
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
  // Advanced settings - server configuration
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET explicitly excluded - must never be exposed via API
]);

// Public environment variable keys that can be exposed through GET endpoints
// Only include non-sensitive keys. Do NOT include signing credentials.
const PUBLIC_ENV_KEYS = new Set([
  'RELAYS',             // Relay URLs configuration
  'GROUP_NAME',         // Display name for the signing group
  'CREDENTIALS_SAVED_AT', // Timestamp when credentials were last saved
  // Advanced settings - safe to expose for configuration UI
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET, SHARE_CRED, GROUP_CRED explicitly excluded from public exposure
]);
```

**Endpoint Restrictions**:
- Authentication settings (`API_KEY`, `BASIC_AUTH_*`) must be configured via actual environment variables
- Environment auth users cannot modify credentials via API
- Only database users can save/retrieve encrypted credentials

### 5. Startup Behavior

**Headless Mode** (`src/const.ts:39`):
```typescript
export const hasCredentials = () => 
  GROUP_CRED !== undefined && SHARE_CRED !== undefined;
// Node starts automatically if credentials present
```

**Database Mode**:
- Node starts when user logs in with valid credentials
- Node starts when credentials are saved to database
- `ADMIN_SECRET` required only when database is uninitialized

## Environment Variable Security Patterns

### 1. Validation and Defaults

Node restart configuration with validation (`src/server.ts:21-52`):
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

SESSION_SECRET auto-generation (`src/routes/auth.ts:48-72`):
```typescript
function validateSessionSecret(): string | null {
  let sessionSecret = process.env.SESSION_SECRET;
  
  if (!sessionSecret) {
    const sessionSecretFile = path.join(getSessionSecretDir(), '.session-secret');
    
    try {
      // Try to load existing secret
      sessionSecret = fs.readFileSync(sessionSecretFile, 'utf8').trim();
    } catch {
      // Generate new secret if file doesn't exist
      sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(sessionSecretFile, sessionSecret, { mode: 0o600 });
    }
    
    process.env.SESSION_SECRET = sessionSecret;
  }
  
  return sessionSecret;
}
```

### 3. CORS Security Warnings

Production security warning (`src/routes/utils.ts:269-271`):
```typescript
if (!allowedOriginsEnv) {
  headers['Access-Control-Allow-Origin'] = '*';
  if (process.env.NODE_ENV === 'production') {
    console.warn('SECURITY WARNING: ALLOWED_ORIGINS not configured in production. Using wildcard (*) for CORS.');
  }
}
```

## Migration Patterns

### Headless → Database Mode Migration

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
   - Plain text env credentials → AES-256-GCM encrypted storage
   - Environment auth users → Full database user accounts
   - Session-specific salts → Persistent salts for consistent key derivation

### Database → Headless Mode Migration

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
   - Encrypted database storage → Plain text env credentials
   - Full user accounts → Environment auth users
   - Persistent salts → Ephemeral session-specific salts

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

- **Environment Constants**: `src/const.ts:1-40`
- **Authentication Config**: `src/routes/auth.ts:78-110`  
- **Environment Utils**: `src/routes/utils.ts:20-85`
- **Database Config**: `src/db/database.ts:4-8`
- **Restart Config**: `src/server.ts:21-52`
- **CORS Security**: `src/routes/utils.ts:261-275`

### Environment Variable Whitelisting

- **Write/Validation Whitelist**: `src/routes/utils.ts:20-26` (`ALLOWED_ENV_KEYS`)
- **Public Read Whitelist**: `src/routes/utils.ts:30-34` (`PUBLIC_ENV_KEYS`)
- **Key Validation**: `src/routes/utils.ts:37-40` (`validateEnvKeys`)

This reference serves as the definitive guide for understanding Igloo Server's dual-mode architecture and environment variable system.