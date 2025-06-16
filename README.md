# Igloo Server

A production-ready server that combines **distributed threshold signing** with an **ephemeral Nostr relay** for the FROSTR protocol. This server acts as a persistent signing node in your FROSTR network while providing relay infrastructure for coordination between nodes.

## What is FROSTR?

**FROSTR** (Flexible Remote Operations using Shamir Threshold Resilience) is a protocol for distributed Bitcoin key management using threshold signatures. It allows you to split a Bitcoin private key into multiple shares and require only a subset (threshold) of those shares to create signatures, providing both security and redundancy.

## Architecture

This server provides two core services:

### 🔐 Bifrost Signing Node
- **Threshold Signatures**: Participates in distributed signing using Shamir's Secret Sharing
- **Always-On Operation**: Maintains persistent connections to coordinate with other nodes
- **Secure Key Management**: Never reconstructs the full private key on any single device
- **Multi-Network Support**: Connects to multiple Nostr relays for redundancy

### 📡 Ephemeral Nostr Relay
- **In-Memory Storage**: Temporarily caches events without persistent database
- **WebSocket Support**: Full NIP-01 compliant Nostr relay implementation  
- **Auto-Purging**: Configurable memory cleanup (default: 30 seconds)
- **Development Ready**: Perfect for testing and coordination within your signing network

## Key Features

- ✅ **Production Ready**: Built with TypeScript, comprehensive error handling, and Docker support
- ✅ **Zero Database**: Fully in-memory operation for maximum security and simplicity  
- ✅ **Hot Reload**: Development mode with automatic source code reloading
- ✅ **Multiple Networks**: Connects to external Nostr relays while hosting its own
- ✅ **Environment Based**: Secure configuration via environment variables
- ✅ **Modern Stack**: Powered by Bun runtime and @frostr/igloo-core

## Prerequisites

- **Bun** runtime (v1.0+) or **Node.js** (v18+)
- **FROSTR Credentials**: You need valid `GROUP_CRED` and `SHARE_CRED` from your FROSTR setup
- **Network Access**: Outbound connections to Nostr relays (ports 80/443)

## Quick Start

### 1. Environment Setup

Copy the example environment file and configure your credentials:

```bash
cp env.example .env
```

Edit `.env` with your FROSTR credentials:

```bash
# Required: Your FROSTR group and share credentials
GROUP_CRED=your_encoded_group_credential_here
SHARE_CRED=your_encoded_share_credential_here

# Optional: External relays to connect to (comma-separated)
RELAYS=wss://relay.damus.io,wss://relay.snort.social,wss://relay.nostr.bg

# Optional: Server configuration  
HOST_NAME=localhost
HOST_PORT=8002
```

### 2. Installation & Running

#### Option A: Manual Installation
```bash
# Install dependencies
bun install

# Start the server
bun run start
```

#### Option B: Docker Deployment
```bash
# Build and run with Docker Compose
docker compose up --build

# Or run in background
docker compose up -d --build
```

### 3. Verify Operation

The server will start on `http://localhost:8002` and provide:

- **HTTP Interface**: Basic web interface and static file serving
- **WebSocket Relay**: Nostr relay at `ws://localhost:8002` 
- **Bifrost Node**: Automatically connects to configured relays and participates in signing

Check the logs for connection status:
```
Server running at localhost:8002
[ bifrost ] connected
[ info   ] [ relay ] purging events every 30 seconds
```

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROUP_CRED` | ✅ Yes | - | Encoded FROSTR group credential |
| `SHARE_CRED` | ✅ Yes | - | Encoded FROSTR share credential |
| `RELAYS` | ❌ No | `[]` | Comma-separated list of external Nostr relay URLs |
| `HOST_NAME` | ❌ No | `localhost` | Hostname to bind the server to |
| `HOST_PORT` | ❌ No | `8002` | Port number for HTTP and WebSocket services |

## How It Works

1. **Startup**: The server loads your FROSTR credentials and initializes both services
2. **Network Connection**: Connects to external Nostr relays for coordination
3. **Local Relay**: Starts an ephemeral relay for local network coordination
4. **Signing Participation**: Listens for signing requests and participates in threshold signatures
5. **Event Relay**: Forwards coordination messages between nodes in your network

## Security Considerations

- **Credential Protection**: Keep your `.env` file secure and never commit it to version control
- **Network Security**: Run behind a firewall; only expose port 8002 if needed externally
- **Memory Safety**: The ephemeral relay purges all data regularly for privacy
- **No Key Reconstruction**: Your share never reconstructs the full private key

## Development

### Project Structure
```
├── src/
│   ├── server.ts      # Main server application
│   ├── const.ts       # Configuration constants
│   └── class/
│       └── relay.ts   # Nostr relay implementation
├── static/            # Web interface assets
├── compose.yml        # Docker Compose configuration
└── dockerfile         # Docker build configuration
```

### Building from Source
```bash
# Install dependencies
bun install

# Run in development mode (with hot reload)
bun --watch run src/server.ts

# Type checking
bun run typecheck
```

## Troubleshooting

### Common Issues

**Server won't start**: 
- Verify `GROUP_CRED` and `SHARE_CRED` are valid base64-encoded credentials
- Check that port 8002 is available

**Connection failures**:
- Ensure external relay URLs are correct and accessible
- Check firewall settings for outbound WebSocket connections

**Memory issues**:
- The relay purges events every 30 seconds by default
- For high-traffic scenarios, consider reducing purge interval

### Getting Help

- **Issues**: Open an issue in the [GitHub repository](https://github.com/FROSTR-ORG/igloo-server)
- **Documentation**: See [FROSTR Protocol Documentation](https://github.com/FROSTR-ORG) 
- **Community**: Join the FROSTR development community

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

For major changes, please open an issue first to discuss the proposed changes.
