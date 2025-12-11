# Deployment Guide

This page collects detailed deploy steps and reverse‑proxy examples that were trimmed from README for brevity.

## Umbrel (App Store, 1.1.0+)

Use the packaged Umbrel app if you prefer a one-click install on your node. The bundle runs **Database mode** by default and persists `/app/data` on Umbrel’s volume.

1) On your Umbrel dashboard, open **App Store** → click the `…` menu (top-right) → **Community App Stores**.
2) Add `https://github.com/frostr-org/igloo-server-store` and save.
3) Open the new store entry, choose **Igloo Server**, and click **Install**.
4) First launch: go straight to the Igloo UI and create your admin user. Umbrel provides `ADMIN_SECRET` automatically, and the package sets `SKIP_ADMIN_SECRET_VALIDATION=true` so you don’t need to copy the secret from the CLI—the first user you create becomes the admin.
5) Configure relays and add your `GROUP_CRED` / `SHARE_CRED` in the UI. Subsequent updates arrive via the Umbrel store; start/stop from the Umbrel dashboard.

**Note:** `SKIP_ADMIN_SECRET_VALIDATION` should remain enabled only on Umbrel where the platform injects `ADMIN_SECRET` for you. Leave it `false` in other deployments to require the secret during onboarding.

## DigitalOcean (Docker)

You can skip cloning and building; pull the published image from GHCR.

1) Create a Droplet (Ubuntu 22.04+; 2GB RAM recommended) and install Docker + Compose:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```
2) Pull and run (pin a release tag for reproducibility, e.g., `1.4.2` or `umbrel-1.4.2`):
```bash
docker pull ghcr.io/frostr-org/igloo-server:latest
docker run -d --name igloo-server -p 8002:8002 \
  -v $PWD/data:/app/data \
  -e ADMIN_SECRET=$(openssl rand -hex 32) \
  -e AUTH_ENABLED=true \
  -e TRUST_PROXY=true \
  -e ALLOWED_ORIGINS=https://yourdomain.com \
  ghcr.io/frostr-org/igloo-server:latest
```
3) Docker Compose option (create `docker-compose.yml`):
```yaml
services:
  igloo:
    image: ghcr.io/frostr-org/igloo-server:latest  # pin a version for prod
    env_file: .env
    ports: ["8002:8002"]
    volumes:
      - ./data:/app/data
    environment:
      - HOST_NAME=0.0.0.0
      - HOST_PORT=8002
      - NODE_ENV=production
    restart: unless-stopped
```
Start with `docker compose up -d` after creating and editing `.env` (copy from `.env.example`).

4) Firewall (UFW):
```bash
sudo ufw allow 80 443 22
sudo ufw allow 8002   # only if accessing without reverse proxy
sudo ufw enable
```

## Reverse Proxy (nginx)

Minimal, WS‑aware proxy (add TLS via certbot or your provider):
```nginx
# http { } context
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 443 ssl;  server_name yourdomain.com;
  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s; proxy_send_timeout 600s; proxy_buffering off;
  }
}

server { listen 80; server_name yourdomain.com; return 301 https://$host$request_uri; }
```

## Security: TLS Requirements

**WARNING**: Never expose Igloo directly to the internet over HTTP in production.
Always deploy behind a TLS-terminating reverse proxy (nginx, Traefik, Cloudflare, etc.)
as shown in the nginx example above. Credentials (API keys, session tokens, Basic Auth)
transmitted over plain HTTP can be intercepted by attackers.

## Production Checklist

- `NODE_ENV=production`, `HOST_NAME=0.0.0.0` (container)
- Persist data: mount `./data:/app/data`
- Set secrets: `ADMIN_SECRET`, `SESSION_SECRET` (or allow auto‑gen), API creds
- Auth on: `AUTH_ENABLED=true` (non‑local) and `RATE_LIMIT_ENABLED=true`
- Proxy: set `TRUST_PROXY=true` and explicit `ALLOWED_ORIGINS`
- WebSocket upgrade headers forwarded (see nginx config)
- Healthcheck and restart policy configured (Compose defaults in `compose.yml`).

## Other Targets

- Start9: service manifest planned.

Keep an eye on `compose.yml` for a working reference configuration.
