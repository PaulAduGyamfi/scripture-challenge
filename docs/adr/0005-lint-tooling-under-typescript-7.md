# 0005. Lint tooling under TypeScript 7

- **Status:** Accepted
- **Date:** 2026-10-27 (proposed and accepted)

## Context

The repo has no linter or formatter. AGENTS.md working rule 4 already expects "lint and format once
they're configured". The project compiles and typechecks with `typescript ^7.0.2` (`package.json`),
and `npm run typecheck` checks both `src/` and `test/`. Linters that use type information depend on
the TypeScript compiler's API, so the TypeScript version limits which tools can run here.

Checked on 2026-10-27 (npm registry): `typescript-eslint` 8.72.1 (latest) and 8.72.2-alpha.2 (canary)
both require `typescript >=4.8.4 <6.1.0`, so ESLint + typescript-eslint can't use TypeScript 7.
oxlint 1.90.0 parses all of this repo's TypeScript 7 code.

TODO(owner): which rules we actually need beyond the categories below (e.g. no floating promises,
import boundaries for the target layers in `docs/architecture.md`).

Lint tools are dev dependencies, so AGENTS.md I6 (runtime dependencies) doesn't apply. The PR
adding one should still say why.

## Options

1. **oxlint.** Add oxlint as the linter and keep TypeScript 7 for typecheck and build.
   oxlint 1.90.0 has 872 rules, including 112 in its `typescript` plugin, of which 61 need type
   information. Type-aware rules run through the optional `oxlint-tsgolint` package, which is built on
   typescript-go, the codebase TypeScript 7 is built from.
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

**Why oxlint:**

- It's the only option that works with TypeScript 7 as it is: typescript-eslint still requires TypeScript <6.1.
- It keeps one TypeScript version, unlike options 2 and 3.
- It has a TypeScript-7-native route to type-aware rules (`oxlint-tsgolint`) for when we need them.

## Consequences

- oxlint is an exact-version dev dependency (`.oxlintrc.json`):
  - the `typescript` plugin, with the `correctness` and `suspicious` categories as errors. That's
    85 rules, and it lints 17 files in about 20 ms;
  - listing `plugins` turns off oxlint's default `unicorn` and `oxc` plugins, so their rules don't run.
- `npm run lint` prints everything. `npm run lint:ci` runs in CI: it fails on any error, or if warnings
  rise above the `--max-warnings` count. Working rule 4 now includes lint.
- Existing code didn't pass three rules, which are set to `warn` (5 warnings to start). Each fix lowers
  the `--max-warnings` count, so it can only go down.
- The repo keeps a single TypeScript version, and nothing about typecheck or build changes.
- No type-aware rules run yet. TODO(owner): evaluate `oxlint-tsgolint` (e.g. for no floating promises)
  as a follow-up.
