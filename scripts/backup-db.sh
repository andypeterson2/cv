#!/usr/bin/env bash
# Snapshot the cv SQLite database into ./backups/ with a timestamped, labelled name,
# instead of scattering cv.db.bak-* files in the package root.
#
# These snapshots contain real CV data and are gitignored (see .gitignore: backups/).
#
# Usage:  scripts/backup-db.sh [label]
#   label        optional tag for the snapshot (e.g. "pre-migration"); default: "manual"
#   CV_DB_PATH   path to the live DB (default: <package>/cv.db) — same env var the
#                editor and deploy compose use, so this works locally and in-container.
set -euo pipefail

pkg_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db="${CV_DB_PATH:-$pkg_root/cv.db}"
label="${1:-manual}"
stamp="$(date +%Y%m%d-%H%M%S)"
dest_dir="$pkg_root/backups"

if [[ ! -f "$db" ]]; then
  echo "error: no database found at '$db' (set CV_DB_PATH to point at the live DB)" >&2
  exit 1
fi

mkdir -p "$dest_dir"
dest="$dest_dir/cv.db.bak-${label}-${stamp}"

# Prefer sqlite's online backup: a consistent snapshot even with WAL writes in flight.
# Fall back to a plain copy only if the sqlite3 CLI isn't available.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$db" ".backup '$dest'"
else
  cp "$db" "$dest"
fi

echo "backup written: ${dest#"$pkg_root/"}"
