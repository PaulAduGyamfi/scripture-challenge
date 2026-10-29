import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// src/domain/ holds the pure game rules, so it may import only other domain files and ../types:
// no AI, sheet, state.json, .env, WhatsApp, npm packages or Node modules. See docs/code-standards.md.
const DOMAIN = path.join(process.cwd(), "src/domain");

// Every module a file imports: `import … from "x"`, `export … from "x"`, `import "x"`, `import("x")`, `require("x")`
function importsOf(source: string): string[] {
  const pattern =
    /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\b(?:import|require)\(\s*["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map(m => m[1] ?? m[2] ?? m[3] ?? "");
}

// "./calendar" (another domain file) or "../types"; nothing else
const isAllowed = (spec: string) => /^\.\/[\w-]+$/.test(spec) || spec === "../types";

describe("src/domain imports", () => {
  const files = fs.readdirSync(DOMAIN).filter(f => f.endsWith(".ts"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s imports only other domain files and ../types", file => {
    const imports = importsOf(fs.readFileSync(path.join(DOMAIN, file), "utf8"));
    expect(imports.filter(spec => !isAllowed(spec))).toEqual([]);
  });

  // The check itself: these would all fail the test above
  it.each([
    'import { load } from "../state";',
    'import type { Player } from "../state";',
    'import { env } from "../config";',
    'import { aiReadGuess } from "../ai";',
    'import { judgeRiddleGuess } from "../ai/judges";',
    'export { loadStories } from "../sheet";',
    'import { getPlayer } from "../players";',
    'import { lateAnswer } from "../answers";',
    'import Anthropic from "@anthropic-ai/sdk";',
    'import { Client } from "whatsapp-web.js";',
    'import fs from "node:fs";',
    'import fs from "fs";',
    'import "../bot";',
    'const fs = require("fs");',
    "import {\n  load,\n} from '../state';",
  ])("catches %s", line => {
    expect(importsOf(line).every(isAllowed)).toBe(false);
  });

  it.each(['import { dayKey } from "./calendar";', 'import type { AnswerType } from "../types";'])(
    "allows %s",
    line => {
      expect(importsOf(line).every(isAllowed)).toBe(true);
    }
  );
});
