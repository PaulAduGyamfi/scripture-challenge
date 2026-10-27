# AGENTS.md

Rules for any coding agent (and human) working in this repo. Numbered items are meant to be
cited in PRs, e.g. "keeps I2" or "see Never 1".

## 1. What this is

scripture-challenge is a live WhatsApp Bible game with real players: a bot posts a daily verse
as an acronym, plus a Bible Riddle, a Midday Review and Emoji Bible, and keeps season and weekly
scores in `state.json`. A mistake can corrupt their scores or spam their group, so we work in
small, reversible steps.

## 2. Commands

| What | Command |
|---|---|
| Install | `PUPPETEER_SKIP_DOWNLOAD=true npm ci` (Chrome isn't needed for tests or builds) |
| Typecheck | `npm run typecheck` (src and test) |
| Test | `npm test` (offline: the AI, the sheet and WhatsApp are faked; no keys needed) |
| Build | `npm run build` (compiles to `dist/`) |
| Simulator | `npm run sim` (plays the game in the terminal; needs `ANTHROPIC_API_KEY` and `SHEET_CSV_URL`) |

`npm run sim` reads and writes `state.json` in the current folder, so only run it in a separate
copy of the project, never in the live server's folder. Lint and format aren't configured yet.

## 3. Map

- `src/bot.ts`: the WhatsApp connection, command routing, admin gating, reply pacing, cron jobs, health check and restarts.
- `src/core.ts`: the game: puzzles, scoring, points, the schedule (`SCHEDULE`), streaks, badges, leaderboards, every player-facing message, and the `inOrder` queue.
- `src/game.ts`: pure matching logic: book names, references, acronyms, decoded words, story and riddle answers.
- `src/ai.ts`: every Claude call and prompt: reading messy guesses, hints, cheers, emoji clues, the Riddle and Emoji judges, the `AI_JUDGING` switch.
- `src/sheet.ts`: downloading and validating the Google Sheet tabs (verses, Stories, Riddles), with the last good copy as fallback.
- `src/state.ts`: the `state.json` schema (Zod), loading, atomic saving, and daily backups.
- `src/config.ts`: reading settings from `.env`.
- `src/types.ts`: the Bible book list and shared types.
- `src/sim.ts`: the terminal simulator.

## 4. Invariants

These must never be broken. A PR that has to break one says so in its description and why.

1. **I1.** AI output never awards points or changes state without a deterministic check in non-AI code.
2. **I2.** Every `state.json` read-modify-write goes through the `inOrder` queue in `src/core.ts`.
3. **I3.** `state.json` schema changes must be backward compatible (new fields get Zod defaults), so a rollback can still load the file.
4. **I4.** Player text (messages, names) and sheet content are untrusted: never put them in a system prompt, always in the user turn, delimited.
5. **I5.** Points values and the schedule are product decisions; change them only when the task says so.
6. **I6.** No new runtime dependency without a one-paragraph justification in the PR.

**Known violations, to be fixed** (remove each line when a PR fixes it):

- I1: `judgeRiddleGuess` and `judgeStoryGuess` returning `correct` award points directly
  (`src/core.ts`, the `verdict === "correct"` branches in `handleMessage`). Baseline audit R-01.
  `AI_JUDGING=off` turns them off.
- I4: both judges put sheet content (story, answers, emoji, riddle) in the system prompt (`src/ai.ts`, `judgeStoryGuess` and `judgeRiddleGuess`).
- I4: no AI call delimits player text in the user turn (`aiReadGuess` sends the raw message, `celebrate` the raw name). Baseline audit R-02.

## 5. Working rules

1. Plan first. Read the files involved, then reply with: the files you will change, the tests you will add or update, the risks, and how to roll back. Wait for my approval before editing anything.
2. Keep the diff small and focused on the task. Don't change what players see unless the task explicitly says so.
3. I handle git. Don't create branches, commit or push.
4. When finished, run every check that exists (npm run typecheck, npm test, npm run build, plus lint and format once they're configured) and paste the results.
5. List the files you changed and draft the pull request description: what changed, why, how it was verified, behaviour change yes/no, rollback.
6. If something is unclear or a decision is mine to make, stop and ask instead of guessing.

## 6. Testing

1. Every behaviour change needs a test in `test/` that fails without the change.
2. Any change to `src/ai.ts` or to a prompt needs an eval run, once evals exist, with the results in the PR.

## 7. Never

1. Never read .env, state.json, backups/ or .wwebjs_auth/ (`.env.example` is fine). Never deploy or ssh. Never run `npm audit fix --force`.
