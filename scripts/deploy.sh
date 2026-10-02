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
echo "== Restarting the bot"
pm2 restart scripture-bot      # the bot only loads new code when it starts
echo "== Deployed $(git log -1 --oneline)"
