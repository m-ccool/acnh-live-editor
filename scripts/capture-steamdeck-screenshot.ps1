param(
  [string]$DeckHost = '10.0.0.233',
  [string]$DeckUser = 'deck',
  [int]$DeckPort = 22,
  [string]$SshKey = "$HOME\.ssh\id_ed25519_steamdeck",
  [string]$RemoteRepoDir = '~/acnh-live-editor',
  [string]$RemoteOutputPath = '/tmp/acnh-live-editor-shot.png',
  [string]$LocalOutputPath = 'C:\Users\mccoo\OneDrive\Developer\acnh-live-editor\test-results\steamdeck-screenshot.png'
)

$ErrorActionPreference = 'Stop'

function Get-RemoteEnvironmentScript {
  return @'
set -euo pipefail

RYUJINX_PID="$(pgrep -n -x Ryujinx || true)"
if [[ -z "${RYUJINX_PID}" ]]; then
  echo "Ryujinx is not running" >&2
  exit 1
fi

python3 -c '
import json
import sys

pid = sys.argv[1].strip()
path = f"/proc/{pid}/environ"
keys = {"DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"}
values = {}

with open(path, "rb") as handle:
  for raw_entry in handle.read().split(b"\0"):
    if not raw_entry or b"=" not in raw_entry:
      continue
    key, value = raw_entry.split(b"=", 1)
    decoded_key = key.decode(errors="ignore")
    if decoded_key in keys:
      values[decoded_key] = value.decode(errors="ignore")

print(json.dumps(values))
' "${RYUJINX_PID}"
'@
}

$sshArgs = @(
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-p', [string]$DeckPort
)

$scpArgs = @(
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-P', [string]$DeckPort
)

if ($SshKey) {
  $sshArgs += @('-i', $SshKey)
  $scpArgs += @('-i', $SshKey)
}

$target = "{0}@{1}" -f $DeckUser, $DeckHost
$remoteScript = Get-RemoteEnvironmentScript
$remoteScript = $remoteScript -replace "`r`n", "`n"

$localDir = Split-Path -Path $LocalOutputPath -Parent
if ($localDir -and -not (Test-Path -LiteralPath $localDir)) {
  New-Item -ItemType Directory -Path $localDir -Force | Out-Null
}

$remoteEnvironmentJson = $remoteScript | & ssh @sshArgs $target 'bash -s'
if ($LASTEXITCODE -ne 0) {
  throw "Remote environment probe failed with exit code $LASTEXITCODE"
}

$remoteEnvironment = $remoteEnvironmentJson | ConvertFrom-Json
if (-not $remoteEnvironment.DISPLAY) {
  throw 'Unable to resolve DISPLAY from the live Ryujinx process'
}

$remoteCaptureParts = @(
  "export DISPLAY='$($remoteEnvironment.DISPLAY)'",
  "export XDG_RUNTIME_DIR='$($remoteEnvironment.XDG_RUNTIME_DIR)'",
  "export DBUS_SESSION_BUS_ADDRESS='$($remoteEnvironment.DBUS_SESSION_BUS_ADDRESS)'",
  "rm -f '$RemoteOutputPath'",
  "spectacle -b -n -o '$RemoteOutputPath'",
  "test -f '$RemoteOutputPath'"
)
if ($remoteEnvironment.XAUTHORITY) {
  $remoteCaptureParts = $remoteCaptureParts[0..2] + "export XAUTHORITY='$($remoteEnvironment.XAUTHORITY)'" + $remoteCaptureParts[3..5]
}
$remoteCaptureCommand = $remoteCaptureParts -join '; '

& ssh @sshArgs $target $remoteCaptureCommand
if ($LASTEXITCODE -ne 0) {
  throw "Remote screenshot capture failed with exit code $LASTEXITCODE"
}

if (Test-Path -LiteralPath $LocalOutputPath) {
  Remove-Item -LiteralPath $LocalOutputPath -Force
}

& scp @scpArgs "${target}:${RemoteOutputPath}" $LocalOutputPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to copy screenshot back from Steam Deck"
}

Write-Host "Saved screenshot to $LocalOutputPath"