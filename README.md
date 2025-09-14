# Igloo Server

A server-based signing device and personal ephemeral relay for the **FROSTR** protocol. Part of the FROSTR ecosystem of k-of-n remote signing clients for Nostr, providing an always-on signing node with optional web UI for configuration and monitoring.

Built on [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core) for reliable FROSTR protocol operations.

## Table of Contents

- [What is FROSTR?](#what-is-frostr)
- [Features](#features)
  - [🔐 FROSTR Signing Node](#-frostr-signing-node)
  - [🌐 Modern Web Interface](#-modern-web-interface)
  - [📡 Ephemeral Nostr Relay](#-ephemeral-nostr-relay)
  - [⚙️ Flexible Operation Modes](#️-flexible-operation-modes)
- [Architecture](#architecture)
- [Health Monitoring & Auto-Restart](#health-monitoring--auto-restart)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation & Setup](#installation--setup)
  - [Configuration Options](#configuration-options)
  - [Docker Deployment](#docker-deployment)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [Environment Management](#environment-management)
  - [Server Status](#server-status)
  - [Peer Management](#peer-management)
  - [Key Recovery](#key-recovery)
  - [Share Management](#share-management)
  - [Real-time Events](#real-time-events)
- [Deployment](#deployment)
  - [Digital Ocean Deployment](#digital-ocean-deployment)
  - [Umbrel Deployment](#umbrel-deployment)
  - [Start9 Deployment](#start9-deployment)
- [Development](#development)
  - [Development Mode](#development-mode)
  - [Development vs Production Caching](#development-vs-production-caching)
  - [Build Commands](#build-commands)
  - [Frontend Structure](#frontend-structure)
- [Built on Igloo-Core](#built-on-igloo-core)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
  - [Common Issues](#common-issues)
  - [Getting Help](#getting-help)
- [Security Configuration](#security-configuration)
  - [🔐 Authentication](#-authentication)
  - [📋 Quick Security Setup](#-quick-security-setup)
  - [🛡️ Security Features](#️-security-features)
- [Security Notes](#security-notes)
- [WebSocket Migration](WEBSOCKET_MIGRATION.md)
- [License](#license)
- [Contributing](#contributing)

## What is FROSTR?

**FROSTR** is a simple k-of-n remote signing and key management protocol for Nostr, using the powers of FROST. It allows you to break up an existing **nsec** into fragments called "shares" and create any kind of multi-signature setup using your shares and signing devices. If one share is compromised, your secret key remains safe, and your **npub** and signatures don't change - nobody knows you're using a multi-sig.

## Features

### 🔐 **FROSTR Signing Node**
- **Always-On Operation**: Persistent signing node that handles Nostr signature requests automatically
- **Share-Based Security**: Uses FROST threshold signatures with your nsec shares - never reconstructs the full private key
- **Multi-Relay Support**: Connects to multiple Nostr relays for redundancy and coordination
- **Real-time Monitoring**: Live peer status tracking and event logging
- **Health Monitoring**: Automatic node health checks with activity tracking every 30 seconds
- **Auto-Restart**: Automatic recovery from silent failures with watchdog timer (5-minute timeout)
- **Connection Resilience**: Enhanced reconnection logic with exponential backoff and extended timeouts

### 🌐 **Modern Web Interface** 
- **React Frontend**: Modern, responsive UI built with TypeScript and Tailwind CSS
- **Configuration Management**: Set up credentials, manage relays, and monitor status
- **Key Recovery**: Intuitive interface for recovering secrets from threshold shares
- **Live Event Logs**: Real-time visibility into signing operations and network events
- **Peer Management**: Monitor other nodes in your signing group with ping/status tracking
- **Authentication**: Secure login with multiple authentication methods (API key, username/password, sessions)

### 📡 **Ephemeral Nostr Relay**
- **Testing Convenience Only**: Built-in relay for development and integration testing; **not recommended for production deployments**
- **In-Memory Storage**: Temporarily caches events without persistent database
- **WebSocket Support**: Full NIP-01 compliant Nostr relay implementation  
- **Auto-Purging**: Configurable memory cleanup (default: 30 seconds)

### ⚙️ **Flexible Operation Modes**
- **Web UI Mode**: Full React interface for interactive management
- **Headless Mode**: Server-only operation via environment variables and APIs
- **API Access**: RESTful endpoints for programmatic control
- **Event Streaming**: WebSocket-based real-time updates with automatic reconnection

## Architecture

The server provides three integrated services:

1. **FROSTR Signing Node** - Built on igloo-core with bifrost protocol implementation
2. **Web Interface** - React frontend for configuration and monitoring  
3. **Ephemeral Test Relay** - In-memory relay included for development/testing convenience; not suitable for production

## Health Monitoring & Auto-Restart

Igloo Server includes a comprehensive health monitoring system designed to prevent silent failures and ensure reliable operation during long-running deployments:

### 🔍 **Health Monitoring**
- **Activity Tracking**: Every bifrost message, event, and connection update updates a `lastActivity` timestamp
- **Keepalive System**: Simple timestamp-based keepalive that runs every 30 seconds to prevent false unhealthy detection
- **Periodic Health Checks**: System checks node health every 30 seconds
- **Real-time Status**: Health information available via `/api/status` endpoint

### ⚡ **Auto-Restart System** 
- **Unhealthy Detection**: Node is considered unhealthy if no activity for 2 minutes
- **Watchdog Timer**: Automatic restart triggered if no activity for 5 minutes
- **Progressive Retry**: Uses exponential backoff for connection attempts
- **Graceful Recovery**: Maintains peer status and connection state through restarts

### 📊 **Health Metrics**
- **Last Activity**: Timestamp of most recent node activity
- **Health Status**: Boolean indicating if node is healthy
- **Consecutive Failures**: Number of consecutive health check failures
- **Restart Count**: Total number of automatic restarts
- **Time Since Activity**: Milliseconds since last activity

### 🛡️ **Connection Resilience**
- **Extended Timeouts**: Increased connection timeout to 30 seconds
- **More Retries**: Up to 5 connection attempts with exponential backoff
- **Enhanced Event Listening**: Comprehensive coverage of all node state changes
- **Silent Failure Recovery**: Detects and recovers from unresponsive nodes
- **Simplified Keepalive**: Updates activity timestamps locally without network operations when idle for over 90 seconds

This system addresses common issues with long-running deployments where nodes may silently stop responding after extended periods, ensuring your signing node remains operational and responsive.

## Quick Start

### Prerequisites

- **Bun runtime** (recommended) or Node.js 18+
- **FROSTR credentials** (group + share) from your nsec shares generated by Igloo Desktop

### Installation & Setup

```bash
# Clone the repository
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server

# Install dependencies
bun install

# Build the frontend
bun run build

# Start the server
bun run start
```

The server will be available at **http://localhost:8002**

### Configuration Options

#### Option 1: Web Interface (Recommended)
1. Open http://localhost:8002 in your browser
2. Use the **Configure** tab to enter your credentials:
   - **Group Credential** (`bfgroup1...`)
   - **Share Credential** (`bfshare1...`)
   - **Relay URLs** (optional - defaults to `wss://relay.primal.net`)
3. Switch to the **Signer** tab to start your signing node
4. Monitor operations in the **Event Log** and **Peer List**

**Note**: The Configure screen only allows updating FROSTR credentials and relay settings. Authentication settings (SESSION_SECRET, API_KEY, etc.) must be configured via environment variables or the `.env` file for security reasons.

#### Option 2: Headless Mode
Set environment variables and run the server directly:

```bash
# Create .env file
cat > .env << EOF
GROUP_CRED=bfgroup1qqsqp...your-group-credential
SHARE_CRED=bfshare1qqsqp...your-share-credential
RELAYS=["wss://relay.primal.net","wss://relay.damus.io"]
GROUP_NAME=my-signing-group
EOF

# Start server (node will start automatically with valid credentials)
bun run start
```

### Docker Deployment

```bash
# Build and run with Docker
docker build -t igloo-server .
docker run -p 8002:8002 \
  -e NODE_ENV="production" \
  -e HOST_NAME="0.0.0.0" \
  -e GROUP_CRED="bfgroup1qqsqp..." \
  -e SHARE_CRED="bfshare1qqsqp..." \
  -e RELAYS='["wss://relay.primal.net","wss://relay.damus.io"]' \
  -e AUTH_ENABLED="true" \
  -e SESSION_SECRET="your-random-64-char-session-secret-here" \
  -e API_KEY="your-secure-api-key-here" \
  -e BASIC_AUTH_USER="admin" \
  -e BASIC_AUTH_PASS="your-strong-password" \
  -e RATE_LIMIT_ENABLED="true" \
  igloo-server

# Or use Docker Compose
docker-compose up -d
```

## API Reference

The server provides RESTful APIs for programmatic control.

### 📖 Interactive API Documentation

**Swagger UI**: [http://localhost:8002/api/docs](http://localhost:8002/api/docs) - Interactive API explorer with request testing
**OpenAPI Spec**: 
- JSON: [http://localhost:8002/api/docs/openapi.json](http://localhost:8002/api/docs/openapi.json)
- YAML: [http://localhost:8002/api/docs/openapi.yaml](http://localhost:8002/api/docs/openapi.yaml)

💡 **Note**: Documentation requires authentication in production environments for security.

### API Endpoints

### Authentication
```bash
# Login with username/password or API key
POST /api/auth/login
Content-Type: application/json
{
  "username": "admin",
  "password": "your-password"
}
# OR
{
  "apiKey": "your-api-key"
}

# Logout (clear session)
POST /api/auth/logout

# Get authentication status
GET /api/auth/status
```

### Environment Management
```bash
# Get current configuration
GET /api/env

# Update configuration  
POST /api/env
Content-Type: application/json
{
  "GROUP_CRED": "bfgroup1...",
  "SHARE_CRED": "bfshare1...",
  "RELAYS": "[\"wss://relay.primal.net\"]"
}
# Note: Only FROSTR credentials and relay settings can be updated via API
# Authentication settings must be configured via environment variables

# Delete configuration keys
POST /api/env/delete
Content-Type: application/json
{
  "keys": ["GROUP_CRED", "SHARE_CRED"]
}
```

### Server Status
```bash
# Get server and node status
GET /api/status

# Response:
{
  "serverRunning": true,
  "nodeActive": true,
  "hasCredentials": true,
  "relayCount": 2,
  "relays": ["wss://relay.primal.net", "wss://relay.damus.io"],
  "timestamp": "2025-01-20T12:00:00.000Z",
  "health": {
    "isHealthy": true,
    "lastActivity": "2025-01-20T11:59:30.000Z",
    "lastHealthCheck": "2025-01-20T12:00:00.000Z",
    "consecutiveFailures": 0,
    "restartCount": 0,
    "timeSinceLastActivity": 30000
  }
}
```

### Peer Management
```bash
# List peers in signing group
GET /api/peers

# Get self public key
GET /api/peers/self

# Ping specific peer
POST /api/peers/ping
Content-Type: application/json
{
  "target": "02abcd1234...peer-pubkey"
}

# Ping all peers
POST /api/peers/ping
Content-Type: application/json
{
  "target": "all"
}
```

### Key Recovery
```bash
# Recover secret key from threshold shares
POST /api/recover
Content-Type: application/json
{
  "groupCredential": "bfgroup1...",
  "shareCredentials": ["bfshare1...", "bfshare1..."]
}

# Validate group or share credentials
POST /api/recover/validate
Content-Type: application/json
{
  "type": "group", // or "share"
  "credential": "bfgroup1..."
}
```

### Share Management
```bash
# Get stored shares
GET /api/shares

# Store new share
POST /api/shares
Content-Type: application/json
{
  "shareCredential": "bfshare1...",
  "groupCredential": "bfgroup1..."
}
```

### Real-time Events
```bash
# Subscribe to live event stream via WebSocket
WebSocket: ws://localhost:8002/api/events
# Or secure WebSocket: wss://yourdomain.com/api/events

# Authentication (if enabled) via URL parameters:
ws://localhost:8002/api/events?apiKey=your-api-key
ws://localhost:8002/api/events?sessionId=your-session-id

# Receives JSON events like:
{"type":"sign","message":"Signature request received","timestamp":"12:34:56","id":"abc123"}
{"type":"bifrost","message":"Peer connected","timestamp":"12:34:57","id":"def456"}
{"type":"system","message":"Connected to event stream","timestamp":"12:34:58","id":"ghi789"}
```

💡 **Note**: Real-time events have been migrated from Server-Sent Events (SSE) to **WebSockets** for better performance and reliability. See [WEBSOCKET_MIGRATION.md](WEBSOCKET_MIGRATION.md) for migration details.

## Deployment

### Digital Ocean Deployment

Deploy Igloo Server on Digital Ocean using Docker for a production-ready setup:

#### 1. Create a Digital Ocean Droplet
```bash
# Create a new droplet (Ubuntu 22.04 recommended)
# Minimum: 1GB RAM, 1 vCPU, 25GB SSD
# Recommended: 2GB RAM, 2 vCPU, 50GB SSD
```

#### 2. Install Docker
```bash
# Connect to your droplet via SSH
ssh root@your-droplet-ip

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 3. Deploy with Docker Compose
```bash
# Clone the repository
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server

# Create production environment file
cat > .env << EOF
NODE_ENV=production
HOST_NAME=0.0.0.0
GROUP_CRED=bfgroup1qqsqp...your-group-credential
SHARE_CRED=bfshare1qqsqp...your-share-credential
RELAYS=["wss://relay.primal.net","wss://relay.damus.io"]
GROUP_NAME=my-signing-group

# Security settings (REQUIRED for production)
AUTH_ENABLED=true
API_KEY=your-secure-api-key-here
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=your-strong-password
SESSION_SECRET=your-random-64-char-session-secret-here
RATE_LIMIT_ENABLED=true
ALLOWED_ORIGINS=https://yourdomain.com
EOF

# Deploy with Docker Compose
docker-compose up -d
```

#### 4. Configure Firewall
```bash
# Allow HTTP/HTTPS traffic
sudo ufw allow 80
sudo ufw allow 443
sudo ufw allow 22
sudo ufw allow 8002  # If accessing directly without reverse proxy

# Enable firewall
sudo ufw enable
```

#### 5. Set Up Reverse Proxy (Recommended)
```bash
# Install nginx
sudo apt update
sudo apt install nginx

# Configure nginx for SSL termination
sudo nano /etc/nginx/sites-available/igloo-server
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:8002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site and restart nginx
sudo ln -s /etc/nginx/sites-available/igloo-server /etc/nginx/sites-enabled/
sudo systemctl restart nginx

# Add SSL with Let's Encrypt (optional)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

#### 6. Monitor and Maintain
```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f

# Update deployment
git pull
docker-compose --env-file .env up -d --build
```

### Umbrel Deployment
*Coming Soon* - One-click installation through the Umbrel App Store.

### Start9 Deployment  
*Coming Soon* - Native Start9 service package for sovereign server deployments.

## Development

### Development Mode
```bash
# Start with hot reload
bun run dev

# This runs:
# - Frontend build with watch mode
# - Tailwind CSS compilation with watch mode
# - Server restart on changes (if using nodemon)
```

### Development vs Production Caching

The server automatically adjusts caching behavior based on the `NODE_ENV` environment variable:

**Development Mode** (`NODE_ENV !== 'production'`):
- Static files are read fresh from disk on each request
- No browser caching (`Cache-Control: no-cache`)
- Perfect for seeing frontend changes immediately after rebuild

**Production Mode** (`NODE_ENV=production`):
- Static files are cached in memory for performance
- Aggressive browser caching (24 hours for JS/CSS)
- Optimized for production deployment

```bash
# Force development mode (recommended for local development)
NODE_ENV=development bun start

# Force production mode
NODE_ENV=production bun start
```

### Build Commands
```bash
# Production build
bun run build          # Minified JS + CSS

# Development build (recommended for local development)
bun run build:dev      # Unminified for debugging, no server caching

# Individual builds
bun run build:js       # Frontend JavaScript only
bun run build:css     # Tailwind CSS compilation only
```

**💡 Tip**: Use `bun run build:dev` during development to avoid caching issues. The server will automatically detect non-production builds and disable static file caching.

### Frontend Structure
```
frontend/
├── index.tsx          # React app entry point
├── App.tsx           # Main app component with routing
├── components/       # Core components
│   ├── Configure.tsx # Credential configuration
│   ├── Signer.tsx    # Signing node management
│   ├── Recover.tsx   # Key recovery interface
│   └── EventLog.tsx  # Live event monitoring
├── components/ui/    # Reusable UI components
├── types/           # TypeScript definitions
└── lib/             # Utilities and helpers
```

## Built on Igloo-Core

This server leverages [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core) for all FROSTR protocol operations, providing:

- **Share Management** - Decode and validate FROSTR group and share credentials  
- **Bifrost Node Operations** - Enhanced connection handling with automatic retries
- **Peer Discovery & Monitoring** - Automatic peer extraction and status tracking from group credentials
- **Comprehensive Validation** - Built-in validation for all FROSTR credential types
- **Strong TypeScript Support** - Full type safety throughout the application

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `GROUP_CRED` | FROSTR group credential (bfgroup1...) | - | ✅ |
| `SHARE_CRED` | Your secret share (bfshare1...) | - | ✅ |
| `RELAYS` | JSON array of relay URLs | `["wss://relay.primal.net"]` | ❌ |
| `GROUP_NAME` | Display name for your signing group | - | ❌ |
| `HOST_NAME` | Server bind address | `localhost` | ❌ |
| `HOST_PORT` | Server port | `8002` | ❌ |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | `*` (all origins) | ⚠️ (Production) |
| `SESSION_SECRET` | Secret for session cookies (32+ chars) | - | ✅ (Production) |
| `NODE_RESTART_DELAY` | Initial delay before node restart (ms) | `30000` (30 seconds) | ❌ |
| `NODE_MAX_RETRIES` | Maximum number of restart attempts | `5` | ❌ |
| `NODE_BACKOFF_MULTIPLIER` | Exponential backoff multiplier | `1.5` | ❌ |
| `NODE_MAX_RETRY_DELAY` | Maximum delay between retries (ms) | `300000` (5 minutes) | ❌ |
| `NODE_HEALTH_MAX_RESTARTS` | Maximum health-based restarts before giving up | `3` | ❌ |
| `NODE_HEALTH_RESTART_DELAY` | Base delay for health restart backoff (ms) | `60000` (1 minute) | ❌ |
| `NODE_HEALTH_BACKOFF_MULTIPLIER` | Health restart exponential backoff multiplier | `2` | ❌ |

**💡 Network Configuration**: 
- **Local development**: Use `HOST_NAME=localhost` (default)
- **Docker deployment**: Use `HOST_NAME=0.0.0.0` to allow external connections

**🔄 Node Restart Configuration**: 
- **Main Restart System**: Handles manual restarts and major failures with configurable retry attempts
  - **Exponential Backoff**: Restart delays increase with each failure using the backoff multiplier
  - **Max Retries**: After reaching the maximum retry attempts, the node restart is abandoned
  - **Example**: With defaults, retry delays would be: 30s, 45s, 67s, 100s, 150s (max 5 attempts)
- **Health-Based Restart System**: Handles automatic restarts from health monitoring watchdog timeouts
  - **Separate Limits**: Independent restart count and backoff to prevent infinite health restarts
  - **Auto-Reset**: Restart count resets when node becomes healthy again
  - **Example**: With defaults, health restart delays would be: 60s, 120s, 240s (max 3 attempts)

## Troubleshooting

### Common Issues

**Build required error**: 
- Frontend build artifacts are not committed to git
- Run `bun run build` to generate required static files

**Server won't start with credentials**:
- Verify `GROUP_CRED` and `SHARE_CRED` are valid FROSTR credentials
- Check that credentials start with `bfgroup1` and `bfshare1` respectively
- Ensure relay URLs are accessible WebSocket endpoints

**Peer connection issues**:
- Verify all signers use at least one common relay
- Check firewall settings for outbound WebSocket connections  
- Timeout errors are normal when peers are offline

**Frontend not loading or changes not appearing**:
- Ensure you've run `bun run build` before starting the server
- Check that static files exist in the `static/` directory
- **For development**: Use `bun run build:dev` and `NODE_ENV=development bun start` to disable caching
- **If changes aren't showing**: The server caches static files differently in development vs production:
  - Development mode: Files read fresh from disk each time (no caching)
  - Production mode: Files cached in memory and browser for performance
- **Clear browser cache only if running in production mode** (Ctrl+F5 / Cmd+Shift+R)
- Restart the server after rebuilding if running in production mode

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/FROSTR-ORG/igloo-server/issues)
- **FROSTR Ecosystem**: [FROSTR Organization](https://github.com/FROSTR-ORG)
- **Core Library**: [@frostr/igloo-core](https://github.com/FROSTR-ORG/igloo-core)
- **Bifrost Reference**: [Bifrost Implementation](https://github.com/FROSTR-ORG/bifrost)

## Security Configuration

Igloo Server includes comprehensive security features to protect your FROSTR credentials and signing operations:

### 🔐 **Authentication**
- **Multiple Auth Methods**: API Key, Basic Auth, Session-based authentication
- **Configurable Security**: Enable/disable authentication for development vs production
- **Rate Limiting**: IP-based request limiting to prevent abuse
- **Session Management**: Secure cookie-based sessions with configurable timeouts

### 📋 **Quick Security Setup**

**Production (Secure)**:
```bash
AUTH_ENABLED=true
API_KEY=your-secure-api-key-here
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=your-strong-password
SESSION_SECRET=your-random-64-char-session-secret-here
RATE_LIMIT_ENABLED=true
```

**Development (Local only)**:
```bash
AUTH_ENABLED=false  # Only for local development
# SESSION_SECRET=optional-for-development  # Will show warning if not set
```

### 🛡️ **Security Features**
- **Timing-safe authentication** to prevent timing attacks
- **Environment variable whitelisting** for configuration endpoints
- **Automatic session cleanup** and timeout management
- **Comprehensive rate limiting** with configurable windows and limits
- **Secure headers** and CORS configuration
- **Required SESSION_SECRET** in production to prevent session invalidation on restarts

See [SECURITY.md](SECURITY.md) for complete security configuration guide.

## Security Notes

- **Share credentials are sensitive**: Store `SHARE_CRED` securely - it's part of your nsec fragments
- **Network security**: Use WSS (secure WebSocket) relays in production  
- **Authentication required**: Configure authentication for any non-local deployment
- **CORS security**: Set `ALLOWED_ORIGINS` to specific domains in production (avoid wildcard `*`)
- **SESSION_SECRET required**: Set a strong 32+ character `SESSION_SECRET` in production to prevent session invalidation on server restarts
- **Memory management**: The relay auto-purges events to prevent memory leaks
- **HTTPS recommended**: Use a reverse proxy with TLS for production deployments

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch  
3. Make your changes with tests
4. Submit a pull request

For major changes, please open an issue first to discuss the proposed changes.
