# Architecture decision records

An ADR records one significant decision: the situation, what we chose, and what follows from it.
They explain *why* the code is the way it is, so nobody has to rediscover it (see [0001](0001-record-architecture-decisions.md)).

## Index

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted | 2026-10-27 |
| [0002](0002-ai-proposes-deterministic-code-decides.md) | AI proposes, deterministic code decides | Accepted | 2026-10-27 |
| [0003](0003-production-deploys-require-approval.md) | Production deploys require human approval | Accepted | 2026-10-27 |
| [0004](0004-keep-state-in-a-json-file.md) | Keep state in a JSON file for now | Accepted | 2026-10-27 |
| [0005](0005-lint-tooling-under-typescript-7.md) | Lint tooling under TypeScript 7 | Proposed | 2026-10-27 |

## Adding one

1. Copy the newest ADR to `NNNN-short-title.md` with the next number.
2. Fill in **Context**, **Decision**, **Consequences** and **Status**, in under one page.
   Write `TODO(owner)` for anything that needs the maintainer's input rather than guessing.
3. Start it as **Proposed**, add it to the index above, and open a PR.
4. The maintainer accepts it by changing the status to **Accepted** in that PR, or a later one.

## Statuses

- **Proposed:** written down, not yet decided.
- **Accepted:** in force. Code and reviews follow it.
- **Superseded by NNNN:** replaced by a later ADR. Kept for the history.
- **Deprecated:** no longer applies, and nothing replaced it.

An accepted ADR isn't rewritten. To change a decision, write a new ADR that supersedes it and
update the old one's status only.
