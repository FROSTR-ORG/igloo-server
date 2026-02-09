# Release Guide

Quick reference for releasing Igloo Server.

## 🚀 Quick Release (Recommended)

```bash
# For new features (minor)
bun run release:minor

# For bug fixes (patch)
bun run release:patch

# For breaking changes
bun run release:major
```

This will:
1. ✅ Validate you're on `dev` branch
2. ✅ Run tests and build  
3. ✅ Create release branch
4. ✅ Push to GitHub
5. ✅ Show next steps

## 📋 Manual Process

### 1. Prepare Release
```bash
git checkout dev
git pull origin dev
bun install && bun run build
bun run docs:validate
```

### 2. Create Release PR  
```bash
git checkout -b release/prepare-v1.1.1
git push origin release/prepare-v1.1.1
```
Create PR: `release/prepare-v1.1.1` → `master`

### 3. Merge & Release
- Merge PR to `master`
- GitHub Actions automatically:
  - Bumps version in `package.json`
  - Updates `CHANGELOG.md`
  - Creates GitHub release
  - Builds & publishes Docker images

### 4. Verify Release
- ✅ Check [GitHub Releases](https://github.com/FROSTR-ORG/igloo-server/releases)
- ✅ Test Docker image: `docker pull ghcr.io/frostr-org/igloo-server:latest`
- ✅ Sync dev: `git checkout dev && git merge master && git push origin dev`

## 🔄 Version Bumping Logic

GitHub Actions automatically detects version type from commit messages:

| Commit Message | Version Bump | Example |
|----------------|--------------|---------|
| `feat:` | Minor | 1.1.1 → 1.2.0 |
| `fix:` | Patch | 1.1.1 → 1.1.2 |
| `BREAKING CHANGE:` | Major | 1.1.1 → 2.0.0 |

## 🚨 Emergency Releases

For critical fixes:
```bash
git checkout master
git checkout -b hotfix/critical-fix
# Make fix and commit
git push origin hotfix/critical-fix
# Create PR to master
```

## 📦 Release Artifacts

Each release creates:
- 🐳 **Docker images**: `ghcr.io/frostr-org/igloo-server:latest` & `ghcr.io/frostr-org/igloo-server:x.y.z`
- 📁 **Source archive**: `igloo-server-x.y.z-src.tar.gz`
- 📦 **Binary archive**: `igloo-server-x.y.z.tar.gz` (with built frontend)
- 📝 **GitHub release** with changelog

## 📞 Help

- 📖 **Full docs**: [CONTRIBUTING.md](../CONTRIBUTING.md)
- 🐛 **Issues**: [GitHub Issues](https://github.com/FROSTR-ORG/igloo-server/issues)
- 💬 **Discord**: [FROSTR Community](https://discord.gg/frostr) 
