# Igloo Server Umbrel Bundle

This directory contains the Umbrel-specific packaging assets for deploying Igloo Server in database mode.

## Contents
- `Dockerfile`: multi-stage Bun image that builds frontend assets and runs as the non-root `igloo` user.
- `docker-compose.yml`: local bundle for development/sideload testing; release versions should pin the image digest.
- `umbrel-app.yml`: Umbrel application manifest metadata.
- `exports.sh`: surfaces key runtime details (admin secret, clearnet/Tor URLs) to the Umbrel dashboard.
- `assets/`: placeholder icon and gallery images – replace with real captures before release.

## Release Checklist
1. Build and publish multi-architecture images using `docker buildx bake` or the GitHub Actions release workflow:
   - `ghcr.io/frostr-org/igloo-server:umbrel-latest`
   - `ghcr.io/frostr-org/igloo-server:umbrel-<version>`
2. Update `umbrel-app.yml` with the new semantic `version`, release notes, and pinned image digest.
3. Replace the placeholder artwork in `assets/` with final 512×512 icon and 1024×768 gallery captures.
4. Regenerate `exports.sh` output examples if URLs change (e.g., when exposing new endpoints).
5. Run the Umbrel sideload smoke tests via `docker-compose -f packages/umbrel/igloo/docker-compose.yml up` on an Umbrel dev kit.

## Notes
- Igloo automatically generates `SESSION_SECRET` under `/app/data/.session-secret`; the image owns `/app` as UID/GID 1000 to match Umbrel volumes.
- Set `ALLOWED_ORIGINS` to match the Umbrel domain and Tor address once known. The compose file defaults to `http://umbrel.local` for local testing.
- When submitting upstream, replace the build args in `docker-compose.yml` with the published image digest and strip the `build:` section.
