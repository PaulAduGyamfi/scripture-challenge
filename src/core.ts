import { makeAcronym, parseReference, mightBeReference, isCorrect, formatRef, matchesDecode, namesStory } from "./game";
import { aiReadGuess, makeHint, celebrate, makeEmoji } from "./ai";
import { loadScriptures, loadStories } from "./sheet";
import { optionalEnv } from "./config";
import * as state from "./state";
import type { State, Player, Review, EmojiGame } from "./state";
import type { AnswerType, Scripture } from "./types";

// A message that @mentions people: bot.ts passes `mentions` to WhatsApp so the tags ping
export interface Post {
  text: string;
  mentions: string[];     // WhatsApp IDs of everyone tagged in text
}

// What handleMessage hands back to bot.ts
export type Reply =
  | (Post & { kind: "win" | "late" })   // "late" = correct, but someone already won today
  | { kind: "react"; emoji: string };   // no message, just an emoji on theirs (🤔 wrong, 👏 right but late)

// "123456@c.us" -> "@123456", which WhatsApp shows as the person's name
const tag = (id: string) => `@${id.split("@")[0]}`;

// Every reply tags the person it answers: "@Ama 📋 Commands...".
// Replies that already tag them (like !me) are left alone, so nobody is tagged twice.
export function replyTo(senderId: string, out: string | Post): Post {
  const post = typeof out === "string" ? { text: out, mentions: [] } : out;
  if (post.mentions.includes(senderId)) return post;
  return { text: `${tag(senderId)} ${post.text}`, mentions: [senderId, ...post.mentions] };
}

// Everything that changes state.json waits its turn here, one at a time, in order.
// Without this, a slow AI check could let a later answer "win", or an answer that was
// waiting on the AI could save over the 12 PM hint or the new puzzle with an old copy.
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
const LATE_POINTS = 1;                        // for each of the next correct answers after the winner
const LATE_SPOTS = 3;                         // how many of them

// Midday Review: a verse from 2+ weeks ago, worth less, no speed bonus or bonus spots
const REVIEW_POINTS: Record<AnswerType, number> = { both: 5, reference: 3, decoded: 2 };
const REVIEW_MIN_AGE = 14;                    // only verses at least this many puzzles old
const REVIEW_MIN_POOL = 10;                   // don't start until there are this many to choose from

const EMOJI_POINTS = 2;                       // Emoji Bible, first correct answer only

// ---------- Schedule ----------
// Every scheduled post, in one place (cron format: minute hour day month weekday).
// bot.ts runs these; !schedule, !help and the bot's messages read their times from here.
export const SCHEDULE = {
  backup:       "55 6 * * *",
  puzzle:       "0 7 * * *",
  hint:         "0 12 * * *",
  review:       "0 14 * * *",
  closeReview:  "0 17 * * *",
  bookHint:     "0 18 * * *",
  emoji:        "0 19 * * *",
  closeEmoji:   "0 20 * * *",
  reveal:       "0 21 * * *",
  weeklyWrap:   "5 20 * * 0",
  seasonFinale: "0 20 31 12 *",
} as const;

// "0 14 * * *" -> "2 PM", "5 20 * * 0" -> "8:05 PM"
export function timeOf(cron: string): string {
  const [min = 0, hour = 0] = cron.split(" ").map(Number);
  const minutes = min ? `:${String(min).padStart(2, "0")}` : "";
  return `${hour % 12 || 12}${minutes} ${hour < 12 ? "AM" : "PM"}`;
}
const when = (job: keyof typeof SCHEDULE) => timeOf(SCHEDULE[job]);

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
  { icon: "😀", name: "Emoji Master", earned: p => p.emojiWins >= 10 },
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

// A streak only counts once they've solved the latest puzzle. If they solved the one before
// but not this one yet, it's "on the line": not claimed, but not lost until they miss the day.
function streakNow(s: State, p: Player): { current: number; onTheLine: number } {
  const latest = s.today?.postedAt;
  if (latest === undefined || p.lastSolvedDay === null) return { current: 0, onTheLine: 0 };
  if (p.lastSolvedDay === dayKey(latest)) return { current: p.streak, onTheLine: 0 };
  if (p.lastSolvedDay === dayKey(latest - DAY)) return { current: 0, onTheLine: p.streak };
  return { current: 0, onTheLine: 0 };
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
    streak: 0, bestStreak: 0, lastSolvedDay: null, emojiWins: 0,
  };
  if (p.season !== season) Object.assign(p, { season, points: 0, wins: 0, fastestMin: null, emojiWins: 0 });
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

