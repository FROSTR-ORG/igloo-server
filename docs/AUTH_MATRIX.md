# Auth and Mode Matrix

This is a human-oriented map of which endpoints exist in each mode and which ones bypass the global auth gate when `AUTH_ENABLED=true`.

Definitions:
- Database mode: `HEADLESS=false` (default)
- Headless mode: `HEADLESS=true`
- Global auth gate: the router-level check that runs when `AUTH_ENABLED=true` and the path starts with `/api/`.

"Bypasses global gate" does not mean "no auth required"; many endpoints enforce their own rules.

## Endpoint Matrix

| Endpoint(s) | Purpose | DB mode | Headless mode | Bypasses global auth gate when `AUTH_ENABLED=true` | Notes |
|---|---|:---:|:---:|:---:|---|
| `/api/status` | Health/status | Yes | Yes | Yes | Public health checks; if auth headers are present the server will attempt auth and include extra details. |
| `/api/update` | Update check | Yes | Yes | Yes | Update checks are disabled for managed deployments (e.g., `HEADLESS=true` or `SKIP_ADMIN_SECRET_VALIDATION=true`) and when `UPDATE_CHECK_DISABLED=true`. |
| `/api/auth/status` | Auth capabilities | Yes | Yes | Yes | Returns configured auth methods and mode signals. |
| `/api/auth/login` | Session login | Yes | Yes | Yes | Creates a session when session auth is enabled; in headless mode with `API_KEY` set, sessions are disabled. |
| `/api/auth/logout` | Session logout | Yes | Yes | Yes | Clears session cookie / invalidates session when sessions are enabled. |
| `/api/onboarding/*` | First-run onboarding | Yes | No | Yes | Only mounted in DB mode. Intended to be unauthenticated; protected by rate limiting and `ADMIN_SECRET` (unless `SKIP_ADMIN_SECRET_VALIDATION=true`). |
| `/api/docs/*` | Swagger UI + raw spec | Yes | Yes | Special | Not behind the global gate, but in `NODE_ENV=production` with `AUTH_ENABLED=true` the docs require auth. |
| `/api/events` (WebSocket) | Server event stream | Yes | Yes | No | WebSocket upgrade is authorized like normal API requests when `AUTH_ENABLED=true`. Origin checks apply for browsers (see `docs/CONFIG.md`). |
| `/api/env`, `/api/env/delete` | Read/write env-backed config | Yes | Yes | No | DB mode: reads require a valid session when `AUTH_ENABLED=true`; writes require admin (`ADMIN_SECRET` or admin role). Headless: reads and writes require API key or Basic Auth even if `AUTH_ENABLED=false`. |
| `/api/env/shares` | Headless share metadata/upload | No | Yes | No | Intentionally headless-only; returns 404 in DB mode. |
| `/api/env/admin-secret` | Reveal `ADMIN_SECRET` (guarded) | Yes | No | No | DB mode only; requires an admin session and explicit confirmation in body. |
| `/api/peers/*` | Peer status/ping/policies | Yes | Yes | No | Policy mutations persist to DB for DB users; otherwise they persist to `data/peer-policies.json` (see `docs/PEER_POLICIES.md`). |
| `/api/recover/*` | Recovery workflows | Yes | Yes | No | Rate limited; intended for controlled use. |
| `/api/sign` | Threshold signing | Yes | Yes | No | Timeout controlled by `FROSTR_SIGN_TIMEOUT` / `SIGN_TIMEOUT_MS`. |
| `/api/nip44/*` | NIP-44 crypto | Yes | Yes | No | Timeout controlled by `FROSTR_SIGN_TIMEOUT` / `SIGN_TIMEOUT_MS`. |
| `/api/nip04/*` | NIP-04 crypto (legacy) | Yes | Yes | No | Timeout controlled by `FROSTR_SIGN_TIMEOUT` / `SIGN_TIMEOUT_MS`. |
| `/api/nip46/*` | NIP-46 APIs | Yes | No | No | DB mode only (not mounted in headless mode). |
| `/api/user/*` | Per-user credential storage | Yes | No | No | DB mode only; requires a DB-backed user session (env-auth users cannot use these endpoints). |
| `/api/admin/*` | Admin APIs (keys/users/status) | Yes | No | Yes (bypasses) | DB mode only; not behind the global gate. Still requires `ADMIN_SECRET` bearer or an admin session. |

## Common Gotchas

- `AUTH_ENABLED=false` is not "open everything". Some endpoints still require auth in headless mode (notably `/api/env*` reads/writes). Admin endpoints still require admin authorization.
- `/api/docs` is protected in production. In `NODE_ENV=production` with `AUTH_ENABLED=true`, you must authenticate to view Swagger UI.
- Mode differences are real API surface differences. Headless mode disables DB-only routes like `/api/user/*`, `/api/admin/*`, and `/api/nip46/*`.
