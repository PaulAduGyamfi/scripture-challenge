import { makeAcronym, parseReference, mightBeReference, isCorrect, formatRef, matchesDecode } from "./game";
import { aiReadGuess, makeHint, celebrate } from "./ai";
import { loadScriptures } from "./sheet";
import * as state from "./state";
import type { State, Player } from "./state";
import type { AnswerType, Scripture } from "./types";

// A message that @mentions people: bot.ts passes `mentions` to WhatsApp so the tags ping
export interface Post {
  text: string;
  mentions: string[];     // WhatsApp IDs of everyone tagged in text
}

// What handleMessage hands back to bot.ts
export type Reply =
  | (Post & { kind: "win" | "late" })   // "late" = correct, but someone already won today
  | { kind: "wrong" };                  // a reference that isn't today's: react, don't reply

// "123456@c.us" -> "@123456", which WhatsApp shows as the person's name
const tag = (id: string) => `@${id.split("@")[0]}`;

// Everything that changes state.json waits its turn here, one at a time, in order.
// Without this, a slow AI check could let a later answer "win", or an answer that was
// waiting on the AI could save over the noon hint or the new puzzle with an old copy.
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
const LATE_POINTS = 1;                        // correct after the winner, before the reveal

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

function dayKey(ms: number): string {         // "2026-03-04" in local time
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, "0")).join("-");
}
const DAY = 24 * 60 * 60_000;

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
const CHEERS = ["🎉 Eeeeiiiii.....!!! 🙌", "🔥 Haaaa! We have a winner! 🏆", "😲 Woooooow! Somebody has been eating the Word! 📖🍽️",
  "🙌 Eeeeiii! This one is sozzled in the Word!! 📖🔥"];
const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

async function cheer(name: string, ref: string): Promise<string> {
  try { return await celebrate(name, ref); }
  catch { return pick(CHEERS) ?? "🎉 Well done!"; }
}

// ---------- Streaks and badges ----------
// Win and streak badges. Win badges follow the season's wins; streak badges last forever.
const BADGES: { icon: string; name: string; earned: (p: Player) => boolean }[] = [
  { icon: "🌱", name: "First Fruits", earned: p => p.wins >= 1 },
  { icon: "📖", name: "Word Eater", earned: p => p.wins >= 10 },
  { icon: "🌊", name: "Sozzled", earned: p => p.wins >= 25 },
  { icon: "👑", name: "Elder", earned: p => p.wins >= 50 },
  { icon: "⚡", name: "Quick Draw", earned: p => p.fastestMin !== null && p.fastestMin < 1 },
  { icon: "🔥", name: "On Fire", earned: p => p.bestStreak >= 3 },
  { icon: "🕊️", name: "Faithful", earned: p => p.bestStreak >= 7 },
  { icon: "⛰️", name: "Unshakeable", earned: p => p.bestStreak >= 30 },
];
const badgesOf = (p: Player) => BADGES.filter(b => b.earned(p)).map(b => `${b.icon} ${b.name}`);

// Counts a correct answer (win or late) toward the player's daily streak
function recordSolve(p: Player, postedAt: number): void {
  const day = dayKey(postedAt);
  if (p.lastSolvedDay === day) return;
  p.streak = p.lastSolvedDay === dayKey(postedAt - DAY) ? p.streak + 1 : 1;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.lastSolvedDay = day;
}

// The streak still counts if they solved today or yesterday; otherwise it's broken
function currentStreak(p: Player, now = Date.now()): number {
  return p.lastSolvedDay === dayKey(now) || p.lastSolvedDay === dayKey(now - DAY) ? p.streak : 0;
}

// "🔥 3-day streak!" and any badges earned since `before`
function newsLines(p: Player, before: string[]): string {
  const lines: string[] = [];
  if (p.streak >= 2) lines.push(`🔥 ${p.streak}-day streak!`);
  for (const b of badgesOf(p)) if (!before.includes(b)) lines.push(`🎖️ New badge: ${b}!`);
  return lines.length ? "\n\n" + lines.join("\n") : "";
}

// A player's record, reset automatically at each new season (year) and week.
function getPlayer(s: State, id: string, name: string, now: number): Player {
  const season = new Date(now).getFullYear();
  const week = weekKey(now);
  const p: Player = s.scores[id] ?? {
    name, points: 0, wins: 0, fastestMin: null, season, week, weekPoints: 0,
    streak: 0, bestStreak: 0, lastSolvedDay: null,
  };
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
  const all = await loadScriptures();               // download outside the queue: answers keep flowing
  return inOrder(async () => pickPuzzle(all));
}

