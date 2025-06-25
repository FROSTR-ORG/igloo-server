# Security Guide for Igloo Server

This guide covers security best practices for deploying and configuring your igloo-server, which handles sensitive FROSTR credentials and signing operations.

## 🔒 Authentication Configuration

### Basic Setup
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

### 1. Single-User Setup (Personal)
```bash
# Minimal security for personal use
AUTH_ENABLED=true
API_KEY=your-personal-api-key
RATE_LIMIT_MAX=50
SESSION_TIMEOUT=7200  # 2 hours
```

### 2. Multi-User Team Setup
```bash
# Enhanced security for team access
AUTH_ENABLED=true
BASIC_AUTH_USER=team-admin
BASIC_AUTH_PASS=strong-team-password
API_KEY=team-api-key
RATE_LIMIT_MAX=200
SESSION_TIMEOUT=3600  # 1 hour
```

### 3. High-Security Enterprise Setup
```bash
# Maximum security configuration
AUTH_ENABLED=true
BASIC_AUTH_USER=enterprise-admin
BASIC_AUTH_PASS=very-strong-enterprise-password
API_KEY=enterprise-api-key-with-special-chars
SESSION_SECRET=256-bit-random-secret
SESSION_TIMEOUT=1800   # 30 minutes
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=300  # 5 minutes
RATE_LIMIT_MAX=50      # Strict limiting
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

- [ ] Authentication enabled in production
- [ ] Strong API keys and passwords
- [ ] HTTPS configured
- [ ] Firewall properly configured
- [ ] Rate limiting enabled
- [ ] .env file permissions secured (600)
- [ ] Credentials not in version control
- [ ] Regular credential rotation scheduled
- [ ] Monitoring and logging in place
- [ ] Backup and recovery plan tested

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