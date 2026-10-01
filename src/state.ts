import fs from "node:fs";
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
  used: z.array(z.string()),
  scores: z.record(z.string(), PlayerSchema),
});

export type State = z.infer<typeof StateSchema>;
export type Player = z.infer<typeof PlayerSchema>;

const FILE = "state.json";

export function load(): State {
  if (!fs.existsSync(FILE)) return { today: null, winner: null, hintsGiven: 0, used: [], scores: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    throw new Error(`${FILE} is not valid JSON. Restore the latest backup from Google Drive.`);
  }
  const parsed = StateSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(i => `${i.path.map(String).join(".")}: ${i.message}`);
    throw new Error(`${FILE} looks damaged (${problems.join("; ")}). Restore the latest backup.`);
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