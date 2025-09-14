# Repository Guidelines

Use this guide when contributing to igloo-server. Keep changes small, focused, and production-safe.

## Project Structure & Module Organization
- `src/` – Bun/TypeScript server code (`server.ts`, `routes/`, `util/`, `class/`, `node/`).
- `frontend/` – React + Tailwind UI (`index.tsx`, `components/`).
- `static/` – Built assets (`app.js`, `styles.css`). Do not edit by hand.
- `docs/` – OpenAPI spec (`openapi.yaml`, bundled JSON).
- `scripts/` – release utilities; `compose.yml`, `dockerfile` for containers.
- `data/` – runtime secrets/db; never commit.

## Build, Test, and Development Commands
- `bun run dev` – Local dev: JS + CSS watch builds.
- `bun run build` – Production bundle (minified JS/CSS).
- `bun run build:dev` – Unminified build (easier debugging).
- `bun run start` – Start server on `http://localhost:8002`.
- `HEADLESS=true bun run start` – API-only mode; skips UI build.
- `bun run docs:validate` – Lint OpenAPI; `bun run docs:bundle` to emit JSON.

## Coding Style & Naming Conventions
- Language: TypeScript (Bun). Strict mode enforced by `tsconfig.json` (no `any`, unuseds fail build).
- Indentation: 2 spaces; Unix line endings.
- Filenames: server modules kebab-case (`auth-factory.ts`), React components PascalCase (`Signer.tsx`).
- Constants: `UPPER_SNAKE_CASE`; functions: `camelCase`.
- Prefer pure functions and explicit types; avoid side effects in `routes/*` handlers.

## Testing Guidelines
- No unit test harness is committed yet. Before PRs: verify `bun run build`, `bun run start`, and `bun run docs:validate` pass.
- If adding tests, use Bun’s test runner (`bun test`) and place files as `src/**/*.(test|spec).ts`.
- Manual checklist: UI loads, `/api/status` responds, Swagger at `/api/docs` renders.

## Commit & Pull Request Guidelines
- Commits follow Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`.
- Branch naming: `feature/<short-name>`, `fix/<short-name>`, `hotfix/<short-name>`.
- PRs must include: purpose, linked issues, testing steps, and screenshots for UI changes. Update `docs/openapi.yaml` when API changes.
- CI must be green (build, Docker build, OpenAPI lint) before review.

## Security & Configuration Tips
- Never commit secrets. `data/` (e.g., `igloo.db`, `.session-secret`) stays local.
- Production requires auth: set `AUTH_ENABLED=true`; keep `ADMIN_SECRET` set (admin APIs return 401 if unset).
- For containers, expose `0.0.0.0` and use a reverse proxy with TLS.

## NIP‑46 + FROSTR: Current State (2025‑09)

The remote signing flow is implemented and working end‑to‑end using NIP‑46 for transport and FROSTR/Bifrost for threshold signing. This section documents what’s live now and how to work on it safely.

### What Works
- Client connection via `nostrconnect://` URIs (client‑initiated):
  - We subscribe to the client’s relays and send `accept(secret)` back to the client pubkey.
  - Sessions appear as Pending and flip to Active on first real request (connect/get_public_key/sign_event).
- Request handling and permissions:
  - UI shows incoming requests and enforces baseline policy (methods + explicit kinds for `sign_event`).
  - Approvals update policy and future requests can auto‑approve when allowed by policy.
  - Manual “bounced” handling: if the upstream lib rejects a message due to schema issues, we decrypt and process it anyway (no user‑visible errors).
- Signing path (FROSTR threshold):
  - `frontend` delegates signing to `/api/sign` with the event id (hash).
  - Server calls Bifrost (`node.req.sign`) and returns a valid schnorr signature hex.
  - Clients receive a proper Nostr signature and mark success.

### Architecture Snapshot
- Transport signer: ephemeral `SimpleSigner` used only for NIP‑44 message encryption.
- Identity signer: `ServerSigner` delegates to API endpoints (`/api/sign`, `/api/nip44/*`, `/api/peers/group`).
- Relay hygiene:
  - NIP‑46 replies are sent back on the relays provided in the `nostrconnect://` string.
  - Server‑side Bifrost relays are filtered at startup to exclude relays that block kind 20004.
  - Per‑relay publish rejections are logged but never crash the process.

### Notable Implementation Details
- Controller (`frontend/components/nip46/controller.ts`):
  - Uses `SignerAgent` + direct socket handlers.
  - Avoids upstream Zod helper functions to prevent v3/v4 conflicts; we craft `{ id, result|error }` messages and send via `socket.send()`.
  - On `socket.error` with “_parse is not a function”, we ignore the noise and rely on the `bounced` path.
- Server hardening (`src/server.ts`, `src/node/manager.ts`):
  - Global rejection guards and a SimplePool publish shim prevent fatal exits when a relay returns `OK false`.
  - Startup self‑test filters server relays that reject kind 20004 (Bifrost payloads).
- `/api/sign` response shape fixed (`src/routes/sign.ts`):
  - Parses Bifrost’s signature entries `[[hash, pubkey, signature]]` and returns `{ id, signature }` with the correct hex for the requested id.

### Known Gaps / Next Steps
- Persistence
  - Persist NIP‑46 session state (active/pending + policy) so sessions survive page reloads/server restarts.
  - Persist permission updates per session (approved kinds/methods) and restore on load.
- Polish
  - Add a small “NIP‑46 Debug” toggle to display decoded invite, relays used, and per‑relay join status in the UI.
  - Improve empty/error states in Sessions/Requests and surface concise failure reasons from the server.
  - Optional: strict server relay mode (fail fast with a clear list when all configured relays block kind 20004).
- Tests
  - Add smoke tests for `/api/sign` to validate signature extraction (array → hex) and error cases.
  - Add a minimal E2E harness for a mocked NIP‑46 client to exercise connect + sign_event flows.

### Contributing Guidelines (NIP‑46 Area)
- Do not re‑introduce library helper calls that construct accept/reject messages; use `socket.send({ id, result|error }, peer)` to avoid Zod version conflicts.
- When changing relays:
  - Keep client NIP‑46 traffic on the URI‑provided relays.
  - Keep Bifrost relays free of NIP‑46‑only policy relays; rely on the startup filter.
- Maintain policy defaults: methods allowed explicitly; `sign_event` kinds must be explicitly allowed.
- Keep changes minimal and production‑safe; verify `bun run build`, `bun run start`, and basic connect/sign flows in UI before opening a PR.
