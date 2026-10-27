# 0004. Keep state in a JSON file for now

- **Status:** Accepted
- **Date:** 2026-10-27
- **Related:** `src/state.ts`; AGENTS.md I2 and I3; baseline audit R-11, R-13, R-21

## Context

All game state (today's puzzle, the three extra games, used verses, and every player's points,
streaks and badges) is one file, `state.json`, owned by one Node.js process serving one WhatsApp
group. Every message that might be an answer loads the file, and every change saves it, inside the
`inOrder` queue in `src/core.ts` (I2). A database would add a dependency, a migration story and
more to run on the server.

TODO(owner): the current size of `state.json` and the number of players. Agents may not read the file.

## Decision

Keep state in `state.json` until one of the triggers below is reached. What makes it safe today:

- **Atomic saves:** `save()` writes `state.json.tmp`, then renames it over `state.json`, so a crash
  mid-save never leaves a half-written file.
- **Validation on load:** `load()` checks the whole file against a Zod schema and refuses to start
  on invalid JSON or the wrong shape, instead of wiping scores. New fields get Zod defaults, so older
  files still load and a rollback can read a newer file (I3).
- **One writer:** every read-modify-write goes through the `inOrder` queue, so two answers never
  save over each other (I2).
- **Backups:** a dated copy is taken at 6:55 every day, keeping 30 days in `backups/`.
  `scripts/offsite-backup.sh` encrypts the newest one and uploads it off the server.
  TODO(owner): confirm the off-site cron job is installed.

**Move to SQLite** when any of these is measured:

| Trigger | Threshold |
|---|---|
| `state.json` size | over 5 MB |
| Time for one `save()` | over 50 ms |
| Processes writing state | more than one (e.g. a second group, a web dashboard, a worker) |

## Consequences

- No database to install, back up or migrate. A backup is a file copy, and a restore is a file copy
  (`docs/runbooks/restore-from-backup.md`).
- The whole file is read and rewritten for every change, so cost grows with its size. That's why the
  first two triggers exist.
- Nothing measures those triggers yet. TODO(owner): decide where to log the file size and save time
  (e.g. one log line from the daily backup).
- Known gaps, accepted for now:
  - A **missing** file starts the game empty instead of refusing to start (R-11).
  - `save()` doesn't fsync before the rename (R-21).
  - Backups taken on the server are lost with the server unless the off-site copy runs (R-13).
- Moving to SQLite later means a one-off import from `state.json`. Keeping the schema in Zod makes
  that import straightforward to validate.
