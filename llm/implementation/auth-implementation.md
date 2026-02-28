# Authentication and Session Implementation (Database + Headless)

Last verified: 2026-02-05

## Scope
This document captures how authentication, sessions, derived key handling, and rate limiting are implemented in Igloo Server, including the design choices for database mode and headless deployments.

## Architecture Summary
- Authentication is centralized in `src/routes/auth.ts` and wired through the unified router in `src/routes/index.ts`.
- Sensitive request state is wrapped via `src/routes/auth-factory.ts` using a WeakMap-backed `RequestAuth` with secure getters.
- Sessions are persisted minimally in SQLite in database mode and mirrored in an in-memory metadata store for derived key features.
- Derived keys are stored only in-memory in a short-lived vault with bounded reads and explicit zeroization.
- Rate limiting uses a persistent SQLite-backed limiter with an in-memory fallback.

## Modes and Auth Methods
Database mode (HEADLESS=false):
- Primary auth methods are database API keys, Basic Auth (optional), and user sessions.
- DB API key auth is enabled only when at least one active key exists in `api_keys`.
- Sessions are backed by SQLite for persistence across restarts.
- Admin-only mutations require ADMIN_SECRET or an admin-role user session.
- The env `API_KEY` is ignored in database mode.

Headless mode (HEADLESS=true):
- Primary auth methods are env `API_KEY` and Basic Auth; sessions are optional but disabled when `API_KEY` is set.
- Env mutations require API key or Basic Auth; session auth alone is not sufficient for writes.

## ADMIN_SECRET and Onboarding
- ADMIN_SECRET is required only for initial database setup when the DB is uninitialized; the server fails fast if missing.
- The onboarding flow validates ADMIN_SECRET unless `SKIP_ADMIN_SECRET_VALIDATION=true` and ADMIN_SECRET is set.
- In CI/test (or when `AUTO_ADMIN_SECRET=true`), a fallback admin secret is auto-generated for non-production runs.
- Onboarding endpoints are rate-limited and enforce a uniform response delay to reduce timing leakage.

Files:
- `src/server.ts` enforces ADMIN_SECRET on first-run in DB mode.
- `src/routes/onboarding.ts` implements validate/setup with rate limiting and uniform delay.
- `src/const.ts` defines ADMIN_SECRET and SKIP_ADMIN_SECRET_VALIDATION semantics.

## Session Secret Persistence
- SESSION_SECRET is required for session auth and must be 64 hex chars (32 bytes).
- If not provided, Igloo generates and persists it at `<DB_PATH>/.session-secret` (directory inferred from `DB_PATH`).
- The generator uses atomic write+rename and enforces permissions: dir 0700, file 0600 (best-effort on Windows).
- In headless mode with `API_KEY` configured, session management is disabled to avoid unnecessary file I/O.
- Session IDs are random 32-byte hex values stored server-side; cookies are not signed.
- If SESSION_SECRET cannot be loaded/generated in non-production, sessions are disabled and login returns a warning with no `sessionId`.

Files:
- `src/routes/auth.ts` (loadOrGenerateSessionSecret, validateSessionSecret)

## Session Storage and Lifecycle
- Database sessions persist only minimal state: `id`, `user_id`, `ip_address`, `created_at`, `last_access`, and only for numeric DB users.
- An in-memory `sessionStore` keeps ephemeral metadata (rehydration counters, hasPassword, per-session salts).
- Session TTL is enforced via `SESSION_TIMEOUT` (default 3600s) for both DB and ephemeral sessions.
- Cleanup runs every 10 minutes and deletes expired DB sessions via `cleanupExpiredSessionsDB`.

Files:
- `src/db/migrations/20251009_0005_add_sessions_table.sql`
- `src/db/database.ts` (session CRUD + cleanup)
- `src/routes/auth.ts` (createSession, authenticateSession, cleanupExpiredSessions)

## WebSocket Event Stream Auth (`/api/events`)
- The event stream uses the same auth pipeline as HTTP; if `AUTH_ENABLED=true`, an auth check happens during the WebSocket upgrade.
- Supported session inputs:
  - `X-Session-ID` header or `session` cookie.
  - Query parameter `sessionId` (mapped to `X-Session-ID` for compatibility).
