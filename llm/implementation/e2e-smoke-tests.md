# E2E Smoke Test Suite (Playwright – DB Mode)

Last verified: 2026-02-20
Test count: 62 (54 API + 8 UI) — all passing

## Purpose

The Playwright smoke test suite exercises igloo-server end-to-end in **database mode** (the default, `HEADLESS=false`). It starts a real server process, spins up a live FROSTR co-signer, completes the full onboarding flow, and then runs two categories of tests:

- **API project** (`01`–`07`): Pure HTTP request-context tests — no browser. Cover auth, status, peers, NIP-44, NIP-04, signing, admin, event log, and credential management.
- **UI project** (`08`): Headless Chrome browser tests. Cover the login page, tab navigation, and the Event Log section embedded in the Signer tab.

## Running the Tests

```bash
# Full suite (both projects)
npx playwright test

# API-only (faster, no browser dependency)
npx playwright test --project=api

# UI-only
npx playwright test --project=ui

# Single spec file
npx playwright test tests/e2e/specs/04-sign.e2e.ts

# HTML report (opens automatically after a run that had failures)
npx playwright show-report
```

Prerequisites:
- `bun run build` must have been run at least once so `static/app.js` exists (the UI tests load the SPA).
- `@playwright/test` and Chromium browser installed (`npx playwright install chromium`).
- Keep port 18002 free when possible. `tests/e2e/global-setup.ts` calls `resolvePort()` and will usually fall back to a random free port if 18002 is busy, but hard-coded references can still break if the preferred port is unavailable.
- Admin credentials must be provided before running tests. Set `SMOKE_ADMIN_SECRET`, `SMOKE_ADMIN_USERNAME`, and `SMOKE_ADMIN_PASSWORD`, or provide `tests/e2e/smoke-test.local.json`; otherwise `tests/e2e/global-setup.ts` exits early.

## File Structure

```text
tests/e2e/
├── global-setup.ts      # Starts server + co-signer, completes onboarding, writes state.json
├── global-teardown.ts   # SIGTERMs both processes, deletes temp dir
├── state.ts             # loadState() helper — reads JSON written by global-setup
├── cosigner.mjs         # Minimal FROSTR co-signer subprocess (node/ESM)
└── specs/
    ├── 01-auth.e2e.ts
    ├── 02-status-peers.e2e.ts
    ├── 03-nip44-nip04.e2e.ts
    ├── 04-sign.e2e.ts
    ├── 05-admin.e2e.ts
    ├── 06-event-log.e2e.ts
    ├── 07-env.e2e.ts
    └── 08-ui.e2e.ts

playwright.config.ts     # Project definitions: "api" (01–07), "ui" (08)
```

## Global Setup (`global-setup.ts`)

The setup runs **once** before all tests and does the following in order:

### 1. Generate a 2-of-2 FROSTR keyset

```typescript
const { groupCredential, shareCredentials } = generateKeysetWithSecret(2, 2, TEST_NSEC_HEX);
```

A **2-of-2** (not 2-of-3) scheme is used deliberately: with exactly two shares, the one connected co-signer is always sufficient to reach threshold without any ambiguity about which peer is needed. `TEST_NSEC_HEX` is a fixed 32-byte private key so the keyset is deterministic across runs.

### 2. Start igloo-server

The server is spawned via `spawnDetached('bun', ['run', 'src/server.ts'], env, logFile)`. Key env overrides:

| Variable | Value | Reason |
|---|---|---|
| `HOST_PORT` | `18002` | Fixed test port |
| `HOST_NAME` | `127.0.0.1` | Loopback only |
| `ADMIN_SECRET` | from env/fixture (e.g. `$SMOKE_ADMIN_SECRET`) | Loaded from environment or local fixture — do not commit secrets |
| `DB_PATH` | `$TMPDIR/igloo-smoke-test/db` | Fresh DB per run |
| `RATE_LIMIT_ENABLED` | `false` | Avoid rate-limit failures in rapid-fire tests |
| `SKIP_RELAY_PROBE` | `true` | Skip external relay verification at startup |
| `ALLOW_LOCALHOST_RELAY` | `true` | Allow `ws://127.0.0.1:18002` as a relay URL |
| `FROSTR_SIGN_TIMEOUT` | `5000` | Cap setup/sign probe latency to 5 s per request |
| `GROUP_CRED` | `''` | Clear any `.env` credential interference |
| `SHARE_CRED` | `''` | Clear any `.env` credential interference |
| `RELAYS` | `''` | Clear any `.env` relay interference |
| `NODE_ENV` | `test` | Suppresses some production-only behaviors |

**Critical**: Bun automatically loads `.env` from the current directory into `process.env`. If the developer's `.env` contains stale `GROUP_CRED`/`SHARE_CRED`/`RELAYS` values from a different port, the server would connect its bifrost node to the wrong relay, making signing always time out. The empty-string overrides above force those variables to be blank regardless of what `.env` contains.

