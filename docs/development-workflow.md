# Development workflow

How a change gets from an idea to the live bot. The rules agents follow while doing it are in
[AGENTS.md](../AGENTS.md); this page is the end-to-end process around them.

## 1. Lifecycle

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | **Requirement** | Maintainer | The task is written down: what should change, what must not, and whether players will see it |
| 2 | **Agent plan** | Agent | The agent has read the files involved and replied with the files to change, tests to add, risks and rollback (AGENTS.md working rule 1) |
| 3 | **Human approval** | Maintainer | The maintainer has approved the plan and answered any open decisions. No edits before this |
| 4 | **Implementation on a branch** | Agent | The change is on a branch named as in §2, and the diff is limited to the task (working rule 2) |
| 5 | **Tests** | Agent | Every behaviour change has a test that fails without it (AGENTS.md Testing 1); `npm run typecheck`, `npm test` and `npm run build` pass and the output is in the PR (working rule 4) |
| 6 | **Evals** (AI changes only) | Agent | Any change to `src/ai.ts` or a prompt has an eval run with results in the PR (Testing 2). Evals don't exist yet: until they do, say so in the PR |
| 7 | **CI** | GitHub Actions | All six check jobs are green on the PR: `install`, then `typecheck`, `lint`, `format`, `test` and `build` in parallel. `test` uploads a `coverage-summary` artifact |
| 8 | **Review** | Maintainer | The diff has been read, the PR description is complete (§4), and every invariant it touches is cited |
| 9 | **Merge** | Maintainer | Merged to `main` with a merge commit. Merging doesn't deploy |
| 10 | **Manual approved deploy** | Maintainer | The deploy has been started from the Actions tab and approved in the `production` environment (§6) |
| 11 | **Observe** | Maintainer | The bot is healthy after the restart and the next scheduled post went out (§6) |

## 2. Branch names

`type/short-name`, lowercase, words joined with hyphens, using the same types as commits (§3):
`feat/offsite-backups`, `fix/riddle-not-posted`, `ci/deploy-approval`, `docs/architecture`.
One branch per task; branch from an up-to-date `main`.

## 3. Commits

