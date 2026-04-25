#!/usr/bin/env bash
# Direct node launcher for the ACNH live bridge.
#
# Designed to be started via systemd-run (preferred) or nohup+setsid so the
# bridge process outlives the SSH session that launches it.
#
# Unlike steamdeck-run-bridge.sh this script does NOT use "exec > >(tee ...)"
# which creates a stdout pipe that receives SIGPIPE when the SSH session closes,
# killing node. stdout/stderr are left as-is so the caller (systemd-run or
# shell redirect) controls the log destination.
#
# Usage (via deploy-steamdeck-bridge.ps1):
#   systemd-run --user --unit=acnh-bridge \
#     --working-directory=~/acnh-live-editor \
#     bash ~/acnh-live-editor/scripts/start-bridge-direct.sh
#
# Manual run:
#   cd ~/acnh-live-editor && bash scripts/start-bridge-direct.sh

set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

ENV_FILE="$REPO/.steamdeck-bridge.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

NODE_BIN="${HOME}/.nvm/versions/node/v24.14.1/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "[start-bridge-direct] node not found — install Node.js or check .nvm path" >&2
  exit 1
fi

exec "$NODE_BIN" scripts/steamdeck-bridge-client.js
