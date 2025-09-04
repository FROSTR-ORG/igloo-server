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

### Security Comparison Table

| Feature | Database Mode | Headless Mode |
|---------|--------------|---------------|
| Multi-user Support | ✅ Yes | ❌ No (single user) |
| Credential Storage | 🔐 Encrypted in database | 📝 Plain in environment |
| Initial Setup | 🔑 ADMIN_SECRET required | ⚙️ Direct env configuration |
| Password Protection | ✅ Bcrypt hashed | 🔑 API key/basic auth only |
| Credential Rotation | ✅ Per-user basis | 🔄 Server restart required |
| User Management | ✅ Add/remove users | ❌ Not applicable |
| Backup Complexity | 📦 Database file + env | 📄 Environment only |
| Migration Path | ✅ Import from env | ✅ Export to env |

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
   ADMIN_SECRET=your-64-character-hex-string-here
   ```

3. **Important ADMIN_SECRET Guidelines**:
   - **One-time use**: Only needed for creating the first user
   - **Keep it secret**: Never share or commit to version control
   - **Rotate after setup**: Change it after initial configuration
   - **Store securely**: Use a password manager or secure vault

#### Database Security Features
- **Password Hashing**: Bcrypt with salt (cost factor 12)
- **Credential Encryption**: AES-256 with PBKDF2 key derivation
- **Database Location**: Configurable via DB_PATH (default: ./data)
- **Per-user isolation**: Each user has encrypted credentials

#### User Management Flow
1. Admin validates with ADMIN_SECRET
2. Creates username and password
3. User logs in with credentials
4. Credentials stored encrypted with user's password as key

### Headless Mode Setup (HEADLESS=true)

1. **Enable Authentication** (recommended for all deployments):
   ```bash
   AUTH_ENABLED=true
   ```

2. **Choose Authentication Method**:
   
   **Option A: API Key (Recommended for API access)**
   ```bash
   API_KEY=your-super-secure-random-api-key-here
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
   SESSION_SECRET=your-random-session-secret
   SESSION_TIMEOUT=3600  # 1 hour
   ```
   Generate secret: `openssl rand -hex 32`

### Development vs Production

**Development** (local testing):
```bash
AUTH_ENABLED=false  # Only for local development
```

**Production** (always secure):
```bash
AUTH_ENABLED=true
API_KEY=your-production-api-key
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
- **Without `ALLOWED_ORIGINS`**: Defaults to wildcard `*` (all origins allowed) - ⚠️ **Security Risk**
- **With `ALLOWED_ORIGINS`**: Only specified domains can make API requests - ✅ **Secure**

⚠️ **Note**: The server shows a warning in production if `ALLOWED_ORIGINS` is not configured.

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
ADMIN_SECRET=your-admin-secret-for-setup
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
ADMIN_SECRET=team-admin-secret-for-onboarding
DB_PATH=/var/lib/igloo/data
AUTH_ENABLED=true
API_KEY=team-api-key  # For CI/CD integration
ALLOWED_ORIGINS=https://team.company.com,https://admin.company.com
RATE_LIMIT_MAX=200
SESSION_TIMEOUT=3600  # 1 hour
```

#### 3. High-Security Enterprise Database Setup
```bash
# Maximum security with database mode
HEADLESS=false
ADMIN_SECRET=enterprise-grade-secret-512-bits
DB_PATH=/encrypted/volume/igloo/data
AUTH_ENABLED=true
API_KEY=enterprise-api-key-with-special-chars
ALLOWED_ORIGINS=https://secure.enterprise.com
SESSION_SECRET=256-bit-random-secret
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
GROUP_CRED=bfgroup1...
SHARE_CRED=bfshare1...
AUTH_ENABLED=true
API_KEY=your-personal-api-key
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_MAX=50
SESSION_TIMEOUT=7200  # 2 hours
```

#### 2. Simple Server Setup
```bash
# Headless mode for single signing node
HEADLESS=true
GROUP_CRED=bfgroup1...
SHARE_CRED=bfshare1...
AUTH_ENABLED=true
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=strong-password
API_KEY=automation-key
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

## 📦 Database Backup and Migration

### Database Mode Backup
```bash
# Backup database file
cp data/igloo.db data/igloo-backup-$(date +%Y%m%d).db

# Backup with encryption
tar -czf - data/igloo.db | openssl enc -aes-256-cbc -salt -out backup.tar.gz.enc

# Restore from backup
cp data/igloo-backup-20240101.db data/igloo.db
```

### Migration Between Modes

#### Headless → Database Mode
1. Start in headless mode with credentials
2. Access the web UI
3. Use Configure page to save credentials
4. Switch to database mode:
   ```bash
   HEADLESS=false
   ADMIN_SECRET=your-admin-secret
   ```
5. Complete onboarding flow

#### Database → Headless Mode
1. Export credentials from database (manual process)
2. Set environment variables:
   ```bash
   HEADLESS=true
   GROUP_CRED=exported-group-cred
   SHARE_CRED=exported-share-cred
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
API_KEY=test-api-key-12345
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