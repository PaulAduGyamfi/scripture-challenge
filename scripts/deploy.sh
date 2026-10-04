#!/usr/bin/env bash
# Pulls the latest code, rebuilds and restarts the bot. Run on the server, by hand
# (npm run deploy) or by GitHub after the tests pass.
# Stops at the first error, so a failed build never restarts the bot onto broken code.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Pulling latest code"
git pull --ff-only
echo "== Installing packages"
npm ci --no-audit --no-fund
echo "== Building"
npm run build
echo "== Checking .env"
# New settings arrive in .env.example; .env lives only on this server, so list any it's missing
missing=$(comm -23 <(grep -oE '^[A-Z_]+=' .env.example | sort) <(grep -oE '^[A-Z_]+=' .env | sort) | tr -d '=' | xargs)
if [ -n "$missing" ]; then
  echo "!! .env is missing: $missing  (see .env.example, then: pm2 restart scripture-bot)"
fi
echo "== Restarting the bot"
pm2 restart scripture-bot      # the bot only loads new code when it starts
echo "== Deployed $(git log -1 --oneline)"
