# Permafrost

Ephemeral relay and remote signing server for the FROSTR protocol.

## Features

* **Bifrost Signing**: An always-on signing node for your FROSTR network.
* **Ephemeral Relay**: Includes a built-in nostr relay for your Bifrost nodes.
* **Docker Support**: Ready-to-deploy Docker configuration.

## Configuration

Create a `.env` file in the project root with the following variables:

```conf
# Group credentials for the server.
GROUP_CRED=your_group_credentials
# Share credentials for the server.
SHARE_CRED=your_share_credentials
# Additional nostr relays to connect to (for the Bifrost node)
RELAYS=wss://relay1.com,wss://relay2.com
# Host name to listen on.
HOST_NAME=localhost
# Port to listen on.
HOST_PORT=8002
```

> You can use the `env.example` file as a guide.

## Installation

You can choose to install the server manually or use the Docker configuration.

### Manual Installation

1. Install dependencies using `bun install`
2. Run the server using `bun run start` 

### Docker Installation

1. Clone the repository and navigate to the project directory
2. Build the Docker image using   `docker compose build`
3. Run the Docker container using `docker compose up`

## Ephemeral Relay

The server includes a fully functional Nostr relay that is used as a back-bone for other Bifrost nodes in your signing network. It does not use a database, but instead caches events in memory for a configurable amount of time.

> Coming soon: The relay will be permissioned to only allow connections from your Bifrost nodes.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

For questions and support, please open an issue in the GitHub repository.
