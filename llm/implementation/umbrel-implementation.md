# Umbrel Implementation (Released)

Last verified: 2026-02-05

## Scope
This document captures the working, released Umbrel packaging for Igloo Server. It reflects both the packaging inside this repo and the live Umbrel community store repo used for distribution.

## Release Artifacts
- Umbrel image is built from `packages/umbrel/igloo/Dockerfile` and published by `.github/workflows/release.yml`.
- Published tags:
  - `ghcr.io/frostr-org/igloo-server:umbrel-latest`
  - `ghcr.io/frostr-org/igloo-server:umbrel-<version>`
- The Umbrel dev workflow `.github/workflows/umbrel-dev.yml` builds and smoke-tests a local image only; it does not push.

## Umbrel Community Store Repo (Igloo Server Store)
Upstream repo: `https://github.com/frostr-org/igloo-server-store`

Key files and current state:
- `umbrel-app-store.yml`
  - Store id: `igloo`
  - Store name: `Igloo Server Store`
- `igloo-server/umbrel-app.yml`
  - `version: 1.1.1`
  - `port: 8002`, `tor: true`
  - Assets are remote URLs (icon + gallery screenshots).
  - Description calls out database mode defaults and admin secret auto-provisioning.
- `igloo-server/docker-compose.yml`
  - Image pinned to a digest (current):
    - `ghcr.io/frostr-org/igloo-server:umbrel-dev@sha256:537a21c960402f12e2157432ca91573d6155a1c17ef88a4a07e42bd839867d2f`
  - `APP_DATA_DIR` is mounted to `/app/data`.
  - `ALLOWED_ORIGINS` default includes `@self` plus `umbrel.local` variants (notably for browser WebSocket Origin checks).
  - App proxy is defined in `umbrel-app.yml` via an `app_proxy` block that points to the Igloo service/port. There is no `PROXY_AUTH_WHITELIST` env.

## Umbrel Image Implementation
Source: `packages/umbrel/igloo/Dockerfile`

Build and runtime details:
- Multi-stage build uses `oven/bun:1.1.30` and runs `bun run build` to compile frontend assets.
- Runtime stage installs `tini` and `curl`, sets `HOST_NAME=0.0.0.0`, `HOST_PORT=8002`.
- Runs as non-root user `igloo` (UID/GID 1000) and exposes port `8002`.
- Declares volume `VOLUME ["/app/data"]`.
- Entrypoint is `scripts/umbrel-entrypoint.sh`.

Entrypoint behavior (`scripts/umbrel-entrypoint.sh`):
- Ensures `/app/data` exists.
- Attempts to `chown -R 1000:1000 /app/data` and `chmod 700`.
- Logs a warning if ownership cannot be changed (for example, if the host volume is owned by root).

## Runtime Configuration (Umbrel Defaults)
These values are set in the store compose and expected by the UI flow:
- `ADMIN_SECRET` comes from Umbrel `APP_PASSWORD`.
- `SKIP_ADMIN_SECRET_VALIDATION=true` so onboarding skips the secret entry screen.
- `AUTH_ENABLED=true` and `RATE_LIMIT_ENABLED=true`.
- `TRUST_PROXY=true` for Umbrel app proxy headers.
- `DB_PATH=/app/data/igloo.db` (database mode).
- `HEADLESS=false` to serve UI assets.
- `ALLOWED_ORIGINS` defaults to `@self` plus `umbrel.local` variants; `@self` auto-allows the host users connect through for browser WebSocket Origin enforcement (host match, port-agnostic).

## Umbrel UI and Exports
- First run goes straight to account creation. The first user becomes admin.
- The Admin Secret is still visible on the Configure page for API usage.
- `packages/umbrel/igloo/exports.sh` surfaces values to Umbrel:
  - `IGLOO_ADMIN_SECRET` from `APP_PASSWORD`
  - `IGLOO_UI_URL` and `IGLOO_API_URL` from `APP_DOMAIN`
  - `IGLOO_TOR_URL` from `APP_TOR_ADDRESS`

## Operational Notes
- Healthcheck uses `curl http://localhost:8002/api/status` with retries and start period.
- The Umbrel store uses a pinned digest to avoid tag caching issues; update the digest on each new release.
- `packages/umbrel/igloo/docker-compose.yml` remains a sideload/dev bundle and still points at `:umbrel-dev` without a digest.

## Update Checklist for Future Releases
1. Build and push the new Umbrel image (`:umbrel-<version>` and `:umbrel-latest`).
2. Update `igloo-server-store/igloo-server/docker-compose.yml` to the new image digest.
3. Update `igloo-server-store/igloo-server/umbrel-app.yml` version and release notes.
4. Refresh gallery assets if the UI has changed.
