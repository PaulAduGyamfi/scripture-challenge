# Working rules for Claude Code

scripture-challenge is a live WhatsApp Bible game with real players. A mistake can corrupt their scores or spam their group, so we work in small, reversible steps.

1. Plan first. Read the files involved, then reply with: the files you will change, the tests you will add or update, the risks, and how to roll back. Wait for my approval before editing anything.
2. Keep the diff small and focused on the task. Don't change what players see unless the task explicitly says so.
3. I handle git. Don't create branches, commit or push.
4. Never read .env, state.json, backups/ or .wwebjs_auth/. Never deploy or ssh.
5. When finished, run every check that exists (npm run typecheck, npm test, npm run build, plus lint and format once they're configured) and paste the results.
6. List the files you changed and draft the pull request description: what changed, why, how it was verified, behaviour change yes/no, rollback.
7. If something is unclear or a decision is mine to make, stop and ask instead of guessing.