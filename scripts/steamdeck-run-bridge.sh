#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_DIR}/.steamdeck-bridge.env"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

if [[ -z "${BRIDGE_TARGET_HOST:-}" ]]; then
  DEFAULT_GATEWAY="$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')"
  if [[ -n "${DEFAULT_GATEWAY}" ]]; then
    BRIDGE_TARGET_HOST="${DEFAULT_GATEWAY}"
    echo "[acnh-bridge] BRIDGE_TARGET_HOST not set, using gateway ${BRIDGE_TARGET_HOST}"
  else
    echo "[acnh-bridge] BRIDGE_TARGET_HOST is required. Set it in ${ENV_FILE}."
    exit 1
  fi
fi

: "${BRIDGE_TARGET_PORT:=32840}"
: "${BRIDGE_DEVICE_NAME:=steamdeck-bridge-client}"
: "${BRIDGE_HEARTBEAT_MS:=5000}"
: "${BRIDGE_COMMAND_TIMEOUT_MS:=4000}"
: "${BRIDGE_ENABLE_FILE_FALLBACK:=0}"
: "${BRIDGE_INVENTORY_FILE:=${REPO_DIR}/data/steamdeck-inventory.json}"
: "${RYUJINX_READ_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_inventory}"
: "${RYUJINX_WRITE_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py write_inventory_slot}"
: "${RYUJINX_READ_GAME_DATA_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_game_data}"
: "${RYUJINX_LIVE_READ_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/acnh_memory_reader.py read_inventory}"
: "${RYUJINX_LIVE_WRITE_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/acnh_memory_reader.py write_inventory_slot}"
: "${RYUJINX_LIVE_READ_GAME_DATA_CMD:=python3 scripts/steamdeck-adapters/acnh_memory_reader.py read_game_data}"

if [[ "${RYUJINX_PERSONAL_SAVE_DIR:-}" == *"/games/01006f8002326000/cache/cpu/"* ]]; then
  echo "[acnh-bridge] Scope guard: RYUJINX_PERSONAL_SAVE_DIR points to a CPU cache path, not live memory or personal save data."
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[acnh-bridge] node is not installed or not in PATH"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[acnh-bridge] python3 is not installed or not in PATH"
  exit 1
fi

export BRIDGE_TARGET_HOST
export BRIDGE_TARGET_PORT
export BRIDGE_DEVICE_NAME
export BRIDGE_HEARTBEAT_MS
export BRIDGE_COMMAND_TIMEOUT_MS
export BRIDGE_ENABLE_FILE_FALLBACK
export BRIDGE_INVENTORY_FILE
export RYUJINX_READ_INVENTORY_CMD
export RYUJINX_WRITE_INVENTORY_CMD
export RYUJINX_READ_GAME_DATA_CMD
export RYUJINX_LIVE_READ_INVENTORY_CMD
export RYUJINX_LIVE_WRITE_INVENTORY_CMD
export RYUJINX_LIVE_READ_GAME_DATA_CMD

cd "${REPO_DIR}"
printf '\033[36m====================================================\033[0m\n'
printf '\033[36m  ACNH Live Bridge (Steam Deck Connector) Starting  \033[0m\n'
printf '\033[36m====================================================\033[0m\n'
echo "[acnh-bridge] Repo: ${REPO_DIR}"
echo "[acnh-bridge] Starting bridge client -> ${BRIDGE_TARGET_HOST}:${BRIDGE_TARGET_PORT}"
echo "[acnh-bridge] Adapter mode: live Ryujinx memory"
exec node scripts/steamdeck-bridge-client.js
