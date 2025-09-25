# Security Guide for Igloo Server

This guide covers security best practices for deploying and configuring your igloo-server, which handles sensitive FROSTR credentials and signing operations.

## 🎯 Operation Modes

Igloo Server supports two operation modes with different security models:

### Database Mode (Default - HEADLESS=false)
- **Multi-user support** with individual encrypted credential storage
- **Admin-controlled setup** using ADMIN_SECRET for initial configuration
- **Password-based encryption** for FROSTR credentials
- **SQLite database** with user management

### Headless Mode (HEADLESS=true)
- **Single-user mode** with environment variables
- **Direct credential storage** in environment
- **Traditional deployment** for backward compatibility
- **No database required**
- **Peer policies**: only explicit blocks are honored via `PEER_POLICIES` or `data/peer-policies.json`

### Security Comparison Table

| Feature | Database Mode | Headless Mode |
|---------|--------------|---------------|
| Multi-user Support | ✅ Yes | ❌ No (single user) |
| Credential Storage | 🔐 Encrypted in database | 📝 Plain in environment |
| Initial Setup | 🔑 ADMIN_SECRET required | ⚙️ Direct env configuration |
| Password Protection | ✅ Argon2id hashed | 🔑 API key/basic auth only |
| Credential Rotation | ✅ Per-user basis | 🔄 Server restart required |
| User Management | ✅ Add/remove users | ❌ Not applicable |
| Backup Complexity | 📦 Database file + env | 📄 Environment only |
| Migration Path | ✅ Import from env | ✅ Export to env |

## 🔑 SESSION_SECRET Auto-Generation

Starting with this version, Igloo Server **automatically generates and persists** SESSION_SECRET if not provided:

### How It Works
1. **First Run**: If no SESSION_SECRET is set in environment, the server:
   - Generates a cryptographically secure 64-character hex string
   - Saves it to `data/.session-secret` with 600 permissions (owner read/write only)
   - Uses atomic file operations to prevent corruption

2. **Subsequent Runs**: The server:
   - Checks for existing `.session-secret` file
   - Loads the previously generated secret
   - Sessions persist across restarts

3. **Manual Override**: You can still set your own:
   ```bash
   SESSION_SECRET=<EXAMPLE_SESSION_SECRET>  # Replace with 64-character secret
   ```

### Security Benefits
- **Zero-configuration security**: Sessions work securely out of the box
- **Persistent across restarts**: No session invalidation on server restart
- **Secure file storage**: 600 permissions on Unix systems
- **Atomic operations**: Prevents corruption during concurrent access

### File Locations
- **Default**: `./data/.session-secret`
- **Custom DB_PATH**: `$DB_PATH/.session-secret`
- **Docker**: Volume-mounted for persistence

## 🔒 Authentication Configuration

### Database Mode Setup (HEADLESS=false)

#### Initial Admin Secret Configuration
1. **Generate a secure ADMIN_SECRET** (required for first-time setup):
   ```bash
   # Generate a strong admin secret
   openssl rand -hex 32
   ```

2. **Set the admin secret**:
   ```bash
   ADMIN_SECRET=<EXAMPLE_ADMIN_SECRET>  # Replace with 64-character hex string
   ```

3. **Important ADMIN_SECRET Guidelines**:
   - **One-time use**: Only needed for creating the first user
   - **Keep it secret**: Never share or commit to version control
   - **Rotate after setup**: Change it after initial configuration
   - **Store securely**: Use a password manager or secure vault
   - **Container deployments**: Prefer container-native secrets (Docker/Kubernetes secrets) over environment variables
   - **Process security**: Environment variables can leak via process listings (ps), crash dumps, or metadata endpoints
   - **Log sanitization**: Never log or include `ADMIN_SECRET` in error messages

