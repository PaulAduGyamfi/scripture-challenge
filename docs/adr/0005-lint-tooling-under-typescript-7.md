# 0005. Lint tooling under TypeScript 7

- **Status:** Accepted
- **Date:** 2026-10-27 (proposed and accepted)

## Context

The repo has no linter or formatter. AGENTS.md working rule 4 already expects "lint and format once
they're configured". The project compiles and typechecks with `typescript ^7.0.2` (`package.json`),
and `npm run typecheck` checks both `src/` and `test/`. Linters that use type information depend on
the TypeScript compiler's API, so the TypeScript version limits which tools can run here.

TODO(owner): which lint tools support TypeScript 7 today, and which rules we actually need
(e.g. no floating promises, no unused variables, import boundaries for the target layers in
`docs/architecture.md`).

Lint tools are dev dependencies, so AGENTS.md I6 (runtime dependencies) doesn't apply. The PR
adding one should still say why.

## Options

1. **oxlint.** Add oxlint as the linter and keep TypeScript 7 for typecheck and build.
   TODO(owner): rule coverage, type-aware rules and TypeScript 7 support.
2. **ESLint + typescript-eslint, with TypeScript 6 installed only for the linter.** Keep TypeScript 7
   for typecheck and build. The linter gets its own TypeScript 6 copy, so the repo has two TypeScript
   versions in its dev dependencies. TODO(owner): how the second copy is installed and kept in step,
   and whether TypeScript 6 parses everything TypeScript 7 accepts in this code.
3. **Downgrade the repo to TypeScript 6.** Use one TypeScript version for typecheck, build and lint,
   with ESLint + typescript-eslint. This changes the compiler that produces `dist/`, so it needs a full
   test and build check. TODO(owner): what TypeScript 7 features or speed we'd give up.

## Decision

Use **oxlint** (option 1) for linting, for now. Keep TypeScript 7 for typecheck and build.
Options 2 and 3 are not taken.

Revisit, with a new ADR that supersedes this one, if we need lint rules oxlint can't provide,
or if ESLint + typescript-eslint supports TypeScript 7.

## Consequences

- oxlint becomes a dev dependency, with an `npm run lint` script that CI runs. Working rule 4 then
  includes lint. This is done in a separate PR. TODO(owner): schedule it.
- The repo keeps a single TypeScript version, and nothing about typecheck or build changes.
- The open questions under Options 1 (rule coverage, type-aware rules, TypeScript 7 support) are
  answered by that PR's first real run, which removes those TODOs.
