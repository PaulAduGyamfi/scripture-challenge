# 0003. Production deploys require human approval via a GitHub environment

- **Status:** Accepted
- **Date:** 2026-10-27
- **Related:** PR #3, *ci: require approval for production deploys* (merge commit `870fb16`); baseline audit R-05

## Context

Until PR #3, every push to `main` that passed the tests was deployed to the live server: GitHub
Actions connected over SSH and ran `scripts/deploy.sh`, which pulls, builds and runs
`pm2 restart scripture-bot`. Nobody had to approve it, and nothing considered the time of day.
A restart drops in-flight work, and node-cron skips any job whose minute passes while the bot is
down, so a badly timed deploy can silently skip a game. The deploy SSH key and host were repository
secrets, readable by any workflow run in the repo.

## Decision

Production deploys are started by hand and approved by a person, using a GitHub environment:

- `.github/workflows/test.yml` has a `workflow_dispatch` trigger. The `deploy` job runs only when
  `github.event_name == 'workflow_dispatch'` and the ref is `refs/heads/main`. It still needs the
  `test` job, and keeps `concurrency: deploy`.
- The `deploy` job declares `environment: production`. The environment requires a reviewer
  (currently `PaulAduGyamfi`) and has a deployment branch policy.
- The `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` secrets live in the `production`
  environment only. No repository-level secrets remain (checked 2026-10-27).
- Pushes and pull requests still run the tests, now including `npm run build`.

## Consequences

- Merging to `main` no longer changes the live bot. Someone has to run the workflow and approve it,
  which gives a chance to pick a time away from game posts.
- The deploy secrets are only available to jobs that a reviewer has approved in `production`.
- Deploys take a few minutes of the maintainer's attention, and the bot can lag behind `main`.
  TODO(owner): decide whether to track "merged but not deployed", e.g. in the PR or a deploy log.
- The first approved deploy succeeded on 2026-10-27, after two runs that failed on a mis-set
  `DEPLOY_KNOWN_HOSTS` and `DEPLOY_HOST`.
- Not covered yet: a check that refuses to deploy near a game time, a health check after the restart,
  and automatic rollback. See `docs/development-workflow.md` §6. TODO(owner): write `docs/runbooks/deploy.md`.
