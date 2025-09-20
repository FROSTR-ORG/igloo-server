# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the Bun/TypeScript backend (`server.ts`, `routes/`, `util/`, `class/`, `node/`). Keep handlers pure and reuse helpers from `util/` when possible.
- `frontend/` contains the React + Tailwind UI (`index.tsx`, `components/`). Build artifacts land in `static/`; never edit `static/app.js` or `static/styles.css` by hand.
- API definitions live in `docs/openapi.yaml` with bundled JSON; update both when endpoints change.
- Deployment helpers reside in `scripts/` (e.g., `compose.yml`, `dockerfile`). Runtime secrets stay in `data/` and must not be committed.

## Build, Test, and Development Commands
- `bun run dev` — watch mode for server, UI, and styles; ideal for active development.
- `bun run build` / `bun run build:dev` — production vs. readable bundles. Run before shipping to catch bundler regressions.
- `bun run start` — serves the full stack at `http://localhost:8002`; use `HEADLESS=true bun run start` for API-only.
- `bun run docs:validate` and `bun run docs:bundle` — lint OpenAPI and regenerate JSON artifacts.

## Coding Style & Naming Conventions
- TypeScript with strict `tsconfig`; avoid `any` and eliminate unused values. Modules use 2-space indentation and Unix line endings.
- Backend filenames are kebab-case (`auth-factory.ts`); React components use PascalCase (`Signer.tsx`). Functions are camelCase, constants UPPER_SNAKE_CASE.
- Keep business logic in pure functions. socket operations should call `socket.send({ id, result|error }, peer)` directly.

## Testing Guidelines
- Use Bun’s built-in runner: `bun test`. Spec files live under `src/**/*.(test|spec).ts`.
- Cover edge cases for `/api/sign`, `/api/nip44/*`, `/api/nip04/*`, and `/api/nip46/*`. Prefer fast, deterministic mocks over network calls.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Branch off `feature/<short-name>` or `fix/<short-name>`.
- PRs must describe intent, link issues, and attach UI screenshots when applicable. Confirm CI (build, Docker build, OpenAPI lint) is green.

## Security & Configuration Tips
- Never commit keys from `data/`. Production runs require `AUTH_ENABLED=true` and `ADMIN_SECRET` to avoid `401` on admin APIs.
- Bind to `0.0.0.0` behind TLS or a proxy. Tune signing timeouts (`FROSTR_SIGN_TIMEOUT`, `SIGN_TIMEOUT_MS`) and ephemeral key TTLs (`AUTH_DERIVED_KEY_TTL_MS`, `AUTH_DERIVED_KEY_MAX_READS`).