function pickPuzzle(all: Scripture[]): string {
  const s = state.load();
  let pool = all.filter(v => !s.used.includes(formatRef(v)));
  if (pool.length === 0) { s.used = []; pool = all; } // every verse used: start over
  const chosen = pick(pool);
  if (!chosen) throw new Error("No scriptures available");

  Object.assign(s, {
    today: { ...chosen, postedAt: Date.now() }, winner: null, hintsGiven: 0, revealed: false, lateSolvers: [],
  });
  s.used.push(formatRef(chosen));
  state.save(s);

  const puzzle = chosen.acronym || makeAcronym(chosen.clue);
  const hintLine = chosen.hint ? `\n\n💡 Hint: ${chosen.hint}` : "";
  return `☀️ Good morning! Today's scripture:\n\n📜 *${puzzle}*${hintLine}\n\n` +
    `💬 Reply with the reference, the decoded words, or both for the most points! 🎯\n🏆 First correct answer wins! ⏱️ Go go go! 🚀`;
}

// sentAt = when the person sent the message, in milliseconds
export function handleMessage(senderId: string, senderName: string, text: string,
                              sentAt = Date.now()): Promise<Reply | null> {
  return inOrder(async () => {
    const s = state.load();
    const today = s.today;
    if (!today || s.revealed) return null;          // the answer is out: nothing left to win today

    // The AI only looks at messages that might be a reference, so "see you at 5pm" costs nothing
    const guess = parseReference(text) ?? (mightBeReference(text) ? await aiReadGuess(text) : null);
    const gotRef = isCorrect(guess, today);
    const gotWords = matchesDecode(text, today.clue);
    if (!gotRef && !gotWords) {
      return guess && !s.winner ? { kind: "wrong" } : null;   // no spam, just a reaction
    }
    if (s.winner) return lateAnswer(s, senderId, senderName, sentAt);

    const type: AnswerType = gotRef && gotWords ? "both" : gotRef ? "reference" : "decoded";
    const minutes = Math.max(0, (sentAt - today.postedAt) / 60_000);
    const { base, bonus, points } = scoreAnswer(type, minutes, s.hintsGiven);
    const p = getPlayer(s, senderId, senderName, sentAt);
    const before = badgesOf(p);
    p.points += points;
    p.weekPoints += points;
    p.wins += 1;
    if (p.fastestMin === null || minutes < p.fastestMin) p.fastestMin = minutes;
    recordSolve(p, today.postedAt);
    s.winner = { id: senderId, name: senderName, type, points, minutes };
    state.save(s);

    const rank = ranked(s, "season", sentAt).findIndex(r => r.id === senderId) + 1;
    const bonusText = bonus ? ` + ⚡${bonus} speed bonus` : "";
    const shout = await cheer(senderName, formatRef(today));
    return {
      kind: "win",
      text: `${shout}\n\n🥇 ${tag(senderId)} got it first in ⏱️ ${formatTime(minutes)}!\n` +
        `🎯 ${ANSWER_LABEL[type]}: ${base}${bonusText} = ✨ ${points} points ✨\n\n` +
        `📖 ${fullRef(today)}:\n"${today.text}"\n\n` +
        `📊 Season total: ${p.points} points (#${rank} on the leaderboard) 🏆` +
        newsLines(p, before),
      mentions: [senderId],
    };
  });
}

// Correct, but someone already won: +1 point once per person
function lateAnswer(s: State, senderId: string, senderName: string, sentAt: number): Reply | null {
  const winner = s.winner;
  if (!winner || !s.today || senderId === winner.id || s.lateSolvers.includes(senderId)) return null;

  const p = getPlayer(s, senderId, senderName, sentAt);
  const before = badgesOf(p);
  p.points += LATE_POINTS;
  p.weekPoints += LATE_POINTS;
  recordSolve(p, s.today.postedAt);
  s.lateSolvers.push(senderId);
  state.save(s);
  return {
    kind: "late",
    text: `✅ Correct, ${tag(senderId)}! +${LATE_POINTS} point 👏 ${tag(winner.id)} got it first today 🏃💨` + newsLines(p, before),
    mentions: [senderId, winner.id],
  };
}

export async function hint(): Promise<string | null> {
  const s = await inOrder(async () => {
    const s = state.load();
    if (!s.today || s.winner) return null;
    s.hintsGiven += 1;
    state.save(s);
    return s;
  });
  const today = s?.today;
  if (!s || !today) return null;
  if (s.hintsGiven === 1) {                         // AI writes the hint outside the queue
    const extra = await makeHint(today).catch(() => `the first word is "${today.clue.split(/\s+/)[0] ?? ""}"`);
    return "💡 Extra hint (no more ⚡ speed bonus today): " + extra;
  }
  return `🔦 Last hint: it's in the book of 📘 ${today.book}!`;
}

