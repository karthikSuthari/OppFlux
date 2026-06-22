#!/bin/bash
# ===========================================
# Deployment Script — Oracle Cloud VM
# ===========================================
# Usage: ssh into your VM, then:
#   cd /opt/content-engine
#   bash deploy/deploy.sh
# ===========================================

set -euo pipefail

APP_DIR="/opt/content-engine"
HEALTH_URL="http://localhost:3000/health"
MAX_HEALTH_RETRIES=10
HEALTH_RETRY_DELAY=3

echo ""
echo "═══════════════════════════════════════════"
echo "  🚀 Content Engine — Deployment"
echo "═══════════════════════════════════════════"
echo ""

# ─── Step 1: Pull latest code ───
echo "📥 Step 1: Pulling latest code..."
cd ${APP_DIR}
git pull origin main
echo "  ✅ Code updated"

# ─── Step 2: Install dependencies ───
echo ""
echo "📦 Step 2: Installing dependencies..."
npm ci --production=false
echo "  ✅ Dependencies installed"

# ─── Step 3: Build TypeScript ───
echo ""
echo "🔨 Step 3: Building TypeScript..."
npm run build
echo "  ✅ Build complete"

# ─── Step 4: Restart PM2 processes ───
echo ""
echo "🔄 Step 4: Restarting PM2 processes..."
pm2 restart ecosystem.config.js
pm2 save
echo "  ✅ PM2 restarted"

# ─── Step 5: Wait for health check ───
echo ""
echo "🏥 Step 5: Waiting for server health..."
HEALTHY=false
for i in $(seq 1 ${MAX_HEALTH_RETRIES}); do
  sleep ${HEALTH_RETRY_DELAY}
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${HEALTH_URL} 2>/dev/null || echo "000")

  if [ "${HTTP_CODE}" = "200" ]; then
    HEALTHY=true
    echo "  ✅ Server is healthy (attempt ${i})"
    break
  else
    echo "  ⏳ Waiting... (attempt ${i}/${MAX_HEALTH_RETRIES}, HTTP ${HTTP_CODE})"
  fi
done

if [ "${HEALTHY}" = false ]; then
  echo "  ❌ Server health check failed after ${MAX_HEALTH_RETRIES} attempts"
  echo "  Check logs: pm2 logs content-server"
  exit 1
fi

# ─── Step 6: Final status ───
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Deployment Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Server health:  $(curl -s ${HEALTH_URL} | head -c 200)"
echo ""
echo "  Useful commands:"
echo "    pm2 list              — View running processes"
echo "    pm2 logs content-server — Server logs"
echo "    pm2 logs content-engine — Pipeline logs"
echo "    pm2 monit             — Real-time monitoring"
echo ""