- Supported API key inputs:
  - `X-API-Key` header or `Authorization: Bearer <token>`.
  - Query parameter `apiKey` (mapped to `X-API-Key` for compatibility).
- Optional `Sec-WebSocket-Protocol` hints for non-browser clients:
  - `apikey.<token>` or `api-key.<token>` sets `X-API-Key`.
  - `bearer.<token>` sets `Authorization: Bearer <token>`.
  - `session.<id>` sets `X-Session-ID`.
- The first offered `Sec-WebSocket-Protocol` value is echoed back in the upgrade response (per RFC6455), even though it is only used as a hint.

Files:
- `src/server.ts` (WebSocket upgrade + auth hint parsing)

## Derived Key Vault (Ephemeral)
- Password-based derived keys are never stored in the DB or on the session object.
- Derived keys are stored only in-memory in two places:
  - `sessionDerivedKeyCache`: long-lived for session duration.
  - `derivedKeyVault`: short-lived vault with TTL and bounded reads.
- Vault defaults and bounds:
  - `AUTH_DERIVED_KEY_TTL_MS` default 120000, clamped to 10s..10m.
  - `AUTH_DERIVED_KEY_MAX_READS` default 100, clamped to 1..1000.
  - `AUTH_DERIVED_KEY_MAX_REHYDRATIONS` default 3, clamped to 0..100.
  - Vault cleanup interval `VAULT_CLEANUP_INTERVAL_MS` default 120000, clamped to 30s..10m.
- Keys are copied on insert and zeroized on removal; zeroization happens on logout and session cleanup.
- Rehydration is allowed only while the session exists and within a limited quota.

Files:
- `src/routes/auth.ts` (vault + cache)
- `src/routes/auth-factory.ts` (secure getters, lazy vault retrieval)
- `src/util/zeroize.ts` (zeroization helpers)

## Password vs Derived Key Decisions
- Database users: derive the key from the user's stored salt (stable across sessions).
- Non-database users: derive a key using a session-specific salt and do not allow credential storage.
- This prevents env-auth users from persisting encrypted credentials they cannot rehydrate later.

Files:
- `src/routes/auth.ts` (createSession key derivation)
- `src/routes/user.ts` (credential access requires password or derived key)

## RequestAuth Hardening
- `RequestAuth` stores secrets in a WeakMap to avoid accidental JSON/spread leakage.
- `getDerivedKey()` retrieves from vault once and refreshes TTL/read counters, then caches in-memory for the request.
- `destroySecrets()` zeroizes derived keys and unregisters finalizers.

Files:
- `src/routes/auth-factory.ts`

## Rate Limiting
- Global rate limiting is enforced in `authenticate()` and onboarding endpoints.
- `PersistentRateLimiter` uses SQLite for durable counters and falls back to in-memory if DB is unavailable.
- Defaults:
  - `RATE_LIMIT_WINDOW` 900s, `RATE_LIMIT_MAX` 300 (headless) or 600 (database).
  - `RATE_LIMIT_ENV_WRITE_WINDOW` and `RATE_LIMIT_ENV_WRITE_MAX` override env write limits.

Files:
- `src/util/rate-limiter.ts`
- `src/routes/auth.ts` (checkRateLimit)
- `src/routes/onboarding.ts` (per-IP rate limiting)
- `src/routes/env.ts` (env write throttling)

## Privileged Routes and Admin Control
- `/api/admin/*` uses ADMIN_SECRET or an admin-role session; auth is optional and validated inside the admin handler.
- `/api/env` writes require an authenticated session in DB mode plus ADMIN_SECRET or admin role.
- Headless `/api/env` writes require API key or Basic Auth (sessions are not sufficient).
- `/api/env/admin-secret` requires admin role and explicit confirmation in the request body to reveal the secret.

Files:
- `src/routes/index.ts` (routing and auth wiring)
- `src/routes/env.ts` (privileged env controls)
- `src/routes/admin.ts` (admin routes)

## Implementation Notes and Rationale
- Sessions persist only what is required for authorization; secrets stay in memory only.
- Derived keys are short-lived and zeroized to reduce exposure if memory is compromised.
- Onboarding uses uniform delay and rate limiting to reduce brute-force and timing leakage on ADMIN_SECRET.
- Headless mode treats API keys as the primary auth and avoids storing persistent session state unless explicitly configured.
