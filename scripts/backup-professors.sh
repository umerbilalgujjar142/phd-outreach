#!/bin/bash
# Cron wrapper for the professor CSV backup. Runs every Friday 4:00 PM.
# Installed crontab line:  0 16 * * 5  /Users/muhammadumerbilal/Desktop/phd-outreach/scripts/backup-professors.sh
#
# All output is appended to backup.log inside the iCloud backup folder so you can
# see what each run did even though cron has no terminal.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/phd-outreach-backups}"
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

# cron runs with a minimal PATH — make sure `node` (Homebrew/nvm/system) is found.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_BIN="/usr/local/bin/node"
else
  echo "[$(date -u +%FT%TZ)] ERROR: node not found on PATH for cron" >>"$LOG"
  exit 1
fi

cd "$PROJECT_ROOT"
"$NODE_BIN" scripts/backup-professors.mjs >>"$LOG" 2>&1
