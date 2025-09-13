# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Igloo Server is a server-based signing device and personal ephemeral relay for the FROSTR protocol. It provides a k-of-n remote signing client for Nostr, built on @frostr/igloo-core for reliable FROSTR protocol operations.

**Core Purpose**: Always-on FROSTR signing node that handles Nostr signature requests automatically using threshold signatures without ever reconstructing the full private key.

**Repository Structure**:
- Main branch: `master` (production releases)
- Development branch: `dev` (active development)
- Release branches: `release/prepare-v*` (temporary during release process)

## Key Commands

### Development
```bash
# Install dependencies
bun install

# Build frontend and CSS (required before running)
bun run build:dev      # Development build (unminified, no caching)
bun run build          # Production build (minified)

# Start server
bun run start          # Runs on http://localhost:8002

# Development with hot reload
bun run dev            # Watches frontend files for changes

# Individual builds
bun run build:js       # Frontend JavaScript only
bun run build:js:prod  # Minified production JavaScript
bun run build:css      # Tailwind CSS with watch mode
bun run build:css:prod # Minified production CSS

# Release process (must be on dev branch)
bun run release        # Patch release (alias for release:patch)
bun run release:patch  # Patch release
bun run release:minor  # Minor release  
bun run release:major  # Major release
```

### Testing & Validation
```bash
# Validate OpenAPI documentation
bun run docs:validate

# Bundle OpenAPI documentation
bun run docs:bundle

# Health check (server provides auto-restart on failures)
curl http://localhost:8002/api/status

# Monitor server logs and health
curl http://localhost:8002/api/status | jq '.health'

# Check peer connectivity
curl http://localhost:8002/api/peers | jq

# Test WebSocket event stream
wscat -c ws://localhost:8002/api/events
```

## Architecture

### Core Components

1. **Server (`src/server.ts`)**: Main Bun server handling WebSocket connections and HTTP requests. Uses dynamic imports for the database module (though DB code is still bundled due to static imports elsewhere, initialization is skipped in HEADLESS mode).
2. **Bifrost Node**: Core logic in `src/node/manager.ts` handles the FROSTR signing node with health monitoring and auto-restart. The routes in `src/routes/node-manager.ts` expose this functionality via API endpoints.
3. **Database (`src/db/database.ts`)**: SQLite database for user management and encrypted credential storage
4. **Routes (`src/routes/`)**: API endpoints for auth, env, peers, recovery, shares, status, user, onboarding
5. **Frontend (`frontend/`)**: React TypeScript app with Tailwind CSS
6. **Ephemeral Relay (`src/class/relay.ts`)**: In-memory Nostr relay for testing

### Key Design Patterns

- **WebSocket Event Streaming**: Real-time updates via WebSocket connections (migrated from SSE)
- **Health Monitoring**: Automatic detection and recovery from silent node failures
- **Exponential Backoff**: Progressive retry delays for connection failures
- **Session Management**: Secure cookie-based sessions with configurable auth methods
- **Static File Caching**: Different strategies for dev (no cache) vs production (aggressive cache)
- **Auth Factory Pattern**: Secure ephemeral storage using WeakMaps (`src/routes/auth-factory.ts`)
  - Prevents secret leakage through spread/JSON/structuredClone operations
  - Auto-clears sensitive data after first access
  - Non-enumerable getter functions for password and derivedKey

### Node Restart System

**Main Restart**: Handles manual restarts with exponential backoff
- Configuration validated in `src/server.ts`
- Environment variables with safe defaults:
  - `NODE_RESTART_DELAY`: Initial delay (default: 30000ms, max: 1 hour)
  - `NODE_MAX_RETRIES`: Max attempts (default: 5, max: 100)
  - `NODE_BACKOFF_MULTIPLIER`: Delay multiplier (default: 1.5, max: 10)
  - `NODE_MAX_RETRY_DELAY`: Max delay between retries (default: 300000ms, max: 2 hours)

### Connectivity Monitoring & Idle Handling

