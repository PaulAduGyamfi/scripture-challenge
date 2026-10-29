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
| Lint | `npm run lint` (oxlint; prints every error and warning) |
| Lint, as CI runs it | `npm run lint:ci` (fails on any error, or if warnings rise above the `--max-warnings` count; lower that count when you fix one) |
| Format | `npm run format` to rewrite, `npm run format:check` to check (Prettier; `src/`, `test/`, `.claude/hooks/`) |
| Simulator | `npm run sim` (plays the game in the terminal; needs `ANTHROPIC_API_KEY` and `SHEET_CSV_URL`) |

`npm run sim` reads and writes `state.json` in the current folder, so only run it in a separate
copy of the project, never in the live server's folder.

## 3. Map

- `src/bot.ts`: the WhatsApp connection, command routing, admin gating, reply pacing, cron jobs, health check and restarts.
- `src/core.ts`: the game flow: new puzzles, `handleMessage`, hints, reveals, the three extra games, and the `inOrder` queue. Re-exports everything `bot.ts` uses.
- `src/answers.ts`: what a correct answer does: points, streaks, badges and the reply (called only inside `inOrder`).
- `src/replies.ts`: the read-only replies: `!today`, leaderboards, `!me`, `!streak`, `!schedule`, `!help`, reminders.
- `src/players.ts`: player records, season and week resets, rankings.
- `src/format.ts`: shared message helpers (`Post`, `Reply`, `replyTo`, tags, times, references).
- `src/schedule.ts`: the schedule (`SCHEDULE`) and `timeOf`.
- `src/domain/`: pure rules, no I/O: `matching.ts` (book names, references, acronyms, decoded words, story and riddle answers), `scoring.ts` (points), `streaks.ts` (streaks, badges), `calendar.ts` (day and week keys), `review.ts` (which old verses can come back).
- `src/game.ts`: re-exports `src/domain/matching.ts` for older imports.
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
7. Follow [docs/code-standards.md](docs/code-standards.md): files ≤400 lines (500 ceiling), a pure `src/domain/`, one-way imports, behaviour-preserving refactors.

## 6. Testing

1. Every behaviour change needs a test in `test/` that fails without the change.
2. Any change to `src/ai.ts` or to a prompt needs an eval run, once evals exist, with the results in the PR.

## 7. Never

1. Never read .env, state.json, backups/ or .wwebjs_auth/ (`.env.example` is fine). Never deploy or ssh. Never run `npm audit fix --force`.

## 8. Review checklist

Every PR review, by a human or by the AI reviewer (`.github/workflows/claude-review.yml`), checks
these. Cite them by number, e.g. "C2: the new hint isn't checked before it's posted".

1. **C1. Invariants.** The PR names every invariant it touches (I1–I6), and keeps them, or says why not.
2. **C2. AI output.** No new path where AI output changes state, awards points or reaches players without a
   deterministic check in non-AI code (I1, ADR 0002). Look at every new use of a function from `src/ai.ts`.
3. **C3. `state.json` compatibility.** Any schema change in `src/state.ts` gives new fields Zod defaults,
   so today's file and older backups still load (I3). There's a test that loads a file without the new field.
4. **C4. Tests.** Every behaviour change has a test in `test/` that fails without it (Testing 1).
5. **C5. Logs.** No player message text and no phone-number IDs (`…@c.us`, `…@lid`, or message IDs, which
   contain them) are logged.
6. **C6. Dependencies.** Any new dependency is justified in the PR. A runtime one needs a paragraph (I6).

**Known C5 exceptions, to be fixed** (remove each line when a PR fixes it; baseline audit R-18):

- `src/bot.ts`, `onMessage`: logs the sender ID when `ADMIN_ID` isn't set.
- `src/bot.ts`, `react`: logs the message ID on success and on failure.
- `src/core.ts`, `handleMessage`: logs up to 100 characters of a Bible Riddle or Emoji Bible answer the AI judged wrong.
