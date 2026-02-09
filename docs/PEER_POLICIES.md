# Peer Policies

Peer policies are directional allow/deny rules attached to peer pubkeys. They let you block outbound and/or inbound traffic with a given peer without rotating credentials.

Terminology:
- `allowSend`: whether this node is allowed to send messages to the peer
- `allowReceive`: whether this node is allowed to accept messages from the peer
- Default is allow/allow when no explicit policy exists.

## Where Policies Come From

There are three inputs/persistence layers:

1. `PEER_POLICIES` (environment)
This is a JSON object or array of objects. It is parsed and normalized during node creation. Use it as a "baseline" policy that ships with your deployment.

2. Database persistence (DB mode, per-user)
When a DB user updates policies via the API, the server persists a sanitized representation into that user's `users.peer_policies` column. These per-user policies are applied when the node is started from that user's stored credentials (for example, via `GET /api/user/credentials` auto-start).

3. Fallback store: `data/peer-policies.json`
When the server cannot associate a policy change with a DB user (headless mode, or env-auth in DB mode), it persists policies to `./data/peer-policies.json` (relative to the server working directory). The server also mirrors DB-user policy changes into this file so headless/API clients can retain overrides across restarts.

Important path nuance:
- The fallback store always uses `./data/peer-policies.json` and does not follow `DB_PATH`. In container deployments, mount `./data` (or ensure the working directory's `data/` is persisted).

## Precedence (What Wins)

When a node is created, the server applies policies in this order:

1. Base policies from the raw string passed into node creation.
This comes from `PEER_POLICIES` env for env-backed nodes (common in headless mode), or from the DB user's stored policies when the node is started from user credentials.

2. Overrides from `data/peer-policies.json`.
These are loaded and merged over the base. Field-level overrides win (for example, an override can set `allowSend:false` even if the base is absent or different).

Operational implication:
- `data/peer-policies.json` is treated as the "last known overrides" layer and can override `PEER_POLICIES` at startup.

## Persistence Rules (What Actually Gets Stored)

To avoid noise and accidental "permit lists", the server sanitizes policies before persisting them:
- Only entries with at least one non-default override are stored.
- A "non-default override" includes `allowSend:false`, `allowReceive:false`, `label`, and `note`.
- `allowSend:true` / `allowReceive:true` are defaults and are not stored.

To remove a deny, delete the policy entry entirely (or update it so it has no non-default overrides).

## Schema (Recommended)

The server accepts a superset of fields (via igloo-core normalization), but the persisted/sanitized shape is intentionally small.

Recommended JSON shape (array form):
```json
[
  {
    "pubkey": "f3b0...xonlyhex",
    "allowSend": false,
    "allowReceive": true,
    "label": "blocked-peer",
    "note": "Temporary outbound block"
  },
  {
    "pubkey": "a1c2...xonlyhex",
    "allowReceive": false,
    "note": "Do not accept inbound requests from this peer"
  }
]
```

Notes:
- Use x-only hex pubkeys when possible. The server normalizes pubkeys internally.
- If you provide a single object instead of an array, it is treated as a one-element array.

## How To Manage Policies

Environment baseline (headless-friendly):
- Set `PEER_POLICIES` to a JSON array (or single object) and restart the server.

API-driven changes:
- Use the `/api/peers/*` policy endpoints to inspect and mutate policies at runtime.
- In DB mode, changes made as an authenticated DB user persist to that user and are mirrored into `data/peer-policies.json`.
- In headless mode (or env-auth), changes persist to `data/peer-policies.json`.

If you are unsure which layer is currently active for your deployment, check:
- `docs/AUTH_MATRIX.md` for mode differences and auth expectations.
- `docs/CONFIG.md` for persistence notes and volume mounting gotchas.
