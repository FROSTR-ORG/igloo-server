# Configuration Guide

This doc is the canonical reference for runtime configuration (environment variables), with emphasis on the knobs that most often affect security and production behavior.

Related:
- `env.example` for a ready-to-copy baseline.
- `docs/SECURITY.md` for hardening guidance and recommended production defaults.

## Modes

Igloo Server runs in two modes:
- Database mode (default, `HEADLESS=false`): multi-user UI + encrypted credential storage in SQLite.
- Headless mode (`HEADLESS=true`): env-only credentials, API-first, no UI assets.

Key differences:
- `API_KEY` is only used in headless mode (ignored in database mode).
- In headless mode with a non-empty `API_KEY`, session management is disabled (no `.session-secret` I/O).

## Must-Set Values

Database mode first run:
- `ADMIN_SECRET`: required when the database is uninitialized (onboarding).

Headless mode:
- `GROUP_CRED` and `SHARE_CRED`: required to actually boot a signer node.

Production (strongly recommended):
- `ALLOWED_ORIGINS`: explicit origins for browser access.
- `TRUST_PROXY=true` when running behind a reverse proxy that sets `X-Forwarded-*`.
- `AUTH_ENABLED=true` and `RATE_LIMIT_ENABLED=true`.

## CORS vs WebSocket Origin (ALLOWED_ORIGINS)

`ALLOWED_ORIGINS` is used by two different mechanisms with different semantics:

HTTP (CORS headers):
- If `ALLOWED_ORIGINS` is unset and `NODE_ENV=production`: no `Access-Control-Allow-Origin` header is set, so browsers block cross-origin requests.
- If `ALLOWED_ORIGINS` is unset and `NODE_ENV` is not `production`: wildcard `*` is used for convenience.
- If `ALLOWED_ORIGINS` is set: it is treated as a comma-separated list of exact origins (or `*`).

WebSocket (Origin enforcement on upgrades):
- If `ALLOWED_ORIGINS` is unset and `NODE_ENV` is not `production`: allow any Origin.
- If `ALLOWED_ORIGINS` is unset and `NODE_ENV=production`: allow only when `Origin` host matches the request `Host` (or `X-Forwarded-Host` if `TRUST_PROXY=true`). Ports are ignored for host matching.
- If `ALLOWED_ORIGINS` includes `@self`: allow any Origin whose host matches the request host (port-agnostic).
- If `NODE_ENV=production` and `ALLOWED_ORIGINS` includes `*`: reject the upgrade (wildcard is not allowed for WebSockets in production).
- Otherwise: require an explicit Origin match.

Practical recipes:
- Same-host UI + API: `ALLOWED_ORIGINS=@self`
- Separate admin UI origin: `ALLOWED_ORIGINS=https://admin.example.com,https://api.example.com`
- Umbrel proxy: set `TRUST_PROXY=true` and include the proxied host in `ALLOWED_ORIGINS` (or use `@self`).

## Sessions (SESSION_SECRET)

`SESSION_SECRET` is a server-only enablement secret. It must never be exposed via API and is intentionally excluded from `/api/env` allowlists.

Behavior:
- If unset, Igloo auto-generates a 32-byte secret (64 hex chars) and persists it to `<DB_PATH>/.session-secret` (or `./data/.session-secret` when `DB_PATH` is unset).
- In `NODE_ENV=production`, failure to load/generate/persist `SESSION_SECRET` is fatal (process exits).
- In headless mode with a non-empty `API_KEY`, sessions are disabled to avoid unnecessary file I/O.

Operational implication:
- Persist your data directory (volume mount in Docker/Umbrel). Otherwise sessions will reset on every restart.

## What The UI/API Can Change

The `/api/env*` endpoints and Configure UI only allow writing a small whitelist of keys (see `src/routes/utils.ts` `ALLOWED_ENV_KEYS`). This includes:
- Credentials + relays: `GROUP_CRED`, `SHARE_CRED`, `RELAYS`, `GROUP_NAME`, `PEER_POLICIES`
- Selected tuning: `SESSION_TIMEOUT`, `FROSTR_SIGN_TIMEOUT`, `RATE_LIMIT_*`, `NODE_*` restart controls, `CONNECTIVITY_PING_TIMEOUT_MS`, `INITIAL_CONNECTIVITY_DELAY`, `ALLOWED_ORIGINS`

Everything else must be configured outside the app (container env, systemd, `.env` on disk, etc.).

Related docs:
- `docs/AUTH_MATRIX.md` for mode-by-mode endpoint availability and what bypasses the global auth gate.
- `docs/PEER_POLICIES.md` for peer policy schema, precedence, and persistence.

Important persistence/precedence detail:
- For keys managed by `/api/env`, Igloo reads from a local `.env` file (relative to the server working directory) and treats it as higher precedence than process environment variables for those keys.
- If you deploy with Docker Compose `env_file: .env`, note that this sets container environment variables but does not mount the file into the container. In headless deployments, UI/API changes that write `.env` will not persist across container recreation unless you also mount a volume for the `.env` file (or you manage configuration exclusively via container environment variables and avoid writing via `/api/env`).
- If you bind-mount `./.env:/app/.env` to persist `/api/env` writes, ensure `./.env` exists as a file before starting the container (for example `cp env.example .env` or `touch .env`). If it is missing, Docker may create `./.env/` as a directory at mount time, which will break both `env_file: .env` and the app's `.env` reads/writes.
- `env_file: .env` is only read at container start. Changes written to the mounted `/app/.env` by the app will not affect the running container's environment until you restart the container.

