---
name: interop-backend-worker
description: Restore validation readiness and implement surgical backend interoperability fixes for the HTTP NIP-44 and NIP-46 NIP-44 surfaces.
---

# interop-backend-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for features that:
- restore local validation readiness on the source repo
- change backend behavior in `src/routes/*`, `src/nip46/*`, `src/db/*`, or related tests
- fix `/api/nip44/*` behavior
- fix NIP-46 `nip44_encrypt` / `nip44_decrypt`
- tighten OpenAPI/runtime parity for the touched API surface

## Required Skills

None.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and `.factory/library/{architecture,environment,user-testing,release}.md` before changing anything.
2. Reproduce the feature's target behavior first.
   - For readiness features: run the failing command or startup smoke the contract references and capture the exact blocker.
   - For code-change features: write or update the smallest failing tests first.
   - For NIP-44 interop proofs, use an **independent standards oracle** (`nostr-tools` NIP-44 conversation-key derivation). Do not reuse Igloo helpers as the oracle for the positive interop cases.
3. Keep the change surgical.
   - Reuse existing helpers and patterns.
   - Do not broaden into NIP-04 unless the orchestrator explicitly changes scope.
   - Do not add legacy NIP-44 decrypt fallback; this mission is standards-only.
   - Prefer neutral names like `convBytes` or `derivedBytes` for computed crypto material to avoid false-positive secret-scanner warnings on variable names such as `conversationKey`.
4. Make the implementation pass the targeted failing tests.
   - Cover both happy path and the exact negative cases named in the validation contract.
   - For NIP-46 policy work, prove the method-specific pending/auto-approve behavior, not just the happy path.
5. Run validation in layers.
   - First: targeted tests for the touched behavior.
   - Then: `.factory/services.yaml` commands for `typecheck`, `test`, `build`, and `docs_validate`.
   - If the feature requires a live local smoke on port `8002`, start only the documented app service and stop it when done.
6. If the feature touches released HTTP contract behavior, update `docs/openapi/openapi.yaml` only as needed to keep the released API contract truthful, then rerun `docs_validate`.
7. Ensure no orphaned processes remain.
   - Stop any local server instance you started.
   - Do not leave watch processes, relays, or background test runners behind.
8. Write a precise handoff.
   - List every command run and what it proved.
   - For interactive checks, describe the end-to-end API or RPC action and the observed result.
   - If you skipped something, say exactly why.

## Example Handoff

```json
{
  "salientSummary": "Fixed NIP-44 conversation-key derivation for `/api/nip44/*` and NIP-46 `nip44_*`, added interop-first tests using `nostr-tools` as the oracle, and verified readiness/build/docs checks on the source repo.",
  "whatWasImplemented": "Added failing interop tests for HTTP and NIP-46 NIP-44 flows, updated the shared NIP-44 key-derivation path so both surfaces derive the spec conversation key from threshold ECDH output, preserved NIP-04 behavior, and updated the released OpenAPI contract for the touched HTTP routes.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun test tests/routes/protected.api.spec.ts --test-name-pattern 'nip44'",
        "exitCode": 0,
        "observation": "HTTP NIP-44 interop and negative decrypt cases passed."
      },
      {
        "command": "bun test tests/routes/nip46.spec.ts --test-name-pattern 'nip44'",
        "exitCode": 0,
        "observation": "NIP-46 nip44_encrypt/nip44_decrypt interop and policy-state cases passed."
      },
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "TypeScript compile check passed."
      },
      {
        "command": "bun test --max-concurrency=9",
        "exitCode": 0,
        "observation": "Full Bun test suite passed after the fix."
      },
      {
        "command": "bun run build",
        "exitCode": 0,
        "observation": "Production bundle build completed successfully."
      },
      {
        "command": "bun run docs:validate",
        "exitCode": 0,
        "observation": "OpenAPI contract remained valid after route-spec updates."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Started the local app on port 8002 with a temporary DB path and queried `/api/status`.",
        "observed": "Server booted in DB mode and `/api/status` returned 200."
      },
      {
        "action": "Exercised `/api/nip44/decrypt` with standards-compliant external ciphertext.",
        "observed": "Route returned the original plaintext instead of `invalid MAC`."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "tests/routes/protected.api.spec.ts",
        "cases": [
          {
            "name": "HTTP NIP-44 decrypt accepts standards-compliant ciphertext",
            "verifies": "`/api/nip44/decrypt` interoperates with a standards-compliant peer using independent conversation-key derivation."
          },
          {
            "name": "HTTP NIP-44 rejects raw-secret legacy ciphertext",
            "verifies": "No legacy fallback exists on the HTTP surface."
          }
        ]
      },
      {
        "file": "tests/routes/nip46.spec.ts",
        "cases": [
          {
            "name": "NIP-46 nip44_encrypt returns ciphertext decryptable by a standards-compliant peer",
            "verifies": "RPC encrypt uses the spec conversation key."
          },
          {
            "name": "NIP-46 method-specific policy grants only auto-approve the granted nip44 method",
            "verifies": "Ungranted `nip44_*` requests remain pending instead of falsely succeeding."
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Fixing the feature would require changing NIP-04 or any other out-of-scope crypto surface.
- Required live-node, NIP-46 session, or auth prerequisites are unavailable and block a contract-required validation.
- A release-line validator fails for reasons that appear unrelated to this feature and need scope triage.
- The work would require touching the sibling store repo or performing release/push steps that belong to `release-rollout-worker`.
