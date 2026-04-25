#!/usr/bin/env pwsh
# Persistent Windows server launcher for ACNH Live Editor.
#
# Starts `node server.js` and automatically restarts it on exit/crash.
# Logs to %LOCALAPPDATA%\acnh-live-editor\server.log by default.
#
# Usage:
#   pwsh -File scripts/start-server-persistent.ps1
#   pwsh -File scripts/start-server-persistent.ps1 -Port 3000
#   pwsh -File scripts/start-server-persistent.ps1 -NoRestart

param(
  [int]$Port = 3000,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logDir = Join-Path $env:LOCALAPPDATA 'acnh-live-editor'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'server.log'

Write-Host "[acnh-server] Repo  : $repoRoot"
Write-Host "[acnh-server] Log   : $logFile"
Write-Host "[acnh-server] Port  : $Port"
Write-Host "[acnh-server] Press Ctrl+C to stop."
Write-Host ''

$env:PORT = $Port
$attempt = 0

do {
  $attempt++
  $start = Get-Date
  Write-Host "[acnh-server] Starting node server.js (attempt $attempt) @ $start"

  try {
    $proc = Start-Process -FilePath 'node' -ArgumentList 'server.js' `
      -WorkingDirectory $repoRoot `
      -NoNewWindow -PassThru
    $proc.WaitForExit()
    $exit = $proc.ExitCode
  } catch {
    Write-Warning "[acnh-server] Failed to start node: $_"
    $exit = -1
  }

  $elapsed = ((Get-Date) - $start).TotalSeconds
  Write-Host "[acnh-server] node exited (code=$exit, uptime=${elapsed}s)"

  if ($NoRestart) { break }

  # Back-off: if it died in under 3 s assume a hard crash — wait 5 s before retry.
  if ($elapsed -lt 3) {
    Write-Warning "[acnh-server] Fast exit — waiting 5 s before restart..."
    Start-Sleep -Seconds 5
  } else {
    Start-Sleep -Seconds 1
  }

} while (-not $NoRestart)
