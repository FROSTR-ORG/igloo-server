---
name: release-rollout-worker
description: Publish the verified source release, verify release artifacts, and update the Umbrel store rollout in the sibling store repo.
---

# release-rollout-worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for features that:
- prepare and publish the next source release
- verify GitHub release metadata, tags, and GHCR artifacts
- boot published release images for smoke validation
- update and push `/Users/plebdev/Desktop/Work/code/frostr/igloo/igloo-server-store`
- verify the exact store-pinned Umbrel image and rollout metadata

## Required Skills

None.

## Work Procedure

1. Read `mission.md`, mission `AGENTS.md`, `.factory/services.yaml`, and `.factory/library/{architecture,environment,user-testing,release}.md`.
2. Determine whether the feature is:
   - source release publication/verification, or
   - store repo rollout update.
3. Before any mutation, inspect git state.
   - For the source repo: confirm only mission-relevant changes are included.
   - For the store repo: confirm the baseline and capture the current branch/HEAD.
   - Never bundle unrelated changes into a release or store push.
4. For source release features:
   - Verify version metadata with `version_check`.
   - Run the required validators before tagging/publishing.
   - Follow the established repo release flow; do not invent a new one.
   - After publication, verify the tag, GitHub release object, assets, GHCR digests, and image labels.
   - Boot the published standard image locally and prove `/api/status` returns 200.
5. For store rollout features:
   - Derive the exact released Umbrel artifact from the published release outputs.
   - Update only the store files required for rollout (`umbrel-app.yml`, `docker-compose.yml`, and nothing else unless the feature explicitly requires it).
   - Preserve the Umbrel runtime contract (auth, rate limiting, onboarding skip validation, proxy whitelist, persistence, port 8002).
   - Boot the **exact store-pinned image** locally with equivalent runtime env and verify the contract endpoints.
   - Commit and push the store repo update only when the feature explicitly requires rollout publication.
6. Serialize remote mutations.
   - Release publication, source pushes, tags, and store pushes must be done deliberately and one at a time.
   - Record the exact commit SHA, tag, release URL, image refs, and digests you verified.
7. Clean up containers/processes you start.
   - Stop any local release-image or Umbrel-image smoke container before handing off.
8. Write a precise handoff with URLs, SHAs, tags, and digests.

## Example Handoff

```json
{
  "salientSummary": "Published the next minor release from the verified source repo, confirmed the GitHub release + GHCR artifacts, then updated and pushed the sibling Umbrel store repo to the exact released Umbrel image.",
  "whatWasImplemented": "Verified version/changelog/tag alignment, ran the source validators, published the release, confirmed standard and Umbrel image digest parity plus OCI labels, smoke-booted the released standard image, updated the store manifest/compose to the released Umbrel artifact, smoke-booted the exact store-pinned image locally, and pushed the store repo rollout commit.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run version:check",
        "exitCode": 0,
        "observation": "Source release metadata stayed in sync."
      },
      {
        "command": "bun test --max-concurrency=9 && bun run typecheck && bun run build && bun run docs:validate",
        "exitCode": 0,
        "observation": "All source release validators passed before publication."
      },
      {
        "command": "gh release view v1.2.0 --repo FROSTR-ORG/igloo-server",
        "exitCode": 0,
        "observation": "GitHub release object for v1.2.0 exists and exposes the expected assets."
      },
      {
        "command": "docker buildx imagetools inspect ghcr.io/frostr-org/igloo-server:1.2.0",
        "exitCode": 0,
        "observation": "Standard release image exists and its digest matches `latest`."
      },
      {
        "command": "git -C /Users/plebdev/Desktop/Work/code/frostr/igloo/igloo-server-store push origin master",
        "exitCode": 0,
        "observation": "Store rollout commit was pushed to the remote store repo."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Booted `ghcr.io/frostr-org/igloo-server:1.2.0` locally with temporary DB-mode env and queried `/api/status`.",
        "observed": "Published standard image booted successfully and returned HTTP 200 from `/api/status`."
      },
      {
        "action": "Booted the exact store-pinned Umbrel image locally with store-equivalent env and queried `/api/status`, `/api/onboarding/status`, and `/api/auth/status`.",
        "observed": "Umbrel image honored the packaged runtime contract, including onboarding skip validation and enabled auth/rate limiting."
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Release/tag/store policy is ambiguous, or the published artifact naming strategy does not match the mission contract.
- GitHub/GHCR/store push permissions are missing or publication fails due to external infrastructure.
- The source repo still contains unrelated uncommitted changes that should not be bundled into the release.
- The exact released Umbrel artifact cannot be derived from the source release outputs.
