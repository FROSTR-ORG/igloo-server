# Multi-stage build for smaller production image
FROM oven/bun:latest AS build

WORKDIR /app

# Copy package files (plus scripts needed during install) first for better caching
COPY package.json bun.lock ./
COPY scripts ./scripts

# Install all dependencies (including dev dependencies for building)
RUN bun install --frozen-lockfile

# Copy source code
COPY src ./src
COPY frontend ./frontend
COPY static ./static
COPY tsconfig.json ./

# Build the frontend
RUN bun run build

# --- Production stage ---
FROM oven/bun:latest AS production

WORKDIR /app

# Copy package files (and required scripts)
COPY package.json bun.lock ./
COPY scripts ./scripts

# Install only production dependencies
RUN bun install --production --frozen-lockfile

# Copy built application from build stage
COPY --from=build /app/src ./src
COPY --from=build /app/static ./static
COPY --from=build /app/tsconfig.json ./

EXPOSE 8002

# Set environment variables for Docker
ENV HOST_NAME=0.0.0.0
ENV HOST_PORT=8002
CMD ["bun", "start"]
