#!/usr/bin/env bash
set -euo pipefail

DESKTOP_ENTRY="${HOME}/.local/share/applications/acnh-live-editor.desktop"
STEAM_ADD_URI="steam://AddNonSteamGame"

if [[ ! -f "${DESKTOP_ENTRY}" ]]; then
  echo "[acnh-steam] Missing launcher entry: ${DESKTOP_ENTRY}"
  echo "[acnh-steam] Run scripts/install-steamdeck-launcher.sh first."
  exit 1
fi

echo "[acnh-steam] Preparing Steam Library registration"
echo "[acnh-steam] Launcher: ${DESKTOP_ENTRY}"

echo "[acnh-steam]"
echo "[acnh-steam] Steps in Steam Desktop client"
echo "[acnh-steam] 1) Games -> Add a Non-Steam Game to My Library"
echo "[acnh-steam] 2) Select: ACNH Live Editor"
echo "[acnh-steam] 3) Click Add Selected Programs"
echo "[acnh-steam]"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${STEAM_ADD_URI}" >/dev/null 2>&1 || true
fi

echo "[acnh-steam] If the Add dialog does not open automatically, open Steam and run the steps above."
