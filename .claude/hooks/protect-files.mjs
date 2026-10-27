// Claude Code PreToolUse hook for Edit|Write (see .claude/settings.json): blocks edits to secrets,
// live data and the deploy script. Exit 2 blocks the edit and shows Claude the reason; exit 0 allows it.
// Anything unreadable is blocked too, so a bug here stops edits instead of quietly allowing them.
// Backs AGENTS.md Never 1, and I2/I3 (state.json only changes through the bot).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/protect-files.mjs: ${reason}\n`);
  process.exit(2);
}

// Why `rel` (a path inside the repo) must not be edited, or null if it's fine
function reasonFor(rel) {
  const [top = "", ...rest] = rel.split(path.sep);
  const atRoot = rest.length === 0;
  if (atRoot && top.startsWith(".env") && top !== ".env.example") return `${top} holds secrets (AGENTS.md Never 1).`;
  if (atRoot && (top === "state.json" || top === "state.json.tmp")) {
    return `${top} is the live scores; it only changes through the bot (AGENTS.md Never 1, I2, I3).`;
  }
  if (top === "backups") return "backups/ holds the score backups (AGENTS.md Never 1).";
  if (top === ".wwebjs_auth") return ".wwebjs_auth/ is the bot's WhatsApp login (AGENTS.md Never 1).";
  if (rel === path.join("scripts", "deploy.sh")) {
    return "scripts/deploy.sh runs on the live server; the maintainer edits it by hand (AGENTS.md Never 1).";
  }
  return null;
}

// The path relative to the repo, or null when it's outside it
function inRepo(abs) {
  const rel = path.relative(ROOT, abs);
  return rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : rel;
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

let hook;
try { hook = JSON.parse(input); } catch { hook = null; }
const filePath = hook?.tool_input?.file_path;
if (typeof filePath !== "string" || filePath === "") {
  block("couldn't read tool_input.file_path from the hook input, so the edit was stopped to be safe.");
}

// Check the path as given and, if it exists, where it really points (a symlink to .env is still .env)
const abs = path.resolve(typeof hook.cwd === "string" ? hook.cwd : ROOT, filePath);
const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
for (const candidate of new Set([abs, real])) {
  const rel = inRepo(candidate);
  const reason = rel === null ? null : reasonFor(rel);
  if (reason) block(reason);
}
process.exit(0);
