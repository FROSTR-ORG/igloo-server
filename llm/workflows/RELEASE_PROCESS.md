# Igloo Server Release Process Documentation

## Overview

The Igloo Server release process is a semi-automated workflow that ensures code quality, proper versioning, and safe deployments. It combines local validation with GitHub Actions automation to create reliable, documented releases.

## Release Workflow Diagram

```
┌─────────────────┐
│   Developer     │
│   (dev branch)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Run Release     │
│    Script       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Local Tests &   │
│  Validation     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Release  │
│    Branch       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Manual PR      │
│   Creation      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GitHub Actions  │
│  (on merge)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Automated       │
│   Release       │
└─────────────────┘
```

## Quick Start Commands

```bash
# Patch release (1.0.0 → 1.0.1)
bun run release

# Minor release (1.0.0 → 1.1.0)
bun run release:minor

# Major release (1.0.0 → 2.0.0)
bun run release:major

# Specific version
./scripts/release.sh 2.5.0
```

## Detailed Process Breakdown

### 1. Pre-Release Requirements

Before initiating a release, ensure:

- **Branch**: You MUST be on the `dev` branch
- **Working Directory**: Must be clean (no uncommitted changes)
- **Dependencies**: Bun runtime installed and working (required); Node.js and npm installed (required for version bump via `npm version` command)
- **Port 8002**: Must be available for server testing

### 2. Release Script Execution (`scripts/release.sh`)

#### 2.1 Version Determination

The script accepts version arguments:
- `patch` (default): Increments patch version (1.0.0 → 1.0.1)
- `minor`: Increments minor version (1.0.0 → 1.1.0)
- `major`: Increments major version (1.0.0 → 2.0.0)
- `x.y.z`: Explicit version number (e.g., "2.5.0")

#### 2.2 Validation Steps

The script performs these checks in sequence:

1. **Branch Verification**
   ```bash
   # Must be on 'dev' branch
   if [ "$CURRENT_BRANCH" != "dev" ]; then
       exit 1
   fi
   ```

2. **Clean Working Directory**
   ```bash
   # No uncommitted changes allowed
   if [ -n "$(git status --porcelain)" ]; then
       exit 1
   fi
   ```

3. **Pull Latest Changes**
   ```bash
   git pull origin dev
   ```

#### 2.3 Build & Test Phase

1. **Install Dependencies**
   ```bash
   bun install
   ```

2. **Build Frontend**
   ```bash
   bun run build
   ```
   - Compiles React TypeScript app
   - Processes Tailwind CSS
   - Creates static assets in `/static`

3. **Server Startup Test**
   - Checks port 8002 availability
   - Starts server in background
   - Captures process ID for cleanup

4. **Health Check Verification**
   - Waits 3 seconds for initialization
   - Attempts health check 5 times
   - Uses curl to test `/api/status` endpoint
   - 1-second retry interval between attempts

5. **Documentation Validation**
   ```bash
   bun run docs:validate
   ```
   - Validates OpenAPI specification
   - Ensures API documentation is correct

#### 2.4 Version Update

1. **Version Calculation**
   - If explicit version: Uses provided version
   - Otherwise: Uses npm version to calculate new version
   ```bash
   NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
   ```

2. **Package.json Update**
   - Version field is updated automatically
   - No git commit created yet

#### 2.5 Release Branch Creation

1. **Branch Naming**
   ```bash
   RELEASE_BRANCH="release/prepare-v${NEW_VERSION}"
   ```
   Example: `release/prepare-v1.2.3`

2. **Create Branch, Commit Version Bump, and Push**
   ```bash
   git checkout -b "$RELEASE_BRANCH"

   # Stage and commit the version bump so the PR contains the change
   git add package.json
   git commit -m "chore(release): bump version to v${NEW_VERSION}"

   # Push the branch to upload it to the remote repository
   git push origin "$RELEASE_BRANCH"
   ```

### 3. Manual Steps (Developer Action Required)

After the script pushes the release branch, you must create a pull request to merge the changes into the `master` branch.

