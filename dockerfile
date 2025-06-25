# Use a multi-stage build for smaller, more secure images

# --- Frontend build stage ---
FROM oven/bun:latest AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install
COPY frontend .
RUN bun run build

# --- Main app build stage ---
FROM oven/bun:latest AS app
WORKDIR /app

# Copy only necessary files for the backend
COPY package.json bun.lock ./
RUN bun install --production
COPY src ./src
COPY static ./static
COPY tsconfig.json ./

# Copy built frontend assets from the build stage
COPY --from=frontend-build /frontend/dist ./static/dist

EXPOSE 8002
CMD ["bun", "start"]
