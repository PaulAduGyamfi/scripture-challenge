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
| 8 | **Review** | Maintainer (the AI review is advisory, §8) | The diff has been read against the AGENTS.md review checklist (C1–C6), the PR description is complete (§4), and every invariant it touches is cited |
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

**Current settings** (Settings → Rules → Rulesets → **Protect main**; read from the GitHub API on 2026-10-27):

| Setting | Value |
|---|---|
| Enforcement | **Active**, on `main` |
| Deletions, force-pushes | Blocked |
| Pull request required | Yes. Nobody can push straight to `main` |
| Required approvals | 0 |
| Require review from Code Owners | **On**. `.github/CODEOWNERS` names the maintainer for every file |
| Required status checks | **`install`, `typecheck`, `lint`, `format`, `test`, `build`, `security`**, all from GitHub Actions |
| Bypass list | The maintainer, **for pull requests only** |
| Allowed merge methods | Merge, squash, rebase |

What that means in practice:

- **Every PR** needs all seven checks green before it can merge. `install` is required too: if it fails,
  the others are *skipped*, and GitHub counts a skipped required check as passing. `deploy` isn't
  required, because it's skipped on pull requests.
- **The maintainer's own PRs**, including the ones agents open under the maintainer's account: GitHub
  doesn't ask for a code-owner review on them. PR #27 showed no review required and could merge
  normally once the checks were green, with no bypass. If that ever changes, the bypass ("bypass rules"
  on the merge button) is there, and the checks still have to be green.
- **Dependabot's PRs, and anyone else's,** need the maintainer's code-owner approval as well as green
  checks. GitHub requests the review automatically, and the PR shows as blocked until it's approved
  (confirmed on Dependabot's #20, 2026-10-27). Read the diff, then approve in "Files changed" →
  "Review changes" → Approve, and merge with a merge commit.
- **Always use a merge commit.** Squash and rebase are allowed, but they change commit hashes, which
  breaks `.git-blame-ignore-revs`. TODO(owner): consider allowing only "Merge".

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

The ruleset (§5) makes these checks required, so a commit made with `--no-verify` still can't
reach `main` until every check passes. Deploys only run from `main` (§6), so code reaches the live
bot only after CI has checked it.

### CI and the server

CI sets `HUSKY=0`, so `npm ci` there doesn't install the hooks. On the server, `deploy.sh` runs
`npm ci`, which installs them into the server's checkout. That's harmless: nobody commits there,
and `git pull` doesn't run these hooks. To turn hooks off for a single command, prefix it with `HUSKY=0`.

## 8. AI review (advisory)

`.github/workflows/claude-review.yml` runs Claude Code's `code-review` plugin on each pull request
and posts its findings as **inline comments** on the PR. It checks against the AGENTS.md review
checklist (C1–C6), like a human reviewer.

**It's advisory, and only that:**

- It is **not a required status check**. The "Protect main" ruleset doesn't list it (§5), and it never
  blocks a merge, even if it fails or finds problems.
- It **can't approve** a PR. The workflow's token is read-only, and it only posts comments.
- **The maintainer makes the merge decision**: read its comments, act on the ones that are right, and
  ignore the rest.

**When it runs:**

- Once per PR, when the PR is opened, reopened or marked ready for review. **Not on every push**, to
  keep cost down, so later pushes aren't re-reviewed automatically.
- Not on draft PRs, which get reviewed when they're marked ready. Not on PRs from forks, because
  GitHub doesn't give fork runs the secret.
- On Dependabot's PRs too, if the key is also a Dependabot secret (see setup).
- At most 25 turns and 15 minutes per run. A newer run on the same PR cancels an older one.
- **Not on a PR that changes `claude-review.yml` itself.** The action only runs when the workflow file is
  identical to the one on `main`, so a PR can't change the review (or leak its key) and have that
  version run. The run shows as successful with a "Workflow validation failed" warning. That's
  expected; review those PRs yourself.

**To re-run it**, e.g. after pushing fixes: Actions → **Claude review** → the PR's run → **Re-run jobs**.
Re-running doesn't happen on its own.

**Setup** (once, by the maintainer):

- Install the Claude GitHub App on the repo. It's what posts the comments.
- Add the API key as the Actions secret `CLAUDE_REVIEW_API_KEY`.
- Add the same key as a **Dependabot** secret named `CLAUDE_REVIEW_API_KEY` (Settings → Secrets and
  variables → Dependabot), because Dependabot's runs can't read Actions secrets.
