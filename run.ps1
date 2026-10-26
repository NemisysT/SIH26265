#Requires -Version 5.1
<#
.SYNOPSIS
  One-command local startup for the Security Deposit & FDR Portal (Windows PowerShell 5.1+ / PowerShell 7+).

.DESCRIPTION
  .\run.ps1              start everything (database, schema, demo data if empty, app, browser)
  .\run.ps1 check        check prerequisites (changes nothing)
  .\run.ps1 help         list the other commands (test, e2e, monitor, reset-demo)

  This wrapper only locates the repository and checks for Node.js; the shared launcher
  (scripts\launcher.mjs, also used by run.sh on macOS/Linux) does the rest.
  Administrator rights are not required. Press Ctrl+C to stop the portal.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'start',
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Stop-WithError([string]$Message, [string]$Hint) {
  Write-Host ''
  Write-Host "X $Message" -ForegroundColor Red
  if ($Hint) { Write-Host "  $Hint" }
  exit 1
}

# Resolve the repository root from this script's own location (any working directory, spaces OK).
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path (Join-Path $Root 'scripts') 'launcher.mjs'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Stop-WithError 'Node.js was not found on PATH.' 'Install Node.js 20.18+ (LTS) from https://nodejs.org, then open a NEW PowerShell window and run .\run.ps1 again.'
}

& node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=18)?0:1)'
if ($LASTEXITCODE -ne 0) {
  $version = (& node -v)
  Stop-WithError "Node.js $version is too old; version 20.18 or newer is required." 'Install the current LTS from https://nodejs.org.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Stop-WithError 'npm was not found on PATH.' 'npm ships with Node.js; reinstall Node.js from https://nodejs.org.'
}

if (-not (Test-Path -LiteralPath $Launcher)) {
  Stop-WithError 'scripts\launcher.mjs is missing.' 'Restore the repository files (git status / git checkout).'
}

$launcherArgs = @($Launcher, $Command)
if ($Yes) { $launcherArgs += '--yes' }

# The launcher handles Ctrl+C itself and stops only the processes it started.
$env:SDP_LAUNCHER = '.\run.ps1'
& node @launcherArgs
exit $LASTEXITCODE
