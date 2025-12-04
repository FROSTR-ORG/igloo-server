# Igloo Server

Server‑based signing device and personal ephemeral relay for the FROSTR protocol. Igloo provides an always‑on signing node with an optional web UI for configuration and monitoring. Built on @frostr/igloo-core.

## What It Is
- Threshold Schnorr signing for Nostr using your FROSTR shares (k‑of‑n). The full private key is never reconstructed.
- Two modes: Database (multi‑user, encrypted creds, web UI) or Headless (env‑only, API‑first, no UI).
- Includes an in‑memory relay for dev/tests; use production relays in real deployments.

## Features
- Always‑on signer built on igloo‑core with multi‑relay support
- Web UI (React + Tailwind) for setup, monitoring, recovery
- REST + WebSocket APIs with API‑key, Basic, or session auth
- Ephemeral relay for testing (not for production data)
- Health monitor + auto‑restart on repeated failures
- Works as a single node or part of a k‑of‑n signer group

## Quick Start

### Prerequisites
- Bun runtime (uses Bun APIs like `bun:sqlite`).
- FROSTR group/share credentials or add them later via UI/API.

### Start Locally (Database mode – default)
```bash
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server && bun install && bun run build
export ADMIN_SECRET=$(openssl rand -hex 32)
bun run start
# http://localhost:8002 → enter ADMIN_SECRET → create admin → Configure tab → add GROUP_CRED + SHARE_CRED
```

### Start Locally (Headless)
```bash
export HEADLESS=true
export GROUP_CRED="bfgroup1..." ; export SHARE_CRED="bfshare1..."
export RELAYS='["wss://relay.primal.net","wss://relay.damus.io"]'
export AUTH_ENABLED=false ; export API_KEY=dev-local-key  # /api/env still requires auth
bun run start
```

## Configure & Deploy Fast

### Pick a Mode
- Database (recommended): multi‑user, AES‑encrypted creds, admin onboarding via `ADMIN_SECRET`, SQLite at `./data/igloo.db` (override with `DB_PATH`).
- Headless: env‑only config, API‑first, UI disabled. Supports `PEER_POLICIES` blocks and API key auth.

### Docker / Compose
```bash
# one‑off
docker build -t igloo-server .
docker run -p 8002:8002 \
  -e NODE_ENV=production -e HOST_NAME=0.0.0.0 \
  -e ADMIN_SECRET=... -e AUTH_ENABLED=true -e RATE_LIMIT_ENABLED=true \
  -v $(pwd)/data:/app/data igloo-server

# compose (see compose.yml)
docker compose up -d --build
```

Reverse proxy (nginx) and cloud steps are in docs/DEPLOY.md.

### Production Checklist
- `NODE_ENV=production`, persist `/app/data`, set strong `ADMIN_SECRET` (keep set after onboarding).
- Explicit `ALLOWED_ORIGINS` (supports `@self` for “whatever host the user connects through”), `TRUST_PROXY=true` behind a proxy; forward WS upgrade headers.
- Auth on (`AUTH_ENABLED=true`), rate limit on (`RATE_LIMIT_ENABLED=true`); optional `SESSION_SECRET` (auto‑gen if absent).
- Timeouts: tune `FROSTR_SIGN_TIMEOUT` or `SIGN_TIMEOUT_MS` (1000–120000ms).

## API & Docs
- Swagger UI: http://localhost:8002/api/docs (self‑hosted; run `bun run docs:vendor` if assets missing).
- OpenAPI: docs/openapi/openapi.yaml or `/api/docs/openapi.{json|yaml}`.
- Auth: API Key, Basic, or session; WS `/api/events` supports subprotocol hints (`apikey.<TOKEN>`, `bearer.<TOKEN>`, `session.<ID>`).
- Validate spec: `bun run docs:validate`.

### API Keys
- Headless: set a single `API_KEY` in env; HTTP cannot rotate it.
- Database mode: manage multiple keys via the UI or admin endpoints. Admin APIs accept either `Authorization: Bearer <ADMIN_SECRET>` or an authenticated admin session.
  - Helpers: `scripts/api-admin-keys.sh`, `scripts/api-test.sh`.

## Operations
- Health monitor: periodic connectivity checks; auto‑recreate node on repeated failures; status at `/api/status`.
- Error circuit breaker: `ERROR_CIRCUIT_WINDOW_MS` (default 60000), `ERROR_CIRCUIT_THRESHOLD` (default 10), `ERROR_CIRCUIT_EXIT_CODE` (default 1).
- Headless env management requires auth even with `AUTH_ENABLED=false` (`/api/env*`).

## Security Quick Setup
Production defaults:
```bash
AUTH_ENABLED=true
RATE_LIMIT_ENABLED=true
ALLOWED_ORIGINS=https://yourdomain.example
TRUST_PROXY=true
# Provide ADMIN_SECRET; SESSION_SECRET auto‑generates if absent
```
Data directory hardening (example):
```bash
chmod 700 ./data
chmod 600 ./data/igloo.db ./data/.session-secret 2>/dev/null || true
```

See SECURITY.md for hardening and CSP details.

## Troubleshooting
- “Build required”: run `bun run build` (UI assets are not committed).
- UI not updating: prod caches assets; rebuild + restart. Dev disables cache.
- Cred/relay issues: verify `bfgroup1...` / `bfshare1...` and reachable relays.
- More: SECURITY.md (hardening), docs/DEPLOY.md (proxy/cloud), docs/openapi/openapi.yaml (API).

## Development
```bash
bun run dev   # frontend watch
bun run start # server
bun test      # backend tests
```

## Security
See SECURITY.md for hardening, CSP, headers, rate limiting, and secret management. Secrets should be provided via environment, not files.

## Contributing & License
MIT (see LICENSE). PRs welcome—use Conventional Commits and verify: `bun run build`, `bun test`, `bun run docs:validate`.
