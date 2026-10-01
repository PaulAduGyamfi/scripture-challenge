import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BOOKS } from "./types";

// The exact shape of state.json. If the file doesn't match, the bot refuses to start
// instead of quietly wiping everyone's scores.
const TodaySchema = z.object({
  book: z.enum(BOOKS),
  chapter: z.number(),
  verseStart: z.number(),
  verseEnd: z.number(),
  clue: z.string(),
  text: z.string(),
  acronym: z.string().optional(),
  hint: z.string().optional(),
  translation: z.string().optional(),
  postedAt: z.number(),
});

const PlayerSchema = z.object({
  name: z.string(),
  points: z.number(),
  wins: z.number(),
  fastestMin: z.number().nullable(),
  season: z.number(),
  week: z.string(),
  weekPoints: z.number(),
  // Streaks never reset with the season. Defaults let older state.json files load.
  streak: z.number().default(0),
  bestStreak: z.number().default(0),
  lastSolvedDay: z.string().nullable().default(null),   // "2026-03-04", the puzzle's day
});

const WinnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["both", "reference", "decoded"]),
  points: z.number(),
  minutes: z.number(),
});

const StateSchema = z.object({
  today: TodaySchema.nullable(),
  winner: WinnerSchema.nullable(),
  hintsGiven: z.number(),
  revealed: z.boolean().default(false),               // the 9 PM reveal went out
  lateSolvers: z.array(z.string()).default([]),       // got today's +1 for a correct late answer
  used: z.array(z.string()),
  scores: z.record(z.string(), PlayerSchema),
});

export type State = z.infer<typeof StateSchema>;
export type Player = z.infer<typeof PlayerSchema>;

const FILE = "state.json";
const BACKUPS = "backups";
const KEEP_BACKUPS = 30;
const RESTORE = `Copy the newest file from the ${BACKUPS} folder over ${FILE}.`;

export function load(): State {
  if (!fs.existsSync(FILE)) {
    return { today: null, winner: null, hintsGiven: 0, revealed: false, lateSolvers: [], used: [], scores: {} };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    throw new Error(`${FILE} is not valid JSON. ${RESTORE}`);
  }
  const parsed = StateSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(i => `${i.path.map(String).join(".")}: ${i.message}`);
    throw new Error(`${FILE} looks damaged (${problems.join("; ")}). ${RESTORE}`);
  }
  return parsed.data;
}

// Writes to a temporary file first, then swaps it in, so a crash mid-save
// can never leave a half-written state.json.
export function save(s: State): void {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, FILE);
}
// Copies state.json to backups/state-2026-03-04.json, keeping the newest 30 days
export function backup(now = new Date()): string | null {
  if (!fs.existsSync(FILE)) return null;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, "0")).join("-");
  const dest = path.join(BACKUPS, `state-${day}.json`);
  fs.copyFileSync(FILE, dest);
  const old = fs.readdirSync(BACKUPS).filter(f => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
  for (const f of old) fs.rmSync(path.join(BACKUPS, f));
  return dest;
}
