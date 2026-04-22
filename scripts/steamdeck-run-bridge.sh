#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_DIR}/.steamdeck-bridge.env"
BRIDGE_CLIENT_ENTRY="scripts/steamdeck-bridge-client.js"
LOG_FILE="${HOME}/.acnh-live-bridge.log"
DEFAULT_WINDOWS_BRIDGE_HOST="10.0.0.25"

pause_if_interactive() {
  if [[ -t 0 && -t 1 ]]; then
    echo
    read -r -p "[acnh-bridge] Press Enter to close..." _unused
  fi
}

fail() {
  local message="$1"
  echo "[acnh-bridge] ${message}"
  pause_if_interactive
  exit 1
}

handle_unexpected_error() {
  local line_no="$1"
  local cmd="$2"
  local code="$3"
  echo "[acnh-bridge] Unexpected failure at line ${line_no}: ${cmd} (exit ${code})"
  pause_if_interactive
  exit "${code}"
}

resolve_node_bin() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [[ -x "/usr/bin/node" ]]; then
    echo "/usr/bin/node"
    return 0
  fi

  if [[ -x "/usr/local/bin/node" ]]; then
    echo "/usr/local/bin/node"
    return 0
  fi

  local nvm_script="${HOME}/.nvm/nvm.sh"
  if [[ -f "${nvm_script}" ]]; then
    # shellcheck source=/dev/null
    source "${nvm_script}" >/dev/null 2>&1 || true
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi

  local newest_nvm_node
  newest_nvm_node="$(find "${HOME}/.nvm/versions/node" -maxdepth 3 -type f -name node 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "${newest_nvm_node}" && -x "${newest_nvm_node}" ]]; then
    echo "${newest_nvm_node}"
    return 0
  fi

  return 1
}

resolve_python3_bin() {
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi

  if [[ -x "/usr/bin/python3" ]]; then
    echo "/usr/bin/python3"
    return 0
  fi

  if [[ -x "/usr/local/bin/python3" ]]; then
    echo "/usr/local/bin/python3"
    return 0
  fi

  return 1
}

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
    if [[ "${key}" == export* ]]; then
      key="${key#export}"
      key="${key#${key%%[![:space:]]*}}"
    fi
    value="${value#${value%%[![:space:]]*}}"
    if [[ "${value}" == *#* ]]; then
      value="${value%%#*}"
      value="${value%${value##*[![:space:]]}}"
    fi

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:-1}"
    fi

    if [[ -n "${key}" ]]; then
      export "${key}=${value}"
    fi
  done < "${env_file}"
}

validate_target() {
  if ! [[ "${BRIDGE_TARGET_PORT}" =~ ^[0-9]+$ ]] || (( BRIDGE_TARGET_PORT < 1 || BRIDGE_TARGET_PORT > 65535 )); then
    echo "[acnh-bridge] BRIDGE_TARGET_PORT must be a number between 1 and 65535"
    exit 1
  fi

  if [[ "${BRIDGE_TARGET_HOST}" =~ ^https?:// ]]; then
    echo "[acnh-bridge] BRIDGE_TARGET_HOST must be an IP/host only (no http:// or https://)"
    echo "[acnh-bridge] Set BRIDGE_TARGET_HOST=10.0.0.25 in ${ENV_FILE}"
    exit 1
  fi

  if [[ "${BRIDGE_TARGET_HOST}" == *:* ]]; then
    echo "[acnh-bridge] BRIDGE_TARGET_HOST must not include a port"
    echo "[acnh-bridge] Set BRIDGE_TARGET_HOST=10.0.0.25 and BRIDGE_TARGET_PORT=32840 in ${ENV_FILE}"
    exit 1
  fi

  case "${BRIDGE_TARGET_HOST}" in
    localhost|127.0.0.1)
      echo "[acnh-bridge] BRIDGE_TARGET_HOST=${BRIDGE_TARGET_HOST} points to Steam Deck itself, not your Windows host"
      echo "[acnh-bridge] Set BRIDGE_TARGET_HOST=10.0.0.25 in ${ENV_FILE} for this MVP setup"
      exit 1
      ;;
  esac

}

normalize_target_host() {
  local raw_host="${BRIDGE_TARGET_HOST:-}"
  local trimmed_host="${raw_host#${raw_host%%[![:space:]]*}}"
  trimmed_host="${trimmed_host%${trimmed_host##*[![:space:]]}}"

  if [[ -z "${trimmed_host}" ]]; then
    BRIDGE_TARGET_HOST="${DEFAULT_WINDOWS_BRIDGE_HOST}"
    echo "[acnh-bridge] BRIDGE_TARGET_HOST not set, using default Windows host ${BRIDGE_TARGET_HOST}"
    return
  fi

  case "${trimmed_host}" in
    YOUR_PC_LAN_IP|YOUR_WINDOWS_PC_IP|YOUR_PC_IP|REPLACE_ME|CHANGEME|"<YOUR_PC_LAN_IP>"|"<YOUR_WINDOWS_PC_IP>")
      BRIDGE_TARGET_HOST="${DEFAULT_WINDOWS_BRIDGE_HOST}"
      echo "[acnh-bridge] BRIDGE_TARGET_HOST placeholder detected (${trimmed_host}); using ${BRIDGE_TARGET_HOST}"
      return
      ;;
  esac

  BRIDGE_TARGET_HOST="${trimmed_host}"
}

