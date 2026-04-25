#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_SCRIPT="${REPO_DIR}/scripts/steamdeck-run-bridge.sh"
ENV_FILE="${REPO_DIR}/.steamdeck-bridge.env"
ICON_PATH="${REPO_DIR}/public/assets/icons/Apple_NL_Icon.png"
DESKTOP_FILE="${HOME}/Desktop/ACNH Live Bridge.desktop"
APP_FILE="${HOME}/.local/share/applications/acnh-live-bridge.desktop"

mkdir -p "${HOME}/.local/share/applications"
chmod +x "${RUN_SCRIPT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<EOF
# Steam Deck bridge settings
# Set this to your PC LAN IP running acnh-live-editor.
BRIDGE_TARGET_HOST=10.0.0.25
BRIDGE_TARGET_PORT=32840
ACNH_READER_MODE=procmem
EOF
  echo "[acnh-bridge] Created ${ENV_FILE}. Update BRIDGE_TARGET_HOST before running."
fi

create_desktop_entry() {
  local target="$1"

  cat > "${target}" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=ACNH Live Bridge
Comment=Start ACNH Steam Deck bridge client
Terminal=true
Path=${REPO_DIR}
Exec=${RUN_SCRIPT}
Icon=${ICON_PATH}
Categories=Game;Utility;
StartupNotify=true
EOF

  chmod +x "${target}"
}

create_desktop_entry "${DESKTOP_FILE}"
create_desktop_entry "${APP_FILE}"

echo "[acnh-bridge] Launcher created: ${DESKTOP_FILE}"
echo "[acnh-bridge] App entry created: ${APP_FILE}"
echo "[acnh-bridge] Double-click the Desktop icon to run bridge client."

# Install persistent systemd user service -----------------------------------
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_FILE="${UNIT_DIR}/acnh-bridge.service"
DIRECT_LAUNCHER="${REPO_DIR}/scripts/start-bridge-direct.sh"

if command -v systemctl >/dev/null 2>&1 && [[ -f "${DIRECT_LAUNCHER}" ]]; then
  mkdir -p "${UNIT_DIR}"
  chmod +x "${DIRECT_LAUNCHER}"

  cat > "${UNIT_FILE}" <<UNIT
[Unit]
Description=ACNH Live Editor Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=/bin/bash ${DIRECT_LAUNCHER}
Restart=on-failure
RestartSec=5
StandardOutput=append:%h/.acnh-live-bridge.log
StandardError=append:%h/.acnh-live-bridge.log

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable acnh-bridge.service
  loginctl enable-linger "$(whoami)" 2>/dev/null || true

  echo "[acnh-bridge] systemd unit installed: ${UNIT_FILE}"
  echo "[acnh-bridge] Service enabled. Run: systemctl --user start acnh-bridge.service"
else
  echo "[acnh-bridge] systemd not available or start-bridge-direct.sh missing — skipping service install."
fi
