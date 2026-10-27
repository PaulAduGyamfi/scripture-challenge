## What and why
<!-- One paragraph. Link the issue or step, and the baseline audit ID (R-xx) if there is one. -->

## Behaviour change for players?
- [ ] No
- [ ] Yes. What players will notice:

## Risk
- Invariants touched (AGENTS.md numbers):
- AI involved? If yes, eval report:
- State schema changed? If yes, old state.json still loads: [ ] yes
- New runtime dependency? If yes, one-paragraph justification (AGENTS.md I6):

## Verified
<!-- Paste the output, or say which CI checks cover it. CI also runs the security check. -->
- [ ] typecheck  - [ ] lint:ci  - [ ] format:check  - [ ] tests  - [ ] build
- [ ] Tried in npm run sim (paste transcript if relevant; run it in a separate copy, never the live folder, because it writes state.json)

## Rollback
<!-- Usually "revert this PR". Say if anything else is needed. -->
