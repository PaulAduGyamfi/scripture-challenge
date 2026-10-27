import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Runs the Claude Code hook the way Claude Code does: hook JSON on stdin, verdict in the exit code
const ROOT = process.cwd();
const HOOK = path.join(ROOT, ".claude/hooks/protect-files.mjs");
function runHook(input: string) {
  const r = spawnSync("node", [HOOK], { input, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
}
const editOf = (filePath: string) =>
  runHook(JSON.stringify({ tool_name: "Edit", cwd: ROOT, tool_input: { file_path: filePath } }));

describe("protect-files hook", () => {
  it.each([
    ".env",
    ".env.local",
    "state.json",
    "state.json.tmp",
    "backups/state-2026-03-04.json",
    ".wwebjs_auth/session/Default/Cookies",
    "scripts/deploy.sh",
    "src/../.env",
  ])("blocks %s with exit 2 and a reason", file => {
    const { code, stderr } = editOf(file);
    expect(code).toBe(2);
    expect(stderr).toMatch(/^Blocked by .*: .+\n$/);
  });

  it("blocks an absolute path too", () => {
    expect(editOf(path.join(ROOT, ".env")).code).toBe(2);
  });

  it.each([
    "src/core.ts",
    ".env.example",
    "scripts/offsite-backup.sh",
    "docs/state.json",
    "AGENTS.md",
    "/tmp/elsewhere/.env",
  ])("allows %s with exit 0", file => {
    expect(editOf(file)).toEqual({ code: 0, stderr: "" });
  });

  it.each([
    ["not JSON", "{oops"],
    ["no file_path", JSON.stringify({ tool_input: {} })],
    ["empty input", ""],
  ])("blocks when the hook input is unreadable (%s)", (_, input) => {
    expect(runHook(input).code).toBe(2);
  });
});
