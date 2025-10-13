API key GET testing

Usage

- Export your base URL and API key (DB mode):
  - macOS/Linux:
    - `export BASE_URL=http://127.0.0.1:8002`
    - `export API_KEY=YOUR_API_KEY`

- Run accessible GET checks (should succeed):
  - `bun run api:test:get`

- Run permission probes (should be blocked):
  - `bun run api:test:get:blocked`

- List GET endpoints from OpenAPI (for auditing):
  - `bun run api:test:get:list`

- WebSocket events test:
  - `bun run api:test:ws`

- NIP-44 / NIP-04 roundtrip (requires node active and a peer pubkey):
  - `export TEST_PEER_PUBKEY=<x-only-or-compressed-pubkey>`
  - `bun run api:test:nip`

Notes

- Tests intentionally include public endpoints (status, docs) while sending the API key to exercise the header parsing path.
- In database mode, API keys authenticate, but routes requiring a numeric DB user or admin secret will still respond 401/403. That’s expected and checked by the permission probes.
- WS auth is performed via `?apiKey=...` query param to avoid client header limitations; the server maps it to `X-API-Key` during upgrade.
