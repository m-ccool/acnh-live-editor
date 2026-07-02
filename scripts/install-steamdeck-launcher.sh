#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_BRIDGE_SCRIPT="${REPO_DIR}/scripts/steamdeck-run-bridge.sh"
LAUNCH_APP_SCRIPT="${REPO_DIR}/scripts/steamdeck-launch-app.sh"
REGISTER_STEAM_SCRIPT="${REPO_DIR}/scripts/register-steam-library-shortcut.sh"
ENV_FILE="${REPO_DIR}/.steamdeck-bridge.env"
ICON_PATH="${REPO_DIR}/public/assets/icons/Apple_NL_Icon.png"
DESKTOP_FILE="${HOME}/Desktop/ACNH Live Editor.desktop"
APP_FILE="${HOME}/.local/share/applications/acnh-live-editor.desktop"
APP_URL="http://127.0.0.1:3000"

SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVER_SERVICE_FILE="${SYSTEMD_USER_DIR}/acnh-live-server.service"
BRIDGE_SERVICE_FILE="${SYSTEMD_USER_DIR}/acnh-live-bridge.service"

SERVER_LOG_FILE="${HOME}/.acnh-live-server.log"
BRIDGE_LOG_FILE="${HOME}/.acnh-live-bridge.log"

mkdir -p "${HOME}/.local/share/applications"
mkdir -p "${SYSTEMD_USER_DIR}"

chmod +x "${RUN_BRIDGE_SCRIPT}"
chmod +x "${LAUNCH_APP_SCRIPT}"
chmod +x "${REGISTER_STEAM_SCRIPT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<EOF
# Steam Deck bridge settings (same-device mode)
SAME_DECK_MODE=1
BRIDGE_TARGET_HOST=127.0.0.1
BRIDGE_TARGET_PORT=32840
ACNH_READER_MODE=procmem
EOF
  echo "[acnh-install] Created ${ENV_FILE} for same-deck mode."
fi

create_desktop_entry() {
  local target="$1"

  cat > "${target}" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=ACNH Live Editor
Comment=Launch ACNH Live Editor on Steam Deck
Terminal=false
Path=${REPO_DIR}
Exec=/bin/bash ${LAUNCH_APP_SCRIPT}
Icon=${ICON_PATH}
Categories=Game;Utility;
StartupNotify=true
EOF

  chmod +x "${target}"
}

create_desktop_entry "${DESKTOP_FILE}"
create_desktop_entry "${APP_FILE}"

echo "[acnh-install] Launcher created: ${DESKTOP_FILE}"
echo "[acnh-install] App entry created: ${APP_FILE}"

cat > "${SERVER_SERVICE_FILE}" <<EOF
[Unit]
Description=ACNH Live Editor Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
Environment=HOME=${HOME}
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env npm run dev
Restart=on-failure
RestartSec=5
StandardOutput=append:${SERVER_LOG_FILE}
StandardError=append:${SERVER_LOG_FILE}

[Install]
WantedBy=default.target
EOF

cat > "${BRIDGE_SERVICE_FILE}" <<EOF
[Unit]
Description=ACNH Live Bridge Client
After=acnh-live-server.service network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
Environment=HOME=${HOME}
EnvironmentFile=-${ENV_FILE}
ExecStart=/bin/bash ${REPO_DIR}/scripts/steamdeck-run-bridge.sh
Restart=on-failure
RestartSec=5
StandardOutput=append:${BRIDGE_LOG_FILE}
StandardError=append:${BRIDGE_LOG_FILE}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload

# On-demand launch only: install units but do not auto-start at login.
systemctl --user disable --now acnh-live-server.service >/dev/null 2>&1 || true
systemctl --user disable --now acnh-live-bridge.service >/dev/null 2>&1 || true

echo "[acnh-install] Services installed (on-demand mode):"
echo "[acnh-install]   - ${SERVER_SERVICE_FILE}"
echo "[acnh-install]   - ${BRIDGE_SERVICE_FILE}"

echo "[acnh-install] Desktop launch opens: ${APP_URL}"
echo "[acnh-install] Steam Library helper: bash ${REGISTER_STEAM_SCRIPT}"
echo "[acnh-install]"
echo "[acnh-install] Commands"
echo "[acnh-install]   Start now:  systemctl --user start acnh-live-server acnh-live-bridge"
echo "[acnh-install]   Stop now:   systemctl --user stop acnh-live-bridge acnh-live-server"
echo "[acnh-install]   Status:     systemctl --user status acnh-live-server acnh-live-bridge"
echo "[acnh-install]"
echo "[acnh-install] Desktop and app launcher entries are ready."
echo "[acnh-install] Run the Steam helper once to add this launcher to your Steam Library."

