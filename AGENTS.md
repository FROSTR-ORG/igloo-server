# Repository Guidelines

## Project Structure & Module Organization
- `src/` – Bun/TypeScript server (`server.ts`, `routes/`, `util/`, `class/`, `node/`).
- `frontend/` – React + Tailwind UI (`index.tsx`, `components/`).
- `static/` – Built assets (`app.js`, `styles.css`). Do not edit by hand.
- `docs/` – OpenAPI spec (`openapi.yaml`, bundled JSON).
- `scripts/` – Release utilities; `compose.yml`, `dockerfile` for containers.
- `data/` – Runtime secrets/db. Never commit.

## Build, Test, and Development Commands
- `bun run dev` – Local dev: JS + CSS watch builds.
- `bun run build` – Production bundle (minified).
- `bun run build:dev` – Unminified build for easier debugging.
- `bun run start` – Start server at `http://localhost:8002`.
- `HEADLESS=true bun run start` – API‑only; skips UI build.
- `bun run docs:validate` – Lint OpenAPI; `bun run docs:bundle` emits JSON.
  - Keep `docs/openapi.yaml` in sync when adding routes (e.g., `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, `/api/nip46/*`).

## Coding Style & Naming Conventions
- Language: TypeScript (Bun). Strict `tsconfig` (no `any`; unuseds fail build).
- Indentation: 2 spaces; Unix line endings.
- Filenames: server modules kebab‑case (e.g., `auth-factory.ts`); React components PascalCase (e.g., `Signer.tsx`).
- Constants: `UPPER_SNAKE_CASE`; functions: `camelCase`.
- Prefer pure functions and explicit types; avoid side effects in `routes/*` handlers.

## Testing Guidelines
- Runner: Bun’s test runner. Place tests as `src/**/*.(test|spec).ts`.
- Until a harness is committed, verify locally: `bun run build`, `bun run start`, `bun run docs:validate`.
- Manual smoke: UI loads, `/api/status` responds, Swagger at `/api/docs` renders.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Branches: `feature/<short-name>`, `fix/<short-name>`, `hotfix/<short-name>`.
- PRs include purpose, linked issues, testing steps, and screenshots for UI changes. Update `docs/openapi.yaml` for API changes.
- CI must be green (build, Docker build, OpenAPI lint) before review.

## Security & Configuration Tips
- Never commit secrets. Keep `data/` local (e.g., `igloo.db`, `.session-secret`).
- Production: set `AUTH_ENABLED=true` and `ADMIN_SECRET`; admin APIs return 401 if unset.
- Containers: bind `0.0.0.0` and proxy behind TLS.
 - Crypto timeouts: set `FROSTR_SIGN_TIMEOUT` (or `SIGN_TIMEOUT_MS`) to bound `/api/sign`, `/api/nip44/*`, `/api/nip04/*` operations (default 30s).
 - Ephemeral derived keys: login‑derived keys are stored in a TTL + max‑reads vault (not on the session). Tune with `AUTH_DERIVED_KEY_TTL_MS` and `AUTH_DERIVED_KEY_MAX_READS`.

## Database & Migrations
- NIP‑46 persistence uses SQLite tables `nip46_sessions` and `nip46_session_events`.
- Migrations run automatically on startup from `src/db/migrations` via `schema_migrations`.
- Add new migrations as timestamped `.sql` files; they are applied once, in order.

## NIP‑46 + FROSTR Notes (2025‑09)
- Remote signing is live via NIP‑46 transport + Bifrost/FROSTR; `/api/sign` returns `{ id, signature }`.
- Do not re‑introduce helper builders for accept/reject; use `socket.send({ id, result|error }, peer)` to avoid Zod version conflicts.
- Keep client NIP‑46 traffic on URI‑provided relays; server Bifrost relays are filtered at startup. Enforce explicit permissions: allowed methods and `sign_event` kinds only.
 - Sessions are per‑client (pubkey). Policy updates affect only that session. Revocation deletes the session (not persisted).
