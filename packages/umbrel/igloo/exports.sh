#!/bin/bash
set -euo pipefail

if [ -n "${APP_PASSWORD:-}" ]; then
  echo "IGLOO_ADMIN_SECRET=$APP_PASSWORD"
fi

if [ -n "${APP_DOMAIN:-}" ]; then
  echo "IGLOO_UI_URL=https://$APP_DOMAIN"
  echo "IGLOO_API_URL=https://$APP_DOMAIN/api"
fi

if [ -n "${APP_TOR_ADDRESS:-}" ]; then
  echo "IGLOO_TOR_URL=http://$APP_TOR_ADDRESS"
fi
