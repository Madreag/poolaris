#!/usr/bin/env bash
# =============================================================================
# Poolaris launcher for macOS
# -----------------------------------------------------------------------------
# Starts the local server (bound to 127.0.0.1 only) and a Cloudflare Tunnel in
# front of it. Double-click in Finder, or run:  ./start-poolaris.command
#
# First time:
#   chmod +x start-poolaris.command
#   brew install python cloudflared        # if you don't have them
#
# Quick (ephemeral) URL: just run it — you'll get a https://*.trycloudflare.com link.
#
# Stable hostname (one-time setup, then set POOLARIS_TUNNEL_NAME below):
#   cloudflared tunnel login
#   cloudflared tunnel create poolaris
#   cloudflared tunnel route dns poolaris pool.yourdomain.com
#   then: export POOLARIS_TUNNEL_NAME=poolaris   (or edit the line below)
#
# SECURITY: the server binds to localhost only (do NOT set POOLARIS_BIND_ALL).
# Add Cloudflare Zero Trust → Access on the hostname for a login gate.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

PORT="${POOLARIS_PORT:-8000}"
TUNNEL_NAME="${POOLARIS_TUNNEL_NAME:-}"     # set to your named tunnel for a stable URL

# ---- prerequisites ----
PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "X  Python 3 not found.  Install it:  brew install python"; exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "X  cloudflared not found.  Install it:  brew install cloudflared"; exit 1
fi

mkdir -p data
echo ">  Starting Poolaris on http://127.0.0.1:$PORT  (localhost only)"
POOLARIS_NO_BROWSER=1 POOLARIS_PORT="$PORT" "$PY" server.py >> data/server.log 2>&1 &
SERVER_PID=$!
TUNNEL_PID=""

cleanup() { echo; echo "|  Stopping..."; kill "$SERVER_PID" 2>/dev/null || true; [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# ---- wait for the server to answer ----
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$PORT/api/auth/me" >/dev/null 2>&1 && break
  sleep 0.4
done
echo "+  Server up  (engine + daily backups on; logs in data/server.log)"

# ---- open the tunnel ----
echo ">  Opening Cloudflare Tunnel..."
if [ -n "$TUNNEL_NAME" ]; then
  cloudflared tunnel run --url "http://127.0.0.1:$PORT" "$TUNNEL_NAME" &
else
  cloudflared tunnel --url "http://127.0.0.1:$PORT" &
fi
TUNNEL_PID=$!
echo "+  Tunnel starting — your public https:// URL prints above. Press Ctrl-C to stop everything."
wait "$TUNNEL_PID"
