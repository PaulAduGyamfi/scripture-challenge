# Restore scores from an off-site backup

Every morning at 6:55 the bot copies `state.json` (all scores, streaks and badges) to
`backups/state-YYYY-MM-DD.json` on the server, keeping 30 days. At 7:00,
`scripts/offsite-backup.sh` encrypts the newest one with [age](https://github.com/FiloSottile/age)
and uploads it with [rclone](https://rclone.org), so the scores survive losing the server.

Only the **public** key is on the server. The **private** key (`key.txt`) stays with you, so
someone who breaks into the server or the storage bucket can't read the backups.

> If the server is fine and you only need yesterday's scores, the local copy is quicker:
> see "Backups" in the README. This runbook is for when the server or its `backups/` folder is gone.

Paths below assume the bot lives in `/root/scripture-challenge` and runs in pm2 as
`scripture-bot`, as in the README. Change them if yours differ.

---

## One-time setup

### 1. Make the key pair, on your own computer

```bash
age-keygen -o key.txt          # prints "Public key: age1..."
```

- Keep `key.txt` in **two** safe places, like a password manager and an offline USB stick.
  **If you lose it, every off-site backup is unreadable.**
- Never copy `key.txt` to the server or commit it.
- The `age1...` line is the public key. You can print it again with `age-keygen -y key.txt`.

### 2. Install the tools on the server

```bash
apt install age rclone          # or rclone's own installer, see rclone.org/install
rclone config                   # create a remote, e.g. "b2" for Backblaze B2
```

- Give rclone a storage key that can **write but not delete** if your provider allows it
  (in Backblaze B2: an application key limited to the bucket, without `deleteFiles`). Then
  someone who takes over the server can't wipe the off-site copies too.
- The script never deletes old copies. Set a lifecycle rule on the bucket (e.g. keep 90 days)
  so they don't pile up forever.

### 3. Add the settings to `.env` on the server

```bash
BACKUP_AGE_RECIPIENT=age1...your-public-key...
BACKUP_REMOTE=b2:scripture-backups/
```

Keep each on its own line, with no comment after the value. The script reads only these two
lines (and `TZ_NAME`) from `.env`.

### 4. Try it by hand

```bash
cd /root/scripture-challenge
./scripts/offsite-backup.sh
rclone ls b2:scripture-backups/          # today's state-YYYY-MM-DD.json.age should be listed
```

Then do a **practice decrypt** on your own computer (steps 1–3 of "Restoring" below) to prove
the key works. A backup you've never decrypted is a hope, not a backup.

### 5. Schedule it with cron

Add this with `crontab -e`, as the same user that runs the bot:

```cron
# Off-site backup at 7:00, after the bot's 6:55 backup
CRON_TZ=America/New_York
0 7 * * * cd /root/scripture-challenge && ./scripts/offsite-backup.sh >> /var/log/scripture-offsite-backup.log 2>&1
```

- **Time zone:** the bot posts and backs up on `TZ_NAME`, but cron uses the server's clock.
  Check the server with `timedatectl`.
  - If the server's zone is the same as `TZ_NAME`, drop the `CRON_TZ` line.
  - Otherwise, set `CRON_TZ` to your `TZ_NAME`. Check that your cron supports it first: `man 5 crontab`
    should mention `CRON_TZ`. If it doesn't, convert 7:00 to server time instead, and remember that
    daylight saving moves it.
- **PATH:** cron's PATH is short (`/usr/bin:/bin`). If `which age rclone` shows another folder,
  add a `PATH=...` line above the job.
- **Failures:** the script exits non-zero with a `!!` line if anything fails. That includes when the
  newest backup isn't today's, which means the bot's 6:55 backup didn't run (it still uploads the
  newest one it has). Check the log now and then:
  `grep '!!' /var/log/scripture-offsite-backup.log`

---

## Restoring

Restore outside game times if you can (e.g. after 9 PM), because answers sent while the bot is
stopped are missed. Scores go back to the time of the backup, so tell the group that anything
after that is lost.

### 1. Download the backup, on your own computer

```bash
rclone ls b2:scripture-backups/                                  # pick the date you want
rclone copy b2:scripture-backups/state-2026-03-04.json.age .
```

(Or download it from your storage provider's website.)

### 2. Decrypt it

```bash
age -d -i key.txt -o state.json state-2026-03-04.json.age
```

### 3. Check that it's valid JSON

```bash
node -e 'JSON.parse(require("fs").readFileSync("state.json", "utf8")); console.log("valid JSON")'
```

If this fails, try an older backup.

### 4. Copy it to the server

Put it in `backups/` under a name the bot's clean-up ignores. That folder is git-ignored, so the
file (which holds players' phone numbers) never ends up in the repo.

```bash
scp state.json root@YOUR_SERVER:/root/scripture-challenge/backups/restore-incoming.json
```

If you're rebuilding a new server, set it up first by following the README (steps 2–5), then come back here.

### 5. Stop the bot, swap the file in, and start it again

On the server:

```bash
cd /root/scripture-challenge
pm2 stop scripture-bot                                     # nothing may write state.json during the swap
[ -f state.json ] && cp state.json backups/state-before-restore.json   # keep the current one, just in case
cp backups/restore-incoming.json state.json
pm2 start scripture-bot
pm2 logs scripture-bot --lines 50
```

### 6. Check it worked

- The log shows `Bot is ready`, and no `state.json looks damaged`.
- `!leaderboard` and `!me` in the group show the restored scores.

**If the bot won't start** (`looks damaged` or `not valid JSON`), put the old file back:

```bash
pm2 stop scripture-bot
cp backups/state-before-restore.json state.json
pm2 start scripture-bot
```

Then try an older backup from step 1.

### 7. Tidy up

- On the server, remove `backups/restore-incoming.json` (and `backups/state-before-restore.json`
  once you're happy).
- On your computer, delete the decrypted `state.json` and the downloaded `.age` file. Keep `key.txt`.
