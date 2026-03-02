#!/bin/bash
# FlowDataGouv — Script de déploiement (zero-downtime)
#
# Usage : ./scripts/deploy.sh
# Prérequis : Node.js 22+, PM2, Nginx installés
set -e

APP_DIR="/opt/flowdatagouv"
LIVE_DIR="/opt/flowdatagouv-live"
LOG_DIR="/var/log/flowdatagouv"

echo "=== FlowDataGouv Deploy ==="

# 1. Pull latest code
cd "$APP_DIR"
git pull origin main

# 2. Install dependencies + build Next.js
npm ci --omit=dev
npm run build

# 3. Build MCP server
cd "$APP_DIR/mcp"
npm ci --omit=dev
npm run build
cd "$APP_DIR"

# 4. Prepare live directory
mkdir -p "$LIVE_DIR/.next"
mkdir -p "$LIVE_DIR/mcp"
mkdir -p "$LOG_DIR"

# 5. Copy Next.js standalone build + assets + data
cp -r .next/standalone/* "$LIVE_DIR/"
cp -r .next/static "$LIVE_DIR/.next/"
cp -r public "$LIVE_DIR/"
cp -r data "$LIVE_DIR/"
cp ecosystem.config.cjs "$LIVE_DIR/"
cp .env.local "$LIVE_DIR/" 2>/dev/null || true

# 6. Copy MCP server build
cp -r mcp/dist "$LIVE_DIR/mcp/"
cp -r mcp/node_modules "$LIVE_DIR/mcp/"
cp mcp/package.json "$LIVE_DIR/mcp/"

# 7. Reload PM2 (zero-downtime)
cd "$LIVE_DIR"
if pm2 describe flowdatagouv > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs
  echo "=== PM2 reloaded ==="
else
  pm2 start ecosystem.config.cjs
  pm2 save
  echo "=== PM2 started ==="
fi

echo "=== Deploy complete ==="
