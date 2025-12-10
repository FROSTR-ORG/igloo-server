# Igloo Server Umbrel Packaging Status (2025-11-21)

## Current State
- **Image availability:** `ghcr.io/frostr-org/igloo-server:umbrel-dev` now publishes on demand and contains the Umbrel-specific Dockerfile plus the new `scripts/umbrel-entrypoint.sh`.
- **Data-dir bootstrap:** The entrypoint ensures `/app/data` exists, attempts to chown/chmod it to UID/GID `1000`, and converts permission failures into warnings so the Bun process no longer crashes immediately.
- **Community store bundle:** `igloo-server-store/igloo-server/docker-compose.yml` points at the `:umbrel-dev` tag, fixes `APP_HOST` to `igloo`, and otherwise matches Umbrel’s template (named volume + app proxy overrides). Fresh installs succeed once the host volume is writable.
- **Umbrel verification:** After seeding `/home/umbrel/umbrel/app-data/igloo-server` with UID/GID `1000`, the backend runs, the proxy connects, and the UI loads on multiple clients.

## Remaining Gaps Before “zero-touch” installs
1. **Host volume ownership:** Umbrel mounts `${APP_DATA_DIR}` owned by `root:root`. Our entrypoint runs as UID `1000`, so it still cannot chown the mount on first boot; users must currently set ownership via SSH.  
   - **Current workaround (document for operators):**
     ```bash
     ssh umbrel@<umbrel-host>
     sudo mkdir -p /home/umbrel/umbrel/app-data/igloo-server/data
     sudo chown -R 1000:1000 /home/umbrel/umbrel/app-data/igloo-server
     sudo chmod 700 /home/umbrel/umbrel/app-data/igloo-server/data
     ```
     After running those commands, reinstall or restart Igloo via the Umbrel UI so Docker reattaches the now-writable volume.
   - **To print out the generated admin secret**
     ```bash
     sudo docker exec igloo-server_igloo_1 printenv ADMIN_SECRET
     ```
   - **Action to eliminate the workaround:** Start the container as `root`, run the entrypoint (which creates/chowns `/app/data`), then drop privileges (e.g., via `su-exec`/`gosu`) before launching `bun start`. This allows the container to fix permissions automatically without manual intervention while still running the app as UID `1000`.
2. **Digest pinning:** The community store bundle references `ghcr.io/frostr-org/igloo-server:umbrel-dev` without a digest. Umbrel caches tags aggressively, so installs may pull an older image if a user installed before the latest push.  
   - **Action:** After rebuilding the image with the privilege-drop fix, pin `image: ghcr.io/frostr-org/igloo-server@sha256:<digest>` in `igloo-server-store/igloo-server/docker-compose.yml`.
3. **Documentation refresh:** Update `llm/workflows/UMBREL_DEPLOYMENT.md` (and the `llm/context` plan) once the privilege-drop change lands to reflect that no SSH steps are required. Mention the new entrypoint behaviour and the pinned digest workflow.
4. **Automated workflow surface:** Once `.github/workflows/umbrel-dev.yml` merges into `master`/`develop`, document how to trigger it pre-merge (currently invisible on feature branches). Optional but removes confusion for future devs.

## Suggested Next Implementation Tasks
1. Modify `packages/umbrel/igloo/Dockerfile`:
   - Keep `USER root`.
   - Install `su-exec` (or equivalent) in production stage.
   - Update the entrypoint to `exec su-exec "${IGLOO_UID}:${IGLOO_GID}" "$@"` after fixing `/app/data`.
2. Rebuild and push `ghcr.io/frostr-org/igloo-server:umbrel-dev`, capture the digest, and pin it in the community store compose.
3. Validate on a factory-reset Umbrel that installs succeed without SSH. Capture logs/screenshots for docs.
4. Update docs + store README with troubleshooting now that the process is fully automated.

Once those steps land, Igloo Server should install from the Umbrel Community Store with no manual shell access, matching the “instantly works” bar.
