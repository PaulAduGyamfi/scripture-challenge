# Code standards

How code in this repo is shaped, so any reviewer can read a file top to bottom and follow it.
The rules the code must keep (I1–I6) are in [AGENTS.md](../AGENTS.md); the layers we're moving
toward are in [architecture.md](architecture.md).

## 1. Keep files small

- Aim for **400 lines or fewer** per file in `src/`. **500 is the ceiling**, and
  `test/file-size.test.ts` fails above it.
- When a file grows past 400, split it by what the code is *for* (for example, the read-only
  replies live in `replies.ts` and the answer handlers in `answers.ts`), not by size alone.
- Keep the public API stable when you split: `core.ts` re-exports what `bot.ts`, `sim.ts` and the
  tests use, so callers don't change.

## 2. `src/domain/` is pure

- `src/domain/` holds the game rules: matching, points, streaks, badges, day and week keys. It does
  no I/O.
- It may import from `../types` and from other `domain/` files only. Never from `ai`, `sheet`,
  `state`, `config` or `bot`, and never a Node module (`node:fs`, `fs`, …).
  `test/domain-boundaries.test.ts` checks this.
- It needs a player or the state? Declare the few fields it reads as a small interface, as
  `domain/streaks.ts` does, instead of importing `Player` or `State`.

## 3. Imports go one way

```
bot.ts, sim.ts  ->  core.ts  ->  answers.ts, replies.ts  ->  players.ts, format.ts, schedule.ts  ->  domain/
```

No import cycles. Nothing imports `core.ts` except the entry points and the tests.
Only `core.ts` runs the `inOrder` queue (I2). Functions elsewhere that save state, such as the
handlers in `answers.ts`, are called only from inside it, and say so at the top of their file.

## 4. Refactors don't change behaviour

- Move code verbatim. Only the `export` keywords and the imports change.
- The characterization snapshots (`test/__snapshots__/`) must not change, and existing tests pass
  unedited. Never run `vitest -u` in a refactor.
- If a refactor needs a real change (like `dayKey`'s optional time zone), keep the default path
  identical and add a test for the new path.

## 5. Write like the code around you

- Plain functions and small interfaces. No classes, frameworks or clever abstractions.
- Name things for what they mean in the game (`recordSolve`, `lateAnswer`), not how they work.
- Comment the *why* and the non-obvious, in one line where possible, at the density of the
  surrounding code. Don't restate the code.
- Prettier formats, oxlint checks (`npm run format`, `npm run lint`).