1.  **Create a Pull Request**

    Pushing the branch makes it available on the remote repository. To create a pull request, you can use the GitHub web interface. GitHub will typically show a prompt to create a PR from a recently pushed branch, or you can use the comparison URL provided by the script.

    Alternatively, if you have the [GitHub CLI](https://cli.github.com/) installed, you can create the pull request from your terminal:
    ```bash
    # Optional: Create the pull request using the GitHub CLI
    # Replace <VERSION> with the new version number from the script's output
    gh pr create --base master --head "release/prepare-v<VERSION>" --title "chore(release): Release v<VERSION>" --body "Prepares for release v<VERSION>"
    ```

2.  **Review and Merge PR**
    - Get approvals if required.
    - Merge the pull request to `master` to trigger the automated release workflow.

### 4. GitHub Actions Automation

When the PR is merged to master:

1. **Release Creation**
   - GitHub automatically creates a release
   - Version tag is applied (e.g., `v1.2.3`)

2. **Changelog Generation**
   - Uses `.github/release.yml` configuration
   - Categorizes changes by labels

### 5. Changelog Configuration (`.github/release.yml`)

#### Excluded Items
- PRs labeled with `ignore-for-release`
- Dependabot commits
- Changes without labels go to "Other Changes"

#### Categories

| Category | Labels | Emoji |
|----------|--------|-------|
| Features | `feature`, `enhancement` | 🚀 |
| Bug Fixes | `bug`, `fix` | 🐛 |
| Maintenance | `maintenance`, `chore`, `dependencies` | 🛠️ |
| Documentation | `documentation`, `docs` | 📚 |
| Security | `security` | 🔒 |
| Other Changes | Any other labels | - |

## Error Handling & Recovery

### Common Issues and Solutions

#### Port 8002 Already in Use
```bash
❌ Port 8002 is already in use
```
**Solution**: Stop any running Igloo Server instances
```bash
# Find and kill process on port 8002
lsof -i :8002
kill <PID>
```

#### Dirty Working Directory
```bash
❌ Working directory is not clean
```
**Solution**: Commit or stash changes
```bash
git add .
git commit -m "Save work before release"
# OR
git stash
```

#### Not on Dev Branch
```bash
❌ Must be on 'dev' branch
```
**Solution**: Switch to dev branch
```bash
git checkout dev
```

#### Server Health Check Fails
```bash
❌ Server failed to respond after 5 attempts
```
**Solution**: 
1. Check server logs for errors
2. Ensure credentials are valid
3. Verify build completed successfully

### Cleanup Mechanism

The script includes automatic cleanup:
- **Trap Handler**: Kills server process on exit/interrupt
- **Process ID Tracking**: Ensures server is properly terminated
- **Exit Codes**: Non-zero exit on any failure

## Best Practices

### Version Numbering (Semantic Versioning)

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (1.x.0): New features, backward compatible
- **PATCH** (1.0.x): Bug fixes, backward compatible

### Pre-Release Checklist

- [ ] All tests passing
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (if manual)
- [ ] Breaking changes documented
- [ ] Migration guide written (for major versions)

### Commit Message Standards

For automatic changelog generation, use these prefixes:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `chore:` Maintenance tasks
- `security:` Security updates

### Label Your PRs

Apply appropriate labels for changelog categorization:
- `feature` / `enhancement`
- `bug` / `fix`
- `documentation` / `docs`
- `security`
- `maintenance` / `chore`

## Environment Variables for Release

| Variable | Description | Used In |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | Server tests |
| `HOST_PORT` | Server port (default: 8002) | Health checks |
| `GROUP_CRED` | FROSTR group credential | Server startup test |
| `SHARE_CRED` | FROSTR share credential | Server startup test |

## Release Artifacts

Each release produces:
1. **Git Tag**: `v{version}` on master branch
2. **GitHub Release**: With auto-generated changelog
3. **Updated package.json**: New version number
4. **Release Branch**: Archived as `release/prepare-v{version}`

## Rollback Procedure

If a release needs to be rolled back:

1. **Revert on Master**
   ```bash
   git checkout master
   git revert -m 1 <merge-commit-hash>
   git push origin master
   ```
   _Use `-m 1` for the common case where master was the first parent of the merge. If you merged from a different base, substitute the parent number that represents the stable branch you want to keep._

2. **Create Hotfix**
   ```bash
   git checkout -b hotfix/v{version}-rollback
   # Make fixes
   git push origin hotfix/v{version}-rollback
   # Create PR to master
   ```

## Monitoring Post-Release

After release:
1. Check GitHub Actions for successful workflow completion
2. Verify release appears on GitHub Releases page
3. Test deployment in production environment
4. Monitor error logs and metrics

## Script Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General failure (wrong branch, dirty working directory, tests failed) |

## Advanced Usage

### Custom Release from Specific Commit
```bash
git checkout dev
git reset --hard <commit-hash>
./scripts/release.sh minor
```

### Dry Run (Manual Steps)
```bash
# Check what version would be created
npm version patch --dry-run

# Manually test server
bun run build
bun run start
# In another terminal:
curl http://localhost:8002/api/status
```

## Troubleshooting Guide

### Release Script Hangs
**Symptom**: Script doesn't proceed past server startup
**Cause**: Server failing to start properly
**Solution**: 
1. Check server logs
2. Verify environment variables
3. Run server manually to see errors

### GitHub Actions Not Triggered
**Symptom**: No release created after merge
**Cause**: Actions disabled or misconfigured
**Solution**: 
1. Check Actions tab in GitHub
2. Verify workflow permissions
3. Check branch protection rules

### Version Already Exists
**Symptom**: npm version fails
**Cause**: Version tag already exists
**Solution**:
1. Use different version number
2. Delete existing tag (if appropriate)
   **⚠️ WARNING**: Only delete tags if you're certain they haven't been used in production
```bash
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
```

## Summary

The Igloo Server release process ensures:
- ✅ Code is tested before release
- ✅ Server starts successfully
- ✅ Documentation is valid
- ✅ Version numbers follow semver
- ✅ Changes are properly categorized
- ✅ Process is reproducible and reliable

By following this process, releases are consistent, documented, and safe for production deployment.
