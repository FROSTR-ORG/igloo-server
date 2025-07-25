#!/bin/bash

# Release script for Igloo Server
# Usage: ./scripts/release.sh [patch|minor|major|x.y.z]

set -e

VERSION_TYPE=${1:-"patch"}
CURRENT_BRANCH=$(git branch --show-current)

echo "🚀 Starting release process..."

# Ensure we're on dev branch
if [ "$CURRENT_BRANCH" != "dev" ]; then
    echo "❌ Must be on 'dev' branch. Currently on '$CURRENT_BRANCH'."
    echo "   Run: git checkout dev"
    exit 1
fi

# Ensure working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Working directory is not clean. Please commit or stash changes."
    exit 1
fi

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin dev

# Run tests and build
echo "🔨 Building project..."
bun install
bun run build

echo "✅ Testing server startup..."
# Check if port 8002 is already in use
if lsof -i :8002 > /dev/null 2>&1; then
    echo "❌ Port 8002 is already in use. Please stop any running servers."
    exit 1
fi

# Start server in background and capture PID
bun run start &
SERVER_PID=$!

# Set up cleanup trap
cleanup_server() {
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null
        wait $SERVER_PID 2>/dev/null
    fi
}
trap cleanup_server EXIT INT TERM

# Wait for server to initialize
sleep 3

# Test server health with retry logic
echo "🔍 Checking server health..."
SERVER_HEALTHY=false
for i in {1..5}; do
    if curl -f -s http://localhost:8002/api/status > /dev/null; then
        echo "✅ Server is responding correctly"
        SERVER_HEALTHY=true
        break
    else
        echo "⏳ Health check attempt $i/5 failed, retrying..."
        sleep 1
    fi
done

if [ "$SERVER_HEALTHY" = false ]; then
    echo "❌ Server failed to respond after 5 attempts"
fi

# Cleanup will be handled by trap, just check if we should fail
if [ "$SERVER_HEALTHY" = false ]; then
    echo "❌ Server startup test failed - cannot proceed with release"
    exit 1
fi

echo "📋 Validating documentation..."
bun run docs:validate

# Determine version
if [[ "$VERSION_TYPE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    NEW_VERSION="$VERSION_TYPE"
else
    CURRENT_VERSION=$(node -p "require('./package.json').version")
    echo "📊 Current version: $CURRENT_VERSION"
    echo "📈 Version bump type: $VERSION_TYPE"
    
    # Compute new version using npm version command
    NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
    # Remove 'v' prefix from version (npm version returns v1.2.3)
    NEW_VERSION=${NEW_VERSION#v}
    echo "🎯 New version: $NEW_VERSION"
fi

# Create release branch
RELEASE_BRANCH="release/prepare-v${NEW_VERSION:-next}"
echo "🌿 Creating release branch: $RELEASE_BRANCH"
git checkout -b "$RELEASE_BRANCH"

# Push release branch
git push origin "$RELEASE_BRANCH"

echo ""
echo "✅ Release preparation complete!"
echo ""
echo "Next steps:"
echo "1. 🔍 Review changes: https://github.com/FROSTR-ORG/igloo-server/compare/master...$RELEASE_BRANCH"
echo "2. 📝 Create PR: $RELEASE_BRANCH → master"
echo "3. 🔄 Merge PR to trigger automated release"
echo "4. 🎉 Monitor GitHub Actions for release completion"
echo "" 