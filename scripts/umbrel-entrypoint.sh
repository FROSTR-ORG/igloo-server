#!/usr/bin/env bash
set -euo pipefail

APP_HOME="/app"
DATA_DIR="${APP_HOME}/data"
APP_USER="${IGLOO_USER:-igloo}"
APP_UID="${IGLOO_UID:-1000}"
APP_GID="${IGLOO_GID:-1000}"

log() {
  echo "[entrypoint] $*" >&2
}

ensure_data_dir() {
  if [ ! -d "${DATA_DIR}" ]; then
    log "Creating data directory at ${DATA_DIR}"
    mkdir -p "${DATA_DIR}"
  fi

  if chown -R "${APP_UID}:${APP_GID}" "${DATA_DIR}" 2>/dev/null; then
    chmod 700 "${DATA_DIR}" 2>/dev/null || true
  else
    log "Warning: unable to chown ${DATA_DIR}; ensure host volume is owned by UID ${APP_UID}."
  fi
}

ensure_data_dir

exec "$@"