probe_bridge_listener() {
  if command -v timeout >/dev/null 2>&1; then
    if timeout 2 bash -lc "cat < /dev/null > /dev/tcp/${BRIDGE_TARGET_HOST}/${BRIDGE_TARGET_PORT}" 2>/dev/null; then
      return 0
    fi
  elif bash -lc "cat < /dev/null > /dev/tcp/${BRIDGE_TARGET_HOST}/${BRIDGE_TARGET_PORT}" 2>/dev/null; then
    return 0
  fi

  fail "Unable to reach Windows bridge listener at ${BRIDGE_TARGET_HOST}:${BRIDGE_TARGET_PORT}. Start the Windows app server first, then rerun this launcher."
}

clear_existing_bridge_client() {
  local pids=""

  if command -v pgrep >/dev/null 2>&1; then
    pids="$(pgrep -f "node .*${BRIDGE_CLIENT_ENTRY}" || true)"
  else
    pids="$(ps -eo pid=,args= | awk '/node .*scripts\/steamdeck-bridge-client\.js/ {print $1}' || true)"
  fi

  if [[ -n "${pids}" ]]; then
    echo "[acnh-bridge] Stopping existing bridge client process(es): ${pids//$'\n'/, }"
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      kill "${pid}" 2>/dev/null || true
    done <<< "${pids}"
  fi
}

if [[ -f "${ENV_FILE}" ]]; then
  load_env_file "${ENV_FILE}"
fi

mkdir -p "$(dirname "${LOG_FILE}")"
touch "${LOG_FILE}" 2>/dev/null || true
exec > >(tee -a "${LOG_FILE}") 2>&1
trap 'handle_unexpected_error "${LINENO}" "${BASH_COMMAND}" "$?"' ERR

normalize_target_host

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
: "${RYUJINX_WRITE_GAME_DATA_CMD:=python3 scripts/steamdeck-adapters/bridge_memory_tool.py write_game_data}"

validate_target

NODE_BIN="$(resolve_node_bin || true)"
if [[ -z "${NODE_BIN}" ]]; then
  fail "node is not available. Install node on Steam Deck or add it to PATH."
fi

PYTHON3_BIN="$(resolve_python3_bin || true)"
if [[ -z "${PYTHON3_BIN}" ]]; then
  fail "python3 is not available. Install python3 on Steam Deck or add it to PATH."
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
export RYUJINX_WRITE_GAME_DATA_CMD

cd "${REPO_DIR}"

if [[ ! -f "${REPO_DIR}/${BRIDGE_CLIENT_ENTRY}" ]]; then
  fail "Missing ${BRIDGE_CLIENT_ENTRY} in ${REPO_DIR}"
fi

clear_existing_bridge_client

printf '\033[36m=============================================\033[0m\n'
printf '\033[36m  ACNH Live Bridge MVP (Steam Deck) Starting \033[0m\n'
printf '\033[36m=============================================\033[0m\n'
echo "[acnh-bridge] Repo: ${REPO_DIR}"
echo "[acnh-bridge] Target: ${BRIDGE_TARGET_HOST}:${BRIDGE_TARGET_PORT}"
echo "[acnh-bridge] Reader mode: ${ACNH_READER_MODE}"
echo "[acnh-bridge] Node: ${NODE_BIN}"
echo "[acnh-bridge] Python: ${PYTHON3_BIN}"
echo "[acnh-bridge] Log: ${LOG_FILE}"
echo "[acnh-bridge] Hazard checks passed: target + dependencies + entrypoint"

probe_bridge_listener

exec "${NODE_BIN}" "${BRIDGE_CLIENT_ENTRY}"
