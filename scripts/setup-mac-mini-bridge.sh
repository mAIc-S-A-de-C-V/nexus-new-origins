#!/usr/bin/env bash
# Nexus LLM bridge — Mac mini setup
# Replaces the Linode + VPN approach. The Mac mini sits inside the MAIC office
# LAN, talks directly to the upstream LLM at 10.150.99.150:8000, and exposes
# OpenAI-shaped /v1/* over an HTTPS Cloudflare Tunnel.
#
# Run once on the Mac mini:
#   chmod +x setup-mac-mini-bridge.sh
#   ./setup-mac-mini-bridge.sh
#
# Prereqs:
#   - Homebrew installed (https://brew.sh)
#   - Cloudflare account with maic.ai (or chosen domain) on Cloudflare DNS
#   - macOS auto-login enabled so launchd agents start at boot

set -euo pipefail

# ---- edit these if needed --------------------------------------------------
UPSTREAM="http://10.150.99.150:8000"
TUNNEL_HOSTNAME="${NEXUS_BRIDGE_HOSTNAME:-llm.maic.ai}"
USERNAME="${NEXUS_BRIDGE_USER:-nexus}"
PASSWORD="${NEXUS_BRIDGE_PASSWORD:-nexus-dev}"
LISTEN_PORT="8787"
TUNNEL_NAME="nexus-llm"
# ---------------------------------------------------------------------------

if ! command -v brew >/dev/null; then
  echo "ERROR: install Homebrew first (https://brew.sh)" >&2
  exit 1
fi

echo "=== 1/5  Installing caddy and cloudflared ==="
brew install caddy cloudflared

echo "=== 2/5  Writing Caddyfile to ~/.nexus-bridge/Caddyfile ==="
mkdir -p "$HOME/.nexus-bridge"
HASH="$(printf '%s' "$PASSWORD" | caddy hash-password)"
cat > "$HOME/.nexus-bridge/Caddyfile" <<EOF
{
    auto_https off
    admin off
}

:${LISTEN_PORT} {
    log {
        output file ${HOME}/.nexus-bridge/access.log
    }

    basicauth {
        ${USERNAME} ${HASH}
    }

    @v1 path /v1/*
    handle @v1 {
        uri replace /v1/ /api/v1/ 1
        reverse_proxy ${UPSTREAM}
    }

    handle {
        respond "Not found" 404
    }
}
EOF

echo "=== 3/5  Cloudflared login (browser opens if not already authed) ==="
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  cloudflared tunnel login
fi

echo "=== 4/5  Creating named tunnel '${TUNNEL_NAME}' (idempotent) ==="
if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi
TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n{print $1; exit}')"

cat > "$HOME/.cloudflared/${TUNNEL_NAME}.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${HOME}/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: http://localhost:${LISTEN_PORT}
  - service: http_status:404
EOF

cloudflared tunnel route dns "$TUNNEL_NAME" "$TUNNEL_HOSTNAME" || \
  echo "  (DNS route may already exist — continuing)"

echo "=== 5/5  Installing launchd agents ==="
BREW_PREFIX="$(brew --prefix)"

cat > "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-caddy.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.maic.nexus-bridge-caddy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BREW_PREFIX}/bin/caddy</string>
    <string>run</string>
    <string>--config</string>
    <string>${HOME}/.nexus-bridge/Caddyfile</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/.nexus-bridge/caddy.out.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.nexus-bridge/caddy.err.log</string>
</dict></plist>
EOF

cat > "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-cloudflared.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.maic.nexus-bridge-cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BREW_PREFIX}/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>${HOME}/.cloudflared/${TUNNEL_NAME}.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/.nexus-bridge/cloudflared.out.log</string>
  <key>StandardErrorPath</key><string>${HOME}/.nexus-bridge/cloudflared.err.log</string>
</dict></plist>
EOF

launchctl unload "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-caddy.plist"        2>/dev/null || true
launchctl unload "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-cloudflared.plist" 2>/dev/null || true
launchctl load   "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-caddy.plist"
launchctl load   "$HOME/Library/LaunchAgents/ai.maic.nexus-bridge-cloudflared.plist"

sleep 3

echo
echo "=== Done ==="
echo "URL:        https://${TUNNEL_HOSTNAME}"
echo "Auth:       ${USERNAME} / ${PASSWORD}"
echo "Logs:       ~/.nexus-bridge/*.log"
echo
echo "--- Local sanity check (should return JSON) ---"
curl -s -u "${USERNAME}:${PASSWORD}" "http://localhost:${LISTEN_PORT}/v1/models" | head -c 400; echo
echo
echo "--- Public sanity check (give cloudflared 30-60s on first run for DNS) ---"
echo "  curl -u ${USERNAME}:${PASSWORD} https://${TUNNEL_HOSTNAME}/v1/models"
echo "  curl -u ${USERNAME}:${PASSWORD} -X POST https://${TUNNEL_HOSTNAME}/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"model\":\"gpt-oss-120b\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":20}'"
