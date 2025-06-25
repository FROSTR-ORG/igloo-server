# Use the latest Bun image as the base environment.
FROM oven/bun:latest

# Set the working directory in the container to /app
WORKDIR /app

# Copy package files first (for better caching)
COPY package.json bun.lock ./

# Install dependencies using Bun
RUN bun install

# Copy the source code and frontend files
COPY src       ./src
COPY frontend  ./frontend
COPY static    ./static
COPY tsconfig.json ./

# Build the production frontend
RUN bun run build

# Expose the port the app runs on
EXPOSE 8002

# Run the application using Bun when the container launches
CMD ["bun", "start"]
