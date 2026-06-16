#!/bin/bash
# ===========================================
# Register Telegram Webhook — Shell Script
# ===========================================
# Usage: bash deploy/register-webhook.sh
#
# Reads TELEGRAM_BOT_TOKEN, WEBHOOK_URL, and
# WEBHOOK_SECRET from .env and registers the
# webhook with Telegram's API.
# ===========================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${APP_DIR}/.env"

# Load .env values
if [ ! -f "${ENV_FILE}" ]; then
  echo "❌ .env file not found at ${ENV_FILE}"
  exit 1
fi

# Source env vars (handle multi-line values carefully)
TELEGRAM_BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "${ENV_FILE}" | cut -d'=' -f2-)
WEBHOOK_URL=$(grep '^WEBHOOK_URL=' "${ENV_FILE}" | cut -d'=' -f2-)
WEBHOOK_SECRET=$(grep '^WEBHOOK_SECRET=' "${ENV_FILE}" | cut -d'=' -f2-)

if [ -z "${TELEGRAM_BOT_TOKEN}" ]; then
  echo "❌ TELEGRAM_BOT_TOKEN not set in .env"
  exit 1
fi

if [ -z "${WEBHOOK_URL}" ]; then
  echo "❌ WEBHOOK_URL not set in .env"
  echo "   Set it to your public HTTPS URL (e.g., https://yourdomain.com)"
  exit 1
fi

API_BASE="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
WEBHOOK_ENDPOINT="${WEBHOOK_URL}/api/telegram/webhook"

echo ""
echo "═══════════════════════════════════════════"
echo "  🔗 Telegram Webhook Registration"
echo "═══════════════════════════════════════════"
echo ""

# Step 1: Delete existing webhook
echo "Step 1: Clearing existing webhook..."
DELETE_RESULT=$(curl -s -X POST "${API_BASE}/deleteWebhook")
echo "  Result: ${DELETE_RESULT}"

# Step 2: Set new webhook
echo ""
echo "Step 2: Setting webhook to: ${WEBHOOK_ENDPOINT}"

WEBHOOK_BODY="{\"url\": \"${WEBHOOK_ENDPOINT}\", \"allowed_updates\": [\"callback_query\", \"message\"]"
if [ -n "${WEBHOOK_SECRET}" ]; then
  WEBHOOK_BODY="${WEBHOOK_BODY}, \"secret_token\": \"${WEBHOOK_SECRET}\""
fi
WEBHOOK_BODY="${WEBHOOK_BODY}}"

SET_RESULT=$(curl -s -X POST "${API_BASE}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "${WEBHOOK_BODY}")

echo "  Result: ${SET_RESULT}"

# Check if successful
if echo "${SET_RESULT}" | grep -q '"ok":true'; then
  echo "  ✅ Webhook registered successfully"
else
  echo "  ❌ Webhook registration failed"
  exit 1
fi

# Step 3: Verify webhook
echo ""
echo "Step 3: Verifying webhook..."
INFO_RESULT=$(curl -s "${API_BASE}/getWebhookInfo")
echo "  Info: ${INFO_RESULT}"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Done!"
echo "═══════════════════════════════════════════"
echo ""
