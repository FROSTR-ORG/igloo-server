# API Keys Deep‑Dive: Design, Usage, and Operations

This document explains how API keys work in Igloo Server across both headless and database modes. It covers generation, storage, authentication, auditing fields, admin APIs, UI behavior, security posture, and recommended operations.

## 1) Modes & Capabilities

- Headless Mode (`HEADLESS=true`)
  - Single API key provided via the environment: `API_KEY`.
  - No HTTP creation/rotation; `/api/env` intentionally cannot set `API_KEY`.
  - Use for automation and simple deployments; the UI “API Keys” tab is disabled.

- Database Mode (`HEADLESS=false`)
  - Multiple keys stored in SQLite (`api_keys` table).
  - Create/list/revoke via Admin API or the UI “API Keys” tab.
  - Admin authentication accepts either `ADMIN_SECRET` bearer or an authenticated admin session.

## 2) Token Format & Storage Model

- Generation
  - 32 random bytes → 64‑char hexadecimal token.
  - Public `prefix` = first 12 characters; used for display and initial DB lookup.

- Storage
  - The full token is never persisted.
  - Server stores `sha256(token)` as `key_hash` (hex) and the unique `prefix`.
  - Token value is returned exactly once in the create response.

- Verification
  - Extract token, derive `prefix`, fetch candidate row by `prefix`.
  - Timing‑safe compare of `sha256(token)` with stored `key_hash` (normalized to 32 bytes).

## 3) Database Schema (SQLite)

Table: `api_keys`

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `prefix` TEXT UNIQUE NOT NULL (≥ 12 chars)
- `key_hash` TEXT NOT NULL (64 hex)
- `label` TEXT NULL
- `created_by_user_id` INTEGER NULL (FK users.id, ON DELETE SET NULL)
- `created_by_admin` INTEGER NOT NULL DEFAULT 1
- `created_at` / `updated_at` DATETIME
- `last_used_at` DATETIME NULL
- `last_used_ip` TEXT NULL
- `revoked_at` DATETIME NULL
- `revoked_reason` TEXT NULL

Indexes & Trigger

- `idx_api_keys_active_prefix` on `(prefix) WHERE revoked_at IS NULL`
- `idx_api_keys_last_used` on `(last_used_at)`
- Trigger `trg_api_keys_touch_updated_at` updates `updated_at` on row updates

Ordering in listings: active first, then `created_at DESC, id DESC`.

## 4) Admin API (Database Mode)

Authentication options (any of):

- `Authorization: Bearer <ADMIN_SECRET>`
- Logged‑in admin session (`X-Session-ID` or session cookie) — accepts first user or users with `role=admin`.

Endpoints

- `GET /api/admin/api-keys`
  - Returns `{ apiKeys: AdminApiKey[] }` (metadata only; no tokens).
- `POST /api/admin/api-keys`
  - Body: `{ label?: string, userId?: number|string }`
  - Returns `{ apiKey: { id, token, prefix, label|null, createdByUserId|null, createdByAdmin } }`.
- `POST /api/admin/api-keys/revoke`
  - Body: `{ apiKeyId: number|string, reason?: string }`
  - Responses: 200 (revoked), 404 (not found), 409 (already revoked), 400 (bad body).

Rate limiting protects these endpoints from brute force; 429 includes `Retry-After` seconds.

## 5) Request Authentication Pipeline

Order of attempts (non‑headless):

1. API Key (DB‑backed) — `X-API-Key` or `Authorization: Bearer`.
2. Basic Auth (if configured).
3. Session (`X-Session-ID` header or cookie) — used by the UI.

On successful DB API‑key auth, the server updates `last_used_at` and, when available, `last_used_ip`.

Client IP attribution precedence:

- `X-Forwarded-For` (left‑most), then `X-Real-IP`, then `CF-Connecting-IP`, else `unknown`.
- Deploy behind trusted proxies and forward correct headers to populate `last_used_ip`.

## 6) UI Behavior (Database Mode)

