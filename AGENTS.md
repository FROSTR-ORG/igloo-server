# Repository Guidelines

This guide keeps backend, frontend, and deployment workflows consistent. These rules apply repository‑wide.

## Project Structure & Module Organization
- Backend TypeScript in `src/`; entry `src/server.ts` registers routes from `src/routes/`.
- Shared classes `src/class/`; Node helpers `src/node/`; pure utilities `src/util/`.
- Fixtures and captured payloads live in `data/`.
- React + Tailwind UI in `frontend/`.
- Generated assets in `static/` — never edit by hand.
- Co‑locate tests with code as `feature.test.ts` or `feature.spec.ts`.

## Build, Test, and Development Commands
- `bun run dev` — concurrent backend, React, and Tailwind watch.
- `bun run build` — production bundles.
- `bun run build:dev` — readable bundles for debugging.
- `bun run start` — start packaged server; `HEADLESS=true bun run start` to skip UI assets.
- `bun test` — run backend tests.
- `bun run docs:validate` — validate the OpenAPI contract.

## Coding Style & Naming Conventions
- TypeScript strict mode; declare explicit types; avoid `any`. Keep utilities pure.
- Two‑space indentation; Unix newlines.
- `camelCase` variables; `UPPER_SNAKE_CASE` constants.
- Backend files kebab‑case (e.g., `src/routes/nip46.ts`); React components PascalCase.

## Testing Guidelines
- Prefer unit tests co‑located with subjects.
- Mock external calls to `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*`.
- Seed complex scenarios from `data/` fixtures instead of live services.
- Add targeted tests when behavior changes and monitor coverage for regressions.

## Commit & Pull Request Guidelines
- Use Conventional Commits (e.g., `feat: enforce peer policy store`) on `feature/<slug>` branches.
- PRs must explain intent, link tickets, and list verification steps: `bun run build`, `bun test`, `bun run docs:validate`.
- Include UI screenshots when frontend changes.
- Confirm no secrets or generated assets (e.g., under `static/`) are committed.

## Security & Configuration Tips
- Load secrets from environment files or `data/` fixtures; never hard‑code.
- Production: set `AUTH_ENABLED=true`, strong `ADMIN_SECRET`, and run behind TLS on `0.0.0.0`.
- Tune `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment.

