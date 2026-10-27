#!/usr/bin/env bash
# One-command local startup for the Security Deposit & FDR Portal (macOS / Linux).
#
#   ./run.sh              start everything (database, schema, demo data if empty, app, browser)
#   ./run.sh check        check prerequisites (changes nothing)
#   ./run.sh help         list the other commands (test, e2e, monitor, reset-demo)
#
# This wrapper only locates the repository and checks for Node.js; the shared launcher
# (scripts/launcher.mjs, also used by run.ps1 on Windows) does the rest. No sudo is required.
set -euo pipefail

# Resolve the repository root from this script's own location (works from any directory,
# through symlinks and with spaces in paths).
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
  SOURCE="$(readlink -- "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac
done
ROOT="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"

die() {
  printf '\n\033[31m✘ %s\033[0m\n' "$1" >&2
  [ -n "${2:-}" ] && printf '  %s\n' "$2" >&2
  exit 1
}

command -v node >/dev/null 2>&1 \
  || die "Node.js was not found on PATH." "Install Node.js 20.18+ (LTS recommended) from https://nodejs.org or with nvm, then open a new terminal and re-run ./run.sh."

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=18)?0:1)'; then
  die "Node.js $(node -v) is too old; version 20.18 or newer is required." "Install the current LTS from https://nodejs.org (or: nvm install --lts && nvm use --lts)."
fi

command -v npm >/dev/null 2>&1 \
  || die "npm was not found on PATH." "npm ships with Node.js; reinstall Node.js from https://nodejs.org."

[ -f "$ROOT/scripts/launcher.mjs" ] || die "scripts/launcher.mjs is missing." "Restore the repository files (git status / git checkout)."

# exec: the launcher replaces this shell, so Ctrl+C and termination signals reach it directly.
SDP_LAUNCHER="./run.sh" exec node "$ROOT/scripts/launcher.mjs" "$@"
