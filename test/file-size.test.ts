import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Source and test files stay small enough to read in one sitting: aim for 400 lines, never over 500.
// See docs/code-standards.md.
const MAX_LINES = 500;

describe.each(["src", "test"])("%s file size", dir => {
  const root = path.join(process.cwd(), dir);
  const files = fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".ts"))
    .sort();

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)(`%s is at most ${MAX_LINES} lines`, file => {
    const lines = fs.readFileSync(path.join(root, file), "utf8").trimEnd().split("\n").length;
    expect(lines).toBeLessThanOrEqual(MAX_LINES);
  });
});
