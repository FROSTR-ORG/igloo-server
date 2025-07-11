# Contributing to Igloo Server

Thank you for your interest in contributing to Igloo Server! This guide will help you understand our development workflow and how to contribute effectively.

## Development Workflow

### Prerequisites
- **Bun runtime** (recommended) or Node.js 18+
- **Git** for version control
- **Docker** (optional, for testing Docker builds)

### Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/your-username/igloo-server.git
   cd igloo-server
   ```

3. **Install dependencies**:
   ```bash
   bun install
   ```

4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

5. **Make your changes** and test locally:
   ```bash
   bun run build
   bun run start
   ```

6. **Commit your changes**:
   ```bash
   git commit -m "feat: add your feature description"
   ```

7. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

8. **Create a Pull Request** on GitHub

### Development Commands

```bash
# Start development server with hot reload
bun run dev

# Build for production
bun run build

# Build for development (no caching)
bun run build:dev

# Start the server
bun run start

# Clean build artifacts
bun run clean

# Test Docker build
bun run docker:build
bun run docker:run

# Validate OpenAPI documentation
bun run docs:validate
```

## Code Style & Standards

### TypeScript Guidelines
- Use functional programming patterns over classes
- Prefer explicit types over `any`
- Add JSDoc comments for all public functions
- Use descriptive variable names with auxiliary verbs (e.g., `isLoading`, `hasError`)

### File Organization
- Keep files under 500 lines for AI compatibility
- Use descriptive file names
- Add file header comments explaining the purpose
- Group related functionality into modules

### Example Function Documentation
```typescript
/**
 * Creates a new Bifrost node with the provided credentials
 * @param groupCred - The FROSTR group credential
 * @param shareCred - The FROSTR share credential
 * @param relays - Array of relay URLs to connect to
 * @returns Promise resolving to the connected node instance
 */
export async function createNodeWithCredentials(
  groupCred: string,
  shareCred: string,
  relays: string[]
): Promise<BifrostNode> {
  // Implementation...
}
```

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) for consistent commit messages:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `security`: Security fixes

### Examples
```bash
git commit -m "feat: add peer status monitoring"
git commit -m "fix: resolve connection timeout issue"
git commit -m "docs: update API documentation"
git commit -m "chore: update dependencies"
```

## Release Process

### Automatic Releases

The project uses automated releases through GitHub Actions:

1. **Push to master** triggers automatic release detection
2. **Version bumping** is based on commit messages:
   - `feat:` → minor version bump
   - `fix:` → patch version bump
   - `BREAKING CHANGE:` → major version bump

3. **Manual releases** can be triggered via GitHub Actions UI

### Release Commands

```bash
# Create a patch release (1.0.0 → 1.0.1)
bun run release:patch

# Create a minor release (1.0.0 → 1.1.0)
bun run release:minor

# Create a major release (1.0.0 → 2.0.0)
bun run release:major

# Create a custom version
npm version 1.2.3
git push origin master --tags
```

### Release Artifacts

Each release automatically creates:
- **GitHub Release** with changelog
- **Docker images** published to GitHub Container Registry
- **Source archives** (tar.gz)
- **Binary archives** (with built frontend)

### Docker Images

```bash
# Latest release
docker pull ghcr.io/frostr-org/igloo-server:latest

# Specific version
docker pull ghcr.io/frostr-org/igloo-server:1.0.0
```

## Testing

### Manual Testing Checklist

Before submitting a PR, please verify:

- [ ] **Build succeeds**: `bun run build`
- [ ] **Server starts**: `bun run start`
- [ ] **Docker build works**: `docker build -t igloo-server .`
- [ ] **Frontend loads** at http://localhost:8002
- [ ] **API endpoints respond** (e.g., `/api/status`)
- [ ] **API documentation loads** at http://localhost:8002/api/docs
- [ ] **OpenAPI spec is valid**: `bun run docs:validate`
- [ ] **No console errors** in browser or server logs

### Automated Testing

The CI pipeline runs:
- TypeScript compilation
- Build verification
- Server startup test
- Docker image build
- Security scanning

## Pull Request Guidelines

### Before Submitting
1. **Update documentation** if you change APIs
2. **Update OpenAPI spec** if you modify API endpoints (`docs/openapi.yaml`)
3. **Add tests** for new functionality
4. **Update CHANGELOG.md** if needed
5. **Verify your changes** don't break existing functionality

### PR Description
Use the provided PR template and include:
- Clear description of changes
- Type of change (feature, bug fix, etc.)
- Testing steps
- Screenshots (if UI changes)
- Any breaking changes

### Review Process
1. **Automated checks** must pass
2. **Code review** by maintainers
3. **Testing** in different environments
4. **Merge** to master branch

## Security

### Reporting Security Issues
Please report security vulnerabilities privately to:
- **Email**: security@frostr.org
- **GitHub**: Use private security advisories

### Security Guidelines
- Never commit secrets or credentials
- Use environment variables for sensitive data
- Follow the security configuration guide in `SECURITY.md`
- Keep dependencies updated

## Getting Help

### Resources
- **Documentation**: [README.md](README.md)
- **Security Guide**: [SECURITY.md](SECURITY.md)
- **Issues**: [GitHub Issues](https://github.com/FROSTR-ORG/igloo-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FROSTR-ORG/igloo-server/discussions)

### Community
- **Discord**: [FROSTR Community](https://discord.gg/frostr)
- **Matrix**: [#frostr:matrix.org](https://matrix.to/#/#frostr:matrix.org)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors are recognized in:
- Release notes
- README.md contributors section
- GitHub contributors graph

Thank you for helping make Igloo Server better! 🎉 