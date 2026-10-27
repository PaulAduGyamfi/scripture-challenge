import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Runs the Claude Code Stop hook the way Claude Code does. PATH holds only node, so if the hook
// tries to run npm (the typecheck), that fails and the hook reports it with exit 2.
const HOOK = path.join(process.cwd(), ".claude/hooks/typecheck-on-stop.mjs");
const NODE_ONLY = path.dirname(process.execPath);

function runHook(env: Record<string, string>) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ stop_hook_active: false }),
    encoding: "utf8",
    env: { PATH: NODE_ONLY, ...env },
  });
  return { code: r.status, stderr: r.stderr };
}

describe("typecheck-on-stop hook", () => {
  it("does nothing in GitHub Actions, where CI runs its own typecheck", () => {
    expect(runHook({ GITHUB_ACTIONS: "true" })).toEqual({ code: 0, stderr: "" });
  });

  it("still runs the typecheck everywhere else", () => {
    const { code, stderr } = runHook({});
    expect(code).toBe(2);
    expect(stderr).toMatch(/npm run typecheck failed/);
  });
});
