import { makeAcronym, parseReference, isCorrect, formatRef, matchesDecode } from "./game";
import { aiReadGuess, makeHint, celebrate } from "./ai";
import { loadScriptures } from "./sheet";
import * as state from "./state";
import type { State, Player } from "./state";
import type { AnswerType, Scripture } from "./types";

// What handleMessage hands back to bot.ts
export interface Reply {
  kind: "win" | "late";   // "late" = correct, but someone already won today
  text: string;
}

// Handle messages strictly one at a time, in the order they arrived.
// Without this, a slow AI check could let a later answer "win".
let queue: Promise<unknown> = Promise.resolve();
function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

// ---------- Points ----------
const ANSWER_POINTS: Record<AnswerType, number> = { both: 10, reference: 6, decoded: 3 };
const ANSWER_LABEL: Record<AnswerType, string> = {
  both: "Reference + decoded", reference: "Reference", decoded: "Decoded",
};
const SPEED_BONUS = [                         // minutes after the puzzle was posted
  { withinMin: 30, bonus: 5 },
  { withinMin: 120, bonus: 3 },
  { withinMin: 240, bonus: 1 },
] as const;

function scoreAnswer(type: AnswerType, minutes: number, hintsGiven: number) {
  const base = ANSWER_POINTS[type];
  const tier = hintsGiven === 0 ? SPEED_BONUS.find(t => minutes <= t.withinMin) : undefined;
  const bonus = tier?.bonus ?? 0;
  return { base, bonus, points: base + bonus };
}

function weekKey(ms: number): string {        // identifies the Monday-to-Sunday week
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function formatTime(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} hr ${Math.round(minutes % 60)} min`;
}

// "1 Kings 15:5 (ESV)"
function fullRef(v: Scripture): string {
  return formatRef(v) + (v.translation ? ` (${v.translation})` : "");
}

// Backup cheers in case the AI is unavailable
const CHEERS = ["Eeeeiiiii.....!!!", "Haaaa! We have a winner!", "Woooooow! Somebody has been eating their Word!"];
const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

async function cheer(name: string, ref: string): Promise<string> {
  try { return await celebrate(name, ref); }
  catch { return pick(CHEERS) ?? "Well done!"; }
}

// A player's record, reset automatically at each new season (year) and week.
function getPlayer(s: State, id: string, name: string, now: number): Player {
  const season = new Date(now).getFullYear();
  const week = weekKey(now);
  const p: Player = s.scores[id] ?? { name, points: 0, wins: 0, fastestMin: null, season, week, weekPoints: 0 };
  if (p.season !== season) Object.assign(p, { season, points: 0, wins: 0, fastestMin: null });
  if (p.week !== week) Object.assign(p, { week, weekPoints: 0 });
  p.name = name;
  s.scores[id] = p;
  return p;
}

type Ranked = Player & { id: string; score: number };

function ranked(s: State, kind: "season" | "week", now = Date.now()): Ranked[] {
  const season = new Date(now).getFullYear();
  const week = weekKey(now);
  return Object.entries(s.scores)
    .map(([id, p]) => ({ ...p, id, score: kind === "week" ? p.weekPoints : p.points }))
    .filter(p => (kind === "week" ? p.week === week : p.season === season) && p.score > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins);
}

// ---------- Game ----------
export async function newPuzzle(): Promise<string> {
  const all = await loadScriptures();
  const s = state.load();
  let pool = all.filter(v => !s.used.includes(formatRef(v)));
  if (pool.length === 0) { s.used = []; pool = all; } // every verse used: start over
  const chosen = pick(pool);
  if (!chosen) throw new Error("No scriptures available");

  Object.assign(s, { today: { ...chosen, postedAt: Date.now() }, winner: null, hintsGiven: 0 });
  s.used.push(formatRef(chosen));
  state.save(s);

  const puzzle = chosen.acronym || makeAcronym(chosen.clue);
  const hintLine = chosen.hint ? `\n\nHint: ${chosen.hint}` : "";
  return `☀️ Good morning! Today's scripture:\n\n📜 *${puzzle}*${hintLine}\n\n` +
    `💬 Reply with the reference, the decoded words, or both for the most points. 🏆 First correct answer wins!`;
}