- The “API Keys” tab appears between “NIP‑46” and “Recover”.
- If logged in as admin, the tab auto‑loads without prompting for `ADMIN_SECRET`.
- Create form supports optional `label` and `userId`.
- The full token is displayed once after creation with copy affordance.
- Listing groups active and revoked with: `prefix`, `label`, timestamps, `last_used_ip`, and revoke action.

## 7) Headless Mode Specifics

- Provision by setting `API_KEY` and restarting to rotate.
- Not creatable/rotatable via HTTP; `/api/env` will reject attempts to set `API_KEY`.
- Use API key headers in requests; the UI admin tab is disabled.

## 8) Operational Guidance

- Issuance
  - Use descriptive labels (integration/team/env/date).
  - Prefer one key per integration/environment.
- Rotation
  - Rotate keys periodically and after incidents; revoke old keys.
  - Headless: update env + restart. Database mode: issue new via API/UI, then revoke old.
- Monitoring
  - Watch `last_used_at`/`last_used_ip` for anomalies and stale keys.
  - Use `createdByAdmin` and `createdByUserId` for traceability.
- Security
  - Keep `ADMIN_SECRET` set in production; store in a secrets manager.
  - Use sessions in the UI to avoid distributing `ADMIN_SECRET` unnecessarily.
  - Enforce TLS and set `ALLOWED_ORIGINS` for CORS.
  - Never log full tokens; avoid placing tokens in URLs.

## 9) Error Semantics (Admin & Auth)

- 401 Unauthorized — invalid/missing ADMIN_SECRET and no admin session, or invalid API key/session.
- 400 Bad Request — invalid request body (types/constraints).
- 404 Not Found — revocation target not found.
- 409 Conflict — key already revoked.
- 503 Service Unavailable — admin routes before DB initialization.
- 429 Too Many Requests — rate limit exceeded (`Retry-After` present).

## 10) Quick Recipes

Create a key (ADMIN_SECRET bearer):

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label":"automation","userId":1}' \
  http://localhost:8002/api/admin/api-keys | jq
```

List keys (admin session):

```bash
curl -sS -H "X-Session-ID: $SESSION_ID" http://localhost:8002/api/admin/api-keys | jq
```

Revoke a key:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"apiKeyId": 1, "reason": "rotation"}' \
  http://localhost:8002/api/admin/api-keys/revoke | jq
```

Use an API key against the public API:

```bash
curl -sS -H "X-API-Key: $TOKEN" http://localhost:8002/api/status | jq
```

## 11) Helper Scripts

API test scripts live in `scripts/api/` and are run via package.json:

- `bun run api:test:get` — test GET endpoints (status, peers, etc.)
- `bun run api:test:sign` — test signing endpoint
- `bun run api:test:cors` — test CORS preflight handling
- `bun run api:test:nip` — test NIP-44/NIP-04 encryption
- `bun run api:test:ws` — test WebSocket event stream

See `scripts/api/README.md` for usage details.

## 12) Testing Coverage (Summary)

- Positive paths: create → authenticate → list → revoke → double‑revoke 409; session‑admin list/create; headless key auth.
- Negative paths: admin route blocked in headless; invalid request bodies → 400; revoke unknown → 404.

## 13) Adoption & Migration

- Headless → Database Mode
  - Start DB mode with `ADMIN_SECRET` and complete onboarding.
  - Issue keys per integration; move clients to new tokens; revoke the old headless key.
- Hybrid
  - Database mode can still use Basic Auth and sessions; DB API‑key auth is available when at least one active key exists.

## 14) Security Checklist (API Keys)

- Use TLS everywhere; never transmit tokens over HTTP.
- Keep `ADMIN_SECRET` configured in production; do not commit it; store in a secrets manager.
- One key per integration; rotate regularly; revoke unused or suspicious keys promptly.
- Trust only your proxy chain for IP headers; otherwise treat `last_used_ip` as advisory.
- Avoid logging tokens; rely on `prefix` and metadata for debugging.

---

For API shapes, see `docs/openapi/openapi.yaml` (Admin: list/create/revoke) and README’s “API Keys” section for quickstart examples.