- **Active keepalive**: Updates activity timestamp locally when idle > 45 seconds (`src/node/manager.ts`)
- **Simple monitoring**: Single 60-second check interval for relay connectivity
- **Auto-recovery**: Recreates node after 3 consecutive connectivity failures
- **Null node handling**: Treats null nodes as failures to ensure recovery mechanisms activate
- **Self-ping detection**: Filters self-pings by comparing normalized pubkeys
- **Race-condition safe**: Uses `withTimeout` helper to prevent stray timer callbacks
- **Production-ready**: Minimal overhead, clear logging, resilient to edge cases

### Security Architecture

- Multiple auth methods: API Key, Basic Auth, Session-based
- Environment variable whitelisting for configuration endpoints
- Timing-safe authentication to prevent timing attacks
- CORS configuration with allowed origins
- Rate limiting (configurable)
- **Auto-generated SESSION_SECRET**: Automatically creates and persists in `data/.session-secret` if not provided

### Dual-Mode Operation

The server supports two operation modes controlled by the `HEADLESS` environment variable:

#### Database Mode (Default - HEADLESS=false)
- **Multi-user support** with individual accounts
- **Credential security**: 
  - Password hashing: Argon2id via Bun.password (for user authentication)
  - Credential encryption: AES-256-GCM with PBKDF2 key derivation (200,000 iterations, see `src/config/crypto.ts`) (for storing FROSTR credentials)
- **Onboarding flow** with `ADMIN_SECRET` for initial setup
- **Session management** for web UI authentication
- **Auto-start node** on login or credential save
- **Database location** configurable via `DB_PATH` (default: ./data)

Key files:
- `src/db/database.ts` - User management and encryption
- `src/routes/onboarding.ts` - Initial setup flow
- `src/routes/user.ts` - User credential management
- `frontend/components/Onboarding.tsx` - Onboarding UI

#### Headless Mode (HEADLESS=true)
- **Single-user operation** via environment variables
- **Direct credential storage** in `GROUP_CRED` and `SHARE_CRED`
- **Backward compatible** with existing deployments
- **Node starts at server startup** if credentials present
- **Database code bundling**: Note that database modules are still included in the built bundle even when HEADLESS=true. Static imports in route files and the dynamic import in server.ts cause database code to be bundled, but database initialization is skipped at runtime when HEADLESS=true (modules are present but not executed).

Environment variables:
- `ADMIN_SECRET` - Required for initial database mode setup (runtime initialization skipped in headless)
- `HEADLESS` - Controls operation mode (default: false)
- `DB_PATH` - Database storage location (default: ./data, unused in headless mode at runtime)
- `GROUP_CRED` - FROSTR group credential (headless mode only)
- `SHARE_CRED` - Your secret share (headless mode only)

## Critical Files & Patterns

### TypeScript Configuration
- Strict mode enabled with all strict checks
- Bun runtime types configured
- ESNext target with bundler module resolution

### Frontend Build System
- esbuild for JavaScript bundling
- Tailwind CSS with PostCSS
- Static files served from `/static` directory
- React 18 with automatic JSX runtime

### API Structure
- RESTful endpoints under `/api/*`
- WebSocket events at `/api/events`
- OpenAPI documentation at `/api/docs`
- Authentication required in production

## Important Considerations

1. **Build Before Run**: Always run `bun run build` or `bun run build:dev` before starting the server - static files are not committed to git

2. **Development vs Production**:
   - Dev: Use `NODE_ENV=development` and `bun run build:dev` for no caching
   - Prod: Use `NODE_ENV=production` with proper auth configuration

3. **Mode-Specific Requirements**:
   - **Database Mode**: `ADMIN_SECRET` for initial setup only (first run, enforced when the DB is uninitialized), then username/password login
   - **Headless Mode**: `GROUP_CRED` and `SHARE_CRED` environment variables
   - **Both Modes**: `SESSION_SECRET` auto-generated if not provided (stored in `data/.session-secret`)

