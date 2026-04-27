param(
  [string]$DeckHost,
  [string]$DeckUser,
  [int]$DeckPort,
  [string]$RepoDir,
  [string]$Branch,
  [string]$BridgeProcessMatch,
  [string]$BridgeStartCommand,
  [string]$SshKey,
  [switch]$RestartBridge,
  [switch]$PrintOnly
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Import-KeyValueFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
      continue
    }

    $parts = $trimmed.Split('=', 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($key) {
      $values[$key] = $value
    }
  }

  return $values
}

function Get-BridgeClientIp {
  try {
    $status = Invoke-RestMethod -Uri 'http://10.0.0.25:3000/api/bridge/status' -Method Get -TimeoutSec 5
    if ($status -and $status.connected -and $status.clientIp) {
      return [string]$status.clientIp
    }
  } catch {
  }

  return $null
}

function Get-RequiredValue {
  param(
    [string]$Explicit,
    [hashtable]$Config,
    [string]$Name,
    [string]$Default = ''
  )

  if ($Explicit) {
    return $Explicit
  }
  if ($Config.ContainsKey($Name) -and $Config[$Name]) {
    return [string]$Config[$Name]
  }
  return $Default
}

function Escape-SingleQuotedBash {
  param([string]$Text)
  return $Text -replace "'", "'\''"
}

function Get-RemoteRepoDirCommand {
  param([string]$Path)

  if ($Path.StartsWith('~/')) {
    $suffix = $Path.Substring(2)
    return '"$HOME/' + $suffix.Replace('"', '\"') + '"'
  }

  return "'$(Escape-SingleQuotedBash $Path)'"
}

$repoRoot = Get-RepoRoot
$configPath = Join-Path $repoRoot '.steamdeck-deploy.env'
$config = Import-KeyValueFile -Path $configPath

$resolvedDeckHost = Get-RequiredValue -Explicit $DeckHost -Config $config -Name 'STEAMDECK_SSH_HOST'
if (-not $resolvedDeckHost) {
  $resolvedDeckHost = Get-BridgeClientIp
}
if (-not $resolvedDeckHost) {
  throw 'Steam Deck host is not configured. Set STEAMDECK_SSH_HOST in .steamdeck-deploy.env or connect the bridge so the script can infer clientIp.'
}

$resolvedDeckUser = Get-RequiredValue -Explicit $DeckUser -Config $config -Name 'STEAMDECK_SSH_USER' -Default 'deck'
$resolvedDeckPort = if ($PSBoundParameters.ContainsKey('DeckPort')) { $DeckPort } elseif ($config.ContainsKey('STEAMDECK_SSH_PORT')) { [int]$config['STEAMDECK_SSH_PORT'] } else { 22 }
$resolvedRepoDir = Get-RequiredValue -Explicit $RepoDir -Config $config -Name 'STEAMDECK_REPO_DIR' -Default '~/acnh-live-editor'
$resolvedBranch = Get-RequiredValue -Explicit $Branch -Config $config -Name 'STEAMDECK_REPO_BRANCH' -Default 'dev'
$resolvedBridgeProcessMatch = Get-RequiredValue -Explicit $BridgeProcessMatch -Config $config -Name 'STEAMDECK_BRIDGE_PROCESS_MATCH' -Default 'scripts/steamdeck-bridge-client.js'
$resolvedBridgeStartCommand = Get-RequiredValue -Explicit $BridgeStartCommand -Config $config -Name 'STEAMDECK_BRIDGE_START_COMMAND' -Default 'bash scripts/steamdeck-run-bridge.sh'
$resolvedSshKey = Get-RequiredValue -Explicit $SshKey -Config $config -Name 'STEAMDECK_SSH_KEY'
$resolvedRepoDirCommand = Get-RemoteRepoDirCommand -Path $resolvedRepoDir

$sshCommand = Get-Command ssh -ErrorAction Stop
$sshArgs = @(
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=10',
  '-p', [string]$resolvedDeckPort
)
if ($resolvedSshKey) {
  $sshArgs += @('-i', $resolvedSshKey)
}

$remoteLines = @(
  'set -euo pipefail',
  "cd $resolvedRepoDirCommand",
  "git fetch origin '$(Escape-SingleQuotedBash $resolvedBranch)'",
  "git checkout '$(Escape-SingleQuotedBash $resolvedBranch)'",
  "git pull --ff-only origin '$(Escape-SingleQuotedBash $resolvedBranch)'"
)

if ($RestartBridge) {
  $processMatch = Escape-SingleQuotedBash $resolvedBridgeProcessMatch
  $startCommand = Escape-SingleQuotedBash $resolvedBridgeStartCommand
  $remoteLines += @(
    "pkill -f '$processMatch' >/dev/null 2>&1 || true",
    "nohup sh -lc '$startCommand' > ~/.acnh-live-bridge.log 2>&1 < /dev/null &",
    'sleep 2',
    "pgrep -f '$processMatch' >/dev/null"
  )
}

$remoteLines += 'git rev-parse HEAD'
$remoteScript = [string]::Join("`n", $remoteLines)
$target = "{0}@{1}" -f $resolvedDeckUser, $resolvedDeckHost

Write-Host "[steamdeck-deploy] Target: $target`:$resolvedDeckPort"
Write-Host "[steamdeck-deploy] Repo: $resolvedRepoDir ($resolvedBranch)"
if ($RestartBridge) {
  Write-Host '[steamdeck-deploy] Bridge restart: enabled'
}

if ($PrintOnly) {
  Write-Host '--- remote script ---'
  Write-Host $remoteScript
  exit 0
}

$sshArgs += @($target, $remoteScript)
& $sshCommand.Source @sshArgs
if ($LASTEXITCODE -ne 0) {
  throw "Remote deploy failed with exit code $LASTEXITCODE"
}