#### Database Security Features
- **Password Hashing**: Argon2id via Bun.password (secure default)
- **Credential Encryption**: AES-256-GCM with PBKDF2 key derivation (200,000 iterations, see `src/config/crypto.ts`)
- **Database Location**: Configurable via DB_PATH (default: ./data)
- **Per-user isolation**: Each user has encrypted credentials
- **Persistent Salts**: Database users have persistent salts for consistent key derivation
  - **Why persistent salts?** Unlike password hashing (where random salts are ideal), credential encryption requires deterministic key derivation to decrypt stored data across sessions
  - **Security maintained**: Each user still has a unique salt stored securely in the database, preventing rainbow table attacks
  - **Trade-off**: Salt persistence is necessary for the encryption/decryption of stored FROSTR credentials without storing the user's password

#### User Management Flow
1. Admin validates with ADMIN_SECRET
2. Creates username and password
3. User logs in with credentials
4. Credentials stored encrypted with user's password as key

#### User Type Separation (Security Design)
Igloo Server distinguishes between two user types for security:

**Database Users** (userId: number):
- Created through onboarding process
- Have persistent salts stored in database
- Can save/retrieve encrypted credentials
- Access to `/api/user/*` endpoints
- Credentials persist across sessions

**Environment Auth Users** (userId: string):
- Authenticated via Basic Auth or API Key
- Receive ephemeral session-specific salts
- **Cannot access credential storage endpoints**
- Designed for API access, not credential management
- Prevents accidental data loss from ephemeral keys

### Headless Mode Setup (HEADLESS=true)

1. **Enable Authentication** (recommended for all deployments):
   ```bash
   AUTH_ENABLED=true
   ```

2. **Choose Authentication Method**:
   
   **Option A: API Key (Recommended for API access)**
   ```bash
   API_KEY=<EXAMPLE_API_KEY>  # Replace with secure random API key
   ```
   Generate a secure key: `openssl rand -hex 32`
   
   **Option B: Username/Password (Recommended for web UI)**
   ```bash
   BASIC_AUTH_USER=your-username
   BASIC_AUTH_PASS=your-secure-password
   ```
   
   **Option C: Both (Most flexible)**
   Use both API key for programmatic access and basic auth for web interface.

3. **Session Security**:
   ```bash
   # SESSION_SECRET is now auto-generated if not provided!
   # The server creates and saves it securely in data/.session-secret
   # You can still override with your own value:
   # SESSION_SECRET=<EXAMPLE_SESSION_SECRET>  # Replace if needed
   SESSION_TIMEOUT=3600  # 1 hour
   ```
   Auto-generation uses cryptographically secure random bytes

### Development vs Production

**Development** (local testing):
```bash
AUTH_ENABLED=false  # Only for local development
```

**Production** (always secure):
```bash
AUTH_ENABLED=true
API_KEY=<EXAMPLE_PRODUCTION_API_KEY>  # Replace with production API key
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=your-strong-password
RATE_LIMIT_ENABLED=true
```

## 🛡️ Rate Limiting

Configure rate limiting to prevent abuse:

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=900    # 15 minutes
RATE_LIMIT_MAX=100       # 100 requests per window per IP
```

**Recommendations by use case**:
- **Personal use**: `RATE_LIMIT_MAX=50`
- **Team use**: `RATE_LIMIT_MAX=200`
- **High traffic**: `RATE_LIMIT_MAX=500`

## 🌐 Network Security

## ⏱️ Cryptographic Operation Timeouts

Threshold signing and ECDH may stall due to peer/relay conditions. The server enforces timeouts to protect responsiveness.

- Applies to:
  - `/api/sign` (threshold Schnorr signing)
  - `/api/nip44/encrypt|decrypt` (ECDH + NIP‑44)
  - `/api/nip04/encrypt|decrypt` (ECDH + NIP‑04)
- Configuration:
  - `FROSTR_SIGN_TIMEOUT` (preferred) or `SIGN_TIMEOUT_MS`
  - Default: `30000` ms; bounds: `1000`–`120000` ms
- Behavior:
  - On timeout, the server returns HTTP `504 Gateway Timeout` with a clear error message and logs a warning.
  - Underlying operations are not crashed; the HTTP request is released to keep the service responsive.

## 🔐 Ephemeral Derived Key Handling
- To minimize exposure of password‑derived keys, the server stores them in an in‑memory ephemeral vault rather than persistent session state.
- Keys are available for a short bootstrap window after login, then auto‑deleted.
- Configuration:
  - `AUTH_DERIVED_KEY_TTL_MS` (default `120000`) – maximum residency time in ms
  - `AUTH_DERIVED_KEY_MAX_READS` (default `3`) – maximum one-time retrievals per session
- Behavior:
  - Each retrieval returns a copy and decrements the read budget; on zero or TTL expiry, the server fills the backing `Uint8Array` with zeros before removal.
  - Logout and session expiry proactively zeroize associated keys, and per-request caches are wiped once responses are sent.
  - ⚠️ JavaScript engines may retain historical copies (GC, structured clones); zeroization is best-effort and should be paired with short TTLs and minimal reuse.

### CORS (Cross-Origin Resource Sharing) Security

Configure secure CORS to prevent unauthorized domains from accessing your API:

**Production (Secure)**:
```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