[Conventional Commits](https://www.conventionalcommits.org): `type: summary`, where the summary is
plain English in the present tense, says what changed for the user or maintainer, and fits on one line.

| Type | For |
|---|---|
| `feat` | something new players or the maintainer can use |
| `fix` | a bug fix |
| `refactor` | a code change with no behaviour change (most of the migration) |
| `test` | tests only |
| `docs` | documentation only |
| `ci` | the GitHub workflow |
| `chore` | tooling, config, dependencies |

Examples from this repo: `fix: Emoji Bible needs the story named, not the emoji described`,
`ci: require approval for production deploys`. A body is welcome when the why isn't obvious.

## 4. Pull requests

GitHub fills in [`.github/pull_request_template.md`](../.github/pull_request_template.md) for every new PR.
Between them, the template and this list cover what every PR description needs (working rule 5):

1. **What changed:** the change in a few bullets.
2. **Why:** the reason, with a baseline audit ID (R-xx) when there is one.
3. **How verified:** the checks that were run, with their results, and any manual testing.
4. **Behaviour change:** yes or no. If yes, what players will notice.
5. **Rollback:** how to undo it.

Also, when they apply:

- Cite every AGENTS.md invariant the change touches, e.g. "keeps I2", "fixes a known violation of I1".
- Justify any new runtime dependency in one paragraph (I6).
- Include eval results for AI changes (§1 step 6).

## 5. The `main` ruleset

**Current state (checked 2026-10-27):** a ruleset named **"Protect main"** exists, but its
enforcement is **disabled**, and `main` has no classic branch protection. So nothing stops a
direct push, a force-push or a merge with failing tests right now. Its configured rules are:

- deleting `main` is blocked, and force-pushes are blocked;
- merges must go through a pull request with **1 approving review** and code-owner review;
- the `test` status check must pass.

As configured, enabling it would block the maintainer: GitHub doesn't let authors approve their
own PRs, and code-owner review needs a `CODEOWNERS` file, which the repo doesn't have.

**Recommended settings** (Settings → Rules → Rulesets → Protect main):

| Setting | Value |
|---|---|
| Enforcement status | **Active** |
| Target | `main` |
| Restrict deletions | On |
| Block force pushes | On |
| Require a pull request before merging | On, with **0** required approvals (or keep 1 and add yourself as a bypass actor "for pull requests only") |
| Require review from Code Owners | Off, until a `CODEOWNERS` file exists |
| Require status checks to pass | On, with **`install`, `typecheck`, `lint`, `format`, `test`, `build`**. Include `install`: if it fails, the others are *skipped*, and GitHub counts a skipped required check as passing. Don't add `deploy`: it's skipped on pull requests |
| Allowed merge methods | Merge (what this repo uses) |

The `production` environment already requires a reviewer and only allows deploys from selected
branches. Keep it that way: it's what makes deploys manual (step 10).

## 6. Deploy, observe, roll back

**Deploy.** The full runbook is to be written (`docs/runbooks/deploy.md`). Until then:

1. Pick a quiet time, never in the 10 minutes before a game (see the schedule in
   [architecture.md](architecture.md)). A restart then skips that game's post.
2. Actions → **Tests and deploy** → **Run workflow** on `main`.
3. When all five checks (`typecheck`, `lint`, `format`, `test`, `build`) pass, **Review deployments** → approve `production`.

**Observe** on the server after the deploy:

- `pm2 logs scripture-bot --lines 0` shows `Bot is ready`, not a QR code or `Couldn't start WhatsApp`.
- `!help` in the group gets a reply.
- The next scheduled post goes out on time.

**Roll back.** The full runbook is to be written. Until then:

- **Bad code:** revert the PR on GitHub, merge the revert, and deploy again.
- **Bad scores:** see [restore-from-backup.md](runbooks/restore-from-backup.md).
- **Other deploy details:** see "Updating" in the [README](../README.md).

## 7. Git hooks

`npm install` and `npm ci` set up two local git hooks through husky (the `prepare` script, which
points git's `core.hooksPath` at `.husky/_`). They catch problems before they leave your machine.

| Hook | Runs | Blocks when | Typical time |
|---|---|---|---|
| **pre-commit** (`.husky/pre-commit`) | lint-staged: `prettier --write` then `oxlint` on the **staged `.ts` files only** | oxlint finds an error. Warnings don't block; the warning count is checked in CI | about 1 s for a 1,800-line commit |
| **pre-push** (`.husky/pre-push`) | `npm run typecheck && npm test` | a type error or a failing test | about 1.5 s |

- Prettier's fixes are added to the commit automatically, so what you commit is already formatted.
- If you had unstaged changes in the same files, lint-staged keeps them aside and puts them back afterwards.
- The hooks don't cover `.claude/hooks/*.mjs`. CI checks those.

### Bypassing in an emergency

```bash
git commit --no-verify -m "fix: ..."    # skips pre-commit
git push --no-verify                    # skips pre-push
```

Use this only when a hook is blocking an urgent fix, for example when the bot is down. CI still
catches anything the hooks would have caught. On every push and pull request it runs the same
checks, on all files, not just the staged ones:

- `npm run format:check` (instead of pre-commit's Prettier);
- `npm run lint:ci` (instead of pre-commit's oxlint, and it also enforces the warning count);
- `npm run typecheck` and `npm test` (pre-push's checks);
- `npm run build`.

Deploys only run from `main` (§6), so code reaches the live bot only after CI has checked it.
**But** the "Protect main" ruleset that would *require* these checks before merging is switched
off (§5). Until it's on, check that CI is green before you merge.

### CI and the server

CI sets `HUSKY=0`, so `npm ci` there doesn't install the hooks. On the server, `deploy.sh` runs
`npm ci`, which installs them into the server's checkout. That's harmless: nobody commits there,
and `git pull` doesn't run these hooks. To turn hooks off for a single command, prefix it with `HUSKY=0`.
