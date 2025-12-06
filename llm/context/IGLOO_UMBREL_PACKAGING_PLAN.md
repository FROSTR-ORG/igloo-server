# Igloo Server Umbrel Packaging Plan (Database Mode)

This document outlines the scoped deliverables, configuration defaults, and operational checklist for packaging **igloo-server** as an Umbrel application that runs in database mode by default.

---

## 1. Objectives & Deliverables
- Ship an Umbrel-ready bundle (`packages/umbrel/igloo/`) containing `Dockerfile`, `docker-compose.yml`, `umbrel-app.yml`, icons, gallery images, `README.md`, `exports.sh`, and optional health scripts.
- Publish a multi-architecture container image (`linux/amd64`, `linux/arm64`) tagged `umbrel-<version>` and pinned by digest in the manifest.
- Ensure the packaged service boots in database mode with persistent state under Umbrel’s app data directory.

- Umbrel build context lives in `packages/umbrel/igloo/Dockerfile` (multi-stage). Both stages pin to `oven/bun:1.1.30` for deterministic builds—update this value when Bun security patches are applied.
- Build stage: install dependencies with `bun install --frozen-lockfile`, copy source + frontend assets, and run `bun run build` so the runtime stage receives compiled UI artifacts.
- Runtime stage: installs only production deps, brings in build outputs, installs `tini` + `curl`, and provisions a dedicated `igloo` user (`uid:1000`, `gid:1000`) to match Umbrel volume ownership. `/app` (including `/app/data`) is owned by this user before switching via `USER`.
- Image exposes `8002`, sets `HOST_NAME`/`HOST_PORT`, declares `VOLUME /app/data`, and starts with `ENTRYPOINT ["tini","--"]` then `CMD ["bun","start"]`.
- Build & release: release workflow now builds/pushes `ghcr.io/frostr-org/igloo-server:umbrel-<version>` and `:umbrel-latest` for `linux/amd64` + `linux/arm64` via GitHub Actions (`.github/workflows/release.yml`). CI also smoke-tests the Umbrel image for regressions.

## 3. Default Environment Configuration (DB Mode)
- `HEADLESS=false` (ensures UI onboarding flow).
- Secrets:
  - `ADMIN_SECRET=$APP_PASSWORD`
  - Allow Igloo to auto-generate and persist `SESSION_SECRET` (64-hex string) at `/app/data/.session-secret`. Document optional override by hashing Umbrel’s `APP_SEED` (e.g., `SESSION_SECRET=$(echo -n "$APP_SEED" | sha256sum | cut -d' ' -f1)`).
- Security defaults: `AUTH_ENABLED=true`, `RATE_LIMIT_ENABLED=true`, `NODE_ENV=production`.
- Network: `HOST_NAME=0.0.0.0`, `HOST_PORT=8002`, `TRUST_PROXY=true` for Umbrel’s reverse proxy.
- Data persistence: `DB_PATH=/app/data/igloo.db`, mount `${APP_DATA_DIR}:/app/data`.
- CORS: set `ALLOWED_ORIGINS` to include both the clearnet host (`http://$APP_DOMAIN`) and Tor host (`http://$APP_TOR_ADDRESS`) once known; document UI steps to add more origins.
- Relays: either leave `RELAYS` empty (UI prompts configuration) or populate with a conservative starter list.

- Compose bundle lives at `packages/umbrel/igloo/docker-compose.yml`.
- `igloo` service:
  - Builds from the local Dockerfile for dev (`build.context: ../..`, `dockerfile: packages/umbrel/igloo/Dockerfile`) and tags releases as `ghcr.io/frostr-org/igloo-server:umbrel-<version>@sha256:…` for the manifest.
  - Environment: values from Section 3 plus `NODE_ENV=production`, `HEADLESS=false`, `TRUST_PROXY=true`. Umbrel injects `APP_PASSWORD`, `APP_DOMAIN`, `APP_TOR_ADDRESS`, etc.
  - Volumes: `${APP_DATA_DIR}:/app/data` (image already owns `/app` as `uid/gid 1000`).
  - Healthcheck: `curl -fsS http://localhost:8002/api/status || exit 1`.
  - Restart policy: `unless-stopped`; set `stop_grace_period: 1m`.