const puzzleOf = (v: Scripture) => v.acronym || makeAcronym(v.clue);

function pickPuzzle(all: Scripture[]): string {
  const s = state.load();
  let pool = all.filter(v => !s.used.includes(formatRef(v)));
  if (pool.length === 0) { s.used = []; pool = all; } // every verse used: start over
  const chosen = pick(pool);
  if (!chosen) throw new Error("No scriptures available");

  Object.assign(s, {
    today: { ...chosen, postedAt: Date.now() }, winner: null, hintsGiven: 0, revealed: false, lateSolvers: [], hints: [],
  });
  s.used.push(formatRef(chosen));
  if (s.history.length === 0) s.history = s.used.slice(0, -1);   // first run: start from what's been used
  s.history.push(formatRef(chosen));
  if (s.review) s.review.closed = true;                          // in case its closing time was missed
  state.save(s);

  const hintLine = chosen.hint ? `\n\n💡 Hint: ${chosen.hint}` : "";
  return `☀️ Good morning! Today's scripture:\n\n📜 *${puzzleOf(chosen)}*${hintLine}\n\n` +
    `💬 Reply with the reference, the decoded words, or both for the most points! 🎯\n🏆 First correct answer wins! ⏱️ Go go go! 🚀`;
}

// sentAt = when the person sent the message, in milliseconds
export function handleMessage(senderId: string, senderName: string, text: string,
                              sentAt = Date.now()): Promise<Reply | null> {
  return inOrder(async () => {
    const s = state.load();
    const today = s.today && !s.revealed ? s.today : null;    // after the reveal, nothing left to win
    const review = s.review && !s.review.closed ? s.review : null;
    const game = s.emojiGame && dayKey(s.emojiGame.postedAt) === dayKey(sentAt) ? s.emojiGame : null;
    if (!today && !review && !game) return null;

    // The AI only looks at messages that might be a reference, so "see you at 5pm" costs nothing
    const guess = !today && !review ? null
      : parseReference(text) ?? (mightBeReference(text) ? await aiReadGuess(text) : null);
    const matches = (v: Scripture) => ({ ref: isCorrect(guess, v), words: matchesDecode(text, v.clue) });

    // The morning puzzle comes first; the review only gets answers that are clearly for it
    const forToday = today ? matches(today) : { ref: false, words: false };
    if (today && (forToday.ref || forToday.words)) {
      if (s.winner) return lateAnswer(s, senderId, senderName, sentAt);
      return winToday(s, today, forToday, senderId, senderName, sentAt);
    }
    // Today's review, even once it's closed, so a late right answer gets 👏, not 🤔
    const lastReview = s.review && dayKey(s.review.verse.postedAt) === dayKey(sentAt) ? s.review : null;
    const forReview = lastReview ? matches(lastReview.verse) : { ref: false, words: false };
    if (lastReview && (forReview.ref || forReview.words)) {
      if (!lastReview.closed) return winReview(s, lastReview, forReview, senderId, senderName, sentAt);
      return lastReview.winner ? { kind: "react", emoji: "👏" } : null;   // after the reveal: nothing
    }

    // Emoji Bible answers are story names, so they're checked last
    if (game && namesStory(text, game.answers)) {
      if (!game.closed) return winEmoji(s, game, senderId, senderName, sentAt);
      return game.winner ? { kind: "react", emoji: "👏" } : null;
    }

    const somethingOpen = (today && !s.winner) || review;
    return guess && somethingOpen ? { kind: "react", emoji: "🤔" } : null;   // no spam, just a reaction
  });
}

type Matched = { ref: boolean; words: boolean };
const answerType = (m: Matched): AnswerType => (m.ref && m.words ? "both" : m.ref ? "reference" : "decoded");

// First correct answer to the morning puzzle
async function winToday(s: State, today: NonNullable<State["today"]>, m: Matched,
                        senderId: string, senderName: string, sentAt: number): Promise<Reply> {
  const type = answerType(m);
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
}