### 3. Complete onboarding

```text
POST /api/onboarding/validate-admin   (Bearer ADMIN_SECRET)
POST /api/onboarding/setup            (creates admin user with username + password)
POST /api/auth/login                  → sessionId
```

### 4. Set FROSTR credentials

```text
POST /api/user/credentials  { group_cred, share_cred: shareCredentials[0], relays: ['ws://127.0.0.1:18002'] }
```

In DB mode, credentials are stored per-user encrypted in SQLite. The server then creates the in-memory bifrost node and polls `GET /api/status` until `nodeActive === true`.

### 5. Start co-signer

```bash
node tests/e2e/cosigner.mjs <groupCred> <shareCredentials[1]> ws://127.0.0.1:18002
```

`cosigner.mjs` creates a bifrost node using `@frostr/igloo-core` directly (no igloo-cli TUI). The server holds `shareCredentials[0]`; the co-signer holds `shareCredentials[1]`. Both connect to the server's built-in Nostr relay at `ws://127.0.0.1:18002`.

### 6. Signing readiness probe

Up to 5 attempts (3 s apart) to POST a 32-byte hex message to `/api/sign`. Success confirms the threshold is reachable and the relay subscription is active on both sides. Setup aborts if signing never succeeds.

### 7. Create a persistent API key

`POST /api/admin/api-keys { label: 'smoke-test-key' }` — the returned token is saved in `state.json` as `apiKey` and used in tests that verify API key authentication.

### 8. Write shared state

Everything is serialized to `$TMPDIR/igloo-smoke-test/state.json` and the path is exported as `SMOKE_STATE_FILE`. Every spec file calls `loadState()` at module level to read this file.

## Shared State (`state.ts`)

`loadState()` reads `SMOKE_STATE_FILE`. During Playwright's test discovery phase (when `--list` is run or the config is imported without a server running) `SMOKE_STATE_FILE` is not set, so the function returns a harmless stub with empty strings. Tests only execute after global-setup has populated the real state.

```typescript
interface SmokeTestState {
  port: number;
  baseUrl: string;
  tmpDir: string;
  serverPid: number;
  cosignerPid: number;
  sessionId: string;       // live admin session from global-setup login
  apiKey: string | null;   // DB-backed API key token
  apiKeyId: string | null;
  groupCredential: string;
  shareCredentials: string[]; // [0] = server share, [1] = cosigner share
  groupPubkeyHex: string;     // x-only (no 02/03 prefix)
  adminUsername: string;
  adminPassword: string;
  adminSecret: string;
}
```

## Spec Coverage

### `01-auth.e2e.ts` — Authentication

- `GET /api/auth/status` returns available auth methods
- `POST /api/auth/login` — valid credentials return `sessionId`
- `POST /api/auth/login` — wrong/unknown password returns 401
- `GET /api/peers` — no auth returns 401 *(uses `/api/peers`, not `/api/status` — see design decisions below)*
- `GET /api/status` — valid session and API key (X-API-Key and Bearer formats) return 200
- `GET /api/peers` — invalid API key returns 401
- `POST /api/auth/logout` — invalidates session; subsequent `GET /api/peers` returns 401

### `02-status-peers.e2e.ts` — Status and Peers

- `GET /api/status` — publicly accessible without auth (intentional design; returns 200)
- `GET /api/status` — with session returns full node info: `serverRunning`, `nodeActive`, `health`, `relayCount`, `timestamp`
- `GET /api/status` — health object has `isConnected`, `consecutiveConnectivityFailures`
- `GET /api/peers` — 401 without auth
- `GET /api/peers` — returns peer list with `peers`, `total`, `online`
- `GET /api/peers/group` — returns `pubkey` (matches `state.groupPubkeyHex`), `threshold`
- `GET /api/peers/self` — returns own share pubkey

### `03-nip44-nip04.e2e.ts` — NIP-44 and NIP-04 Encryption

NIP-44:
- 401 without auth
- Encrypt returns ciphertext
- Encrypt → decrypt round-trips plaintext
- Invalid `peer_pubkey` returns 400
- Missing `content` returns 400

NIP-04:
- 401 without auth
- Encrypt returns ciphertext with IV suffix (NIP-04 format: `<cipher>?iv=<iv>`)
- Encrypt → decrypt round-trips plaintext
- Invalid `peer_pubkey` returns 400

Uses `state.groupPubkeyHex` as the peer pubkey for encryption (the server encrypts to itself for round-trip tests).

### `04-sign.e2e.ts` — Threshold Signing

