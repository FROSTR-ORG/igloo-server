# NIP-46 Refactor Design and Implementation Guide

This document is a complete, end‑to‑end map of our NIP‑46 implementation as it exists on this branch, plus a concrete refactor plan to accommodate upstream DB schema and API changes. It is intended as an engineering guide for maintainers.

## 1) System Overview
- Dual‑key model:
  - Transport keypair: Ephemeral/persistent key used only for NIP‑44 encryption of NIP‑46 messages (client ↔ signer). Implemented via `SimpleSigner` in nostr‑connect.
  - Identity key: FROSTR group public key (threshold identity). All signing and ECDH happen server‑side via Bifrost/igloo‑core; private shares never exist in the browser.
- Major modules:
  - Frontend orchestrator: `frontend/components/nip46/controller.ts` (NIP46Controller)
  - Frontend identity signer: `frontend/components/nip46/server-signer.ts` (delegates to HTTP)
  - Requests UI: `frontend/components/nip46/Requests.tsx`
  - Sessions UI: `frontend/components/nip46/Sessions.tsx` (+ `Permissions.tsx`)
  - Server routes: `src/routes/sign.ts`, `src/routes/nip44.ts`, `src/routes/peers.ts` (group info)

## 2) Transport & Protocol Flow (NIP‑46)
- Library: `@cmdcode/nostr-connect` (client side only here).
- Important behavior: We intentionally bypass strict Zod validation by handling all inbound protocol payloads from the library’s `socket.on('bounced')` event, then:
  1) Decrypt with transport key via NIP‑44.
  2) Parse JSON‑RPC envelope `{ id, method, params }`.
  3) Route methods: `connect`, `get_public_key`, `sign_event`, `nip44_encrypt`, `nip44_decrypt`, `ping`.
  4) Send responses directly via `client.socket.send(...)`.
- Session lifecycle (current):
  - Client‑initiated: paste/scan `nostrconnect://...` → decode → subscribe to client relays → register pending session → send immediate secret echo/ack → move to active on first request or on explicit `connect` ack.
  - Signer‑initiated: we can generate a `bunker://pubkey?relay=...` URL from the transport key for clients to connect.

## 3) Identity & Crypto Flow (FROSTR)
- Identity pubkey: fetched from server: `GET /api/peers/group` → compressed secp (02/03 + X) → convert to 32‑byte X for Nostr.
- Signing: `POST /api/sign { message: <32‑byte event id hex> }` → Bifrost `req.sign` → aggregated Schnorr signature returned.
- NIP‑44 (ECDH): `POST /api/nip44/{encrypt|decrypt} { peer_pubkey, content }` → Bifrost `req.ecdh` → derive conversation key → nostr‑tools nip44.{encrypt|decrypt}.
- Timeouts: `FROSTR_SIGN_TIMEOUT` (ms) used for both sign and ecdh wrappers.

## 4) Permissions & Approvals
- Policy shape (`frontend/components/nip46/types.ts`):
  - `methods: Record<string, boolean>`
  - `kinds: Record<string, boolean>` (explicit allow; default‑deny).
- Enforcement path: inside NIP46Controller → `handleRequestApproval` checks method/kind; if denied → request retained with `deniedReason` for UI approval.
- UX accelerators: Requests view supports approve/deny all; “Approve All Kind X” also updates the session’s `policy.kinds[k] = true` to reduce future prompts.

## 5) Code Map (where things happen)
- Session plumbing: maintained inside nostr‑connect in memory (pending/active) plus permission `policy` we mutate.
- Request queue: `pendingRequests: Map<string, any>` in controller; events: `request:new|approved|denied`.
- Identity signer: `ServerSigner` implements the library SignerDeviceAPI, but every method calls server routes; it also converts compressed → nostr pubkey.
- Server APIs used by the frontend: `/api/peers/group`, `/api/sign`, `/api/nip44/encrypt`, `/api/nip44/decrypt`.

## 6) Error Model & Edge Cases
- Library schema mismatch: handled via `socket.on('bounced')` manual processing.
- Partial relay connectivity: we race a connect with timeout; proceed best‑effort and still subscribe/send.
- Idempotency: requests identified by JSON‑RPC `id`; we don’t persist dedupe keys yet.
- Missing params/bad JSON: respond with `{ result: null, error: <reason> }` and keep UI state consistent.
- Long‑running FROSTR ops: wrapped with timeout and user logs.

## 7) Current Data Model (Ephemeral)
- Sessions: maintained by nostr‑connect in memory (pending/active) plus permission `policy` we mutate.
- Requests: ephemeral in `pendingRequests` Map.
- No DB persistence on this branch.

## 8) Refactor Targets (to absorb upstream DB/API changes)
Introduce thin, testable seams so storage and API surface can change without touching UI/business logic.

- Storage adapters (frontend):
  - `SessionStore` interface (get/add/update/revoke, list active/pending, persist policy). Default: in‑memory proxy over nostr‑connect; DB variant: REST client to new backend endpoints.
  - `RequestQueue` interface (enqueue, getAll, resolve, reject). Default: local Map; DB variant: persisted queue.
- Server API client:
  - `SignerApi` wrapper with typed methods: `getGroupInfo()`, `sign(id)`, `nip44.encrypt()`, `nip44.decrypt()`; one place to map changed endpoints/fields.
