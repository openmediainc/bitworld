#!/usr/bin/env bash
# Run on Qimi. GitHub is the source of truth. Source, runtime, and data all sit
# on the internal disk: the external volume drops reads under launchd, which
# leaves the service unable to start.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
REPO="${DISTRICT_REPO:-https://github.com/openmediainc/bitworld.git}"
APP_SUPPORT="$HOME/Library/Application Support/District"
SRC="${DISTRICT_SRC:-$APP_SUPPORT/src}"
RUNTIME="$APP_SUPPORT/runtime"

mkdir -p "$APP_SUPPORT"
if [ ! -d "$SRC/.git" ]; then
  git clone "$REPO" "$SRC"
fi
cd "$SRC"
git remote set-url origin "$REPO"
git fetch origin main
git reset --hard origin/main

mkdir -p "$RUNTIME"
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude data \
  "$SRC/" "$RUNTIME/"
cd "$RUNTIME"
npm ci
export DISTRICT_BASE="${DISTRICT_BASE:-/district/}"
npm run build -w @district/web

PLIST="$HOME/Library/LaunchAgents/digital.openmedia.district.plist"
cp "$RUNTIME/scripts/digital.openmedia.district.plist" "$PLIST"
UID_N="$(id -u)"
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
