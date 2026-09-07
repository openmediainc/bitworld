#!/usr/bin/env bash
# Snapshot District's persisted campus state without stopping the hub.
set -euo pipefail

ROOT="${DISTRICT_ROOT:-/Volumes/MacMiniExtended/Local Server/District}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
BACKUP_DIR="${DISTRICT_BACKUP_DIR:-/Volumes/MacMiniExtended/Backups/District}"
KEEP="${DISTRICT_BACKUP_KEEP:-30}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/district-data-$stamp.tar.gz"
tmp="$archive.tmp"

tar -C "$DATA_DIR" -czf "$tmp" .
mv "$tmp" "$archive"

# Keep the newest N complete archives. Partial .tmp files are never counted.
mapfile_cmd=()
while IFS= read -r file; do
  mapfile_cmd+=("$file")
done < <(ls -1t "$BACKUP_DIR"/district-data-*.tar.gz 2>/dev/null || true)

if ((${#mapfile_cmd[@]} > KEEP)); then
  printf '%s\0' "${mapfile_cmd[@]:KEEP}" | xargs -0 rm -f
fi

echo "$archive"
