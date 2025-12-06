# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Igloo Server is a threshold Schnorr signing server for Nostr using the FROSTR protocol. It provides an always-on signing node with k-of-n threshold signatures where the full private key is never reconstructed. Built on `@frostr/igloo-core` and `@frostr/bifrost`.

Two operational modes:
- **Database mode** (default): Multi-user, SQLite persistence, web UI, session/API key auth
- **Headless mode**: Environment-only config, API-first, no UI

## Build & Development Commands

```bash
# Install dependencies
bun install

# Build frontend (required before running - assets not committed)
bun run build            # Production (minified)
bun run build:dev        # Development (readable output)

# Run server
bun run start

# Development (frontend watch mode)
bun run dev          # CSS + JS watch
bun run start        # Server (separate terminal)

# Run tests
bun test                           # All tests
bun test tests/routes/auth.spec.ts # Single file
bun test --watch                   # Watch mode

# API integration tests (scripts/api/)
bun run api:test:get               # Test GET endpoints
bun run api:test:sign              # Test signing

# Validate OpenAPI spec
bun run docs:validate
```

## Architecture Overview

### Backend (`/src`)

**Entry point**: `src/server.ts` - HTTP/WebSocket server setup, node lifecycle, graceful shutdown

**Routing** (`src/routes/`):
- `index.ts` - Unified request router, CORS handling, auth flow
- `auth.ts` - Session/API key/Basic auth, rate limiting
- `admin.ts` - Admin-only endpoints (require ADMIN_SECRET or admin session)
- `sign.ts` - Nostr event signing
- `nip44.ts`, `nip04.ts`, `nip46.ts` - NIP encryption/signer protocols
- `env.ts` - Credential management (privileged)

**Core services**:
- `node/manager.ts` - Bifrost node creation, peer tracking, health monitoring
- `db/database.ts` - SQLite schema, user management, AES-256-GCM credential encryption
- `nip46/service.ts` - NIP-46 remote signer implementation
- `class/relay.ts` - NostrRelay EventEmitter for protocol handling

**Context types** (passed to route handlers):
- `BaseContext`: node, peerStatuses, eventStreams, logging
- `PrivilegedContext`: extends BaseContext + `updateNode()` for credential changes

### Frontend (`/frontend`)

React 18 + Tailwind CSS, bundled with esbuild to `/static/app.js`

- `App.tsx` - Root component, tab navigation, auth state
- `components/` - Page components (Signer, Configure, NIP46, ApiKeys, etc.)
- `components/ui/` - Reusable UI components (Radix-based, shadcn-style)

### Key Configuration

Environment variables parsed in `src/const.ts`:
- `HEADLESS` - Disable UI, env-only config
- `GROUP_CRED`, `SHARE_CRED` - FROSTR credentials
- `ADMIN_SECRET` - Initial setup & admin operations
- `AUTH_ENABLED`, `RATE_LIMIT_ENABLED` - Security toggles
- `DB_PATH` - SQLite location (default: `./data/igloo.db`)

### Testing

Tests in `/tests/routes/` using Bun test runner. API test scripts in `/scripts/api/`.

Test patterns:
- Co-locate tests with code as `*.spec.ts` or `*.test.ts`
- Mock external calls to signing/NIP endpoints
- Seed fixtures from `data/` directory

### WebSocket Endpoints

- `/` - Nostr relay WebSocket
- `/api/events` - Server event stream (logs, status updates)

Both have per-IP connection limits and rate limiting.

## Runtime Requirements

- Bun runtime (uses `bun:sqlite` native bindings)
- Run `bun run build` before first start (frontend assets not committed)

## Code Style

- TypeScript strict mode; explicit types, avoid `any`
- 2-space indentation, Unix newlines
- Names: `camelCase` variables, `UPPER_SNAKE_CASE` constants
- Files: backend kebab-case (`nip46.ts`), React PascalCase (`Configure.tsx`)
- Conventional Commits for PRs (`feat:`, `fix:`, etc.)
