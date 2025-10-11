# Igloo Server – Security Audit and Recommendations

Date: 2025-10-10
Scope: Backend server (Bun), routes in `src/routes/*`, WebSocket handling in `src/server.ts` and `src/class/relay.ts`, DB layer in `src/db/*`, utilities in `src/routes/utils.ts` and `src/utils/*`.

This document summarizes a security review of the API and supporting services, ordered from Critical → Nitpick, with concrete file references and actionable remediations.

---

## Executive Summary

Overall security posture is strong: secrets are guarded from API exposure, auth uses timing‑safe compares, password hashing and at‑rest credential encryption are modern (Argon2id + AES‑GCM via PBKDF2), rate limiting persists across restarts, and session secrets are safely generated/persisted with correct permissions.

Primary risk areas:
- WebSocket authentication uses URL query parameters and lacks Origin checks.
- NIP‑04 uses AES‑CBC (malleable, no AEAD), which is acceptable for spec‑compat but risky; NIP‑44 is preferred.
- A global error circuit breaker can be tripped by repeated unhandled errors (potential remote DoS if attackers can elicit them).
- Missing uniform JSON body caps across POST routes; some endpoints may accept large payloads.

Top actions: harden WebSocket upgrades, add uniform body limits and per‑bucket rate limits, tighten production CORS and security headers, consider an option to disable NIP‑04 in production.

---

## Findings by Severity

### Critical

1) WebSocket credentials in URLs and no Origin checks
- Issue: `/api/events` upgrade allows `apiKey`/`sessionId` via query params; URLs leak in logs, proxies, browser history. No Origin allowlist check for WS on `/api/events` or the relay at `/`.
- Files: `src/server.ts:683-706` (URL params for auth), `src/server.ts:677-740` (WS upgrade handling).
- Remediation:
  - Reject credentials in query params; accept only headers or `Sec-WebSocket-Protocol` for tokens.
  - Enforce `Origin` allowlist matching `ALLOWED_ORIGINS` (exact match) during `server.upgrade()`; deny when missing or mismatched in production.
  - Add per‑IP connection caps and per‑socket message rate limits (see “Mitigations” below).

2) NIP‑04 uses unauthenticated encryption (AES‑CBC)
- Issue: AES‑CBC is malleable and provides no integrity; ciphertexts can be modified undetected.
- Files: `src/routes/nip04.ts:12-17,35-41`.
- Remediation:
  - Prefer NIP‑44 endpoints (`/api/nip44/*`) for confidentiality and integrity.
  - Add a production flag to disable NIP‑04 (`DISABLE_NIP04=true`) or return 404 in production unless explicitly enabled.
  - Clearly document risks in API docs.

3) Error circuit breaker can exit the process (potential DoS)
- Issue: Repeated unhandled exceptions trigger a shutdown; if an attacker can consistently provoke non‑benign errors, they may cause repeated restarts.
- Files: `src/server.ts:36-107,122-157`.
- Remediation:
  - Gate exits behind `ERROR_CIRCUIT_EXIT_ENABLED=true` and default to false in production; or scope the breaker only to internal relay failures.
  - Increase observability and degrade gracefully (trip a “safe mode” without exiting).

### High

4) Headless env writes rely on Basic/API Key only
- Risk: Correct by design, but very high impact if TLS is not enforced or keys are weak.
- Files: `src/routes/env.ts:138-171,214-225`.
- Remediation:
  - Require TLS (documented operationally) and set conservative rate limits on `env` writes.
  - Emit an admin log event on any env write/delete; consider email/webhook alert hooks.

5) Event stream data leakage risk
- Issue: Server logs/events are broadcast to all authenticated WS clients. While `safeStringify` helps, payloads may include sensitive context.
- Files: `src/node/manager.ts:1133-1206`.
- Remediation:
  - Introduce an allowlist of event types for broadcast.
  - Redact known secret‑like fields; cap payload sizes; add server‑side sampling/dropping for high‑volume event types.

6) WS abuse protections are minimal
- Issue: No per‑IP connection caps or in‑socket rate limits; relay handler trusts inputs.
- Files: `src/server.ts:663-740`, `src/class/relay.ts:62-106`.
- Remediation:
  - Track IP (from `server.requestIP` or trusted headers) and apply caps (e.g., 5 concurrent WS per IP) and message budgets (e.g., 20 msg/sec).
  - Close on protocol violations and excessive rate; backoff per IP.