// First correct answer to the Midday Review: smaller prize, no bonus spots after it
async function winReview(s: State, review: Review, m: Matched,
                         senderId: string, senderName: string, sentAt: number): Promise<Reply> {
  const type = answerType(m);
  const points = REVIEW_POINTS[type];
  const minutes = Math.max(0, (sentAt - review.verse.postedAt) / 60_000);
  const p = getPlayer(s, senderId, senderName, sentAt);
  p.points += points;
  p.weekPoints += points;
  review.winner = { id: senderId, name: senderName, type, points, minutes };
  review.closed = true;
  state.save(s);

  const shout = await cheer(senderName, formatRef(review.verse));
  return {
    kind: "win",
    text: `${shout}\n\n🔁 ${tag(senderId)} won the *Midday Review* in ⏱️ ${formatTime(minutes)}!\n` +
      `🎯 ${ANSWER_LABEL[type]}: ✨ ${points} points ✨\n\n` +
      `📖 ${fullRef(review.verse)}:\n"${review.verse.text}"\n\n` +
      `📊 Season total: ${p.points} points` +
      (s.today && !s.winner && !s.revealed ? "\n\n☀️ This morning's puzzle is still open! Send !today to see it" : ""),
    mentions: [senderId],
  };
}

// First correct answer to Emoji Bible
async function winEmoji(s: State, game: EmojiGame, senderId: string, senderName: string,
                        sentAt: number): Promise<Reply> {
  const minutes = Math.max(0, (sentAt - game.postedAt) / 60_000);
  const p = getPlayer(s, senderId, senderName, sentAt);
  const before = badgesOf(p);
  p.points += EMOJI_POINTS;
  p.weekPoints += EMOJI_POINTS;
  p.emojiWins += 1;
  game.winner = { id: senderId, name: senderName, points: EMOJI_POINTS, minutes };
  game.closed = true;
  state.save(s);
  return {
    kind: "win",
    text: `🎉 ${tag(senderId)} got it in ⏱️ ${formatTime(minutes)}! ${game.emoji}\n` +
      `😀 It's *${game.story}*` + (game.reference ? ` (📖 ${game.reference})` : "") + "\n" +
      `✨ +${EMOJI_POINTS} points ✨` + newsLines(p, before),
    mentions: [senderId],
  };
}

