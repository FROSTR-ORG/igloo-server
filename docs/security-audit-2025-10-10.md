# Security Audit — igloo-server

Date: 2025-10-10 (UTC)
Scope: Backend API and supporting code in this repo (src/**, static/**, docs/**, compose.yml, dockerfile). No dynamic scanning; static review only.

## Executive Summary

Overall posture is thoughtful: strict TypeScript, centralized crypto config, careful secret handling (zeroization, vault TTL/reads), persistent rate‑limiter with SQLite fallback, and explicit production warnings for CORS. Primary risks are configuration and trust boundaries: (1) headless mode combined with disabled auth lets attackers read/write environment‑backed credentials; (2) rate limits trust spoofable headers by default; (3) Swagger UI pulls third‑party JS from a CDN; (4) several edge cases where unauthenticated consumers can learn internal state. The fixes are straightforward.

## Methodology

- Manual static review of server, routes, auth, env handling, and DB modules.
- Focus on auth, secrets, validation, CORS, rate limiting, crypto ops, logging.
- File paths are referenced as repo‑relative, with approximate line numbers.

## Severity Legend

- Critical: Compromise or remote R/W of secrets/config without auth.
- High: Serious exploit or broad abuse requiring partial preconditions.
- Medium: Security control weaknesses with constrained impact.
- Low: Hardening and hygiene issues.
- Nitpick: Style/consistency and low‑risk improvements.

---

## Findings (Highest → Lowest)

### Critical — Headless + auth disabled exposes secrets and allows env writes

Description: In headless mode, when auth is disabled (AUTH_ENABLED=false), env endpoints allow reading presence of credentials and writing/deleting environment values, including credentials. The write paths also restart the node with attacker‑provided values.

- Affected endpoints: `/api/env`, `/api/env/shares`, `/api/env/delete`
- Evidence:
  - `src/routes/env.ts:131` GET path selection in headless returns public env without auth.
  - `src/routes/env.ts:260` POST updates env in headless with only AUTH_ENABLED gate.
  - `src/routes/env.ts:408` DELETE removes env in headless with only AUTH_ENABLED gate.
- Impact: Remote attacker can set `GROUP_CRED`/`SHARE_CRED`, modify relays, and force node restarts; or delete creds to cause denial of service. In certain code paths `GET /api/env/shares` can expose whether secrets exist (and include them when auth is enabled)—this should never echo secrets back.
- Recommendation:
  1. In headless mode, require auth for ALL /api/env* routes irrespective of AUTH_ENABLED, and never echo secrets in any response (including `/api/env/shares`).
  2. Prefer failing closed: refuse env writes in headless unless an API key or Basic Auth is present.
  3. Consider disallowing headless for production entirely, or document mandatory env (AUTH_ENABLED=true, API_KEY set).

### Critical — Rate limit identity trusts spoofable headers

Description: Rate limiting uses `X-Forwarded-For`, `X-Real-IP`, and `CF-Connecting-IP` without a global trust gate; an attacker can send arbitrary headers to bypass per‑IP limits.

- Evidence: `src/routes/auth.ts:436` (getClientIP); used in `checkRateLimit` across auth, sign, crypto, onboarding.
- Impact: Brute‑force and DoS protections can be trivially bypassed.
- Recommendation:
  - Create a shared `getClientIp(req, fallbackFromServer?: string)` that:
    - Only trusts proxy headers when `TRUST_PROXY=true`.
    - Otherwise, uses Bun’s `server.requestIP(req)?.address` (plumb via `RouteContext.clientIp`).
  - Replace all ad‑hoc IP parsing with the shared helper.

### High — Swagger UI loads third‑party JS from CDN on an authenticated page

Description: `/api/docs` serves Swagger UI from unpkg without SRI.

- Evidence: `src/routes/docs.ts:62` (external scripts/styles).
- Impact: CDN compromise → arbitrary JS executes on your origin; can make authenticated same‑origin requests.
- Recommendation: Self‑host Swagger UI files (checked into `static/`) or add SRI + `crossorigin` with version pinning. Keep docs behind auth in production (you already do this).

### High — NIP‑04/NIP‑44 crypto oracles can be abused at scale

Description: Endpoints perform ECDH and encryption/decryption on behalf of the authenticated user. This is a design feature but invites abuse if rate limits are bypassed.

- Evidence: `src/routes/nip04.ts`, `src/routes/nip44.ts` (per‑route rate limits present).
- Impact: Resource drain / DoS, unintended use as an oracle.
- Recommendation: After fixing IP trust, consider per‑user quotas (bucketed by authenticated user), structured logging, and optional daily caps.

### Medium — CORS wildcard in production

Description: `ALLOWED_ORIGINS='*'` enables wildcard CORS.

- Evidence: `src/routes/utils.ts:448` and related.
- Impact: Any origin can send cross‑origin requests with Authorization headers (preflight permits them), increasing attack surface for token misuse.
- Recommendation: For production, refuse wildcard (`*`); require explicit allowlist and reflect only exact matches (you already reflect and set `Vary: Origin` correctly). Optionally add a fatal startup error if `NODE_ENV=production` and no allowlist is set.

### Medium — “First user” bypass for env writes

Description: Non‑headless env writes permit either an admin secret OR “first user” (id=1).

- Evidence: `src/routes/env.ts:207` (`firstUser` check).
- Impact: If user id=1 is compromised or mis‑seeded, attacker gains env write privileges.
- Recommendation: Restrict env writes to either a valid admin secret or an authenticated admin‑role session. Remove the first‑user shortcut.

### Medium — Event stream reveals internal state when auth is off

Description: `/api/events` WebSocket upgrades enforce auth only when AUTH is enabled; when disabled, anyone can subscribe and view internal log events.

- Evidence: `src/server.ts:677` upgrade path with conditional auth.
- Impact: Information disclosure useful for recon.
- Recommendation: Require auth for `/api/events` regardless of AUTH_ENABLED, or remove it entirely in production.

### Low — Compose mounts source in a “production” service

Description: `compose.yml` sets `NODE_ENV=production` while bind‑mounting `./src:/app/src:rw`.

- Evidence: `compose.yml:1`.
- Impact: Drift from built image; accidental edits in prod container.
- Recommendation: Use separate dev compose; run production from a built image without bind mounts.

### Low — Error message detail variance

Description: Several endpoints return specific parse errors in 4xx; crypto endpoints vary between “Invalid base64 …” and “Decryption failed.”

- Evidence: e.g., `src/routes/env.ts:187`, `src/routes/user.ts:301`, `src/routes/nip04.ts:29,57`.
- Impact: Minor information leakage; aids fuzzing.
- Recommendation: Normalize error messages in production (e.g., generic “Invalid request”).

### Low — CDN assets without SRI

Description: Swagger UI assets lack integrity attributes.

- Evidence: `src/routes/docs.ts:62`.
- Recommendation: Add integrity attributes or self‑host (covered above).

### Nitpicks — Consistency and hygiene

- IP parsing: Reuse a single `getClientIp` helper (you already did a robust, gated version in onboarding; promote it to shared util and use everywhere).
- Defense‑in‑depth: Mirror explicit auth checks in `nip04` as done in `nip44`.
- Logging: Prefer structured logs; ensure secret values never appear in logs (already mostly true).
- Public env reads: In headless, consider minimizing even public keys in production responses from `/api/env`.

---

## Phased Remediation Plan

### Phase 0 — Immediate config safeguards

- Production:
  - Set `AUTH_ENABLED=true`, `RATE_LIMIT_ENABLED=true`.
  - Set `ALLOWED_ORIGINS` to explicit origins; avoid `*` in production.
  - Prefer `HEADLESS=false`. If headless is required, also set `API_KEY` or Basic Auth and enforce auth on all `/api/env*` routes.
  - Set `TRUST_PROXY=true` only when behind a trusted proxy terminating TLS.
- Secrets:
  - Rotate any secrets stored in `.env` that may have been exposed during development output (including `ADMIN_SECRET`).

### Phase 1 — Code changes (low risk, high value)

1) Auth‑gate headless env endpoints and stop secret echoing
   - Files: `src/routes/env.ts`
   - Require auth for GET/POST/DELETE under headless regardless of `AUTH_ENABLED`.
   - Ensure `/api/env/shares` never includes `shareCredential`/`groupCredential` in any response.

2) Unspoofable client identity for rate limits
   - Files: `src/server.ts`, `src/routes/auth.ts`, shared util
   - Add `getClientIp(req, serverIp)` with TRUST_PROXY gate; plumb `server.requestIP(req)?.address` into `RouteContext.clientIp` from `server.ts` and use it across rate‑limited routes.

3) CORS fail‑closed in production
   - Files: `src/routes/utils.ts`, `src/server.ts`
   - Refuse `*` in `NODE_ENV=production`; require explicit list and reflect only exact matches; keep `Vary: Origin`.

4) Docs hardening
   - Files: `src/routes/docs.ts`, `static/`
   - Self‑host Swagger UI or add SRI + version pinning.

### Phase 2 — Enhancements

- Per‑user quotas for `/api/sign`, `/api/nip04/*`, `/api/nip44/*` (bucket by user id instead of IP only).
- Require auth for `/api/events` regardless of `AUTH_ENABLED`.
- Remove “first user” special case for env writes; require admin secret or admin role.
- Normalize error messages for JSON/body parsing and decryption errors in production.

### Phase 3 — Hardening & Ops

- Headers (at proxy): `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` (self‑hosted docs make CSP easier).
- Secrets management: Use orchestrator/KMS secrets; avoid long‑lived secrets in `.env`.
- Monitoring: Alert on spikes in rate‑limited buckets and on `/api/events` auth failures.

---

## Configuration Checklist (Production)

- `AUTH_ENABLED=true`
- `ALLOWED_ORIGINS=https://yourapp.example`
- `RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_WINDOW=900`, `RATE_LIMIT_MAX` sized to your traffic
- `TRUST_PROXY=true` (only behind TLS proxy)
- `HEADLESS=false` (preferred). If `HEADLESS=true`, set `API_KEY` or Basic Auth and enforce auth for all `/api/env*`
- `SESSION_SECRET` set (auto‑generation is fine; ensure `data/.session-secret` is persisted)
- `ADMIN_SECRET` set and stored securely (rotate if exposed)

---

## Test Plan (Post‑fix)

- Env endpoints in headless require auth and never return secrets:
  - `GET /api/env` and `GET /api/env/shares` → 401 without auth; never include any credential values with auth.
  - `POST /api/env`/`/api/env/delete` → 401/403 unless proper admin/auth present.
- Rate limiting honors true client IP:
  - With `TRUST_PROXY=false`, spoofed `X-Forwarded-For` does not alter identity.
  - With `TRUST_PROXY=true`, first `X-Forwarded-For` entry is honored from your proxy.
- CORS:
  - Requests from non‑allowed origins fail preflight.
  - Allowed origin gets reflected and requests succeed.
- Docs:
  - `/api/docs` serves self‑hosted assets or loads CDN with valid SRI.
- Events:
  - `/api/events` rejects unauthenticated upgrades in all modes.

---

## Strengths Observed

- Strict TS and clear separation of contexts (`RouteContext`, `PrivilegedRouteContext`).
- Session secret auto‑generation with atomic write and strict filesystem permissions.
- Ephemeral derived‑key vault with TTL and bounded reads + zeroization.
- Robust DB layer and rate limiter with resilient fallbacks and `SQLITE_BUSY` handling.
- CORS utilities reflect single origins and set `Vary: Origin` correctly.

---

## Notes

- This write‑up avoids including any secret values discovered locally. If any were printed to logs or shared terminals during development, rotate them.
- Dates are explicit to avoid confusion: this audit was performed on 2025-10-10.

