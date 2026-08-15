#!/bin/bash
# rk-bot launcher — double-click in Finder.
# - Kills any previous instance on ports 9000/9001
# - Auto-restarts if bot exits (or you click Restart in the dashboard)
# - Ctrl+C stops the loop entirely
set -e

cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  osascript -e 'display alert "rk-bot" message "bun is not installed. Run: curl -fsSL https://bun.sh/install | bash"'
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[launcher] installing dependencies…"
  bun install
fi

# Kill anything already bound to our ports (previous run, stale bun, etc.)
kill_existing() {
  local pids
  pids=$(lsof -ti:9000,9001 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[launcher] killing previous instance(s): $pids"
    kill $pids 2>/dev/null || true
    sleep 0.5
    kill -9 $pids 2>/dev/null || true
  fi
}
kill_existing

# Open dashboard + game (only once at boot — subsequent restarts reuse tabs)
(
  sleep 2
  open "http://localhost:9001/"
  open "https://websea01.rayrag.com/"
) &

# Restart loop — dashboard's Restart button calls process.exit(0),
# code changes need this loop to pick up.
trap 'echo "[launcher] stopping"; kill_existing; exit 0' INT TERM
while true; do
  echo "[launcher] starting rk-bot…"
  bun run start || echo "[launcher] rk-bot exited with code $?"
  echo "[launcher] restart in 2s — press Ctrl+C to stop the loop"
  sleep 2
done
