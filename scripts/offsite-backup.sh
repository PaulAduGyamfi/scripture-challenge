#!/usr/bin/env bash
# Encrypts the newest backups/state-YYYY-MM-DD.json with age and uploads it with rclone, so the
# scores survive losing the server. Run on the server by cron, after the bot's 6:55 backup.
# Needs BACKUP_AGE_RECIPIENT and BACKUP_REMOTE, from the environment or from .env.
# Never prints the backup's contents. Restoring: docs/runbooks/restore-from-backup.md
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "!! $*" >&2; exit 1; }

# Cron doesn't load .env, so read just the one setting asked for (never the rest of the file)
from_env_file() {
  [ -f .env ] || return 0
  { grep -E "^$1=" .env || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r' |
    sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}

BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-$(from_env_file BACKUP_AGE_RECIPIENT)}"
BACKUP_REMOTE="${BACKUP_REMOTE:-$(from_env_file BACKUP_REMOTE)}"
[ -n "$BACKUP_AGE_RECIPIENT" ] || fail "BACKUP_AGE_RECIPIENT is not set (an age public key, age1...). See .env.example"
[ -n "$BACKUP_REMOTE" ] || fail "BACKUP_REMOTE is not set (an rclone remote, like b2:scripture-backups/). See .env.example"
# Without a colon rclone would quietly copy to a local folder instead of off-site
[[ "$BACKUP_REMOTE" == *:* ]] || fail "BACKUP_REMOTE \"$BACKUP_REMOTE\" isn't an rclone remote (like b2:scripture-backups/)"
command -v age >/dev/null || fail "age is not installed (apt install age)"
command -v rclone >/dev/null || fail "rclone is not installed (apt install rclone)"

# Dated names sort oldest to newest, so the last one is the newest
shopt -s nullglob
files=(backups/state-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].json)
[ ${#files[@]} -gt 0 ] || fail "No backups/state-YYYY-MM-DD.json to upload (the bot makes one at 6:55)"
newest="${files[-1]}"
name="$(basename "$newest")"

# The encrypted copy lives only in a private temporary folder, removed however the script ends
tmp="$(umask 077 && mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "== Encrypting $name"
age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp/$name.age" "$newest" ||
  fail "Couldn't encrypt $name with age (is BACKUP_AGE_RECIPIENT a valid age1... public key?)"
echo "== Uploading $name.age to $BACKUP_REMOTE"
rclone copy --no-traverse "$tmp/$name.age" "$BACKUP_REMOTE" ||
  fail "Couldn't upload $name.age to $BACKUP_REMOTE (check: rclone lsd ${BACKUP_REMOTE%%:*}:)"
echo "== Uploaded $name.age"

# Uploaded anyway, but a backup that isn't today's means the 6:55 backup didn't run: say so loudly.
# "Today" is the bot's day (TZ_NAME), the same one it names its backups by.
TZ_NAME="${TZ_NAME:-$(from_env_file TZ_NAME)}"
today="$(TZ="${TZ_NAME:-America/New_York}" date +%F)"
[ "$name" = "state-$today.json" ] ||
  fail "The newest backup is $name, not today's (state-$today.json). Check that the bot is running: pm2 logs scripture-bot"