- `app_proxy` service:
  - Uses Umbrel’s proxy image (`${APP_PROXY_IMAGE:-ghcr.io/getumbrel/umbrel-app-proxy:latest}`), `APP_HOST=igloo`, `APP_PORT=8002`, and `PROXY_AUTH_WHITELIST=/api/*,/api/docs/*,/api/events/*` to expose APIs while keeping UI behind Umbrel auth.
- Networks: attach both services to Umbrel’s default app network and Tor network when `tor: true`.

- `manifestVersion: 1`, `id: frostr-igloo`, `name: Igloo Server`; bump to `1.1` once hook scripts ship. Manifest maintained at `packages/umbrel/igloo/umbrel-app.yml`.
- Metadata:
  - `version`: matches igloo-server release tag (e.g., `0.6.0`).
  - `tagline`, `description`, `license: MIT`, `developer: FROSTR`.
  - `category`: `bitcoin`, `lightning`.
- UI routing: `path: ""` to land on Igloo dashboard.
- Authentication: `defaultPassword: $APP_PASSWORD` (surface admin secret to user).
- Tor support: `tor: true`.
- Assets: reference packaged icon (512×512 PNG) and gallery screenshots (16:9, 1024×768).
- `releaseNotes`: summarize changes per release.
- Optional fields: `deterministic: true` once releases stabilize; `dependencies` if future Umbrel services are required.

## 6. Exports, Docs, and UX Hooks
- `exports.sh` (`packages/umbrel/igloo/exports.sh`): surfaces admin secret and clearnet/Tor URLs for Umbrel’s dashboard:
  ```
  IGLOO_ADMIN_SECRET=$APP_PASSWORD
  IGLOO_UI_URL=http://$APP_DOMAIN
  IGLOO_API_URL=http://$APP_DOMAIN/api
  IGLOO_TOR_URL=http://$APP_TOR_ADDRESS
  ```
- Umbrel’s dashboard already surfaces the clearnet URL, so no additional exports are required beyond the essentials above.
- `README.md` (`packages/umbrel/igloo/README.md`): installation walkthrough, first-login instructions, relay setup, API key management, backup guidance for `/app/data`, and upgrade steps.
- `check.sh` (optional): validate permissions on `/app/data` and confirm `HEADLESS=false`.

## 7. Testing & Verification
- Local QA:
  - Sideload the Umbrel app bundle into a development Umbrel instance.
  - Confirm first-run onboarding, admin creation via `APP_PASSWORD`, relay configuration, API endpoints (REST + WebSocket), persistence after restart, and Tor reachability.
- Automated CI:
  - Lint manifest against Umbrel schema.
  - Run `docker compose config` validation.
  - Execute backend tests (`bun test`) and a smoke test (`curl /api/status`) against the built image.
- Security review:
  - Verify TLS headers/cookies when proxied.
  - Ensure CORS adheres to configured origins.
  - Confirm admin setup requires the surfaced secret.

- Tag igloo-server release and update Umbrel bundle version, release notes, and image digest.
- Release workflow publishes both the core image and Umbrel-specific tags (`umbrel-<version>`, `umbrel-latest`); ensure `umbrel-app.yml` references the pushed digest.
- Publish container manifest, run CI release pipeline, upload icons/screenshots if changed, and sign release artifacts (image digest, bundle archive) with GPG for downstream verification.
- Open PR to `getumbrel/umbrel-apps` including:
  - Verification steps: build logs, digests, QA checklist results.
  - Summary of defaults (DB mode, auth on).
- Maintain internal changelog entries and track Umbrel user feedback for future updates (e.g., optional headless mode toggle or advanced relay presets).

---

**Next Implementation Steps**
1. Keep `packages/umbrel/igloo/assets/` updated with current icon/gallery captures (refresh when the UI changes).
2. Pin `docker-compose.yml` and `umbrel-app.yml` to the published image digest during release and document the update process.
3. Run local Umbrel sideload tests using `packages/umbrel/igloo/docker-compose.yml` before submitting to the Umbrel app store.
