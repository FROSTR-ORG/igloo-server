# Igloo Server API Reference (LLM)

Last verified: 2026-02-09

## Canonical Sources
- Primary contract: `docs/openapi/openapi.yaml` (OpenAPI 3.1).
- Runtime truth for edge cases and missing endpoints: `src/routes/*.ts` and `src/server.ts`.

## Modes and Auth Summary
- Database mode (`HEADLESS=false`): UI enabled, SQLite-backed users, sessions persisted, DB API keys supported, env `API_KEY` ignored.
- Headless mode (`HEADLESS=true`): no UI, DB-only routes disabled, env `API_KEY` and Basic Auth are primary; sessions are optional and disabled when `API_KEY` is set.
- Global auth gate: with `AUTH_ENABLED=true`, all `/api/*` endpoints require auth except `GET /api/status`, `/api/auth/*`, `/api/onboarding/*` (DB only), and `GET /api/update`.
- `GET /api/status` is always public; in DB mode it returns `hasCredentials: null` when unauthenticated.
- Admin routes require `ADMIN_SECRET` bearer or an admin session (`role=admin`); DB mode only.
- `GET /api/env` in DB mode requires an authenticated session and only returns decrypted credentials when a password or derived key is available on the session.
- Env writes in DB mode require admin authorization (admin session or `ADMIN_SECRET` bearer); in headless they require `API_KEY` or Basic Auth.

## OpenAPI-Modeled Endpoints
For request/response schemas, examples, and auth security schemes, use `docs/openapi/openapi.yaml`.

Authentication
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Status and Updates
- `GET /api/status`

Events
- `GET /api/events` (WebSocket upgrade)

Configuration (env + shares)
- `GET /api/env`
- `POST /api/env`
- `POST /api/env/delete`
- `GET /api/env/shares` (headless-only; 404 in DB mode)
- `POST /api/env/shares` (headless-only; 404 in DB mode)

Peers
- `GET /api/peers`
- `GET /api/peers/group`
- `GET /api/peers/self`
- `POST /api/peers/ping`

Recovery
- `POST /api/recover`
- `POST /api/recover/validate`

Crypto
- `POST /api/sign`
- `POST /api/nip44/encrypt`
- `POST /api/nip44/decrypt`
- `POST /api/nip04/encrypt`
- `POST /api/nip04/decrypt`

NIP-46 (DB only)
- `GET /api/nip46/sessions`
- `POST /api/nip46/sessions`
- `PUT /api/nip46/sessions/{pubkey}/policy`
- `PUT /api/nip46/sessions/{pubkey}/status`
- `DELETE /api/nip46/sessions/{pubkey}`
- `GET /api/nip46/history`

Admin (DB only)
- `GET /api/admin/api-keys`
- `POST /api/admin/api-keys`
- `POST /api/admin/api-keys/revoke`
- `GET /api/admin/users`
- `POST /api/admin/users/delete`
- `GET /api/admin/whoami`

User (DB only, session auth only)
- `GET /api/user/profile`
- `GET /api/user/credentials`
- `POST /api/user/credentials`
- `PUT /api/user/credentials`
- `DELETE /api/user/credentials`
- `GET /api/user/relays`
- `POST /api/user/relays`
- `PUT /api/user/relays`

Onboarding (DB only; unauthenticated)
- `GET /api/onboarding/status`
- `POST /api/onboarding/validate-admin`
- `POST /api/onboarding/setup`

## Endpoints Not Modeled In OpenAPI (Highest Priority Gaps)
These are active routes that are not captured in `docs/openapi/openapi.yaml` and should be documented there or in a companion spec.

Documentation UI
- `/api/docs` (Swagger UI), `/api/docs/openapi.json`, `/api/docs/openapi.yaml`, `/api/docs/assets/*`.
- In production, `/api/docs` requires auth if `AUTH_ENABLED=true`.

Update checks
- `GET /api/update` checks GitHub releases/tags and is disabled for managed deployments or when `UPDATE_CHECK_DISABLED=true`.

Admin utilities
- `GET /api/admin/status` (DB-only; initialization/status info).

Environment secret reveal
- `POST /api/env/admin-secret` (DB-only; requires admin session; confirm flag required).

Peer policy management
- `GET /api/peers/policies` (list policy summaries).
- `GET /api/peers/{pubkey}/policy` (single policy read).
- `PUT /api/peers/{pubkey}/policy` (set allowSend/allowReceive; persists to DB when possible, fallback store otherwise).

NIP-46 extended API (DB only)
- `GET /api/nip46/transport` and `PUT /api/nip46/transport` (transport key).
- `GET /api/nip46/relays`, `POST /api/nip46/relays`, `PUT /api/nip46/relays` (relay pool management).
- `GET /api/nip46/requests`, `POST /api/nip46/requests`, `DELETE /api/nip46/requests` (request queue).
- `POST /api/nip46/connect` (process `nostrconnect://` URI).

Non-API WebSocket
- `GET /` with `Upgrade: websocket` is the internal relay WebSocket; origin and rate limits apply.

## Timeouts, Rate Limits, and Errors
- Crypto timeouts: `/api/sign`, `/api/nip44/*`, `/api/nip04/*` honor `FROSTR_SIGN_TIMEOUT` (preferred) or `SIGN_TIMEOUT_MS` (default 30000ms; bounds 1000..120000ms).
- Rate limits: auth, env writes, recovery, and WebSocket upgrades return 429 with `Retry-After`.
- Error payloads vary by endpoint. OpenAPI `ErrorResponse` is `{ error, success?: false }`; unhandled errors can return `{ code, error, requestId }` with `X-Request-ID`.
- Many endpoints enforce a JSON body size limit of `DEFAULT_MAX_JSON_BODY` (64KB).

## Practical Guidance for LLM Use
- Treat `docs/openapi/openapi.yaml` as the canonical schema and validate against route code for endpoints listed under "Not Modeled".
- When describing endpoint behavior, include mode constraints (DB vs headless) and auth method requirements.
- For WebSocket `/api/events`, describe the auth handshake and message envelope; avoid inventing event `type` values.
