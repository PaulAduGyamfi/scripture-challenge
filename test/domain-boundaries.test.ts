import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, it, expect } from "vitest";

// src/domain/ holds the pure game rules: no AI, sheet, state.json, .env, WhatsApp or Node I/O.
// See docs/code-standards.md.
const DOMAIN = path.join(process.cwd(), "src/domain");
const OFF_LIMITS = ["ai", "sheet", "state", "config", "bot"];

// Every module a file imports: `import … from "x"`, `export … from "x"`, `import "x"`, `import("x")`, `require("x")`
function importsOf(source: string): string[] {
  const pattern =
    /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\b(?:import|require)\(\s*["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map(m => m[1] ?? m[2] ?? m[3] ?? "");
}

function isOffLimits(spec: string): boolean {
  if (spec.startsWith("node:") || builtinModules.includes(spec)) return true;
  return spec.startsWith(".") && OFF_LIMITS.includes(path.basename(spec).replace(/\.ts$/, ""));
}

describe("src/domain imports", () => {
  const files = fs.readdirSync(DOMAIN).filter(f => f.endsWith(".ts"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s imports nothing from ai, sheet, state, config, bot or Node", file => {
    const imports = importsOf(fs.readFileSync(path.join(DOMAIN, file), "utf8"));
    expect(imports.filter(isOffLimits)).toEqual([]);
  });

  // The check itself: these would all fail the test above
  it.each([
    'import { load } from "../state";',
    'import type { Player } from "../state";',
    'import { env } from "../config";',
    'import { aiReadGuess } from "../ai";',
    'export { loadStories } from "../sheet";',
    'import fs from "node:fs";',
    'import fs from "fs";',
    'import "../bot";',
    'const fs = require("fs");',
    "import {\n  load,\n} from '../state';",
  ])("catches %s", line => {
    expect(importsOf(line).some(isOffLimits)).toBe(true);
  });

  it.each(['import { dayKey } from "./calendar";', 'import type { AnswerType } from "../types";'])(
    "allows %s",
    line => {
      expect(importsOf(line).some(isOffLimits)).toBe(false);
    }
  );
});