**Development (Flexible)**:
```bash
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8002
```

**Security Impact**:
- **Without `ALLOWED_ORIGINS`**:
  - Development: Defaults to wildcard `*` (all origins allowed) for easier testing
  - **Production: CORS requests are BLOCKED** - ✅ **Secure by default**
- **With `ALLOWED_ORIGINS`**: Only specified domains can make API requests - ✅ **Secure**

🔒 **Security Enforcement**: As of the latest version, the server will **block all CORS requests** in production if `ALLOWED_ORIGINS` is not configured. This prevents accidental security vulnerabilities from misconfiguration.

**Common Configurations**:
```bash
# Single domain
ALLOWED_ORIGINS=https://myapp.com

# Multiple domains
ALLOWED_ORIGINS=https://myapp.com,https://admin.myapp.com,https://staging.myapp.com

# Local development
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:8002
```

### HTTPS/TLS Setup

**Option 1: Reverse Proxy (Recommended)**
Use nginx or Caddy as a reverse proxy with automatic HTTPS:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Option 2: Caddy (Simplest)**
```caddyfile
your-domain.com {
    reverse_proxy localhost:8002
}
```

### Firewall Configuration

**UFW (Ubuntu)**:
```bash
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (for HTTPS redirect)
ufw allow 443/tcp     # HTTPS
ufw deny 8002/tcp     # Block direct access to igloo-server
ufw enable
```

## 🔐 Credential Security

### FROSTR Credentials
- **Never commit** `GROUP_CRED` or `SHARE_CRED` to version control
- **Use .env files** with restricted permissions:
  ```bash
  chmod 600 .env
  chown your-user:your-user .env
  ```

### API Keys and Passwords
- **Generate strong API keys**: Use `openssl rand -hex 32`
- **Use strong passwords**: Minimum 12 characters, mixed case, numbers, symbols
- **Rotate credentials** regularly (monthly recommended)

### Environment Variable Protection
```bash
# Secure .env file permissions
chmod 600 .env
chown your-user:your-user .env

# Prevent accidentally committing secrets
echo ".env" >> .gitignore
echo "*.key" >> .gitignore
echo "*.pem" >> .gitignore
```

## 🏗️ Deployment Patterns

### Database Mode Deployments

#### 1. Personal Multi-Device Setup
```bash
# Database mode for personal use across devices
HEADLESS=false
ADMIN_SECRET=<EXAMPLE_ADMIN_SECRET>  # Replace with actual secret
DB_PATH=/secure/location/data
AUTH_ENABLED=true
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_MAX=50
SESSION_TIMEOUT=7200  # 2 hours
```

#### 2. Team Collaboration Setup
```bash
# Database mode for team with multiple users
HEADLESS=false
ADMIN_SECRET=<EXAMPLE_ADMIN_SECRET>  # Replace with actual secret
DB_PATH=<EXAMPLE_DB_PATH>  # e.g., /var/lib/igloo/data
AUTH_ENABLED=true
API_KEY=<EXAMPLE_API_KEY>  # Replace with actual API key for CI/CD
ALLOWED_ORIGINS=https://team.company.com,https://admin.company.com
RATE_LIMIT_MAX=200
SESSION_TIMEOUT=3600  # 1 hour
```

