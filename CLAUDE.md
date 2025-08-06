# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Igloo Server is a server-based signing device and personal ephemeral relay for the FROSTR protocol. It provides a k-of-n remote signing client for Nostr, built on @frostr/igloo-core for reliable FROSTR protocol operations.

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

# Release process (must be on dev branch)
bun run release        # Patch release
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
3. **Routes (`src/routes/`)**: API endpoints for auth, env, peers, recovery, shares, status
4. **Frontend (`frontend/`)**: React TypeScript app with Tailwind CSS
5. **Ephemeral Relay (`src/class/relay.ts`)**: In-memory Nostr relay for testing

### Key Design Patterns

- **WebSocket Event Streaming**: Real-time updates via WebSocket connections (migrated from SSE)
- **Health Monitoring**: Automatic detection and recovery from silent node failures
- **Exponential Backoff**: Progressive retry delays for connection failures
- **Session Management**: Secure cookie-based sessions with configurable auth methods
- **Static File Caching**: Different strategies for dev (no cache) vs production (aggressive cache)

### Node Restart System

Two independent restart mechanisms:
1. **Main Restart**: Handles manual restarts with exponential backoff (env vars: NODE_RESTART_DELAY, NODE_MAX_RETRIES)
2. **Health Restart**: Automatic recovery from 5-minute inactivity timeouts (env vars: NODE_HEALTH_MAX_RESTARTS, NODE_HEALTH_RESTART_DELAY)

### Security Architecture

- Multiple auth methods: API Key, Basic Auth, Session-based
- Environment variable whitelisting for configuration endpoints
- Timing-safe authentication to prevent timing attacks
- CORS configuration with allowed origins
- Rate limiting (configurable)

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

3. **Required Environment Variables**:
   - `GROUP_CRED`: FROSTR group credential (bfgroup1...)
   - `SHARE_CRED`: Your secret share (bfshare1...)
   - `SESSION_SECRET`: Required in production (32+ chars)

4. **Health Monitoring**: Node automatically restarts after 5 minutes of inactivity, with progressive backoff

5. **WebSocket Migration**: Events have been migrated from SSE to WebSockets for better reliability

6. **Release Process**: Must be on `dev` branch, merges to `master` after tests pass

## Dependencies

Key packages:
- `@frostr/igloo-core`: Core FROSTR protocol implementation
- `@frostr/bifrost`: Bifrost node operations
- `nostr-tools`: Nostr protocol utilities
- `bun`: Runtime and server
- `react` & `react-dom`: Frontend framework
- `tailwindcss`: CSS framework