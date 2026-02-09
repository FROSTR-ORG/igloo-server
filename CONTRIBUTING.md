# Contributing to Igloo Server

This repo has a backend (Bun + TypeScript) and a React/Tailwind UI bundled into `static/`.

Canonical contributor rules live in `AGENTS.md`. When this file and `AGENTS.md` disagree, follow `AGENTS.md`.

## Quick Links
- Configuration reference: `docs/CONFIG.md`
- Deployment guide: `docs/DEPLOY.md`
- Security guide: `docs/SECURITY.md`
- Release flow: `docs/RELEASE.md`
- API contract: `docs/openapi/openapi.yaml` (validate with `bun run docs:validate`)

## Prerequisites
- Bun (required)
- Git
- Docker (optional, for container builds/tests)

## Local Development

Install:
```bash
bun install
```

Build UI assets once (needed for first run):
```bash
bun run build
```

Run server:
```bash
bun run start
```

Frontend watch (separate terminal):
```bash
bun run dev
```

Notes:
- `bun run dev` only rebuilds `static/app.js` and `static/styles.css` (it does not start the server).
- Headless mode disables the frontend routes entirely (`HEADLESS=true`).

## Tests and Validation

```bash
# Backend tests
bun test

# TypeScript typecheck
bun run typecheck

# Validate OpenAPI spec
bun run docs:validate
```

## Docker

The repo uses a standard `Dockerfile` at the repo root:
```bash
docker build -t igloo-server .
```

If you use `compose.yml`, note it uses `env_file: .env` to inject environment variables and also mounts `.env` as a read-write volume (via `env_file: .env` plus a volume mount). For headless deployments that write config via `/api/env`, the `.env` file will persist if mounted as a volume (see `docs/CONFIG.md`).

## Coding Standards

Follow `AGENTS.md`:
- TypeScript strict mode, explicit types, avoid `any`.
- Backend files kebab-case, React components PascalCase.
- Do not hand-edit generated assets in `static/`.

## PR Checklist (What We Expect)

1. `bun run build`
2. `bun test`
3. `bun run docs:validate` (when API/doc changes)
4. If Docker-related changes: `docker build -t igloo-server .`
5. If frontend changes: include screenshots in the PR

## Release

Use `docs/RELEASE.md` (and `scripts/release.sh`) for the current release workflow.