- Protocol boundary:
  - `Nip46Transport` abstraction that encapsulates: subscribe/unsubscribe, send, decrypt/encrypt, and session activation flow. Keep the current nostr‑connect usage behind this.
- Policy engine:
  - Extract policy checks into `PolicyEvaluator` with pure functions (`isMethodAllowed`, `isKindAllowed`). Isolate default‑deny and future rules (rate limits, wildcards, scopes).
- Event bus:
  - Local `Emitter` already exists; formalize event names in a `types.ts` union for compile‑time safety.

Result: swapping DB schema or server endpoints only touches `SignerApi` and the adapter implementations, not UI components or protocol logic.

## 9) Proposed Persistent Schema (backend‑oriented)
- `sessions` (session_pubkey PK, created_at, profile {name,url,image}, status enum, last_seen_at)
- `session_policies` (session_pubkey FK, method -> bool map, kinds -> bool map, updated_at)
- `requests` (id PK, session_pubkey FK, method, payload JSON, status enum[pending|approved|denied|sent], denied_reason, created_at, resolved_at)
- Indexes: `sessions(status)`, `requests(status, created_at)`, GIN on JSON columns if used.
- Migration strategy: seed active/pending from memory on startup (temporary) or introduce POST endpoints the frontend calls when sessions appear.

## 10) Endpoint Compatibility Layer
If upstream changes routes/shapes, adapt in `SignerApi` only. Expected methods and suggested fallbacks:
- `getGroupInfo(): { pubkey, threshold?, totalShares? }` → can accept `{ group_pubkey }` and normalize.
- `sign(eventId): { signature }` → if upstream moves to `{ signatures: [[id,pubkey,sig], ...] }`, select the matching id.
- `nip44.{encrypt|decrypt}(peer_pubkey, content) → { result }` → support `{ ciphertext|plaintext }` as alternates.
- Return unified `SignerError { code, message, retriable? }` for UI logic.

## 11) Sequence Diagrams (text)
- Connect (client‑initiated):
  1) User scans `nostrconnect://...` → Controller decodes token → subscribes to client relays.
  2) Controller registers pending session → sends connect response (secret echo or ack) via `socket.send`.
  3) On first request or ack, move session to active → emit `session:active`.
- Sign Event:
  1) Client → NIP‑46 request `sign_event(eventJSON)` (encrypted NIP‑44) → arrives as `bounced`.
  2) Controller decrypts → policy check; if blocked, queue for approval.
  3) If allowed/approved: build Nostr event id → `POST /api/sign` → receive Schnorr signature.
  4) Controller replies `{ id, result: signedEvent }` → UI marks approved.
- NIP‑44 Encrypt/Decrypt: same as above but call `/api/nip44/*` with ECDH derived by Bifrost.

## 12) Testing Plan (pre‑ and post‑refactor)
- Unit (frontend):
  - `PolicyEvaluator` pure tests.
  - `ServerSigner` with `fetch` mocked: sign success, nip44 paths, error surfaces.
  - `SignerApi` adapter contract against multiple fixture shapes.
- Integration (headless):
  - Start server; run scripted `connect → sign → decrypt/encrypt → revoke` flow.
  - Timeouts: simulate FROSTR peer absence and assert error messages.
- UI: Cypress/Playwright happy‑path for Sessions/Requests tabs; QR scanning stub.

## 13) Refactor Steps (incremental)
1. Introduce `SignerApi` client and switch `ServerSigner` to use it (no behavior change).
2. Extract `PolicyEvaluator` and replace inline checks.
3. Introduce `Nip46Transport` wrapper over nostr‑connect; move `bounced` logic inside.
4. Add `SessionStore` + `RequestQueue` interfaces with in‑memory adapters; route controller calls through them.
5. Land backend persistence endpoints (or align with upstream), then add DB‑backed adapters without changing UI.
6. Add telemetry hooks (see below) and error taxonomy.

## 14) Observability & Telemetry
- Add `debug` channels for: transport, policy, api, crypto, session.
- Correlate requests with `{ rpcId, session_pubkey }` in logs.
- Count metrics: `requests_total{method,status}`, `policy_denials_total{reason}`, `sign_latency_ms`.

## 15) Security Notes
- Trust boundaries: browser holds only transport key; identity ops are server‑side and thresholded.
- Rate limiting: enforce on `/api/sign` and `/api/nip44/*` (already documented in SECURITY.md), plus per‑session method budgets in `PolicyEvaluator` (future).
- Secrets: never store FROSTR credentials client‑side; rely on server env and authenticated endpoints.

## 16) Known Gaps & Risks
- Reliance on nostr‑connect internals (`_pending`, `_active`): isolate via `Nip46Transport` to ease library upgrades.
- Non‑persistent session/request state: addressed via adapters.
- Error taxonomy is informal: standardize `{ code, message }` and map HTTP status → UI states.

## 17) Quick Reference (APIs used today)
- `GET /api/peers/group` → `{ pubkey, threshold?, totalShares? }`
- `POST /api/sign` → `{ signature }` (body `{ message }`)
- `POST /api/nip44/encrypt|decrypt` → `{ result }` (body `{ peer_pubkey, content }`)

With the abstractions above, switching to upstream DB schema and new endpoints should require changes only in the adapters while preserving UI/UX and protocol correctness.