## Operational Tuning Knobs (Most Commonly Missed)

Timeouts:
- `FROSTR_SIGN_TIMEOUT` (preferred) or `SIGN_TIMEOUT_MS` (legacy): clamps to 1000..120000ms.
- `CONNECTIVITY_PING_TIMEOUT_MS` (or `PING_TIMEOUT_MS`): connectivity ping timeout, clamps to 1000..120000ms.
- `PUBLISH_EVENT_TIMEOUT_MS` (or `RELAY_PUBLISH_TIMEOUT`): relay publish receipt timeout, clamps to 1000..120000ms.

WebSocket abuse controls:
- `RATE_LIMIT_WS_UPGRADE_WINDOW`, `RATE_LIMIT_WS_UPGRADE_MAX`
- `WS_MAX_CONNECTIONS_PER_IP`, `WS_MSG_RATE`, `WS_MSG_BURST`
- `ALLOW_QUERY_CREDENTIALS` (default `true` for legacy `/api/events?apiKey=...` / `sessionId` compatibility; set `false` to disable query-param auth on upgrades)

Recovery throttling:
- `RATE_LIMIT_RECOVERY_WINDOW`, `RATE_LIMIT_RECOVERY_MAX`

Node restart/backoff:
- `NODE_RESTART_DELAY` (ms), `NODE_MAX_RETRIES`, `NODE_BACKOFF_MULTIPLIER`, `NODE_MAX_RETRY_DELAY` (ms)

Error circuit breaker (exits process after repeated unhandled errors):
- `ERROR_CIRCUIT_WINDOW_MS`, `ERROR_CIRCUIT_THRESHOLD`, `ERROR_CIRCUIT_EXIT_CODE`

Update checks (`GET /api/update`):
- `UPDATE_CHECK_DISABLED`
- `MANAGED_DEPLOYMENT` (also treated as managed when `HEADLESS=true` or `SKIP_ADMIN_SECRET_VALIDATION=true`)
- `GITHUB_TOKEN` (avoids GitHub API rate limits)
- `UPDATE_CHECK_TIMEOUT_MS`, `UPDATE_CHECK_TTL_MS`, `UPDATE_CHECK_FAILURE_TTL_MS`
- `APP_VERSION` (override what `/api/update` reports; intended for packaged builds)

Onboarding hardening (database mode only):
- `FINGERPRINT_SECRET` (stabilizes per-client identifiers across restarts)
- `CLIENT_ID_TTL_MS` (bounds in-memory client-id cache)
- `LOG_FINGERPRINT_FALLBACK=true` (diagnostic logging; avoid in production unless troubleshooting)

Performance toggles (advanced):
- `SKIP_RELAY_PROBE`, `DEFER_RELAY_PROBE` (relay probing behavior; deferred probing is diagnostics-only and does not rewrite the active relay set)
- `SKIP_STARTUP_ECHO` (skips headless startup echo broadcasts)
- `MAX_PEER_STATUS_ENTRIES` (bounds peer status memory)

## UI Event Log (DB Mode Only)

In database mode (`HEADLESS=false`), the UI "Event Log" is persisted server-side in SQLite (within the same `igloo.db` under your `DB_PATH`).

For details on retention, de-duplication, and disk usage, see `docs/EVENT_LOG.md`.

API surfaces (DB mode only):
- `GET /api/event-log` paginates recent history (use `beforeSeq` to page older entries, and `types` to filter).
- `GET /api/event-log/blob/<hash>` fetches the full JSON payload for a log entry by content hash (the UI loads this lazily on expand).
- `GET /api/event-log/export` downloads the full log stream as NDJSON (one entry per line).

Growth control:
- `UI_EVENT_LOG_INCLUDE_PINGS=false` (default) suppresses `/ping/*` request/response entries from the persisted UI event log to avoid runaway growth on long-running deployments. Enable only when debugging ping behavior.
- `UI_EVENT_LOG_RETENTION_DAYS`: optional; when set to a positive integer, Igloo will periodically prune persisted UI event log entries older than N days (and delete unreferenced payload blobs).

## DB_PATH Semantics

`DB_PATH` can be either:
- A directory (e.g., `/var/lib/igloo/data`), or
- A file path (e.g., `/var/lib/igloo/igloo.db`)

In both cases, Igloo stores:
- SQLite at `<DB_PATH>/igloo.db` when `DB_PATH` is a directory (or uses the file path directly when it looks like a file)
- Session secret in the `DB_PATH` directory as `.session-secret`:
  - If `DB_PATH` is a directory: `<DB_PATH>/.session-secret`
  - If `DB_PATH` is a file path: the directory containing `DB_PATH` plus `/.session-secret` (for example, `/var/lib/igloo/.session-secret` when `DB_PATH=/var/lib/igloo/igloo.db`)
