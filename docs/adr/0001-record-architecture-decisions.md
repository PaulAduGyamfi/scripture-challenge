# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

scripture-challenge is maintained by one person, with coding agents doing much of the
implementation. Agents start each session without memory of earlier ones, and the reasons behind
decisions (why state is a JSON file, why deploys need approval, why AI never awards points on its
own) were scattered across PR descriptions, chat sessions and the baseline audit. Without a record,
the same questions get reopened, or a decision gets undone by someone who didn't know why it was made.

## Decision

We record each significant decision as an architecture decision record (ADR) in `docs/adr/`,
following the format described by Michael Nygard: **Context**, **Decision**, **Consequences**,
**Status**, in under one page.

- A decision is significant if it constrains future changes: architecture, data, deployment,
  security, the role of AI, or tooling choices that are expensive to reverse.
- ADRs are numbered in order and listed in [the index](README.md).
- An accepted ADR isn't rewritten. A changed decision gets a new ADR that supersedes the old one.
- Anything that needs the maintainer's input is written as `TODO(owner)`, not guessed.

## Consequences

- Agents and reviewers can check a change against recorded decisions, and PRs can cite them
  ("follows ADR 0002"), the same way they cite AGENTS.md invariants.
- Writing an ADR costs a few minutes per significant decision. Small or easily reversed choices don't need one.
- The ADRs only help if they're kept current: a PR that changes a recorded decision must add or
  supersede an ADR in the same PR.
