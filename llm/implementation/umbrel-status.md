# Igloo Server Umbrel Packaging Status (2025-12-12)

## Current State
- **Images:** `ghcr.io/frostr-org/igloo-server:umbrel-dev` builds via `.github/workflows/umbrel-dev.yml` (smoke-test only, no push) and `:umbrel-<version>`/`:umbrel-latest` publish via `.github/workflows/release.yml`.
- **Runtime user:** Image runs as non-root `igloo` (UID/GID 1000). Entrypoint creates `/app/data`, tries to chown/chmod 700, and logs a warning if host volume is owned by root.
- **Community store bundle:** `packages/umbrel/igloo/docker-compose.yml` points at `:umbrel-dev` tag and uses a named `app-data` volume; works when the volume is writable.
- **UI/UX:** Onboarding shows the instructions screen first; `SKIP_ADMIN_SECRET_VALIDATION=true` (default in compose) skips the admin-secret step. Configure page can reveal the admin secret for signed-in admins via `/api/env/admin-secret`.
- **CORS/WS:** `ALLOWED_ORIGINS` defaults to `@self,http://umbrel.local`; `@self` now also works when Umbrel app proxy sets `x-forwarded-host`.

## Remaining Gaps
1) **Volume ownership on fresh installs:** Umbrel mounts `${APP_DATA_DIR}` as root. Our entrypoint (running as UID 1000) cannot chown the mount, so first-boot writes may fail unless the user fixes ownership manually.
   - Current workaround (documented in `docs/DEPLOY.md`, Umbrel section):
     ```bash
     ssh umbrel@<host>
     sudo mkdir -p /home/umbrel/umbrel/app-data/igloo-server/data
     sudo chown -R 1000:1000 /home/umbrel/umbrel/app-data/igloo-server
     sudo chmod 700 /home/umbrel/umbrel/app-data/igloo-server/data
     ```
   - Proposed fix (not yet implemented): start container as root, run entrypoint to chown/chmod, then drop privileges with `su-exec`/`gosu` before `bun start`.
2) **Digest pinning:** Compose/manifest still reference the `:umbrel-dev` tag without a digest. Umbrel may cache an older tag. Need to rebuild, capture digest, and pin in `packages/umbrel/igloo/docker-compose.yml` and `umbrel-app.yml` before shipping.
3) **Docs alignment:** After privilege-drop + digest pinning land, refresh `docs/DEPLOY.md` and `packages/umbrel/igloo/README.md` to remove the SSH ownership workaround and describe the new entrypoint flow.
4) **Workflow exposure:** `umbrel-dev` GH Action only smoke-tests; no push occurs. Decide whether to push `:umbrel-dev`/commit tags from that workflow or document manual `docker buildx --push` for testers.

## Next Actions
- Update `packages/umbrel/igloo/Dockerfile` to run entrypoint as root, install `su-exec` (or `gosu`), and drop to UID/GID 1000 after fixing `/app/data` permissions.
- Rebuild and push a fresh `:umbrel-dev`, record its digest, and pin compose/manifest to `@sha256:<digest>`.
- Validate on a clean Umbrel (no pre-chown) that install succeeds without SSH. Capture logs and screenshots.
- Update docs (`docs/DEPLOY.md`, bundle README) once automation is confirmed.