// sentAt = when the person sent the message, in milliseconds
export function handleMessage(senderId: string, senderName: string, text: string,
                              sentAt = Date.now()): Promise<Reply | null> {
  return inOrder(async () => {
    const s = state.load();
    const today = s.today;
    if (!today) return null;

    const guess = parseReference(text) ?? (/\d/.test(text) ? await aiReadGuess(text) : null);
    const gotRef = isCorrect(guess, today);
    const gotWords = matchesDecode(text, today.clue);
    if (!gotRef && !gotWords) return null;          // stay quiet on wrong guesses: no spam
    if (s.winner) return { kind: "late", text: `Correct, ${senderName}! ${s.winner.name} got it first today.` };

    const type: AnswerType = gotRef && gotWords ? "both" : gotRef ? "reference" : "decoded";
    const minutes = Math.max(0, (sentAt - today.postedAt) / 60_000);
    const { base, bonus, points } = scoreAnswer(type, minutes, s.hintsGiven);
    const p = getPlayer(s, senderId, senderName, sentAt);
    p.points += points;
    p.weekPoints += points;
    p.wins += 1;
    if (p.fastestMin === null || minutes < p.fastestMin) p.fastestMin = minutes;
    s.winner = { id: senderId, name: senderName, type, points, minutes };
    state.save(s);

    const rank = ranked(s, "season", sentAt).findIndex(r => r.id === senderId) + 1;
    const bonusText = bonus ? ` + ${bonus} speed bonus` : "";
    const shout = await cheer(senderName, formatRef(today));
    return {
      kind: "win",
      text: `${shout}\n\n${senderName} got it first in ${formatTime(minutes)}!\n` +
        `${ANSWER_LABEL[type]}: ${base}${bonusText} = ${points} points\n\n` +
        `${fullRef(today)}:\n"${today.text}"\n\n` +
        `Season total: ${p.points} points (#${rank} on the leaderboard)`,
    };
  });
}

export async function hint(): Promise<string | null> {
  const s = state.load();
  const today = s.today;
  if (!today || s.winner) return null;
  s.hintsGiven += 1;
  state.save(s);
  if (s.hintsGiven === 1) {
    const extra = await makeHint(today).catch(() => `the first word is "${today.clue.split(/\s+/)[0] ?? ""}"`);
    return "Extra hint (no more speed bonus today): " + extra;
  }
  return `Last hint: it's in the book of ${today.book}.`;
}

export function reveal(): string | null {
  const s = state.load();
  if (!s.today || s.winner) return null;
  return `Nobody got it today! It was ${fullRef(s.today)}:\n\n"${s.today.text}"`;
}

// ---------- Leaderboards ----------
export function leaderboard(kind: "season" | "week" = "season"): string {
  const rows = ranked(state.load(), kind).slice(0, 10);
  const title = kind === "week" ? "This week's leaderboard" : `${new Date().getFullYear()} season leaderboard`;
  if (rows.length === 0) return `${title}\nNo points yet. Be the first!`;
  return title + "\n\n" + rows.map((p, i) =>
    `${i + 1}. ${p.name}: ${p.score} pts` + (kind === "season" ? ` (${p.wins} wins)` : "")
  ).join("\n");
}

export function myStats(senderId: string): string {
  const board = ranked(state.load(), "season");
  const i = board.findIndex(r => r.id === senderId);
  const p = board[i];
  if (!p) return "No points yet this season. Tomorrow could be your day!";
  return `${p.name}: ${p.points} pts, ${p.wins} wins, #${i + 1} this season. ` +
    `Fastest solve: ${formatTime(p.fastestMin ?? 0)}.`;
}