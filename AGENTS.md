# Repository Guidelines

## Project Structure & Module Organization
- Backend lives in `src/` with entrypoint `server.ts`; group route handlers under `routes/`, pure helpers in `util/`, and shared classes in `class/` or `node/`.
- React UI resides in `frontend/` (`index.tsx`, `components/`, `styles/`); compiled assets write to `static/`—do not edit generated files like `static/app.js` or `static/styles.css`.
- API contracts sit in `docs/openapi.yaml`; regenerate bundled JSON via `bun run docs:bundle` after spec changes.
- Deployment assets (Docker, Compose) are under `scripts/`; secrets remain outside the repo in `data/` or environment variables.

## Build, Test, and Development Commands
- `bun run dev` watches Tailwind and frontend bundles for live editing.
- `bun run build` creates production JS/CSS; use `bun run build:dev` when readable assets help debugging.
- `bun run start` launches the full stack on `http://localhost:8002`; set `HEADLESS=true` to skip UI builds for API-only runs.
- `bun test` executes backend specs; keep runs hermetic and deterministic.
- `bun run docs:validate` lints the OpenAPI definition before publishing artifacts.

## Coding Style & Naming Conventions
- TypeScript strict mode is enabled; prefer explicit types and avoid `any`.
- Use 2-space indentation, Unix line endings, camelCase functions, and UPPER_SNAKE_CASE constants.
- Backend filenames use kebab-case (e.g., `auth-factory.ts`); React components use PascalCase (`Signer.tsx`).
- Keep backend logic pure where possible; socket flows should call `socket.send({ id, result | error }, peer)` directly.

## Testing Guidelines
- Place specs under `src/**/*.(test|spec).ts`, mirroring the production structure.
- Cover `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*` edge cases with mocked inputs—no external network calls.
- Run `bun test` before pushing; add targeted fixtures to keep tests fast and deterministic.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (e.g., `feat: add signer session store`); branch names like `feature/<slug>`.
- PR descriptions should state intent, link issues, and list manual verification steps; include UI screenshots when frontend changes.
- Ensure `bun run build`, Docker builds, and `bun run docs:validate` succeed before requesting review.

## Security & Configuration Tips
- Keep secrets out of version control; reference through environment variables or `data/` mounts.
- Production requires `AUTH_ENABLED=true` and `ADMIN_SECRET` for admin APIs; bind services to `0.0.0.0` behind TLS or a proxy.
- Tune `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment to balance latency and security.
