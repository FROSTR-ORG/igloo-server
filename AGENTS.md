# Repository Guidelines

Use this guide to onboard quickly and keep the codebase consistent across backend, frontend, and deployment workflows.

## Project Structure & Module Organization
Backend TypeScript lives in `src/`; `src/server.ts` registers routes from `src/routes/`, shared classes sit in `src/class/`, and node helpers live in `src/node/`. Utilities without state belong in `src/util/`, while fixtures and captured payloads stay in `data/`. The React + Tailwind UI resides in `frontend/`; generated assets flow into `static/` and must never be edited by hand. Co-locate tests with their subjects as `feature.test.ts` or `feature.spec.ts`.

## Build, Test, and Development Commands
Use `bun run dev` for the concurrent backend, React, and Tailwind watch loop. Run `bun run build` for production bundles and `bun run build:dev` when you need readable output to debug. Launch the packaged server with `bun run start` or `HEADLESS=true bun run start` to skip UI assets. Validate the OpenAPI contract via `bun run docs:validate` before shipping API changes.

## Coding Style & Naming Conventions
TypeScript runs in strict mode—declare explicit types and avoid `any`. Keep utility helpers pure to ease testing. Follow two-space indentation, Unix newlines, camelCase variables, and UPPER_SNAKE_CASE constants. Name backend files in kebab-case (e.g., `src/routes/nip46.ts`) and React components in PascalCase.

## Testing Guidelines
Execute backend tests with `bun test`. Mock external calls to `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*`. Seed complex scenarios from `data/` fixtures rather than live services. Add targeted tests when behavior changes and watch coverage for regressions.

## Commit & Pull Request Guidelines
Use Conventional Commits (e.g., `feat: enforce peer policy store`) on `feature/<slug>` branches. PRs should explain intent, reference tickets, and list manual verification steps such as `bun run build`, `bun test`, and `bun run docs:validate`. Include UI screenshots when frontend code changes and confirm no secrets or generated assets are committed.

## Security & Configuration Tips
Load secrets from environment files or `data/` fixtures. Production deployments must set `AUTH_ENABLED=true`, a strong `ADMIN_SECRET`, and run behind TLS on `0.0.0.0`. Tune `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment to balance responsiveness and risk.
