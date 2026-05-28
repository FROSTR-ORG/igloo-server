# User Testing

Testing surfaces, tools, and concurrency guidance for this mission.

**What belongs here:** validation surfaces, testing tools, runtime constraints, and concurrency limits.
**What does NOT belong here:** implementation details or feature-specific task steps.

---

## Validation Surface

This mission is validated primarily through API/RPC, release, and container surfaces. Browser UI validation is not the primary surface here.

### 1. Local command validators
- Surface: source repo install/test/typecheck/build/docs validation
- Tools: `bun`, `git`
- Assertions: `VAL-READY-001`, `VAL-READY-002`, parts of release assertions
- Notes: use repo-standard commands from `.factory/services.yaml`

### 2. HTTP API surface
- Surface: local DB-mode server on port `8002`
- Tools: `curl`, Bun contract tests
- Assertions: `VAL-READY-003`, `VAL-READY-004`, `VAL-NIP44-API-*`
- Notes: prefer hermetic DB-mode smoke with explicit env; do not rely on ambient credentials

### 3. NIP-46 RPC surface
- Surface: DB-mode server plus relay-backed NIP-46 session/request flow
- Tools: Bun integration tests, Nostr Connect-compatible test client, `curl` for policy/bootstrap endpoints
- Assertions: `VAL-NIP46-*`, `VAL-CROSS-001`
- Notes: use independent NIP-44 derivation via `nostr-tools`; do not use Igloo helpers as the oracle

### 4. Source release surface
- Surface: git tag / GitHub release / GHCR image publication
- Tools: `git`, `gh`, `docker`
- Assertions: `VAL-RELEASE-*`
- Notes: release verification must target the released `master` commit, not only the mission branch head

### 5. Umbrel store rollout surface
- Surface: sibling store repo plus exact released Umbrel image
- Tools: `git`, `gh`, `docker run`, `curl`
- Assertions: `VAL-UMBREL-*`, `VAL-CROSS-002`
- Notes: scope stops at store repo push; no live Umbrel device install/update in this mission

### 6. Optional live API NIP smoke
- Surface: running app with real auth + real signing-node credentials + test peer
- Tools: `bun run api:test:nip`
- Notes: only run if usable credentials exist after readiness; otherwise return to orchestrator

## Validation Concurrency

Machine profile gathered during planning:
- 18 logical CPUs
- 137,438,953,472 bytes RAM total
- Baseline memory use during dry run was roughly 43 GiB, leaving ample headroom

Even though raw CPU/RAM headroom is high, concurrency here is constrained more by isolation, fixed ports, shared DB/session state, and remote mutation than by memory.

### Command/static validation
- Surfaces: install, tests, typecheck, build, docs validation
- Max concurrent validators: **5**
- Rationale: lightweight relative to available CPU/RAM; capped conservatively to preserve headroom and reduce I/O contention

### HTTP live smoke on port 8002
- Surfaces: local readiness and API smoke against one running app instance
- Max concurrent validators: **1**
- Rationale: fixed port and shared DB-mode process

### NIP-46 relay-backed integration
- Surfaces: session/policy/request flow and RPC interop
- Max concurrent validators: **2**
- Rationale: stateful DB-mode session queue plus relay/request coupling make higher concurrency brittle even though hardware could handle more

### Release / remote mutation checks
- Surfaces: git tags, GitHub release objects, remote pushes, store repo pushes
- Max concurrent validators: **1**
- Rationale: remote mutation and shared git state must remain serialized

### Docker image boot smokes
- Surfaces: published standard image and exact store-pinned Umbrel image
- Max concurrent validators: **1**
- Rationale: fixed local port, image pulls, and container lifecycle should remain serialized for clean evidence