export function reveal(): Promise<string | null> {
  return inOrder(async () => {
    const s = state.load();
    if (!s.today || s.winner) return null;
    s.revealed = true;
    state.save(s);
    return `😮 Nobody got it today! It was 📖 ${fullRef(s.today)}:\n\n"${s.today.text}"\n\n🙏 Meditate on it and come back tomorrow! 💪`;
  });
}

// ---------- Leaderboards ----------
const MEDALS = ["🥇", "🥈", "🥉"];

export function leaderboard(kind: "season" | "week" = "season"): Post {
  const rows = ranked(state.load(), kind).slice(0, 10);
  const title = kind === "week" ? "📅 This week's leaderboard 🔥" : `🏆 ${new Date().getFullYear()} season leaderboard 🏆`;
  if (rows.length === 0) return { text: `${title}\n🤷 No points yet. Be the first! 🚀`, mentions: [] };
  const text = title + "\n\n" + rows.map((p, i) =>
    `${MEDALS[i] ?? `${i + 1}.`} ${tag(p.id)}: ${p.score} pts` + (kind === "season" ? ` (🏅 ${p.wins} wins)` : "")
  ).join("\n");
  return { text, mentions: rows.map(p => p.id) };
}

export function myStats(senderId: string): Post {
  const board = ranked(state.load(), "season");
  const i = board.findIndex(r => r.id === senderId);
  const p = board[i];
  if (!p) return { text: "🌱 No points yet this season. Tomorrow could be your day! 💪", mentions: [] };
  const badges = badgesOf(p);
  const text = `📊 ${tag(p.id)}: ⭐ ${p.points} pts, 🏅 ${p.wins} wins, 🏆 #${i + 1} this season.\n` +
    `⚡ Fastest solve: ${p.fastestMin === null ? "none yet" : formatTime(p.fastestMin)}\n` +
    `🔥 Streak: ${currentStreak(p)} days (best ${p.bestStreak})` +
    (badges.length ? `\n🎖️ Badges: ${badges.join(", ")}` : "");
  return { text, mentions: [p.id] };
}

export function streak(senderId: string): Post {
  const p = state.load().scores[senderId];
  if (!p || p.bestStreak === 0) {
    return { text: "🌱 No streak yet. Solve today's puzzle to start one! 🔥", mentions: [] };
  }
  const now = currentStreak(p);
  const text = now > 0
    ? `🔥 ${tag(senderId)} is on a ${now}-day streak! (best: ${p.bestStreak}) Keep eating the Word! 📖`
    : `💤 ${tag(senderId)}'s streak has ended (best: ${p.bestStreak}). Solve today's puzzle to start again! 💪`;
  return { text, mentions: [senderId] };
}

// A dated copy of state.json in backups/, so a bad day can be undone
export function backupState(): void {
  const file = state.backup();
  if (file) console.log(`Backed up scores to ${file}`);
}

export function help(): string {
  const within = (min: number) => (min < 60 ? `${min} min` : `${min / 60} hr`);
  const bonus = SPEED_BONUS.map(t => `+${t.bonus} within ${within(t.withinMin)}`).join(", ");
  return [
    "📖 *Scripture Challenge* 🙌",
    "",
    "☀️ Every morning I post a verse as an acronym, like *TLIMS; ISNW*.",
    "💬 Reply with the reference (John 3:16), the decoded words, or both!",
    "",
    "🎯 *Points*",
    `• Reference + decoded: ${ANSWER_POINTS.both}`,
    `• Reference only: ${ANSWER_POINTS.reference}`,
    `• Decoded only: ${ANSWER_POINTS.decoded}`,
    `• ⚡ Speed bonus: ${bonus} (gone once a hint is out)`,
    `• ✅ Correct after the winner: +${LATE_POINTS}`,
    "• 🌙 Once the answer is revealed, the day is closed",
    "",
    "💡 Hints come at noon and 6 PM, and the answer at 9 PM.",
    "🔥 Solve on days in a row to build a streak and earn badges 🎖️",
    "",
    "🤖 *Commands*",
    "• !leaderboard: season standings 🏆",
    "• !week: this week's standings 📅",
    "• !me: your points, streak and badges 📊",
    "• !streak: your current streak 🔥",
    "• !help: this message",
  ].join("\n");
}
