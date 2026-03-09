# Release Guide

Quick reference for releasing Igloo Server.

## Quick Release

```bash
# For new features (minor)
bun run release:minor

# For bug fixes (patch)
bun run release:patch

# For breaking changes
bun run release:major
```

This will:
1. Validate you're on `dev`
2. Run checks and build
3. Sync `package.json` and OpenAPI version metadata
4. Seed a `CHANGELOG.md` heading if it is missing
5. Create and push `release/prepare-vX.Y.Z`

## Manual Process

### 1. Prepare release on `dev`

```bash
git checkout dev
git pull origin dev
bun install
bun run build
bun run docs:validate
```

### 2. Create the release branch

```bash
bun run release:minor
```

This creates a `release/prepare-vX.Y.Z` branch with:
- `package.json` bumped
- `docs/openapi/openapi.yaml` and `docs/openapi/openapi.json` synced
- a top-level `CHANGELOG.md` entry inserted when missing

Before opening the PR, replace any placeholder changelog headings with real release notes.

Create PR: `release/prepare-vX.Y.Z` -> `master`

### 3. Merge and publish

Merge the PR to `master`.

The release workflow on `master` then:
- verifies version metadata consistency
- validates the OpenAPI spec
- runs tests and build
- tags `vX.Y.Z`
- creates the GitHub release
- publishes Docker and Umbrel images

### 4. Verify release

- Check [GitHub Releases](https://github.com/FROSTR-ORG/igloo-server/releases)
- Test `docker pull ghcr.io/frostr-org/igloo-server:latest`
- Sync `dev`: `git checkout dev && git merge master && git push origin dev`

## Version Selection

Release prep is explicit:

| Command | Version bump | Example |
|---------|--------------|---------|
| `bun run release:minor` | Minor | `1.1.1 -> 1.2.0` |
| `bun run release:patch` | Patch | `1.1.1 -> 1.1.2` |
| `bun run release:major` | Major | `1.1.1 -> 2.0.0` |
| `bun run release -- 1.2.0` | Exact version | set the version directly |

The release workflow publishes the version already committed on `master`. It does not infer semver from commit messages.

## Emergency Releases

```bash
git checkout master
git checkout -b hotfix/critical-fix
# Make fix and commit
git push origin hotfix/critical-fix
# Create PR to master
```

## Release Artifacts

Each release creates:
- Docker images: `ghcr.io/frostr-org/igloo-server:latest` and `ghcr.io/frostr-org/igloo-server:x.y.z`
- Source archive: `igloo-server-x.y.z-src.tar.gz`
- Binary archive: `igloo-server-x.y.z.tar.gz`
- GitHub release tagged `vX.Y.Z`
