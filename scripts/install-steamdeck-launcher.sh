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

# ── systemd user service (survives reboot / power-off) ───────────────────────
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_USER_DIR}/acnh-live-bridge.service"

mkdir -p "${SYSTEMD_USER_DIR}"

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=ACNH Live Bridge Client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStartPre=/bin/bash -c 'cd ${REPO_DIR} && git pull --ff-only origin dev 2>&1 | tee -a ${HOME}/.acnh-live-bridge.log || true'
ExecStart=/bin/bash ${REPO_DIR}/scripts/steamdeck-run-bridge.sh
Restart=on-failure
RestartSec=10
StandardOutput=append:${HOME}/.acnh-live-bridge.log
StandardError=append:${HOME}/.acnh-live-bridge.log
Environment=HOME=${HOME}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable acnh-live-bridge.service

# Allow the user service to run without an active login session (survives power-off/reboot)
loginctl enable-linger deck 2>/dev/null || true

echo "[acnh-bridge] systemd user service installed: ${SERVICE_FILE}"
echo "[acnh-bridge] Service will auto-start on next boot and restart on failure."
echo "[acnh-bridge] To start now: systemctl --user start acnh-live-bridge"
echo "[acnh-bridge] To check status: systemctl --user status acnh-live-bridge"