- 401 without auth
- 400 for non-hex message
- 400 for message shorter than 32 bytes
- 400 for missing body
- Signs a 32-byte hex message; response contains `id` and `signature`
- Signs a full Nostr event object (with `id`, `pubkey`, `content`, `kind`, `created_at`, `tags`)
- Signs with API key auth (`X-API-Key` header) — confirms DB-backed API keys work for signing
- 400 for event with invalid pubkey

Signing tests exercise the complete FROSTR threshold flow: server publishes a sign request over the relay, co-signer responds with a partial signature, server aggregates and returns the final signature.

### `05-admin.e2e.ts` — Admin Endpoints

API key management:
- `GET /api/admin/api-keys` returns list (includes key from global-setup)
- `POST /api/admin/api-keys` creates a key (returns 201 with `token`, `id`)
- New API key authenticates successfully
- Revoked API key returns 401: creates key → verify works on `/api/event-log` → revoke → verify 401 on `/api/event-log`

User management:
- `GET /api/admin/users` returns users list; admin user is present
- `GET /api/admin/whoami` returns `userId`
- Both require auth (401 without)

### `06-event-log.e2e.ts` — UI Event Log

- `GET /api/event-log` — 401 without auth
- Returns `{ entries: [...] }` with valid shape (`type`, `message`, `timestamp`)
- Pagination: `?limit=5` returns ≤ 5 entries
- `GET /api/event-log/export` — streams NDJSON (`Content-Type: application/x-ndjson`); each line parses as valid JSON
- Export — 401 without auth

### `07-env.e2e.ts` — Credential / Env Management

- `GET /api/env` — 401 without auth
- `GET /api/env` with session — returns `{ hasCredentials: true, ... }`
- `POST /api/env` — invalid `GROUP_CRED` returns 400
- `POST /api/env` — invalid `SHARE_CRED` returns 400
- `POST /api/env` — invalid relay URL returns 400
- `POST /api/env` — without auth returns 401

### `08-ui.e2e.ts` — Browser UI (Headless Chrome)

Login page:
- `/` renders login form (username + password inputs visible)
- Login form fills credentials and reaches the dashboard (tabs visible)

Authenticated app (each test logs in fresh via `beforeEach`):
- Signer tab is visible after login
- Configure tab is accessible (click navigates, inputs render)
- API Keys tab renders without "Something went wrong"
- Event Log collapsible section (inside Signer tab, not a separate tab) is visible, click-to-expand works, no errors
- Logout button signs out and returns to login form

Onboarding:
- `/` does not show "Admin Secret" text when DB is already initialized

## Design Decisions and Gotchas

### `/api/status` is intentionally public

`/api/status` bypasses the main authentication check in `src/routes/index.ts`:

```typescript
const isStatusEndpoint = url.pathname === '/api/status';
// Auth check skips status:
if (url.pathname.startsWith('/api/') && AUTH_CONFIG.ENABLED && !isPublicEndpoint && !isStatusEndpoint && ...) {
```

This is by design — unauthenticated health checks and monitoring probes must be able to reach the status endpoint. Consequently:
- Tests that verify 401 enforcement **must use a different endpoint** (e.g., `GET /api/peers` or `GET /api/event-log`).
- Tests that verify authenticated 200 responses can still use `/api/status` (they pass with or without auth).

### DB API keys and per-user credential lookup

Database-backed API keys authenticate via `authenticateDatabaseApiKey()` and return `userId: 'api-key:<prefix>'` — a string, not a numeric DB row ID. Several routes in DB mode call `getCredentials(auth)` which requires a numeric `userId` to decrypt per-user credentials from SQLite. If `userId` is not numeric, `getCredentials` returns `null` and the route responds 401.

