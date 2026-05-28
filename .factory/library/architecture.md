# Architecture

How the system works at a high level for this mission.

**What belongs here:** major components, relationships, data flows, and invariants that workers need to preserve.
**What does NOT belong here:** step-by-step task instructions, exact release commands, or port allocations.

---

## Runtime Modes

Igloo Server has two runtime modes that matter to this mission:

- **Database mode**: multi-user mode with SQLite persistence, session/API-key auth, web UI, and the NIP-46 service.
- **Headless mode**: environment-driven mode without the DB-only management surfaces.

This mission's NIP-46 work and the cross-surface validation contract depend on **database mode**. The HTTP `/api/nip44/*` routes exist in both modes, but the shared API/RPC interop proof must use one DB-mode instance because NIP-46 is only available there.

## Mission-Relevant Component Map

Workers should know the main files before changing anything:

- `src/routes/index.ts` — top-level request router and auth/mount behavior
- `src/routes/nip44.ts` — HTTP `/api/nip44/encrypt` and `/api/nip44/decrypt`
- `src/routes/crypto-utils.ts` — peer normalization and shared-secret derivation
- `src/routes/nip46.ts` — DB-mode NIP-46 HTTP/session management endpoints
- `src/db/nip46.ts` — persisted NIP-46 sessions, requests, and policy data
- `src/nip46/service.ts` — NIP-46 request processing, policy auto-approval, and `nip44_*` RPC execution
- `docs/openapi/openapi.yaml` — released HTTP API contract
- `package.json` / `CHANGELOG.md` — source release metadata
- `../igloo-server-store/igloo-server/umbrel-app.yml` — Umbrel store manifest
- `../igloo-server-store/igloo-server/docker-compose.yml` — Umbrel store image/runtime pin

## HTTP API Path

The request router in `src/routes/index.ts` applies auth and routes API traffic into focused handlers.

For the NIP-44 HTTP surface:

1. The router authenticates the request and builds a route context.
2. `src/routes/nip44.ts` validates request shape, enforces request-size and rate-limit checks, normalizes `peer_pubkey`, and requires an active signing node.
3. `src/routes/crypto-utils.ts` performs peer normalization and derives the raw shared secret (`shared_x`) from threshold ECDH.
4. The NIP-44 route must transform that raw shared secret into the **NIP-44 conversation key** before calling `nostr-tools` NIP-44 encrypt/decrypt helpers.

### Mission-critical invariant

- The value returned by threshold ECDH is **input keying material**, not the final NIP-44 conversation key.
- Only NIP-44 surfaces apply the `nip44-v2` conversation-key derivation step.
- This mission must **not** broaden into the separate NIP-04 behavior.

## NIP-46 RPC Path

`src/nip46/service.ts` runs the remote-signer request loop for NIP-46.

High-level flow:

1. A client establishes a NIP-46 session and transport.
2. Session and policy state are created/updated through `src/routes/nip46.ts` and persisted in `src/db/nip46.ts`.
3. Requests are stored/tracked, then either auto-approved by policy or held in a pending queue for manual handling.
4. `nip44_encrypt` and `nip44_decrypt` eventually call the same underlying shared-secret path used by the HTTP NIP-44 surface.
5. Responses are returned over the NIP-46 transport using the original request ID.

### Mission-critical invariants

- HTTP `/api/nip44/*` and NIP-46 `nip44_*` must derive the **same** standards-compliant NIP-44 conversation key from the same signer/peer relationship.
- Method-specific NIP-46 policy grants remain separate: `nip44_encrypt` and `nip44_decrypt` can be granted independently.
- Ungranted NIP-46 requests should remain pending until handled; they must not falsely succeed.

## Surface Contracts Workers Must Preserve

| Surface | Input shape | Output shape | Mode/auth constraints |
| --- | --- | --- | --- |
| HTTP `/api/nip44/encrypt` | JSON `{ peer_pubkey, content }` | JSON `{ result: <ciphertext> }` or JSON error | Mounted in both modes; auth-gated by router |
| HTTP `/api/nip44/decrypt` | JSON `{ peer_pubkey, content }` | JSON `{ result: <plaintext> }` or JSON error | Mounted in both modes; auth-gated by router |
| NIP-46 `nip44_encrypt` | RPC params `[peer_pubkey, plaintext]` | RPC `{ id, result }` or `{ id, error }` | DB mode only; requires a connected session and approval/policy |
| NIP-46 `nip44_decrypt` | RPC params `[peer_pubkey, ciphertext]` | RPC `{ id, result }` or `{ id, error }` | DB mode only; requires a connected session and approval/policy |
| NIP-46 `get_public_key` | no payload beyond request envelope | signer user pubkey | Used by interop harness to derive peer-side standards-compliant ciphertext |

## Shared Crypto Boundary

The shared crypto boundary for this mission is:

- `xOnly(...)` / peer normalization
- threshold ECDH shared-secret derivation
- NIP-44 conversation-key derivation

Workers should preserve these invariants:

- Accept x-only and compressed peer-key forms consistently across HTTP and NIP-46 surfaces.
- Fail fast on malformed request shapes before claiming cryptographic success.
- Keep the NIP-44 fix surgical: update only the NIP-44 paths that currently misuse the raw shared secret.
- Do not add a legacy decrypt fallback; the mission requires standards-only behavior.

## Release and Store Artifact Lineage

This mission spans two repos and two release artifacts.

### Source repo (`igloo-server`)

Target end state for this mission:

1. Work lands on the mission branch based on `origin/dev`.
2. Release preparation flows through the source repo's release process (`scripts/release.sh` and merge to `master`).
3. `.github/workflows/release.yml` publishes:
   - git tag / GitHub release
   - standard GHCR image from the root `Dockerfile`
   - Umbrel GHCR image from `packages/umbrel/igloo/Dockerfile`

Important distinction: this section describes the **intended post-mission release path**, not necessarily the current pre-mission repo/store state.

### Store repo (`igloo-server-store`)

Target end state for this mission:

1. The store repo consumes the released Umbrel artifact via `igloo-server/docker-compose.yml`.
2. The user-visible store metadata lives in `igloo-server/umbrel-app.yml`.
3. The store repo is updated only after the source release artifact exists and is verified.
4. For this mission, rollout stops at **store repo push**. It does **not** include updating a live Umbrel node.

## End-to-End Validation Shape

This mission is primarily validated through API, RPC, release, and container surfaces rather than browser UI.

Validation layers:

- **Local readiness**: install, validators, startup smoke.
- **HTTP contract tests**: `/api/nip44/*` interop and failure semantics.
- **NIP-46 integration tests**: real session/request flow plus interop and policy behavior.
- **Release verification**: tag/release/image publication and image boot smoke.
- **Store rollout verification**: exact pinned Umbrel image, manifest/compose contract, local Umbrel-image boot smoke, and store repo push.

## What Workers Should Optimize For

- Prefer the narrowest change that restores standards-compliant NIP-44 behavior.
- Reuse shared helpers so the HTTP and NIP-46 paths cannot drift.
- Treat OpenAPI, release metadata, GHCR artifacts, and store manifests as part of the shipped contract for this mission.
- Preserve DB-mode behavior and approval semantics while fixing crypto interoperability.
