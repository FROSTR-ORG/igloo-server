# Deployment Guide

This page collects detailed deploy steps and reverse‑proxy examples that were trimmed from README for brevity.

## DigitalOcean (Docker)

1) Create a Droplet (Ubuntu 22.04+; 2GB RAM recommended).
2) Install Docker + Compose:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```
3) Clone and deploy:
```bash
git clone https://github.com/FROSTR-ORG/igloo-server.git
cd igloo-server
cp .env.example .env
# Edit .env for non‑sensitive defaults, export secrets in shell or use secrets manager
export ADMIN_SECRET=$(openssl rand -hex 32)
export API_KEY=$(openssl rand -hex 32)
docker compose up -d --build
```
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

- Umbrel: packaging planned.
- Start9: service manifest planned.

Keep an eye on `compose.yml` for a working reference configuration.
