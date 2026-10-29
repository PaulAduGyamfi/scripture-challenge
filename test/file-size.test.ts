import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Source files stay small enough to read in one sitting: aim for 400 lines, never over 500.
// See docs/code-standards.md.
const SRC = path.join(process.cwd(), "src");
const MAX_LINES = 500;

describe("src file size", () => {
  const files = fs
    .readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter(f => f.endsWith(".ts"))
    .sort();

  it.each(files)(`%s is at most ${MAX_LINES} lines`, file => {
    const lines = fs.readFileSync(path.join(SRC, file), "utf8").trimEnd().split("\n").length;
    expect(lines).toBeLessThanOrEqual(MAX_LINES);
  });
});
