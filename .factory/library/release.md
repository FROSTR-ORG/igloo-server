# Release and Rollout Notes

Release-specific facts and artifact relationships for this mission.

**What belongs here:** source release flow, image lineage, store repo handoff, and rollout constraints.
**What does NOT belong here:** implementation details for route fixes.

---

## Source Release Line

- Mission work is based on `origin/dev` via local branch `mission/nip44-release`
- Current source repo version on this line is `1.2.0`
- The source release publishes from `master`, not directly from the mission branch head

## Source Release Contracts

The release worker must keep these files/facts aligned:
- `package.json`
- `CHANGELOG.md`
- `docs/openapi/openapi.yaml`
- git tag / GitHub release `v<version>`
- GHCR images for standard and Umbrel variants

Use `bun run version:check` as the first metadata consistency gate.

## Published Artifacts

Release workflow expectations:
- Standard source release assets on GitHub releases
- Standard image from the root `Dockerfile`
- Umbrel image from `packages/umbrel/igloo/Dockerfile`
- GHCR tags expected by the mission contract:
  - `ghcr.io/frostr-org/igloo-server:<version>`
  - `ghcr.io/frostr-org/igloo-server:latest`
  - `ghcr.io/frostr-org/igloo-server:umbrel-<version>`
  - `ghcr.io/frostr-org/igloo-server:umbrel-latest`

The release workflow also sets OCI labels for version and revision; workers should use those labels to verify that a published image actually corresponds to the released source commit.

## Store Repo Handoff

Store repo path:
- `/Users/plebdev/Desktop/Work/code/frostr/igloo/igloo-server-store`

Files that matter for rollout:
- `igloo-server/umbrel-app.yml`
- `igloo-server/docker-compose.yml`

Important current-state nuance discovered during planning:
- the store repo currently advertises `version: 1.1.0`
- the store compose currently points at `ghcr.io/frostr-org/igloo-server:umbrel-dev@sha256:...`

Workers must treat those as **pre-mission state**, not the intended end state. The rollout feature must derive the correct released Umbrel artifact and then make the store repo match it.

## Rollout Scope Boundary

- This mission includes updating and pushing the local sibling store repo
- This mission does **not** include installing/updating a live Umbrel node
- Local container smokes are allowed and expected for the exact released/store-pinned Umbrel image
