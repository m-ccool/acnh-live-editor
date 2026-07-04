#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_URL="${ACNH_APP_URL:-http://127.0.0.1:3000}"
MAX_WAIT_SECONDS="${ACNH_APP_WAIT_SECONDS:-25}"

SERVER_UNIT="acnh-live-server.service"
BRIDGE_UNIT="acnh-live-bridge.service"

fail() {
  echo "[acnh-launch] $1"
  exit 1
}

if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemctl is required for service startup"
fi

if [[ ! -d "${REPO_DIR}" ]]; then
  fail "Repository path not found: ${REPO_DIR}"
fi

echo "[acnh-launch] Starting on-demand services..."
systemctl --user start "${SERVER_UNIT}" "${BRIDGE_UNIT}"

wait_for_app() {
  local elapsed=0
  while (( elapsed < MAX_WAIT_SECONDS )); do
    if bash -lc "cat < /dev/null > /dev/tcp/127.0.0.1/3000" 2>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

if ! wait_for_app; then
  fail "App server did not become reachable at 127.0.0.1:3000 within ${MAX_WAIT_SECONDS}s"
fi

echo "[acnh-launch] Opening ${APP_URL}"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${APP_URL}" >/dev/null 2>&1 &
  exit 0
fi

if command -v steam >/dev/null 2>&1; then
  steam "steam://openurl/${APP_URL}" >/dev/null 2>&1 &
  exit 0
fi

fail "Unable to open browser automatically. Open ${APP_URL} manually."