7) CORS footguns in production
- Issue: Allowing `ALLOWED_ORIGINS=*` in production enables cross‑origin JS calls. Credentials aren’t automatically sent, but bearer/API headers can be.
- Files: `src/routes/utils.ts:447-468`.
- Remediation:
  - In production, reject `*` and require explicit origins. Warn and refuse to start if `*` is set.

### Medium

8) Inconsistent JSON body size limits
- Issue: `/api/sign` caps at ~100KB; other POST endpoints lack limits.
- Files: `src/routes/sign.ts:90-98` (good), others: `env.ts`, `user.ts`, `admin.ts`, `recovery.ts`, `nip04.ts`, `nip44.ts`.
- Remediation:
  - Add a shared helper to enforce `Content-Length` ≤ e.g., 64KB for all JSON POST routes.

9) Rate‑limiter identity behind proxies
- Issue: Without `TRUST_PROXY=true`, many clients may collapse to the same address or ‘unknown’; with it misconfigured, spoofing is possible.
- Files: `src/routes/utils.ts:505-530`, `src/utils/rate-limiter.ts`.
- Remediation:
  - Document and require `TRUST_PROXY=true` when running behind a trusted reverse proxy; validate header presence/format.

10) Session bearer acceptance expands theft surface
- Issue: Supporting `X-Session-ID` header is useful for APIs, but increases risk vs. HttpOnly cookie.
- Files: `src/routes/auth.ts:914-977,1048-1074`; `src/server.ts:689-705`.
- Remediation:
  - Keep header support, but ensure no logging of header values, and prefer cookies for browser flows.

11) Recovery endpoint returns raw private key
- Issue: Sensitive by nature; current flow is auth + rate limit only.
- Files: `src/routes/recovery.ts:14-24,96-156`.
- Remediation:
  - Require password re‑prompt (derived key presence) or admin secret; add stricter bucket (e.g., max 3 per 15 min); add alerting.

### Low

12) Missing standard security headers on HTML/UI
- Issue: No HSTS, clickjacking, or no‑sniff headers on static.
- Files: `src/routes/static.ts:114-157`.
- Remediation:
  - Add: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a CSP for the UI/docs.

13) Admin bearer vs. API keys semantics
- Issue: Admin endpoints accept `Authorization: Bearer <ADMIN_SECRET>` and also admin sessions.
- Files: `src/routes/admin.ts:92-112`.
- Remediation:
  - Clarify in docs; consider a separate `Admin-Secret` header to avoid conflation with OAuth‑style Bearer.

14) Cookie hardening
- Issue: Cookies are already `HttpOnly; Secure; SameSite=Strict` in prod. Could add `__Host-` prefix if hosted at root.
- Files: `src/routes/auth.ts:1172-1180`.

15) DB integer safety
- Issue: Good warnings when IDs exceed `Number.MAX_SAFE_INTEGER`.
- Files: `src/db/database.ts:15-37,297-318`.
- Remediation: Continue returning ID as string where needed.

---

## What’s Already Strong

- Secrets never exposed via env endpoints; forbidden key assertion at module init.
  - Files: `src/routes/utils.ts:137-164,146-159`.
- Timing‑safe compares for admin/api/basic auth.
  - Files: `src/routes/onboarding.ts:280-309`, `src/routes/auth.ts:907-931,988-1001`.
- Credential storage security: Argon2id password hashing; AES‑GCM with 200k‑iter PBKDF2 for user data encryption.
  - Files: `src/config/crypto.ts`, `src/db/database.ts:353-420`.
- Session secret generation/persistence with atomic writes and strict perms; validation in prod.
  - Files: `src/routes/auth.ts:28-176,178-236`.
- Persistent rate limiter with SQLite fallback; dedicated buckets already in use for `auth`, `sign`, `crypto`.
  - Files: `src/utils/rate-limiter.ts`, usage in routes.

---

## Recommended Remediation Plan

