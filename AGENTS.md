# Repository Guidelines

Contributors should follow these conventions to keep the igloo-server stack predictable, testable, and secure.

## Project Structure & Module Organization
- `src/` hosts the Bun/TypeScript backend (entry `server.ts`, supporting modules in `routes/`, `util/`, `class/`, `node/`). Favor pure helpers in `util/` and import them into route handlers.
- React UI code lives in `frontend/` with shared UI under `components/` and the root `index.tsx`. Bundled assets land in `static/`; never hand-edit `static/app.js` or `static/styles.css`.
- API definitions stay in `docs/openapi.yaml`; regenerate the bundled JSON with `bun run docs:bundle` after any contract change.
- Deployment helpers reside in `scripts/` (Docker, Compose). Keep runtime secrets outside version control under `data/`.

## Build, Test, and Development Commands
- `bun run dev` watches Tailwind and frontend bundles for live editing.
- `bun run build` creates production assets; use `bun run build:dev` when readable bundles help debugging.
- `bun run start` serves the full stack at `http://localhost:8002`; set `HEADLESS=true` to skip rebuilding the UI for API-only runs.
- `bun run docs:validate` checks OpenAPI syntax prior to publishing or releasing artifacts.

## Coding Style & Naming Conventions
- TypeScript strict mode is enforced; prefer explicit types and avoid `any`. Use 2-space indentation and Unix newlines.
- Backend files adopt kebab-case (e.g., `auth-factory.ts`); React components use PascalCase (`Signer.tsx`). Functions camelCase, constants UPPER_SNAKE_CASE.
- Keep business logic pure; socket flows should call `socket.send({ id, result | error }, peer)` directly without hidden side effects.

## Testing Guidelines
- Place specs under `src/**/*.(test|spec).ts`, mirroring the production folder layout.
- Execute `bun test` locally before pushing. Cover `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*` edge cases with deterministic mocks.
- Avoid external network or key material in tests; fake inputs keep runs fast and hermetic.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) on branches like `feature/<slug>` or `fix/<slug>`.
- PRs must summarize intent, link issues, list manual verification steps, and attach UI screenshots when the frontend changes.
- Ensure CI prerequisites—`bun run build`, Docker build, and `bun run docs:validate`—are green before requesting review.

## Security & Configuration Tips
- Never commit material from `data/`; reference secrets through environment variables.
- Production requires `AUTH_ENABLED=true` and `ADMIN_SECRET` to unlock admin APIs.
- Bind to `0.0.0.0` behind TLS or a proxy. Tune `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment to match latency and security needs.
