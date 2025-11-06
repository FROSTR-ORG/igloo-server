# Umbrel Deployment Guide

This guide walks through packaging, sideloading, and releasing the Umbrel edition of **igloo-server**. Follow these steps to build the Umbrel image, validate the bundle locally, and publish updates upstream.

---

## 1. Prerequisites
- Docker Engine 24+ with Buildx enabled (`docker buildx version`).
- GitHub access to `FROSTR-ORG/igloo-server` with permission to push container images to GHCR (`ghcr.io/frostr-org`).
- Umbrel dev environment or hardware device (v0.5.5+ recommended).
- Bun 1.1.x locally if you plan to run any scripts outside containers.

---

## 2. Repository Layout
- `packages/umbrel/igloo/Dockerfile`: multi-stage Bun image pinned to `oven/bun:1.1.14`, runs as non-root `igloo` (UID/GID 1000) to match Umbrel volume ownership.
- `packages/umbrel/igloo/docker-compose.yml`: reference compose file for local smoke tests and Umbrel sideloads (replace `build:` with a pinned digest before release).
- `packages/umbrel/igloo/umbrel-app.yml`: manifest metadata (`manifestVersion: 1`). Update `version`, `releaseNotes`, and image digest per release.
- `packages/umbrel/igloo/exports.sh`: exposes admin secret plus Tor/clearnet URLs to Umbrel’s dashboard.
- `packages/umbrel/igloo/assets/`: Umbrel icon (512×512 PNG) and 16:9 gallery screenshots (1024×768). Replace placeholders with real captures before shipping.

---

## 3. Build & Publish Images
GitHub Actions already handles multi-arch builds on release, but you can build locally for testing.

```bash
# Build multi-arch image (uses the Umbrel Dockerfile)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file packages/umbrel/igloo/Dockerfile \
  --tag ghcr.io/frostr-org/igloo-server:umbrel-dev \
  .
```

To push test tags (requires GHCR login):

```bash
docker login ghcr.io
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file packages/umbrel/igloo/Dockerfile \
  --tag ghcr.io/frostr-org/igloo-server:umbrel-${GIT_SHA} \
  --push \
  .
```

For official releases, trigger the **Release** workflow (`.github/workflows/release.yml`). It publishes:
- `ghcr.io/frostr-org/igloo-server:umbrel-latest`
- `ghcr.io/frostr-org/igloo-server:umbrel-<version>`

Record the resulting digest (e.g., `sha256:...`) for the manifest and compose file.

---

## 4. Prepare Bundle Artifacts
1. Update `packages/umbrel/igloo/umbrel-app.yml`:
   - Set `version` to the igloo-server tag (e.g., `0.7.0`).
   - Add concise `releaseNotes`.
   - Confirm the icon (512×512) and gallery screenshots (16:9) reflect the current UI and ensure paths match.
2. Replace `packages/umbrel/igloo/docker-compose.yml` `build:` section with the published image reference, for example:

   ```yaml
   image: ghcr.io/frostr-org/igloo-server:umbrel-0.7.0@sha256:<digest>
   ```

3. Update `exports.sh` if new environment values should appear on Umbrel’s dashboard.

---

## 5. Local Sideload Testing
### 5.1 Compose smoke test (no Umbrel)

```bash
ALLOWED_ORIGINS=http://umbrel.local \
docker compose -f packages/umbrel/igloo/docker-compose.yml up --build
```

Visit `http://localhost:8002` to confirm the UI, API (`/api/status`), and websocket events load. Stop with `Ctrl+C`.

### 5.2 Umbrel sideload
1. Copy the bundle directory to Umbrel (e.g., `scp -r packages/umbrel/igloo umbrel@umbrel.local:/home/umbrel/apps/frostr-igloo`).
2. On Umbrel, run:

   ```bash
   cd /home/umbrel/apps/frostr-igloo
   umbrel-dev tools register-app .
   umbrel-dev apps install frostr-igloo
   ```

3. Confirm:
   - First launch prompts for onboarding with `ADMIN_SECRET` set to Umbrel’s `$APP_PASSWORD`.
   - `SESSION_SECRET` auto-generates at `/app/data/.session-secret`.
   - API endpoints work via Umbrel’s proxy and Tor (`http://<tor-address>`).
   - Restart preserves SQLite state under `/app/data`.

4. Capture fresh gallery screenshots and update the PNGs if the UI changed.

---

## 6. Release Checklist
1. Create a new igloo-server tag (Conventional Commit release flow).
2. Trigger the Release GitHub Action or run the multi-arch build manually.
3. Pin `umbrel-app.yml` and `docker-compose.yml` to the pushed image digest.
4. Commit bundle updates on `feature/<slug>` branch and open PR:
   - Include verification steps (`ci.yml`, compose smoke test, Umbrel sideload proof).
   - Attach updated screenshots if the UI changed.
5. After merge, submit a PR to `getumbrel/umbrel-apps` with:
   - Bundle contents (manifest, compose, exports, docs, assets).
   - Digest references.
   - Testing notes (clearnet/Tor access, persistence, API whitelist).

---

## 7. Troubleshooting
- **CORS blocked**: ensure `ALLOWED_ORIGINS` includes Umbrel domain and Tor address. Igloo refuses wildcard (`*`) in production.
- **Database write errors**: confirm the container runs as UID/GID 1000 and `/app/data` is writable (non-root user baked into the image).
- **Session failures**: check `/app/data/.session-secret`. If missing, perms might be wrong; restart container and ensure Umbrel’s volume owner matches the igloo user.
- **Proxy auth failures**: verify `PROXY_AUTH_WHITELIST` covers `/api/*`, `/api/docs/*`, and `/api/events/*` so APIs stay reachable behind Umbrel’s auth layer.

---

## 8. Reference Commands
```bash
# Format manifest (optional)
yq e '.' packages/umbrel/igloo/umbrel-app.yml

# Validate compose file
docker compose -f packages/umbrel/igloo/docker-compose.yml config

# Curl health endpoint during tests
curl -fsS http://localhost:8002/api/status
```

---

Maintain this document as packaging requirements evolve (e.g., manifestVersion 1.1 hooks, new environment variables, or Umbrel app proxy changes). Pull requests touching the bundle should update both this guide and `llm/context/IGLOO_UMBREL_PACKAGING_PLAN.md`.
