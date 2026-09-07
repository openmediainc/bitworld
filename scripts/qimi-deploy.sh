#!/usr/bin/env bash
# Run on Qimi after git pull. GitHub is the source of truth.
set -euo pipefail
ROOT="${DISTRICT_ROOT:-/Volumes/MacMiniExtended/Local Server/District}"
cd "$ROOT"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
git fetch origin main
git reset --hard origin/main
npm ci
export DISTRICT_BASE="${DISTRICT_BASE:-/district/}"
npm run build -w @district/web
cp "$ROOT/scripts/digital.openmedia.district.plist" "$HOME/Library/LaunchAgents/digital.openmedia.district.plist"
UID_N="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/digital.openmedia.district.plist"
if launchctl print "gui/${UID_N}/digital.openmedia.district" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/${UID_N}/digital.openmedia.district"
else
  echo "LaunchAgent not loaded. From a Mini Terminal run:"
  echo "  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/digital.openmedia.district.plist"
fi
