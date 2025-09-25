# Repository Guidelines

## Project Structure & Module Organization
- Backend TypeScript lives in `src/`; `src/server.ts` wires routes from `src/routes/`, shared logic in `src/class/`, and node helpers in `src/node/`.
- Frontend React + Tailwind lives in `frontend/`; build artifacts land in `static/` and must not be edited manually.
- Helpers without state belong in `src/util/`; persistent fixtures and captured payloads go under `data/`.
- Place tests next to their subjects as `feature.test.ts` or `feature.spec.ts` (e.g., `src/routes/status.test.ts`).

## Build, Test, and Development Commands
- `bun run dev` — concurrent watch build for backend, React, and Tailwind during local development.
- `bun run build` — production bundles, minified JS/CSS.
- `bun run build:dev` — readable bundles for debugging deployed issues.
- `bun run start` / `HEADLESS=true bun run start` — launch the packaged server with or without UI assets.
- `bun run docs:validate` — verify the OpenAPI contract before shipping API changes.
- `bun test` — execute the Bun-powered backend suite.

## Coding Style & Naming Conventions
- TypeScript is in strict mode: declare explicit types, avoid `any`, and prefer readonly props where practical.
- Use two-space indentation, Unix newlines, camelCase variables, and UPPER_SNAKE_CASE constants.
- Backend filenames stay kebab-case (`src/routes/nip46.ts`); React components use PascalCase.
- Keep utility helpers pure; stateful logic belongs in services or classes for easier testing.

## Testing Guidelines
- Use Bun’s test runner with colocated specs; mock external calls to `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*`.
- Seed complex scenarios from `data/` fixtures instead of hitting live services.
- Run `bun test` before every push and note material coverage impacts in PRs; add scenario-focused tests when behavior changes.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (e.g., `feat: enforce peer policy store`), and branch off `main` using `feature/<slug>`.
- PRs should state intent, reference tickets, list manual verification (`bun run build`, `bun test`, `bun run docs:validate`), and include UI screenshots when relevant.
- Confirm no secrets or generated assets are committed; re-run the app in headless mode when backend-only.

## Security & Configuration Tips
- Load secrets from environment files or `data/` fixtures; never commit real credentials.
- Production deployments must set `AUTH_ENABLED=true`, a strong `ADMIN_SECRET`, and serve behind TLS on `0.0.0.0`.
- Adjust `FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`, `AUTH_DERIVED_KEY_TTL_MS`, and `AUTH_DERIVED_KEY_MAX_READS` per environment to balance responsiveness and risk tolerance.
