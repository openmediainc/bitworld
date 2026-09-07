#!/usr/bin/env bash
# Run on Qimi after git pull. GitHub is the source of truth.
set -euo pipefail
ROOT="${DISTRICT_ROOT:-/Volumes/MacMiniExtended/Local Server/District}"
cd "$ROOT"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
git fetch origin main
git reset --hard origin/main
APP_SUPPORT="$HOME/Library/Application Support/District"
RUNTIME="$APP_SUPPORT/runtime"
mkdir -p "$RUNTIME"
if [ ! -d "$APP_SUPPORT/data" ] && [ -d "$ROOT/data" ]; then
  ditto "$ROOT/data" "$APP_SUPPORT/data"
fi
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude data \
  "$ROOT/" "$RUNTIME/"
cd "$RUNTIME"
npm ci
export DISTRICT_BASE="${DISTRICT_BASE:-/district/}"
npm run build -w @district/web
cp "$ROOT/scripts/digital.openmedia.district.plist" "$HOME/Library/LaunchAgents/digital.openmedia.district.plist"
UID_N="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/digital.openmedia.district.plist"
if launchctl print "gui/${UID_N}/digital.openmedia.district" >/dev/null 2>&1; then
  # kickstart retains the previously loaded environment. Reload the plist so
  # BASE_PATH and other release settings actually take effect.
  launchctl bootout "gui/${UID_N}/digital.openmedia.district"
fi
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/${UID_N}" "$PLIST"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    exit 1
  fi
  sleep 1
done