1) Harden WebSocket Upgrades (Critical)
- Disallow credentials in query params on `/api/events`.
- Validate `Origin` against `ALLOWED_ORIGINS` (no wildcard in prod).
- Implement per‑IP connection caps (e.g., 5) and per‑socket message rate limits (e.g., 20 msg/s, burst 40) with immediate close on abuse.
- Files to change: `src/server.ts` (upgrade paths), `src/class/relay.ts` (per‑socket pacing & close on overflow).

2) Uniform JSON Body Caps (High/Medium)
- Add a helper (e.g., `enforceJsonBodyLimit(req, 64 * 1024)`) and call it in POST handlers of: `env.ts`, `user.ts`, `admin.ts`, `recovery.ts`, `nip04.ts`, `nip44.ts`.

3) Per‑Bucket Rate Limits (High)
- Define buckets and defaults:
  - `auth`: existing
  - `sign`: existing
  - `crypto`: existing
  - `env-write`: max 10 per 15m/ip
  - `recovery`: max 3 per 15m/ip
  - `ws-upgrade`: max 30 per 15m/ip
- Wire each route to its bucket; add `Retry-After` from limiter metadata.

4) Production Security Headers (Low → Medium)
- In `static.ts` (and `docs.ts` for HTML):
  - Add `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - CSP example: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'`

5) NIP‑04 Production Gate (Critical/Policy)
- Add env flag `DISABLE_NIP04=true` for production; handler returns 404 when disabled.
- Update docs to steer clients to `/api/nip44/*`.

6) Error Circuit Breaker Safeguards (Critical)
- Require `ERROR_CIRCUIT_EXIT_ENABLED=true` in production to allow auto‑exit, otherwise log and continue in degraded mode.
- Narrow “counted” errors to internal subsystems that cannot be user‑provoked.

7) Recovery Endpoint Safety (Medium/High)
- Require: (a) valid derived key (password re‑prompt) or (b) valid admin secret; and tighten rate limit bucket to `3/15m`.
- Optional: add secondary approval step via short‑lived challenge code.

---

## Concrete Code Pointers (What to Change)

- `src/server.ts`
  - In WS upgrades (`/api/events`, `/`):
    - Reject auth via query string; support `X-API-Key` | `X-Session-ID` headers or `Sec-WebSocket-Protocol`.
    - Enforce `Origin` allowlist using `ALLOWED_ORIGINS` (reject when unset in prod).
    - Add per‑IP connection accounting and caps.

- `src/routes/utils.ts`
  - Add `enforceJsonBodyLimit(req, maxBytes)`; call early in POST handlers.
  - In `getSecureCorsHeaders`, reject `*` in production.

- `src/utils/rate-limiter.ts`
  - Add buckets: `env-write`, `recovery`, `ws-upgrade`; expose helpers to pass window/max per bucket.

- `src/routes/static.ts` and `src/routes/docs.ts`
  - Attach production security headers for HTML responses (and cache headers as applicable).

- `src/routes/nip04.ts`
  - Guard on `DISABLE_NIP04`; return 404/405 when disabled in production.

---

## Operational Hardening Checklist

- TLS everywhere (enforced at proxy or platform); never expose Basic/API key over plaintext.
- Set `AUTH_ENABLED=true`, strong `ADMIN_SECRET`, and run behind a trusted reverse proxy with `TRUST_PROXY=true`.
- Set `ALLOWED_ORIGINS` to explicit hostnames; never `*` in production.
- Keep environment secrets out of logs; do not pass secrets via URLs.
- Monitor rate‑limit rejections and WS connection spikes; alert on thresholds.

---

## Suggested Follow‑Up PRs

1) WS Hardening PR
- Implement Origin checks, header‑only credentials, and per‑IP caps; add tests.

2) Body Limits + Buckets PR
- Add `enforceJsonBodyLimit` (+64KB default) and wire per‑bucket limits for env/recovery/ws‑upgrade.

3) Headers + CORS PR
- Add HSTS/no‑sniff/frame‑deny/referrer policy and reject wildcard CORS in prod.

4) NIP‑04 Gate PR
- Add `DISABLE_NIP04` and update docs to recommend NIP‑44.

---

If you want, I can follow up with patches implementing these changes (incrementally, starting with WS hardening and body limits).

