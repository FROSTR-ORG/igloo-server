# Repository Guidelines

## Project Structure & Module Organization
- `src/` — Bun/TypeScript server (`server.ts`, `routes/`, `util/`, `class/`, `node/`).
- `frontend/` — React + Tailwind UI (`index.tsx`, `components/`).
- `static/` — Built assets (`app.js`, `styles.css`). Do not edit by hand.
- `docs/` — OpenAPI spec (`openapi.yaml` + bundled JSON).
- `scripts/` — Release utilities; containers (`compose.yml`, `dockerfile`).
- `data/` — Runtime secrets/db (local only; never commit).

## Build, Test, and Development Commands
- `bun run dev` — Local dev: JS + CSS watch builds.
- `bun run build` | `bun run build:dev` — Production | unminified bundles.
- `bun run start` — Start server at `http://localhost:8002`.
- `HEADLESS=true bun run start` — API‑only; skips UI build.
- `bun run docs:validate` — Lint OpenAPI; `bun run docs:bundle` emits JSON.
- `bun test` — Run Bun tests in `src/**/*.(test|spec).ts`.

## Coding Style & Naming Conventions
- Language: TypeScript (Bun). Strict `tsconfig` (no `any`; unuseds fail).
- Indentation: 2 spaces; Unix line endings.
- Filenames: server modules kebab‑case (e.g., `auth-factory.ts`); React components PascalCase (e.g., `Signer.tsx`).
- Naming: constants `UPPER_SNAKE_CASE`; functions `camelCase`.
- Prefer pure functions and explicit types; avoid side effects in `routes/*` handlers.

## Testing Guidelines
- Runner: Bun’s test runner.
- Test files: `src/**/*.(test|spec).ts`.
- Expectations: keep fast and deterministic; include edge cases for `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, `/api/nip46/*`.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Branches: `feature/<short-name>`, `fix/<short-name>`, `hotfix/<short-name>`.
- PRs: purpose, linked issues, testing steps, and screenshots for UI changes. Update `docs/openapi.yaml` for API changes.
- CI must be green (build, Docker build, OpenAPI lint) before review.

## Security & Configuration Tips
- Never commit secrets; keep `data/` local (e.g., `igloo.db`, `.session-secret`).
- Production: set `AUTH_ENABLED=true` and `ADMIN_SECRET`; admin APIs return `401` if unset.
- Bind `0.0.0.0` behind TLS/proxy. Crypto timeouts: `FROSTR_SIGN_TIMEOUT` or `SIGN_TIMEOUT_MS`.
- Ephemeral derived keys: tune `AUTH_DERIVED_KEY_TTL_MS` and `AUTH_DERIVED_KEY_MAX_READS`.

## Database & Migrations
- SQLite tables: `nip46_sessions`, `nip46_session_events`.
- Migrations: `src/db/migrations/*.sql` (timestamped); auto‑applied once, in order.

## NIP‑46 + FROSTR Notes
- Remote signing via NIP‑46 + Bifrost/FROSTR; `/api/sign` returns `{ id, signature }`.
- Use `socket.send({ id, result|error }, peer)`; do not re‑introduce helper builders.
- Keep client NIP‑46 traffic on URI relays; enforce allowed methods and `sign_event` kinds. Sessions are per‑client (pubkey); revocation deletes session.
