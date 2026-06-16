#!/bin/bash
# ===========================================
# SSL Setup — Let's Encrypt + Certbot
# ===========================================
# Usage: sudo bash deploy/ssl-setup.sh YOUR_DOMAIN
#
# Prerequisites:
#   - Nginx installed and running
#   - DNS pointing to this server
#   - Port 80 and 443 open in firewall/security list
# ===========================================

set -euo pipefail

DOMAIN="${1:-}"

if [ -z "${DOMAIN}" ]; then
  echo "❌ Usage: sudo bash deploy/ssl-setup.sh YOUR_DOMAIN"
  echo "   Example: sudo bash deploy/ssl-setup.sh content.example.com"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  🔒 SSL Setup — Let's Encrypt"
echo "  Domain: ${DOMAIN}"
echo "═══════════════════════════════════════════"
echo ""

# ─── Step 1: Install Certbot ───
echo "📦 Step 1: Installing Certbot..."
if command -v apt-get &> /dev/null; then
  apt-get update -y
  apt-get install -y certbot python3-certbot-nginx
elif command -v yum &> /dev/null; then
  yum install -y certbot python3-certbot-nginx
elif command -v dnf &> /dev/null; then
  dnf install -y certbot python3-certbot-nginx
else
  echo "❌ Unsupported package manager. Install certbot manually."
  exit 1
fi
echo "  ✅ Certbot installed"

# ─── Step 2: Create webroot directory ───
echo ""
echo "📁 Step 2: Creating webroot for ACME challenges..."
mkdir -p /var/www/certbot
echo "  ✅ Directory created: /var/www/certbot"

# ─── Step 3: Obtain SSL certificate ───
echo ""
echo "🔐 Step 3: Obtaining SSL certificate..."
certbot --nginx \
  -d "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --email "admin@${DOMAIN}" \
  --redirect

echo "  ✅ SSL certificate obtained"

# ─── Step 4: Verify certificate ───
echo ""
echo "🔍 Step 4: Verifying SSL certificate..."
certbot certificates --domain "${DOMAIN}"

# ─── Step 5: Setup auto-renewal ───
echo ""
echo "🔄 Step 5: Configuring auto-renewal..."

# Certbot auto-renewal is usually set up by the package,
# but let's make sure the timer/cron is active
if systemctl list-timers | grep -q certbot; then
  echo "  ✅ Certbot systemd timer is active"
else
  # Add cron job as fallback
  CRON_CMD="0 0,12 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'"
  (crontab -l 2>/dev/null | grep -v certbot; echo "${CRON_CMD}") | crontab -
  echo "  ✅ Certbot renewal cron job added (runs twice daily)"
fi

# ─── Step 6: Test renewal ───
echo ""
echo "🧪 Step 6: Testing renewal (dry run)..."
certbot renew --dry-run
echo "  ✅ Renewal test passed"

# ─── Done ───
echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ SSL Setup Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Certificate: /etc/letsencrypt/live/${DOMAIN}/"
echo "  Auto-renewal: Active"
echo ""
echo "  Test HTTPS: curl -I https://${DOMAIN}/health"
echo ""
