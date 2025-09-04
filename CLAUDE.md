# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Igloo Server is a server-based signing device and personal ephemeral relay for the FROSTR protocol. It provides a k-of-n remote signing client for Nostr, built on @frostr/igloo-core for reliable FROSTR protocol operations.

**Core Purpose**: Always-on FROSTR signing node that handles Nostr signature requests automatically using threshold signatures without ever reconstructing the full private key.

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
```

## Architecture

### Core Components

1. **Server (`src/server.ts`)**: Main Bun server handling WebSocket connections and HTTP requests
2. **Bifrost Node (`src/node/manager.ts`)**: FROSTR signing node with health monitoring and auto-restart
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

### Node Restart System

**Main Restart**: Handles manual restarts with exponential backoff (env vars: NODE_RESTART_DELAY, NODE_MAX_RETRIES, NODE_BACKOFF_MULTIPLIER, NODE_MAX_RETRY_DELAY)

### Connectivity Monitoring & Idle Handling

- **Active keepalive**: Updates activity timestamp locally when idle > 45 seconds to prevent false unhealthy detection
- **Simple monitoring**: Single 60-second check interval for relay connectivity
- **Auto-recovery**: Recreates node after 3 consecutive connectivity failures
- **Null node handling**: Treats null nodes as failures to ensure recovery mechanisms activate
- **Self-ping detection**: Filters any self-pings from logs by comparing normalized pubkeys
- **Production-ready**: Minimal overhead, clear logging, resilient to edge cases

### Security Architecture

- Multiple auth methods: API Key, Basic Auth, Session-based
- Environment variable whitelisting for configuration endpoints
- Timing-safe authentication to prevent timing attacks
- CORS configuration with allowed origins
- Rate limiting (configurable)

### Dual-Mode Operation

The server supports two operation modes controlled by the `HEADLESS` environment variable:

#### Database Mode (Default - HEADLESS=false)
- **Multi-user support** with individual accounts
- **Encrypted credential storage** using bcrypt + AES-256
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

Environment variables:
- `ADMIN_SECRET` - Required for initial database mode setup
- `HEADLESS` - Controls operation mode (default: false)
- `DB_PATH` - Database storage location (default: ./data)
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
   - **Database Mode**: `ADMIN_SECRET` for initial setup, then username/password login
   - **Headless Mode**: `GROUP_CRED` and `SHARE_CRED` environment variables
   - **Both Modes**: `SESSION_SECRET` required in production (32+ chars)

4. **WebSocket Migration**: Events have been migrated from SSE to WebSockets for better reliability

5. **Release Process**: Must be on `dev` branch, merges to `master` after tests pass

6. **Node Event Flow**: 
   - All Bifrost events update `lastActivity` timestamp
   - Self-pings filtered from logs via pubkey comparison
   - Peer status tracked independently from health monitoring
   - Null node states properly trigger failure counting and recovery
   - Connectivity monitoring continues even with null nodes to enable recovery

## Dependencies

Key packages:
- `@frostr/igloo-core`: Core FROSTR protocol implementation
- `@frostr/bifrost`: Bifrost node operations
- `nostr-tools`: Nostr protocol utilities
- `bun`: Runtime and server
- `react` & `react-dom`: Frontend framework
- `tailwindcss`: CSS framework