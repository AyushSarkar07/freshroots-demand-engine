#!/usr/bin/env bash
# Copies the app's settings from .env.local to Vercel production. Never prints values.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYS=(DATABASE_URL DATABASE_URL_UNPOOLED GEMINI_API_KEY GEMINI_MODEL TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID APP_URL CASE_EVALUATION_DATE)
for k in "${KEYS[@]}"; do
  v="$(grep -E "^${k}=" .env.local | head -1 | cut -d= -f2- || true)"
  if [ -z "$v" ]; then echo "skip  $k (empty)"; continue; fi
  printf '%s' "$v" | vercel env add "$k" production --force --sensitive >/dev/null 2>&1 && echo "set   $k" || { echo "FAIL  $k"; exit 1; }
done
