# Repository Guidelines

This guide keeps backend, frontend, and deployment workflows consistent for this repo. Follow these rules for all contributions.

## Project Structure & Module Organization
- Backend TypeScript in `src/`; entry `src/server.ts` registers routes from `src/routes/`.
- Shared classes `src/class/`; Node helpers `src/node/`; pure utilities `src/util/`.
- React + Tailwind UI in `frontend/`.
- Fixtures and captured payloads in `data/`.
- Generated assets in `static/` — never edit by hand.
- Co‑locate tests with code as `feature.test.ts` or `feature.spec.ts`.

## Build, Test, and Development Commands
- `bun run dev` — run backend, React, and Tailwind in watch mode.
- `bun run build` — create production bundles.
- `bun run build:dev` — readable bundles for debugging.
- `bun run start` — start packaged server; use `HEADLESS=true bun run start` to skip UI assets.
- `bun test` — run backend tests.
- `bun run docs:validate` — validate the OpenAPI contract.

## Coding Style & Naming Conventions
- TypeScript strict mode; declare explicit types; avoid `any`. Keep utilities pure.
- Indentation: two spaces; Unix newlines.
- Names: `camelCase` variables; `UPPER_SNAKE_CASE` constants.
- Files: backend files kebab‑case (e.g., `src/routes/nip46.ts`); React components PascalCase.

## Testing Guidelines
- Prefer unit tests co‑located with subjects; name `*.test.ts` or `*.spec.ts`.
- Mock external calls to `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*`.
- Seed complex scenarios from `data/` fixtures instead of live services.
- Add targeted tests when behavior changes and monitor coverage for regressions.

## Commit & Pull Request Guidelines
- Use Conventional Commits (e.g., `feat: enforce peer policy store`) on `feature/<slug>` branches.
- PRs must explain intent, link tickets, and list verification steps: `bun run build`, `bun test`, `bun run docs:validate`.
- Include UI screenshots when frontend changes.
- Confirm no secrets or generated assets (anything under `static/`) are committed.

## Security & Configuration Tips
- Load secrets from environment files or `data/` fixtures; never hard‑code.
- Production: set `AUTH_ENABLED=true`, strong `ADMIN_SECRET`, and run behind TLS on `0.0.0.0`.
- Tune `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment.

