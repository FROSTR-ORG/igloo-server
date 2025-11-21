# Umbrel-specific igloo-server image with non-root runtime user
FROM oven/bun:1.1.14 AS build

WORKDIR /app

# Copy package files first for dependency caching
COPY package.json bun.lock ./
COPY scripts ./scripts

# Install dependencies (dev deps needed for build)
RUN bun install --frozen-lockfile

# Copy source code and assets
COPY src ./src
COPY frontend ./frontend
COPY static ./static
COPY docs ./docs
COPY tsconfig.json ./

# Build bundled frontend assets
RUN bun run build

# Production stage with non-root user that matches Umbrel defaults
FROM oven/bun:1.1.14 AS production

ARG IGLOO_USER=igloo
ARG IGLOO_UID=1000
ARG IGLOO_GID=1000
ENV APP_HOME=/app \
    HOST_NAME=0.0.0.0 \
    HOST_PORT=8002

WORKDIR ${APP_HOME}

# Minimal init for signal handling and health checks
RUN apt-get update \
    && apt-get install --no-install-recommends -y tini curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifest and required scripts
COPY package.json bun.lock ./
COPY scripts ./scripts

# Install production dependencies
RUN bun install --production --frozen-lockfile && chmod +x ./scripts/umbrel-entrypoint.sh

# Bring in compiled application artifacts
COPY --from=build /app/src ./src
COPY --from=build /app/static ./static
COPY --from=build /app/docs ./docs
COPY --from=build /app/tsconfig.json ./

# Prepare writable directories and runtime user
RUN set -eux; \
    mkdir -p ${APP_HOME}/data; \
    groupadd --gid "${IGLOO_GID}" "${IGLOO_USER}" 2>/dev/null || true; \
    useradd --uid "${IGLOO_UID}" --gid "${IGLOO_GID}" --home "${APP_HOME}" --create-home --shell /usr/sbin/nologin "${IGLOO_USER}" 2>/dev/null || true; \
    chown -R ${IGLOO_UID}:${IGLOO_GID} ${APP_HOME}

EXPOSE 8002
VOLUME ["${APP_HOME}/data"]

USER ${IGLOO_UID}:${IGLOO_GID}

ENTRYPOINT ["tini", "--", "./scripts/umbrel-entrypoint.sh"]
CMD ["bun", "start"]