#### 3. High-Security Enterprise Database Setup
```bash
# Maximum security with database mode
HEADLESS=false
ADMIN_SECRET=<EXAMPLE_ENTERPRISE_ADMIN_SECRET>  # Replace with strong secret
DB_PATH=/encrypted/volume/igloo/data
AUTH_ENABLED=true
API_KEY=<EXAMPLE_ENTERPRISE_API_KEY>  # Replace with complex API key
ALLOWED_ORIGINS=https://secure.enterprise.com
# SESSION_SECRET auto-generated and persisted in data/.session-secret
SESSION_TIMEOUT=1800   # 30 minutes
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=300  # 5 minutes
RATE_LIMIT_MAX=50      # Strict limiting
NODE_ENV=production
```

### Headless Mode Deployments (Legacy)

#### 1. Single-User Setup (Personal)
```bash
# Headless mode for backward compatibility
HEADLESS=true
GROUP_CRED=<EXAMPLE_GROUP_CRED>  # Replace with actual group credential
SHARE_CRED=<EXAMPLE_SHARE_CRED>  # Replace with actual share credential
AUTH_ENABLED=true
API_KEY=<EXAMPLE_PERSONAL_API_KEY>  # Replace with your API key
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_MAX=50
SESSION_TIMEOUT=7200  # 2 hours
```

#### 2. Simple Server Setup
```bash
# Headless mode for single signing node
HEADLESS=true
GROUP_CRED=<EXAMPLE_GROUP_CRED>  # Replace with actual group credential
SHARE_CRED=<EXAMPLE_SHARE_CRED>  # Replace with actual share credential
AUTH_ENABLED=true
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=strong-password
API_KEY=<EXAMPLE_AUTOMATION_KEY>  # Replace with automation API key
ALLOWED_ORIGINS=https://server.domain.com
RATE_LIMIT_MAX=100
SESSION_TIMEOUT=3600  # 1 hour
```

## 🐳 Docker Security

### Secure Dockerfile Practices
```dockerfile
# Use non-root user
USER node

# Set secure environment
ENV NODE_ENV=production
ENV AUTH_ENABLED=true

# Use secrets for sensitive data
COPY --from=secrets /run/secrets/api_key /tmp/api_key
RUN export API_KEY=$(cat /tmp/api_key) && rm /tmp/api_key
```

### Docker Compose with Secrets
```yaml
version: '3.8'
services:
  igloo-server:
    build: .
    ports:
      - "127.0.0.1:8002:8002"  # Bind to localhost only
    environment:
      - AUTH_ENABLED=true
    secrets:
      - api_key
      - basic_auth_pass
    
secrets:
  api_key:
    file: ./secrets/api_key.txt
  basic_auth_pass:
    file: ./secrets/password.txt
```

## 📊 Monitoring and Logging

### Security Monitoring
Monitor these events for security issues:
- **Failed authentication attempts**
- **Rate limit violations**
- **API key misuse**
- **Session anomalies**

### Log Analysis
```bash
# Monitor auth failures
grep "Authentication required" server.log

# Check rate limiting
grep "Rate limit exceeded" server.log

# Monitor successful logins
grep "login" server.log
```

