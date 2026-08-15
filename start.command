#!/bin/bash
# rk-bot launcher — double-click in Finder to start
set -e

cd "$(dirname "$0")"

# Sanity checks
if ! command -v bun >/dev/null 2>&1; then
  osascript -e 'display alert "rk-bot" message "bun is not installed. Run: curl -fsSL https://bun.sh/install | bash"'
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[launcher] installing dependencies…"
  bun install
fi

# Open the game + dashboard tabs 2s after boot
(
  sleep 2
  open "http://localhost:9001/"
  open "https://websea01.rayrag.com/"
) &

echo "[launcher] starting rk-bot…"
exec bun run start
