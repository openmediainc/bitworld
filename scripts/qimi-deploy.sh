#!/usr/bin/env bash
# Run on Qimi. GitHub is the source of truth. Source, runtime, and data all sit
# on the internal disk: the external volume drops reads under launchd, which
# leaves the service unable to start.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"

# This script updates the checkout it lives in, and bash reads scripts as it
# runs. Re-exec from a snapshot so a mid-run rewrite cannot shift byte offsets
# under the interpreter.
if [ "${DISTRICT_DEPLOY_SNAPSHOT:-}" != "1" ]; then
  SNAPSHOT="$(mktemp -t qimi-deploy)"
  cp "$0" "$SNAPSHOT"
  trap 'rm -f "$SNAPSHOT"' EXIT
  DISTRICT_DEPLOY_SNAPSHOT=1 bash "$SNAPSHOT" "$@"
  exit $?
fi
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
LABEL="digital.openmedia.district"
loaded() { launchctl list 2>/dev/null | /usr/bin/grep -q "$LABEL"; }

if loaded; then
  # kickstart retains the previously loaded environment. Reload the plist so
  # BASE_PATH and other release settings actually take effect.
  launchctl bootout "gui/${UID_N}/${LABEL}" || true
  # bootout returns before launchd finishes unloading, and bootstrapping into a
  # half-unloaded service fails with EIO.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    loaded || break
    sleep 1
  done
fi

for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/${UID_N}" "$PLIST"; then
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "[district] could not bootstrap ${LABEL}" >&2
    exit 1
  fi
  sleep 2
done

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT:-4242}/health" >/dev/null 2>&1; then
    echo "[district] deployed and healthy"
    exit 0
  fi
  sleep 1
done
echo "[district] service never answered /health — check /tmp/district.err.log" >&2
exit 1