Affected routes: `GET /api/peers`, `GET /api/peers/group`, `GET /api/peers/self`.
Unaffected: `POST /api/sign`, `GET /api/event-log`, NIP-44/NIP-04 (which use the in-memory node directly or don't need per-user credential lookup).

For this reason:
- The "revoked API key returns 401" test in `05-admin.e2e.ts` uses `GET /api/event-log` (not `/api/peers`) for the pre/post-revocation auth check.
- The "new API key can authenticate" test uses `GET /api/event-log` to exercise real API-key auth enforcement on a protected endpoint.

### Event log export is NDJSON, not JSON

`GET /api/event-log/export` returns `Content-Type: application/x-ndjson` with one JSON object per line (newline-delimited JSON). Calling `response.json()` on this response fails because the body as a whole is not valid JSON. The test reads the body as text and parses each line individually:

```typescript
const text = await res.text();
const lines = text.trim().split('\n').filter(Boolean);
for (const line of lines) {
  expect(() => JSON.parse(line)).not.toThrow();
}
```

### `POST /api/env` validates credential format in DB mode

The DB-mode `POST /api/env` handler (in `src/routes/env.ts`) validates `GROUP_CRED` and `SHARE_CRED` using `validateGroup()` / `validateShare()` from `@frostr/igloo-core` before writing to the `.env` file. Invalid credentials return 400. This validation was added during test development; it was previously only present on the headless `/api/env/shares` path.

### Event Log is embedded in Signer tab, not a top-level tab

The application has four top-level tabs: **Signer**, **NIP-46**, **API Keys**, **Recover**. There is no "Event Log" tab. The event log is a collapsible section within the Signer tab rendered as a `div[role="button"]` containing a `<span>Event Log</span>`. The UI test locates it with:

```typescript
page.locator('[role="button"]:has-text("Event Log")').first()
```

### `.env` file interference with test server

Bun loads `.env` from the current working directory automatically. A developer's `.env` may contain `GROUP_CRED`, `SHARE_CRED`, or `RELAYS` pointing to a production relay or a different port. If these leak into the test server's environment, the server creates a bifrost node at startup using the old credentials (different relay URL), and when the test then POSTs new credentials the server logs "Node already running, skipping restart" and stays connected to the wrong relay. The co-signer connects to the test relay, the server connects elsewhere — signing always times out.

**Fix**: global-setup passes explicit empty-string overrides for all three variables when spawning the server:
```typescript
GROUP_CRED: '',
SHARE_CRED: '',
RELAYS: '',
```

### nostr-tools 2.x REQ filter format

`@frostr/igloo-core` (which depends on `nostr-tools` 2.x) sends REQ messages in the format:
```json
["REQ", "sub_id", [{"kinds":[20004],"#p":["<pubkey>"]}]]
```
Note the **array-wrapped filter** as the third element. NIP-01 expects filters as positional arguments:
```json
["REQ", "sub_id", {"kinds":[20004],"#p":["<pubkey>"]}]
```

The built-in relay (`src/class/relay.ts`) normalizes this in `_handler`:
```typescript
if (payload.length === 2 && Array.isArray(payload[1])) {
  payload = [payload[0], ...payload[1]];
}
```

Without this fix, the server's relay would reject all subscriptions from the bifrost node (logging "bad req: provided filter is not an object") and signing would always time out.

## Temp Directory Layout

Each run creates a fresh temp directory at `$TMPDIR/igloo-smoke-test/` (deleted by teardown):

```text
igloo-smoke-test/
├── db/          # SQLite database files (igloo.db, .session-secret)
├── state.json   # Shared test state (pids, session, credentials, etc.)
├── server.log   # igloo-server stdout/stderr
└── cosigner.log # co-signer subprocess stdout/stderr
```

If a run fails unexpectedly (e.g., setup throws before teardown registers), the temp dir may be left behind. It is safe to delete manually.

## Adding New Tests

1. Create `tests/e2e/specs/NN-name.e2e.ts`.
2. Import `loadState` from `../state.js` and call it at module level.
3. Use `state.sessionId` for session-authenticated requests, `state.apiKey` for API key requests.
4. Add the spec to the correct project in `playwright.config.ts` (update `testMatch` if needed, or rely on the `0[1-7]-*.e2e.ts` glob for API specs).
5. If testing a credential-sensitive endpoint in DB mode (peers, env), use `state.sessionId` — DB API keys cannot look up per-user credentials.

## Files

| File | Role |
|---|---|
| `tests/e2e/global-setup.ts` | Server lifecycle, onboarding, state serialization |
| `tests/e2e/global-teardown.ts` | SIGTERM + temp dir cleanup |
| `tests/e2e/state.ts` | `SmokeTestState` type and `loadState()` |
| `tests/e2e/cosigner.mjs` | Minimal co-signer subprocess (ESM, no TUI) |
| `tests/e2e/specs/01-auth.e2e.ts` | Auth enforcement, login/logout |
| `tests/e2e/specs/02-status-peers.e2e.ts` | Node status, peer list |
| `tests/e2e/specs/03-nip44-nip04.e2e.ts` | NIP-44 / NIP-04 encrypt+decrypt |
| `tests/e2e/specs/04-sign.e2e.ts` | Threshold Schnorr signing |
| `tests/e2e/specs/05-admin.e2e.ts` | API key CRUD, revocation, user management |
| `tests/e2e/specs/06-event-log.e2e.ts` | Event log pagination and NDJSON export |
| `tests/e2e/specs/07-env.e2e.ts` | Credential/env endpoint validation |
| `tests/e2e/specs/08-ui.e2e.ts` | Headless Chrome SPA smoke tests |
| `playwright.config.ts` | Project config, timeout, reporter, globalSetup/Teardown |
| `src/routes/env.ts` | DB-mode POST validates GROUP_CRED / SHARE_CRED format |
| `src/class/relay.ts` | Normalizes nostr-tools 2.x double-wrapped REQ filters |
| `src/routes/utils.ts` | `ALLOW_LOCALHOST_RELAY` bypass for test relay URLs |
