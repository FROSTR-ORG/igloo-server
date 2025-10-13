# CHANGELOG

## [1.0.0] - 2025-10-13
### Changes since v0.1.9:
- security-hardened API & WebSocket stack: echo subprotocol, per‑IP caps with reservation/rollback, token‑bucket limits; CSP allows `wss:`; headless `/api/env*` now requires auth.
- admin API keys (DB mode): issuance and management; session/auth fixes with real TTL handling.
- consolidate API routes; clearer env/onboarding/auth errors; OpenAPI updated.
- `/api/env` now returns `RELAYS` as an array; DB/headless env handling avoids credential leakage.
- WS reliability: echo subprotocol, NaN‑safe env parsing, copy‑timeout cleanup; UI `useCallback` deps fixed.
- slimmer Docker image; add `.dockerignore` and targeted copy in Dockerfile.
- add API test scripts under `scripts/api/*` (CORS preflight, GET sweeps, permissions, NIP‑44/04 crypto, WS events, `/sign`).
- frontend: “API Docs” link and docs improvements.
- fix: NIP‑46 agent restarts when socket closes; keep‑alive refactor.
- fix: auth/session storage with real TTL in DB+memory; refresh `lastAccess`; async cleanup.
- tests added for origin checks, body limits, rate buckets, and 401s.
- BREAKING: headless `/api/env*` endpoints are auth‑gated; update unauthenticated tooling to include auth.
- migration: apply `20251008_0009_create_api_keys.sql` and `20251009_0005_add_sessions_table.sql`.
- note: rebuild Docker image to pick up slimmer layout and `.dockerignore`.

## [0.1.9] - 2025-09-26
### Changes since v0.1.8:
- Merge pull request #18 from FROSTR-ORG/dev
- add database-backed multi-user mode with admin onboarding, session auth, and persistent node credentials
- keep headless single-user mode via `HEADLESS=true` and expand environment/config validation
- implement full NIP-46 remote signing stack (pairing, permissions UI, relay handling, auditing)
- expose new NIP-44 and NIP-04 encrypt/decrypt APIs backed by the node service
- persist peer policies and relay metadata, harden node/relay monitoring and keepalive flows
- overhaul auth/session vault, derived-key handling, and security defaults
- refresh frontend for onboarding, signer, and NIP-46 management with new UI components
- document new modes, security posture, and API surface; update OpenAPI specs
- streamline release/build scripts, Docker flow, and QR worker packaging for nostr-connect

## [0.1.8] - 2025-07-25
### Changes since v0.1.7:
- Merge pull request #11 from FROSTR-ORG/dev
- health check fix for release script
- fix release script logic for major minor and fix
- remove websocket doc
- update / simplify release process
- fix: stop health monitor from scheduling duplicate restarts
- fix type issue
- Merge pull request #10 from FROSTR-ORG/feature/auto-reconnection-and-health-monitoring
- openapi fixes
- fix backoff multiplier validation to prevent decreasing delays
- add validation for environment variables in restart and health configs
- fix: stop health monitoring after max restarts to prevent infinite error loops
- ufw allow 22 for ssh in digital ocean deployment instructions
- Use getSecureCorsHeaders for consistent CORS handling in env route
- fix: add health restart limits with exponential backoff to prevent infinite loops
- fix: improve node restart mechanism with concurrency control and configurable backoff
- Merge branch 'dev' into feature/auto-reconnection-and-health-monitoring
- basic health monitoring system, enhanced event listeners, automatic bifrost node restart, better connection management and status api
- Merge pull request #9 from FROSTR-ORG/refactor/event-stream-over-websockets
- fix response
- refactor: replace magic number with named constant and improve WebSocket type safety
- fix: improve WebSocket implementation robustness and type safety
- feat: exponential backoff with jitter for WebSocket reconnection
- initial websocket refactor, seems to be working good locally and through docker

## [0.1.7] - 2025-07-11
### Changes since v0.1.6:
- Merge pull request #8 from FROSTR-ORG/dev
- Merge pull request #7 from FROSTR-ORG/refactor/minimal-mobile-styles
- mobile style fixes for header, page layout, signer, and recover pages
- Merge pull request #6 from FROSTR-ORG/bugfix/configuration-quirks
- docs: clarify HOST_NAME configuration for Docker vs local development
- just use .env to simplify configuration, fix docker configs and readme for this change
- fix: read environment variables from process.env in Docker containers

## [0.1.6] - 2025-07-11
### Changes since v0.1.5:
- Merge pull request #5 from FROSTR-ORG/chore/api-docs
- lint
- add bearer to openapi.json
- more openapi formatting nitpicks
- fix inconsistency between openapi.yaml and openapi.json
- fix server and docker configs interop
- fix more openapi yaml syntax errs
- fixes for openapi syntax
- fix yaml syntax, dedicated openapi validator, fixed scripts after updates
- fix server binding and docker config
- fix docker ci
- fix package version
- openapi docs

## [0.1.5] - 2025-07-10
### Changes since v0.1.4:
- Update CHANGELOG.md

## [0.1.4] - 2025-07-10
- feat: merge CI/CD workflows and release automation
- feat: add comprehensive CI/CD workflows and release automation
- Merge pull request #4 from FROSTR-ORG/feature/static-igloo-frontend
