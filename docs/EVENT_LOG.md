# UI Event Log (DB Mode)

This doc describes how the UI "Event Log" works in database mode (`HEADLESS=false`), with emphasis on disk usage and long-running deployments.

In headless mode (`HEADLESS=true`), `/api/event-log*` is unavailable (404) and you typically rely on process stdout logging instead.

## Persistence Model

In DB mode, UI event log entries are persisted to the same SQLite database as the rest of the DB-mode state (typically `./data/igloo.db`, or under `DB_PATH`).

API surfaces:
- `GET /api/event-log` lists recent entries (reverse chronological; cursor pagination via `beforeSeq`).
- `GET /api/event-log/blob/<hash>` fetches the full JSON payload for an entry by content hash.
- `GET /api/event-log/export` downloads NDJSON (one entry per line) for easy support/debugging.

## Storage Optimizations

### 1) High-Volume Event Suppression (Pings)

`/ping/*` traffic can be extremely frequent on always-on deployments and can dominate the event log over time.

By default, ping request/response events are suppressed from the persisted UI event log:
- Env: `UI_EVENT_LOG_INCLUDE_PINGS=false` (default)

Ping traffic is still used internally for peer status/latency; it just does not get persisted into the UI event log unless explicitly enabled.

### 2) Payload De-duplication (Content-Addressed Blobs)

Persisted payloads are stored by **SHA-256 hash** in a blob table. Event log entries reference payloads by hash:

- If the same JSON payload repeats across many entries, the database stores it once.
- Entries remain fully auditable: each entry is still recorded, but large repeated payloads do not multiply disk usage.

### 3) Lazy Loading Full Payloads

The log list endpoint returns a small `dataPreview` and `dataHash` for each entry.

The UI only fetches the full `data` from `/api/event-log/blob/<hash>` when a row is expanded. This reduces bandwidth and keeps initial UI loads snappy even with a large history.

### 4) Redaction and Size Bounding

Before persistence:
- Known secret-bearing keys are redacted (example: `Authorization`, `Cookie`, `*_secret`, `*_token`, `transport_sk`, etc).
- Objects are sanitized to avoid cycles and other non-JSON values.
- Oversized payloads are bounded:
  - If the serialized payload exceeds a hard cap, a summary blob is stored instead with `_truncated: true`, and the entry records the original byte size.

This prevents accidental persistence of sensitive material and prevents single requests/responses from exploding disk usage.

### 5) Optional Retention (Auto-Prune)

You can opt into pruning old entries automatically:
- Env: `UI_EVENT_LOG_RETENTION_DAYS=<N>`

When set to a positive integer, Igloo periodically deletes event log entries older than N days, then deletes any now-unreferenced payload blobs.

Important: this is a tradeoff. Retention reduces disk usage but also reduces "full history" auditability.

## Operational Guidance

Recommended defaults for long-running deployments:
- Keep ping suppression enabled (`UI_EVENT_LOG_INCLUDE_PINGS=false`) unless actively debugging pings.
- If you need bounded disk usage, set a retention window (example `UI_EVENT_LOG_RETENTION_DAYS=30` or `90`).
- Use `/api/event-log/export` for support bundles instead of screenshots or manual copying.

