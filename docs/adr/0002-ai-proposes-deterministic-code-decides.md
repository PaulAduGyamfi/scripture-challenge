# 0002. AI proposes, deterministic code decides

- **Status:** Accepted
- **Date:** 2026-10-27
- **Related:** AGENTS.md invariants I1 and I4; baseline audit R-01, R-02, R-07, R-19

## Context

The bot uses Claude to read messy guesses ("john three sixteen"), judge free-text Riddle and Emoji
Bible answers, write hints, cheer winners and draw emoji clues. Model output can be wrong, and
it can be steered: players write the messages and choose their WhatsApp display names, and both
reach the prompts. In a live game with real scores, one wrong or manipulated reply can award
points, close a game for everyone, or post something to the whole group.

## Decision

AI output may **interpret, rank or draft**. Only non-AI code **awards points, writes state, or
posts to the group unchecked**.

- When AI interprets a message, deterministic code makes the decision. Example: `aiReadGuess`
  returns a reference, and `isCorrect` compares it with the answer, which the AI never sees.
- AI-drafted text is posted only after a deterministic check, or with a non-AI fallback.
- Untrusted text (player messages, names, sheet content) goes in the user turn, delimited, never in the system prompt (I4).

## Current exceptions, tracked for removal

These break the decision today. Remove each line when a PR fixes it.

**Award points without a deterministic check:**

1. `judgeRiddleGuess`: a `correct` verdict wins the Bible Riddle and closes it (`src/core.ts`, `handleMessage`). R-01.
2. `judgeStoryGuess`: the same for Emoji Bible. R-01.

**Posted to the group unchecked:**

3. `makeHint`: the AI hint is posted as written. Nothing checks that it avoids the verse's words or the book. R-07.
4. `celebrate`: the AI cheer, built from the player-chosen display name, is posted as written. R-02.
5. `makeEmoji`: only ASCII letters and digits are rejected, so letters from other scripts would pass. R-19.

The stopgap for 1 and 2 is `AI_JUDGING=off` in `.env`, which turns both judges off. Only the
answers listed in the sheet then win.

## Consequences

- New AI features need a deterministic check, or no power over points, state or posts, before they
  can merge. Reviewers check this against I1.
- Some free-text answers that a person would accept ("the man who built the ark") can't win
  until a deterministic way to accept them exists, or a reviewed exception is recorded in a new ADR.
- Removing exceptions 1–5 is migration work. TODO(owner): choose the phase or PR for each.
- Changes to `src/ai.ts` or prompts also need eval runs once evals exist (AGENTS.md Testing 2).
