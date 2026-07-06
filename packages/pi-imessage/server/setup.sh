#!/bin/bash
# Staged setup for imsg-server. Run ON THE MACBOOK AIR, as the single owning
# account (the permanently-logged-in server account), IN A GUI SESSION.
# Stages MUST run in order: configure -> smoke-send -> install-agent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/imsg-server"
CONFIG="$CONFIG_DIR/config.json"
SMOKE_SENTINEL="$CONFIG_DIR/.smoke-send-ok"
PLIST_LABEL="com.familyos.imsg-server"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

usage() {
  cat <<'EOF'
Usage: setup.sh <stage>   (run stages in order, on the Air, in a GUI session)

  configure      Generate token, write ~/.config/imsg-server/config.json (600).
  smoke-send     Send a test iMessage interactively. Approve the macOS
                 Automation prompt when it appears. MUST succeed before
                 install-agent. Troubleshooting: tccutil reset AppleEvents
  install-agent  Install + load the launchd agent, then verify via HTTP.

Prerequisite: Messages is signed into the agent Apple ID on this machine.
EOF
}

configure() {
  mkdir -p "$CONFIG_DIR"
  local token host recipient
  token=$(openssl rand -hex 32)
  host=$(tailscale ip -4 2>/dev/null | head -1 || true)
  if [ -z "$host" ]; then
    read -r -p "Tailscale IP of this machine (bind address): " host
  fi
  if [ -z "$host" ]; then
    echo "error: bind host must not be empty (never binds 0.0.0.0 implicitly)" >&2
    exit 1
  fi
  read -r -p "Recipient (your phone number or Apple ID email): " recipient
  IMSG_TOKEN="$token" IMSG_HOST="$host" IMSG_RECIPIENT="$recipient" node --input-type=module -e '
    const { validateRecipient } = await import(process.argv[1]);
    const { IMSG_TOKEN: token, IMSG_HOST: host, IMSG_RECIPIENT: recipient } = process.env;
    if (!validateRecipient(recipient)) { console.error("recipient is not phone/email-like"); process.exit(1); }
    const fs = await import("node:fs");
    fs.writeFileSync(process.argv[2], JSON.stringify({ token, recipient, host, port: 8787 }, null, 2) + "\n", { mode: 0o600 });
  ' "$SCRIPT_DIR/lib.mjs" "$CONFIG"
  chmod 600 "$CONFIG"
  rm -f "$SMOKE_SENTINEL"
  echo "Config written to $CONFIG"
  echo
  echo "Token (paste into ~/.config/imsg/config.json on the Pro):"
  echo "$token"
  echo
  echo "Next: ./setup.sh smoke-send"
}

smoke_send() {
  echo "Sending test message via the production code path..."
  echo "If a macOS prompt appears (Terminal wants to control Messages), APPROVE it."
  node "$SCRIPT_DIR/imsg-server.mjs" --smoke-send "setup smoke test"
  touch "$SMOKE_SENTINEL"
  chmod 600 "$SMOKE_SENTINEL"
  echo
  echo "Verify System Settings > Privacy & Security > Automation shows the grant."
  echo "Next: ./setup.sh install-agent"
}

install_agent() {
  # Preflight 1: config must load cleanly BEFORE anything touches launchd,
  # so a broken KeepAlive agent is never bootstrapped.
  node --input-type=module -e '
    const { loadServerConfig } = await import(process.argv[1]);
    try { loadServerConfig(process.argv[2]); } catch (err) {
      console.error(String(err.message ?? err));
      process.exit(1);
    }
  ' "$SCRIPT_DIR/lib.mjs" "$CONFIG"
  # Preflight 2: a successful interactive smoke-send must have happened for
  # the CURRENT config (sentinel exists and is newer than the config file).
  # This enforces the spec's staged-authorization ordering: launchd never
  # loads before Automation authorization has succeeded.
  if [ ! -f "$SMOKE_SENTINEL" ] || [ ! "$SMOKE_SENTINEL" -nt "$CONFIG" ]; then
    echo "error: run ./setup.sh smoke-send successfully before install-agent" >&2
    exit 1
  fi
  local node_path
  node_path=$(command -v node)
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/imsg-server"
  IMSG_NODE="$node_path" IMSG_SERVER="$SCRIPT_DIR/imsg-server.mjs" node --input-type=module -e '
    import { readFileSync, writeFileSync } from "node:fs";
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let t = readFileSync(process.argv[1], "utf8");
    t = t.replace("__NODE__", esc(process.env.IMSG_NODE))
         .replace("__SERVER__", esc(process.env.IMSG_SERVER))
         .replaceAll("__HOME__", esc(process.env.HOME));
    writeFileSync(process.argv[2], t);
  ' "$SCRIPT_DIR/$PLIST_LABEL.plist.template" "$PLIST_DEST"
  launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
  echo "LaunchAgent loaded. Verifying via HTTP (launchd context)..."
  sleep 2
  node --input-type=module -e '
    const { loadServerConfig } = await import(process.argv[1]);
    const c = loadServerConfig(process.argv[2]);
    const res = await fetch(`http://${c.host}:${c.port}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: "install-agent verification", emoji: "🔧", context: "setup.sh install-agent" }),
    });
    const body = await res.json();
    if (!body.ok) { console.error("HTTP smoke test FAILED:", res.status, JSON.stringify(body)); process.exit(1); }
    console.log("HTTP smoke test OK — setup complete.");
  ' "$SCRIPT_DIR/lib.mjs" "$CONFIG"
}

case "${1:-}" in
  configure) configure ;;
  smoke-send) smoke_send ;;
  install-agent) install_agent ;;
  *) usage ;;
esac
