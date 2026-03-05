# Bifrost Node Lifecycle and Credential Application

Last verified: 2026-02-05

## Scope
This document captures how the server creates, replaces, and monitors the Bifrost node, and how credentials, relays, and peer policies are applied from env and database sources.

## Key Files
- `src/server.ts` (startup, restart logic, `updateNode`)
- `src/node/manager.ts` (node creation, monitoring, echo, event listeners)
- `src/utils/node-lock.ts` (serialized node updates)
- `src/routes/env.ts` (env-based credential updates)
- `src/routes/user.ts` (DB credential updates)
- `src/routes/peers.ts` (peer policy updates + persistence)
- `src/node/peer-policy-store.ts` (fallback policy persistence)
- `src/util/peer-policy.ts` (sanitize + merge policy inputs)

## Credential Sources and Snapshots
- `ActiveNodeCredentials` is the canonical in-memory snapshot used for restarts: group, share, relaysEnv, peerPoliciesRaw, and source (`env` or `dynamic`).
- `buildEnvCredentialSnapshot()` pulls from `GROUP_CRED`, `SHARE_CRED`, `RELAYS`, and `PEER_POLICIES` when present.
- `activeCredentials` is updated whenever a node is started or replaced, so restart logic can reuse the last-known good credential set even if env changes later.

## Startup Behavior
- If `GROUP_CRED` and `SHARE_CRED` are present at boot, the server creates a node immediately with `createNodeWithCredentials()`.
- If no credentials exist, the server starts without a node and waits for credentials via UI/API.
- In headless mode, if `SKIP_STARTUP_ECHO=false`, the server sends a self-echo and a broadcast share echo as non-blocking connectivity signals after initial node creation.

## Node Updates and Locking
- All node creation/replacement operations are serialized with `executeUnderNodeLock()` to avoid race conditions.
- Re-entrant lock acquisition is detected using `AsyncLocalStorage` and treated as an error to prevent deadlocks.
- `updateNode()` is synchronous and is the single cleanup boundary. It calls `cleanupBifrostNode()`, resets monitoring, attaches listeners, updates `activeCredentials`, and clears restart blocked state.

## Credential Update Flows
Env/admin updates (`/api/env`, `/api/env/shares`):
- Env writes are validated and persisted to `.env`.
- Credential or relay changes trigger node recreation under the lock via `createNodeWithCredentials()`.
- The context `updateNode()` swaps the node atomically and reattaches monitoring.
- Self-echo and broadcast echo are fired after credential updates to surface relay issues without blocking the update.
- Deletions (`/api/env/delete`) call `cleanupNodeSynchronized()` which runs `updateNode(null)` under lock.

DB user updates (`/api/user/credentials`):
- GET: if stored credentials exist and the node is missing, the server auto-starts a node under the lock.
- POST/PUT: credentials are saved, then self-echo + broadcast echo are fired (non-blocking). The node is started if missing; existing nodes are not force-restarted here.
- DELETE: deletes credentials and cleans up the node under the lock.
- Relay-only updates (`/api/user/relays`) update the DB but do not restart the node. The running node keeps its current relay set until a restart occurs, so clients should expect relay changes to take effect only after reloading/restarting the node.
- Consider returning an explicit message from `/api/user/relays` so users know updates are persisted but not yet active (for example: "Relays saved; restart required to apply changes."), and document that clients should call the restart endpoint (for example `/api/node/restart`) to apply the new relays.

## Peer Policy Persistence and Application
- `PEER_POLICIES` env is JSON-parsed and normalized via igloo-core's `normalizeNodePolicies`.
- `/api/peers/*` mutates policies via `setNodePolicies()` and persists them.
- DB mode persistence uses `peer_policies` on the user record.
- Headless or unknown user persistence uses `data/peer-policies.json` fallback store.
- On node creation, fallback policies are merged into env policies using `mergePolicyInputs()`. Runtime overrides take precedence and are tagged with `source: 'runtime'`.

## Node Creation Details (`createNodeWithCredentials`)
- Relays are parsed with `getValidRelays(relaysEnv)`.
- Relay probing (kind 20004) can be skipped with `SKIP_RELAY_PROBE=true`.
- Relay probing can be deferred with `DEFER_RELAY_PROBE=true`, which runs in the background after startup.
- Connection strategy uses up to 5 attempts with `createConnectedNode()` (30s timeout, autoReconnect on).
- Progressive backoff is applied between attempts, with a final fallback to `createAndConnectNode()`.
- A SimplePool `subscribeMany` normalization patch is applied for single-filter arrays to avoid inconsistent nostr-tools behavior.
- The node client request timeout is adjusted to `getOpTimeoutMs()` (bounded) when possible.
- The node is wrapped in an instrumented proxy to track publish metrics and optionally swallow benign publish errors.
- `NODE_PUBLISH_METRICS=false` disables instrumentation.
- `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` is authoritative; `RELAY_ALLOW_BENIGN_SWALLOW` is a backward-compatibility fallback consulted only when `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` is unset (`NODE_ALLOW_BENIGN_PUBLISH_SWALLOW ?? RELAY_ALLOW_BENIGN_SWALLOW`). Any explicit value on `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` (including `true` or `false`) takes precedence. To force publish errors to surface, set `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW=false`; if `NODE_ALLOW_BENIGN_PUBLISH_SWALLOW` is unset, set `RELAY_ALLOW_BENIGN_SWALLOW=false`.
- Initial connectivity check runs after optional `INITIAL_CONNECTIVITY_DELAY` to avoid startup races.

## Monitoring and Recovery
- `setupNodeEventListeners()` wires Bifrost events, peer status tracking, and connectivity monitoring.
- Monitoring runs every 60s and checks node validity and client presence.
- Monitoring enforces idle thresholds and keepalive ping when supported.
- Monitoring evaluates relay connection status and reconnection attempts.
- After 3 consecutive failures the monitor invokes a recreate callback. Backoff in the monitor doubles up to 1 hour, with `MAX_RECREATION_ATTEMPTS=5` before requiring manual intervention.
- Server-level restarts use a separate backoff loop with env tuning.
- `NODE_RESTART_DELAY` defaults to 30s.
- `NODE_MAX_RETRIES` defaults to 5.
- `NODE_BACKOFF_MULTIPLIER` defaults to 1.5.
- `NODE_MAX_RETRY_DELAY` defaults to 300s.
- Restart uses `activeCredentials` if set, otherwise the env snapshot. If no credentials exist, restarts are blocked and logged until credentials return.

## Echo and Connectivity Signals
- `sendSelfEcho()` uses igloo-core `sendEcho()` with bounded timeouts and logs soft timeouts instead of failing the flow.
- `broadcastShareEcho()` spins up a temporary node to publish `/echo/req` to the node pubkey, then cleans up the node immediately. Relays are resolved from explicit input, env relays, group relays, and `DEFAULT_ECHO_RELAYS`.

## Event Stream and Peer Status
- Message handlers map sign/ECDH/ping tags to user-facing events and update `peerStatuses`.
- `peerStatuses` is FIFO-evicted at `MAX_PEER_STATUS_ENTRIES` to cap memory usage.
- The event stream suppresses noisy aggregation messages to keep UI logs readable.

## Shutdown
- Graceful shutdown calls `cleanupMonitoring()` and `clearCleanupTimers()`, then closes NIP-46 services and the database.
- Node cleanup is always performed via `cleanupBifrostNode()` through `updateNode()` or restart handlers.
