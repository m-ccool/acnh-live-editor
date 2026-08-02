#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${ACNH_MEMORY_USER:-deck}"
HELPER_DIR="/etc/acnh-live-editor"
HELPER_PATH="${HELPER_DIR}/enable-memory-access"
SERVICE_PATH="/etc/systemd/system/acnh-memory-access.service"
TIMER_PATH="/etc/systemd/system/acnh-memory-access.timer"
SYSCTL_PATH="/etc/sysctl.d/99-acnh-live-editor.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/install-steamdeck-memory-access.sh"
  exit 1
fi

if ! id "${TARGET_USER}" >/dev/null 2>&1; then
  echo "Target user does not exist: ${TARGET_USER}"
  exit 1
fi

if [[ ! -x /usr/bin/gdb ]]; then
  echo "gdb is required at /usr/bin/gdb"
  exit 1
fi

install -d -o root -g root -m 0755 "${HELPER_DIR}"

cat > "${HELPER_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${ACNH_MEMORY_USER:-deck}"

mapfile -t ryujinx_pids < <(
  /usr/bin/pgrep -x Ryujinx || true
)

for pid in "${ryujinx_pids[@]}"; do
  proc_dir="/proc/${pid}"
  if [[ ! -d "${proc_dir}" ]]; then
    continue
  fi

  maps_owner="$(stat -c '%U' "${proc_dir}/maps" 2>/dev/null || true)"
  if [[ "${maps_owner}" == "${TARGET_USER}" ]]; then
    continue
  fi

  /usr/bin/gdb -q -n -batch \
    -ex "attach ${pid}" \
    -ex 'call (int)prctl(4,1,0,0,0)' \
    -ex 'detach' >/dev/null 2>&1

  maps_owner="$(stat -c '%U' "${proc_dir}/maps" 2>/dev/null || true)"
  if [[ "${maps_owner}" != "${TARGET_USER}" ]]; then
    echo "Ryujinx PID ${pid} did not become readable by ${TARGET_USER}" >&2
    exit 1
  fi

  echo "Enabled ACNH memory access for Ryujinx PID ${pid}"
done
EOF

chown root:root "${HELPER_PATH}"
chmod 0755 "${HELPER_PATH}"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Enable ACNH Live Editor access to Ryujinx memory

[Service]
Type=oneshot
Environment=ACNH_MEMORY_USER=${TARGET_USER}
ExecStart=${HELPER_PATH}
EOF

cat > "${TIMER_PATH}" <<EOF
[Unit]
Description=Watch for Ryujinx memory-access changes

[Timer]
OnBootSec=2s
OnUnitActiveSec=5s
AccuracySec=500ms
Unit=acnh-memory-access.service

[Install]
WantedBy=timers.target
EOF

cat > "${SYSCTL_PATH}" <<'EOF'
kernel.yama.ptrace_scope = 0
EOF

chown root:root "${SERVICE_PATH}" "${TIMER_PATH}" "${SYSCTL_PATH}"
chmod 0644 "${SERVICE_PATH}" "${TIMER_PATH}" "${SYSCTL_PATH}"

/usr/sbin/sysctl -q -w kernel.yama.ptrace_scope=0
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable --now acnh-memory-access.timer
/usr/bin/systemctl start acnh-memory-access.service

echo "Installed ACNH memory-access automation for user ${TARGET_USER}."
echo "Timer: acnh-memory-access.timer"
echo "Sysctl: ${SYSCTL_PATH}"