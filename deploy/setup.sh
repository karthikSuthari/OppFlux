#!/bin/bash
# ===========================================
# Oracle Cloud VM Setup Script
# ===========================================
# Usage: scp this file to your VM, then:
#   chmod +x setup.sh
#   ./setup.sh
#
# Prerequisites:
#   - Oracle Cloud VM with Ubuntu 22.04+ or Oracle Linux 8+
#   - SSH access configured
#   - Ports 22 (SSH) open in security list
# ===========================================

set -euo pipefail

echo "═══════════════════════════════════════════"
echo "  Opportunity Content Engine - VM Setup"
echo "═══════════════════════════════════════════"

# ─── System Update ───
echo ""
echo "📦 Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y 2>/dev/null || \
sudo yum update -y 2>/dev/null || \
echo "⚠️  Package manager not detected, skipping system update"

# ─── Install Git ───
echo ""
echo "📦 Installing Git..."
sudo apt-get install -y git 2>/dev/null || \
sudo yum install -y git 2>/dev/null || \
echo "⚠️  Git install failed — may already be installed"

# ─── Install Node.js via NVM ───
echo ""
echo "📦 Installing Node.js via NVM..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  echo "  NVM already installed"
fi

nvm install 20
nvm use 20
nvm alias default 20

echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"

# ─── Install PM2 ───
echo ""
echo "📦 Installing PM2..."
npm install -g pm2
pm2 --version

# ─── Set up PM2 Startup Script ───
echo ""
echo "🔄 Configuring PM2 startup..."
pm2 startup
echo "  Run the command printed above with sudo if prompted"

# ─── Create Application Directory ───
APP_DIR="/opt/content-engine"
echo ""
echo "📁 Setting up application directory: ${APP_DIR}"
sudo mkdir -p ${APP_DIR}
sudo chown $(whoami):$(whoami) ${APP_DIR}

# ─── Clone Repository ───
echo ""
echo "📥 Cloning repository..."
if [ -d "${APP_DIR}/.git" ]; then
  echo "  Repository already exists, pulling latest..."
  cd ${APP_DIR}
  git pull origin main
else
  echo "  Enter your GitHub repository URL:"
  read -p "  > " REPO_URL
  git clone ${REPO_URL} ${APP_DIR}
  cd ${APP_DIR}
fi

# ─── Install Dependencies ───
echo ""
echo "📦 Installing Node.js dependencies..."
cd ${APP_DIR}
npm ci --production=false

# ─── Build TypeScript ───
echo ""
echo "🔨 Building TypeScript..."
npm run build

# ─── Create .env File ───
echo ""
if [ ! -f "${APP_DIR}/.env" ]; then
  echo "📝 Creating .env file from template..."
  cp .env.example .env
  echo ""
  echo "═══════════════════════════════════════════"
  echo "⚠️  IMPORTANT: Edit .env with your secrets!"
  echo "  nano ${APP_DIR}/.env"
  echo "═══════════════════════════════════════════"
else
  echo "  .env file already exists"
fi

# ─── Create Required Directories ───
echo ""
echo "📁 Creating directories..."
mkdir -p ${APP_DIR}/images
mkdir -p ${APP_DIR}/logs

# ─── Start with PM2 ───
echo ""
echo "🚀 Starting application with PM2..."
cd ${APP_DIR}
pm2 start ecosystem.config.js
pm2 save

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Setup Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "  1. Edit .env: nano ${APP_DIR}/.env"
echo "  2. Restart:   pm2 restart content-engine"
echo "  3. Logs:      pm2 logs content-engine"
echo "  4. Monitor:   pm2 monit"
echo "  5. Status:    pm2 list"
echo ""
echo "  The pipeline runs every 30 minutes via PM2 cron."
echo ""
echo "  Manual run:   cd ${APP_DIR} && node dist/index.js"
echo ""
