// Claude Code Stop hook (see .claude/settings.json): runs npm run typecheck before a session ends.
// On type errors it exits 2, which keeps Claude working and shows it the errors. If Claude was
// already sent back once (stop_hook_active), it exits 1 instead: the errors are shown and the
// session ends, so it can never loop. Backs AGENTS.md working rule 4 (run every check).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Not in GitHub Actions: CI has its own typecheck job, and checkouts there (e.g. the AI review's) may
// have no node_modules, so the hook would only send Claude off to "fix" a missing install (seen on #30).
if (process.env.GITHUB_ACTIONS === "true") process.exit(0);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOW_LINES = 40; // enough to see the errors without flooding the session

let input = "";
for await (const chunk of process.stdin) input += chunk;
let alreadyBlocked = false;
try {
  alreadyBlocked = JSON.parse(input).stop_hook_active === true;
} catch {
  /* treat as the first stop */
}

const run = spawnSync("npm", ["run", "--silent", "typecheck"], { cwd: ROOT, encoding: "utf8" });
if (run.status === 0) process.exit(0);

const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim() || String(run.error ?? "no output");
const lines = output.split("\n");
const shown =
  lines.length > SHOW_LINES
    ? [...lines.slice(0, SHOW_LINES), `... ${lines.length - SHOW_LINES} more lines`]
    : lines;
process.stderr.write(`npm run typecheck failed. Fix these before finishing:\n${shown.join("\n")}\n`);
process.exit(alreadyBlocked ? 1 : 2);
