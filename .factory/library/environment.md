# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** required env vars, external services, local repo relationships, and environment-specific constraints.
**What does NOT belong here:** service ports/commands (use `.factory/services.yaml`).

---

## Working Repos

- Source repo: `/Users/plebdev/Desktop/Work/code/frostr/igloo/igloo-server`
- Store repo: `/Users/plebdev/Desktop/Work/code/frostr/igloo/igloo-server-store`
- Mission branch in source repo: `mission/nip44-release` (tracks `origin/dev`)

## Available Tooling

- Bun is installed locally (`bun 1.3.11` observed during planning)
- Docker and `docker buildx` are available locally
- GitHub CLI is available and already authenticated on this machine

## Environment Constraints

- No local `.env` files were found in the source repo during planning
- Do not rely on ambient shell or `.env` state for readiness or container smoke tests
- For hermetic local smokes, pin env explicitly and use a temporary `DB_PATH`
- DB mode is required for NIP-46 validation; headless mode is insufficient for the cross-surface contract

## Ports and Shared Machine Boundaries

- Mission app port: `8002`
- Avoid already busy local ports/services observed during planning: `3000`, `8080`, `8081`, `8082`, `9090`, `9101`
- Do not disturb unrelated local containers or background services already running on this machine

## External / Sensitive Prerequisites

- Real live-node NIP API smoke requires usable auth plus signing-node credentials and a peer pubkey fixture
- If those real credentials are not available after readiness setup, workers should stop and return to orchestrator rather than faking end-to-end validation
- Do not expose secrets, API keys, or persisted credentials in logs, commits, or handoffs
