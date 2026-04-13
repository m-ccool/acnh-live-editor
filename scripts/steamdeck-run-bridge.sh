#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_DIR}/.steamdeck-bridge.env"

load_env_file() {
  local env_file="$1"
  local line=""
  local key=""
  local value=""

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"

    if [[ -z "${line//[[:space:]]/}" || "${line}" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    if [[ "${line}" != *=* ]]; then
      continue
    fi

    key="${line%%=*}"
    value="${line#*=}"

    key="${key#${key%%[![:space:]]*}}"
    key="${key%${key##*[![:space:]]}}"
    value="${value#${value%%[![:space:]]*}}"

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:-1}"
    fi

    export "${key}=${value}"
  done < "${env_file}"
}

if [[ -f "${ENV_FILE}" ]]; then
  load_env_file "${ENV_FILE}"
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
: "${BRIDGE_RECONNECT_DELAY_MS:=3000}"
: "${BRIDGE_COMMAND_TIMEOUT_MS:=5000}"
: "${RYUJINX_PROCESS_MATCH:=ryujinx}"
: "${RYUJINX_STRICT_PROCESS_CHECK:=1}"
: "${ACNH_READER_MODE:=procmem}"
: "${RYUJINX_READ_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_inventory}"
: "${RYUJINX_WRITE_INVENTORY_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py write_inventory_slot}"
: "${RYUJINX_READ_GAME_DATA_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py read_game_data}"

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
export BRIDGE_RECONNECT_DELAY_MS
export BRIDGE_COMMAND_TIMEOUT_MS
export RYUJINX_PROCESS_MATCH
export RYUJINX_STRICT_PROCESS_CHECK
export ACNH_READER_MODE
export RYUJINX_READ_INVENTORY_CMD
export RYUJINX_WRITE_INVENTORY_CMD
export RYUJINX_READ_GAME_DATA_CMD

cd "${REPO_DIR}"

printf '\033[36m=============================================\033[0m\n'
printf '\033[36m  ACNH Live Bridge MVP (Steam Deck) Starting \033[0m\n'
printf '\033[36m=============================================\033[0m\n'
echo "[acnh-bridge] Repo: ${REPO_DIR}"
echo "[acnh-bridge] Target: ${BRIDGE_TARGET_HOST}:${BRIDGE_TARGET_PORT}"
echo "[acnh-bridge] Reader mode: ${ACNH_READER_MODE}"

exec node scripts/steamdeck-bridge-client.js