> See canonical guidance in the main README:
> - [Migration Between Modes](README.md#migration-between-modes)
> - [Database directory permissions and ownership](README.md#database-directory-permissions-and-ownership)
> These links consolidate backup/migration notes and permissions in one place, avoiding duplicate content here.



### Migration Between Modes

#### Headless → Database Mode
1. Start in headless mode with credentials
2. Access the web UI
3. Use Configure page to save credentials
4. Switch to database mode:
   ```bash
   HEADLESS=false
   ADMIN_SECRET=<EXAMPLE_ADMIN_SECRET>  # Replace with admin secret
   ```
5. Complete onboarding flow

#### Database → Headless Mode
1. Export credentials from database (manual process)
2. Set environment variables:
   ```bash
   HEADLESS=true
   GROUP_CRED=<EXAMPLE_GROUP_CRED>  # Replace with exported group credential
   SHARE_CRED=<EXAMPLE_SHARE_CRED>  # Replace with exported share credential
   ```
3. Remove database file (optional)

### Database Security Best Practices
- **File permissions**: `chmod 600 data/igloo.db`
- **Directory permissions**: `chmod 700 data/`
- **Regular backups**: Daily automated backups recommended
- **Encrypted storage**: Use encrypted filesystems for DB_PATH
- **Access logging**: Monitor database file access

## 🚨 Incident Response

### If Credentials Are Compromised

1. **Immediate Actions**:
   ```bash
   # Disable authentication temporarily
   AUTH_ENABLED=false
   # Restart server
   ```

2. **Generate New Credentials**:
   ```bash
   # New API key
   openssl rand -hex 32
   
   # New session secret
   openssl rand -hex 32
   ```

3. **Update Configuration**:
   - Change all passwords
   - Rotate API keys
   - Update session secrets

### Security Checklist

#### General Security
- [ ] Authentication enabled in production
- [ ] Strong API keys and passwords
- [ ] CORS origins configured (avoid wildcard `*`)
- [ ] HTTPS configured
- [ ] Firewall properly configured
- [ ] Rate limiting enabled
- [ ] .env file permissions secured (600)
- [ ] Credentials not in version control
- [ ] Regular credential rotation scheduled
- [ ] Monitoring and logging in place
- [ ] Backup and recovery plan tested

#### Database Mode Specific
- [ ] ADMIN_SECRET generated securely (64+ characters)
- [ ] ADMIN_SECRET rotated after initial setup
- [ ] Database file permissions set (600)
- [ ] Database directory secured (700)
- [ ] DB_PATH on encrypted filesystem (production)
- [ ] Regular database backups configured
- [ ] User passwords meet complexity requirements
- [ ] Session timeout configured appropriately

#### Headless Mode Specific
- [ ] GROUP_CRED and SHARE_CRED secured
- [ ] Environment variables properly isolated
- [ ] Process memory protected from dumps
- [ ] Server restart procedures documented

## 📚 API Usage Examples

### Using API Key
```bash
# With header
curl -H "X-API-Key: your-api-key" https://your-domain.com/api/status

# With bearer token
curl -H "Authorization: Bearer your-api-key" https://your-domain.com/api/status
```

### Using Basic Auth
```bash
curl -u username:password https://your-domain.com/api/status
```

### Using Session (Web UI)
The web interface handles session management automatically after login.

## 🔗 Additional Resources

- [OWASP Security Guidelines](https://owasp.org/www-project-top-ten/)
- [Let's Encrypt for Free TLS](https://letsencrypt.org/)
- [Fail2ban for Intrusion Prevention](https://www.fail2ban.org/)
- [Security Headers Checker](https://securityheaders.com/)

---

## 🧪 Testing Your Security Setup

### Local Testing
```bash
# 1. Test with authentication disabled (development)
AUTH_ENABLED=false
bun run start

# 2. Test with API key authentication
AUTH_ENABLED=true
API_KEY=<EXAMPLE_TEST_API_KEY>  # Replace with test API key
curl -H "X-API-Key: test-api-key-12345" http://localhost:8002/api/status

# 3. Test with basic authentication
AUTH_ENABLED=true
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=testpass123
curl -u admin:testpass123 http://localhost:8002/api/status

# 4. Test rate limiting
for i in {1..10}; do curl http://localhost:8002/api/status; done
```

### Security Validation Checklist
- [ ] Test unauthenticated requests are blocked
- [ ] Test rate limiting works correctly
- [ ] Test session timeout functionality
- [ ] Test logout clears sessions
- [ ] Test invalid credentials are rejected
- [ ] Test HTTPS works in production
- [ ] Test CORS headers are appropriate

**Remember**: Security is a process, not a destination. Regularly review and update your security configuration. 
4. **Directional Peer Policies** (optional):
   - Defaults allow both inbound and outbound traffic.
   - To deny a direction, supply `allowSend:false` and/or `allowReceive:false` in `PEER_POLICIES`.
   - The server mirrors saved overrides into `data/peer-policies.json` so they persist between restarts.