// Correct, but someone already won. The next 3 people get +1; after that it's just a well done
// (both count for their streak), so copying the answer from the chat isn't worth much.
function lateAnswer(s: State, senderId: string, senderName: string, sentAt: number): Reply | null {
  const winner = s.winner;
  if (!winner || !s.today || senderId === winner.id || s.lateSolvers.includes(senderId)) return null;
  s.lateSolvers.push(senderId);
  const spot = s.lateSolvers.length;
  const firstBy = `${tag(winner.id)} got it first today 🏃💨`;

  const p = getPlayer(s, senderId, senderName, sentAt);
  const before = badgesOf(p);
  recordSolve(p, s.today.postedAt);             // every correct answer keeps the streak going

  if (spot > LATE_SPOTS) {
    state.save(s);
    return {
      kind: "late",
      text: `✅ Correct, ${tag(senderId)}! 👏 All ${LATE_SPOTS} bonus spots are taken today. ${firstBy}` +
        newsLines(p, before),
      mentions: [senderId, winner.id],
    };
  }

  p.points += LATE_POINTS;
  p.weekPoints += LATE_POINTS;
  state.save(s);
  return {
    kind: "late",
    text: `✅ Correct, ${tag(senderId)}! +${LATE_POINTS} point (bonus spot ${spot} of ${LATE_SPOTS}) 👏 ${firstBy}` +
      newsLines(p, before),
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
  const line = s.hintsGiven === 1                   // AI writes the hint outside the queue
    ? "💡 Extra hint: " + await makeHint(today).catch(() => `the first word is "${today.clue.split(/\s+/)[0] ?? ""}"`)
    : `🔦 Last hint: it's in the book of 📘 ${today.book}!`;

  await inOrder(async () => {                       // remember it for !today
    const now = state.load();
    if (now.today?.postedAt !== today.postedAt) return;   // a new puzzle came out meanwhile
    now.hints.push(line);
    state.save(now);
  });
  return s.hintsGiven === 1 ? line.replace("Extra hint:", "Extra hint (no more ⚡ speed bonus today):") : line;
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

// ---------- Midday Review ----------
// Morning verses old enough to come back as a review
const oldVerses = (s: State) => [...new Set(s.history.slice(0, -REVIEW_MIN_AGE))];
// Posts a verse from an earlier morning (2+ weeks ago), so the sheet is never used up faster.
// Returns null until enough old verses exist.
export async function newReview(): Promise<string | null> {
  const all = await loadScriptures();
  return inOrder(async () => {
    const s = state.load();
    const old = oldVerses(s);
    const byRef = new Map(all.map(v => [formatRef(v), v]));
    const eligible = old.filter(ref => byRef.has(ref) && ref !== (s.today && formatRef(s.today)));
    if (eligible.length < REVIEW_MIN_POOL) return null;

    let pool = eligible.filter(ref => !s.reviewed.includes(ref));
    if (pool.length === 0) { s.reviewed = []; pool = eligible; }   // all reviewed: start over
    const ref = pick(pool);
    const chosen = ref ? byRef.get(ref) : undefined;
    if (!ref || !chosen) return null;

    s.review = { verse: { ...chosen, postedAt: Date.now() }, winner: null, closed: false };
    s.reviewed.push(ref);
    state.save(s);

    const morningOpen = s.today && !s.winner && !s.revealed;
    return `🔁 *Midday Review* 🧠\nA verse we've had before. Do you remember it?\n\n📜 *${puzzleOf(chosen)}*\n\n` +
      `🎯 First correct answer wins ${REVIEW_POINTS.both} points! Closes at ${when("closeReview")} ⏳` +
      (morningOpen ? "\n☀️ This morning's puzzle is still open too. Send !today to see it" : "");
  });
}

// closeReview time: closes the review, revealing the answer if nobody got it
// ---------- Emoji Bible ----------
// emoji time: a Bible story told in emoji, from the Stories tab. Returns null if there's no Stories tab.
export async function newEmojiGame(): Promise<string | null> {
  const stories = await loadStories();
  if (stories.length === 0) return null;
  const fresh = stories.filter(st => !state.load().storiesUsed.includes(st.story));
  const startOver = fresh.length === 0;                           // every story used: start over
  const chosen = pick(startOver ? stories : fresh);
  if (!chosen) return null;
  const emoji = chosen.emoji ?? await makeEmoji(chosen.story);   // the AI call happens outside the queue

  return inOrder(async () => {
    const s = state.load();
    s.emojiGame = { ...chosen, emoji, postedAt: Date.now(), winner: null, closed: false };
    s.storiesUsed = [...(startOver ? [] : s.storiesUsed), chosen.story];
    state.save(s);
    return `😀 *Emoji Bible* 🎬\nWhich Bible story is this?\n\n${emoji}\n\n` +
      `🎯 First to name it wins ${EMOJI_POINTS} points! Closes at ${when("closeEmoji")} ⏳`;
  });
}

// closeEmoji time: closes Emoji Bible, revealing the story if nobody got it
export function closeEmojiGame(): Promise<string | null> {
  return inOrder(async () => {
    const s = state.load();
    const g = s.emojiGame;
    if (!g || g.closed) return null;
    g.closed = true;
    state.save(s);
    return `😀 Emoji Bible closed! Nobody got it 😮\n${g.emoji} was *${g.story}*` +
      (g.reference ? ` (📖 ${g.reference})` : "") + `. See you tomorrow at ${when("emoji")}! 🙌`;
  });
}

export function closeReview(): Promise<string | null> {
  return inOrder(async () => {
    const s = state.load();
    const r = s.review;
    if (!r || r.closed) return null;
    r.closed = true;
    state.save(s);
    const morningOpen = s.today && !s.winner && !s.revealed;
    return `🔁 Midday Review closed! Nobody got it 😮 It was 📖 ${fullRef(r.verse)}:\n\n"${r.verse.text}"` +
      (morningOpen ? `\n\n☀️ This morning's puzzle is still open until ${when("reveal")}. Send !today to see it 💪` : "");
  });
}

// !today: the puzzle, the hints so far, and whether someone has solved it
export function todayPuzzle(): Post {
  const s = state.load();
  const morning = morningStatus(s);
  const extras = [reviewStatus(s), emojiStatus(s)].filter((x): x is Post => x !== null);
  return {
    text: [morning, ...extras].map(x => x.text).join("\n\n"),
    mentions: [morning, ...extras].flatMap(x => x.mentions),
  };
}

// Today's Emoji Bible, if one was posted today
function emojiStatus(s: State): Post | null {
  const g = s.emojiGame;
  if (!g || dayKey(g.postedAt) !== dayKey(Date.now())) return null;
  const head = `😀 *Emoji Bible*: ${g.emoji}`;
  if (g.winner) return { text: `${head}\n✅ Won by ${tag(g.winner.id)}: it was *${g.story}*`, mentions: [g.winner.id] };
  if (g.closed) return { text: `${head}\n🌙 Nobody got it. It was *${g.story}*`, mentions: [] };
  return { text: `${head}\n⏳ Open until ${when("closeEmoji")}: name the story for ${EMOJI_POINTS} points!`, mentions: [] };
}

// Today's Midday Review, if one was posted today
function reviewStatus(s: State): Post | null {
  const r = s.review;
  if (!r || dayKey(r.verse.postedAt) !== dayKey(Date.now())) return null;
  const head = `🔁 *Midday Review*: *${puzzleOf(r.verse)}*`;
  if (r.winner) {
    return { text: `${head}\n✅ Won by ${tag(r.winner.id)} in ⏱️ ${formatTime(r.winner.minutes)}!`, mentions: [r.winner.id] };
  }
  if (r.closed) return { text: `${head}\n🌙 Nobody got it. It was 📖 ${fullRef(r.verse)}`, mentions: [] };
  return { text: `${head}\n⏳ Open until ${when("closeReview")}: first correct answer wins ${REVIEW_POINTS.both} points!`, mentions: [] };
}

function morningStatus(s: State): Post {
  const v = s.today;
  if (!v) return { text: `😴 No puzzle yet. The next one comes out at ${when("puzzle")} ☀️`, mentions: [] };

  const lines = [`📜 Today's scripture: *${puzzleOf(v)}*`];
  if (v.hint) lines.push(`💡 Hint: ${v.hint}`);
  lines.push(...s.hints);
  lines.push("");

  if (s.revealed) {
    lines.push(`🌙 Nobody got it. It was 📖 ${fullRef(v)}. A new one comes at ${when("puzzle")} ☀️`);
    return { text: lines.join("\n"), mentions: [] };
  }
  if (!s.winner) {
    lines.push("⏳ Nobody has got it yet. First correct answer wins! 🏆");
    return { text: lines.join("\n"), mentions: [] };
  }
  const left = Math.max(0, LATE_SPOTS - s.lateSolvers.length);
  lines.push(`✅ Solved by ${tag(s.winner.id)} in ⏱️ ${formatTime(s.winner.minutes)}! 🎉`);
  lines.push(left > 0
    ? `👏 ${left} of ${LATE_SPOTS} bonus spots left: answer correctly for +${LATE_POINTS}`
    : `👏 All ${LATE_SPOTS} bonus spots are taken. Try tomorrow's! 🙏`);
  return { text: lines.join("\n"), mentions: [s.winner.id] };
}

// ---------- Leaderboards ----------
const MEDALS = ["🥇", "🥈", "🥉"];
const TOP = 10;                               // the main board
const HONORABLE = 5;                          // ranks 11-15, listed under it

// Top 10, then 5 honourable mentions. Anyone asking from further down sees their own place.
export function leaderboard(kind: "season" | "week" = "season", askerId?: string): Post {
  const all = ranked(state.load(), kind);
  const title = kind === "week" ? "📅 This week's leaderboard 🔥" : `🏆 ${new Date().getFullYear()} season leaderboard 🏆`;
  if (all.length === 0) return { text: `${title}\n🤷 No points yet. Be the first! 🚀`, mentions: [] };

  const row = (p: Ranked, i: number) =>
    `${MEDALS[i] ?? `${i + 1}.`} ${tag(p.id)}: ${p.score} pts` + (kind === "season" ? ` (🏅 ${p.wins} wins)` : "");
  const top = all.slice(0, TOP);
  const honorable = all.slice(TOP, TOP + HONORABLE);
  const lines = [title, "", ...top.map(row)];
  if (honorable.length) lines.push("", "🎖️ *Honourable mentions*", ...honorable.map((p, i) => row(p, TOP + i)));

  const mine = askerId ? all.findIndex(p => p.id === askerId) : -1;
  if (mine >= TOP + HONORABLE) {
    lines.push("", `📍 You're #${mine + 1} with ${all[mine]?.score} pts. Keep going, you'll climb! 💪`);
  }
  return { text: lines.join("\n"), mentions: [...top, ...honorable].map(p => p.id) };
}

export function myStats(senderId: string): Post {
  const s = state.load();
  const board = ranked(s, "season");
  const i = board.findIndex(r => r.id === senderId);
  const p = board[i];
  if (!p) {
    return { text: `🌱 ${tag(senderId)}, no points yet this season. Tomorrow could be your day! 💪`, mentions: [senderId] };
  }
  const badges = badgesOf(p);
  const text = `📊 ${tag(p.id)}: ⭐ ${p.points} pts, 🏅 ${p.wins} wins, 🏆 #${i + 1} this season.\n` +
    `⚡ Fastest solve: ${p.fastestMin === null ? "none yet" : formatTime(p.fastestMin)}\n` +
    streakLine(streakNow(s, p), p.bestStreak) +
    (badges.length ? `\n🎖️ Badges: ${badges.join(", ")}` : "");
  return { text, mentions: [p.id] };
}

const streakLine = ({ current, onTheLine }: ReturnType<typeof streakNow>, best: number) =>
  `🔥 Streak: ${current} days (best ${best})` +
  (onTheLine ? `\n⏳ Your ${onTheLine}-day streak is on the line. Solve today's puzzle to keep it!` : "");

export function streak(senderId: string): Post {
  const s = state.load();
  const p = s.scores[senderId];
  if (!p || p.bestStreak === 0) {
    return { text: "🌱 No streak yet. Solve today's puzzle to start one! 🔥", mentions: [] };
  }
  const { current, onTheLine } = streakNow(s, p);
  const text = current > 0
    ? `🔥 ${tag(senderId)} is on a ${current}-day streak! (best: ${p.bestStreak}) Keep eating the Word! 📖`
    : onTheLine > 0
      ? `⏳ ${tag(senderId)}, your ${onTheLine}-day streak is on the line! (best: ${p.bestStreak}) Solve today's puzzle to keep it going 🔥`
      : `💤 ${tag(senderId)}'s streak has ended (best: ${p.bestStreak}). Solve today's puzzle to start again! 💪`;
  return { text, mentions: [senderId] };
}

// A dated copy of state.json in backups/, so a bad day can be undone
export function backupState(): void {
  const file = state.backup();
  if (file) console.log(`Backed up scores to ${file}`);
}

// !schedule: the whole day at a glance
export function schedule(): string {
  const reviewSoon = oldVerses(state.load()).length < REVIEW_MIN_POOL;
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value;
  return [
    "🗓️ *Daily schedule*" + (zone ? ` (${zone})` : ""),
    "",
    `☀️ ${when("puzzle")}: Morning puzzle`,
    `💡 ${when("hint")}: Extra hint (the speed bonus ends)`,
    `🔁 ${when("review")}: Midday Review, until ${when("closeReview")}` + (reviewSoon ? " _(starting soon)_" : ""),
    `🔦 ${when("bookHint")}: Last hint: the book`,
    ...(optionalEnv("STORIES_CSV_URL") ? [`😀 ${when("emoji")}: Emoji Bible, until ${when("closeEmoji")}`] : []),
    `🌙 ${when("reveal")}: The answer, if nobody got it`,
    "",
    `📅 Sundays ${when("weeklyWrap")}: Weekly standings`,
    `🏆 Dec 31, ${when("seasonFinale")}: Season finale`,
  ].join("\n");
}

// Shared by !help and !commands, so the two lists never drift apart
const COMMANDS = [
  "• !today: today's puzzles, hints, and who solved them 📜",
  "• !schedule: what happens at what time 🗓️",
  "• !leaderboard: season standings 🏆",
  "• !week: this week's standings 📅",
  "• !me: your points, streak and badges 📊",
  "• !streak: your current streak 🔥",
  "• !commands: just this list 📋",
  "• !help: rules, points and commands 📖",
];

export function commands(): string {
  return ["📋 *Commands*", ...COMMANDS].join("\n");
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
    `• ✅ Next ${LATE_SPOTS} correct answers after the winner: +${LATE_POINTS} each`,
    "• 🌙 Once the answer is revealed, the day is closed",
    "",
    `💡 Hints come at ${when("hint")} and ${when("bookHint")}, and the answer at ${when("reveal")}.`,
    `😀 At ${when("emoji")} it's *Emoji Bible*: name the Bible story told in emoji for ${EMOJI_POINTS} points, until ${when("closeEmoji")}.`,
    `🔁 At ${when("review")} there's a *Midday Review* of a verse from a few weeks back: ${REVIEW_POINTS.both} / ${REVIEW_POINTS.reference} / ${REVIEW_POINTS.decoded} points, open until ${when("closeReview")}.`,
    "🗓️ Send !schedule to see the whole day.",
    "🔥 Solve on days in a row to build a streak and earn badges 🎖️",
    "",
    "🤖 *Commands*",
    ...COMMANDS,
  ].join("\n");
}