4. **WebSocket Migration**: Events have been migrated from SSE to WebSockets for better reliability

5. **Release Process**: See "Release Workflow" section below for detailed instructions

6. **Node Event Flow**: 
   - All Bifrost events update `lastActivity` timestamp
   - Self-pings filtered from logs via pubkey comparison
   - Peer status tracked independently from health monitoring
   - Null node states properly trigger failure counting and recovery
   - Connectivity monitoring continues even with null nodes to enable recovery

7. **Security Considerations**:
   - Auth factory pattern prevents secret leakage through object operations
   - Database users have persistent salts for consistent key derivation
   - Environment auth users receive ephemeral session-specific salts
   - Timing-safe authentication prevents timing attacks
   - SESSION_SECRET must NEVER be exposed via API endpoints

## Release Workflow

### Quick Release Commands
```bash
# Patch release (1.0.0 → 1.0.1)
bun run release        # or bun run release:patch

# Minor release (1.0.0 → 1.1.0)
bun run release:minor

# Major release (1.0.0 → 2.0.0)
bun run release:major

# Specific version
./scripts/release.sh 2.5.0
```

### Release Process Steps
1. **Pre-checks** (`scripts/release.sh`):
   - Must be on `dev` branch
   - Working directory must be clean
   - Port 8002 must be available

2. **Automated validation**:
   - Builds frontend and CSS
   - Starts server and tests health endpoint
   - Validates OpenAPI documentation
   - Creates release branch `release/prepare-v{version}`
   - Commits version bump and pushes to origin

3. **Manual steps**:
   - Create PR from release branch to `master`
   - Review and merge PR to trigger GitHub Actions
   - Actions create GitHub release with changelog

### Error Recovery
- Server cleanup handled by trap in release script
- Rollback procedure documented in `llm/workflows/RELEASE_PROCESS.md`

## Troubleshooting Common Issues

### Build/Frontend Issues
- **Problem**: Frontend changes not appearing
- **Solution**: Use `bun run build:dev` and `NODE_ENV=development bun start` to disable caching
- **Check**: Verify static files exist in `static/` directory

### Authentication Issues
- **Problem**: "Cannot access credential storage endpoints" error
- **Cause**: Environment auth users (API key/Basic auth) can't save credentials
- **Solution**: Use database mode with proper user account for credential storage

### Node Health Issues
- **Problem**: Node marked unhealthy despite being responsive
- **Solution**: Check `lastActivity` timestamp - keepalive updates occur after 45s idle
- **Debug**: Monitor with `curl http://localhost:8002/api/status | jq '.health'`

### Release Script Issues
- **Problem**: Port 8002 already in use
- **Solution**: `lsof -i :8002` to find process, then `kill <PID>`
- **Problem**: Server health check fails
- **Solution**: Check credentials are valid, verify build completed

## Environment Variable Whitelisting

**Critical Security**: `SESSION_SECRET` must NEVER be exposed via API endpoints. It's excluded from:
- `ALLOWED_ENV_KEYS` (`src/routes/utils.ts`) - Can't be modified via API
- `PUBLIC_ENV_KEYS` (`src/routes/utils.ts`) - Can't be read via API
- Auto-generated and stored in `data/.session-secret` if not provided

**API-Modifiable Variables** (`ALLOWED_ENV_KEYS`):
- `SHARE_CRED`, `GROUP_CRED` (headless mode only)
- `RELAYS`, `GROUP_NAME`
- `CREDENTIALS_SAVED_AT`

**Publicly Readable Variables** (`PUBLIC_ENV_KEYS`):
- `RELAYS`, `GROUP_NAME`, `CREDENTIALS_SAVED_AT`
- Excludes all sensitive credentials

## Dependencies

Key packages:
- `@frostr/igloo-core`: Core FROSTR protocol implementation
- `@frostr/bifrost`: Bifrost node operations
- `nostr-tools`: Nostr protocol utilities
- `bun`: Runtime and server
- `react` & `react-dom`: Frontend framework
- `tailwindcss`: CSS framework