// The read-only replies: !today, leaderboards, !me, !streak, !schedule, !help and the reminders.
// Nothing here writes state.json, so none of it needs the inOrder queue.
import { optionalEnv } from "./config";
import { dayKey } from "./domain/calendar";
import { oldVerses, REVIEW_MIN_POOL } from "./domain/review";
import {
  ANSWER_POINTS,
  EMOJI_POINTS,
  LATE_POINTS,
  LATE_SPOTS,
  ON_TRACK_POINTS,
  REVIEW_POINTS,
  RIDDLE_POINTS,
  SPEED_BONUS,
} from "./domain/scoring";
import { badgesOf, streakNow } from "./domain/streaks";
import { formatTime, fullRef, puzzleOf, riddleAnswer, tag, type Post } from "./format";
import { ranked, type Ranked } from "./players";
import { when } from "./schedule";
import * as state from "./state";
import type { State } from "./state";

// !today: the puzzle, the hints so far, and whether someone has solved it
export function todayPuzzle(): Post {
  const s = state.load();
  const morning = morningStatus(s);
  const extras = [riddleStatus(s), reviewStatus(s), emojiStatus(s)].filter((x): x is Post => x !== null);
  return {
    text: [morning, ...extras].map(x => x.text).join("\n\n"),
    mentions: [morning, ...extras].flatMap(x => x.mentions),
  };
}

// Today's Bible Riddle, if one was posted today
function riddleStatus(s: State): Post | null {
  const r = s.riddle;
  if (!r || dayKey(r.postedAt) !== dayKey(Date.now())) return null;
  const head = `🧩 *Bible Riddle*: ${r.riddle}`;
  if (r.winner)
    return {
      text: `${head}\n✅ Solved by ${tag(r.winner.id)}: it was *${riddleAnswer(r)}*`,
      mentions: [r.winner.id],
    };
  if (r.closed) return { text: `${head}\n🌙 Nobody got it. It was *${riddleAnswer(r)}*`, mentions: [] };
  return {
    text: `${head}\n⏳ Open until ${when("closeRiddle")}: first right answer wins ${RIDDLE_POINTS} points!`,
    mentions: [],
  };
}

// Today's Emoji Bible, if one was posted today
function emojiStatus(s: State): Post | null {
  const g = s.emojiGame;
  if (!g || dayKey(g.postedAt) !== dayKey(Date.now())) return null;
  const head = `😀 *Emoji Bible*: ${g.emoji}`;
  if (g.winner)
    return { text: `${head}\n✅ Won by ${tag(g.winner.id)}: it was *${g.story}*`, mentions: [g.winner.id] };
  if (g.closed) return { text: `${head}\n🌙 Nobody got it. It was *${g.story}*`, mentions: [] };
  return {
    text: `${head}\n⏳ Open until ${when("closeEmoji")}: name the story for ${EMOJI_POINTS} points!`,
    mentions: [],
  };
}

// Today's Midday Review, if one was posted today
function reviewStatus(s: State): Post | null {
  const r = s.review;
  if (!r || dayKey(r.verse.postedAt) !== dayKey(Date.now())) return null;
  const head = `🔁 *Midday Review*: *${puzzleOf(r.verse)}*`;
  if (r.winner) {
    return {
      text: `${head}\n✅ Won by ${tag(r.winner.id)} in ⏱️ ${formatTime(r.winner.minutes)}!`,
      mentions: [r.winner.id],
    };
  }
  if (r.closed) return { text: `${head}\n🌙 Nobody got it. It was 📖 ${fullRef(r.verse)}`, mentions: [] };
  return {
    text: `${head}\n⏳ Open until ${when("closeReview")}: first correct answer wins ${REVIEW_POINTS.both} points!`,
    mentions: [],
  };
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
  lines.push(
    left > 0
      ? `👏 ${left} of ${LATE_SPOTS} bonus spots left: answer correctly for +${LATE_POINTS}`
      : `👏 All ${LATE_SPOTS} bonus spots are taken. Try tomorrow's! 🙏`
  );
  return { text: lines.join("\n"), mentions: [s.winner.id] };
}

// ---------- Leaderboards ----------
const MEDALS = ["🥇", "🥈", "🥉"];
const TOP = 10; // the main board
const HONORABLE = 5; // ranks 11-15, listed under it

// Top 10, then 5 honourable mentions. Anyone asking from further down sees their own place.
export function leaderboard(kind: "season" | "week" = "season", askerId?: string): Post {
  const all = ranked(state.load(), kind);
  const title =
    kind === "week"
      ? "📅 This week's leaderboard 🔥"
      : `🏆 ${new Date().getFullYear()} season leaderboard 🏆`;
  if (all.length === 0) return { text: `${title}\n🤷 No points yet. Be the first! 🚀`, mentions: [] };

  const row = (p: Ranked, i: number) =>
    `${MEDALS[i] ?? `${i + 1}.`} ${tag(p.id)}: ${p.score} pts` +
    (kind === "season" ? ` (🏅 ${p.wins} wins)` : "");
  const top = all.slice(0, TOP);
  const honorable = all.slice(TOP, TOP + HONORABLE);
  const lines = [title, "", ...top.map(row)];
  if (honorable.length)
    lines.push("", "🎖️ *Honourable mentions*", ...honorable.map((p, i) => row(p, TOP + i)));

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
    return {
      text: `🌱 ${tag(senderId)}, no points yet this season. Tomorrow could be your day! 💪`,
      mentions: [senderId],
    };
  }
  const badges = badgesOf(p);
  const text =
    `📊 ${tag(p.id)}: ⭐ ${p.points} pts, 🏅 ${p.wins} wins, 🏆 #${i + 1} this season.\n` +
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
  const text =
    current > 0
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

// Midday Review is "starting soon" until there are enough old verses to pick from
const reviewNotYet = () => oldVerses(state.load()).length < REVIEW_MIN_POOL;
const hasEmojiBible = () => Boolean(optionalEnv("STORIES_CSV_URL"));
const hasRiddles = () => Boolean(optionalEnv("RIDDLES_CSV_URL"));

// 10 minutes before each game: a heads-up. null when that game won't run today.
export function reminder(game: "puzzle" | "riddle" | "review" | "emoji"): string | null {
  if (game === "puzzle")
    return `⏰ Today's scripture drops at ${when("puzzle")}, in 10 minutes! Get ready 📖🔥`;
  if (game === "riddle") {
    if (!hasRiddles()) return null;
    return `⏰ *Bible Riddle* at ${when("riddle")}, in 10 minutes! 🧩🤔`;
  }
  if (game === "review") {
    if (reviewNotYet()) return null;
    return `⏰ *Midday Review* starts at ${when("review")}, in 10 minutes! 🔁🧠`;
  }
  if (!hasEmojiBible()) return null;
  return `⏰ *Emoji Bible* starts at ${when("emoji")}, in 10 minutes! 😀🎬`;
}

// !schedule: the whole day at a glance
export function schedule(): string {
  const reviewSoon = reviewNotYet();
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date())
    .find(p => p.type === "timeZoneName")?.value;
  return [
    "🗓️ *Daily schedule*" + (zone ? ` (${zone})` : ""),
    "",
    `☀️ ${when("puzzle")}: Morning puzzle`,
    ...(hasRiddles() ? [`🧩 ${when("riddle")}: Bible Riddle, until ${when("closeRiddle")}`] : []),
    `💡 ${when("hint")}: Extra hint (the speed bonus ends)`,
    `🔁 ${when("review")}: Midday Review, until ${when("closeReview")}` +
      (reviewSoon ? " _(starting soon)_" : ""),
    `🔦 ${when("bookHint")}: Last hint: the book`,
    ...(hasEmojiBible() ? [`😀 ${when("emoji")}: Emoji Bible, until ${when("closeEmoji")}`] : []),
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
  const reviewNote = reviewNotYet() ? " _(starting soon)_" : "";
  return [
    "📖 *Scripture Challenge* 🙌",
    "",
    `☀️ Every day at ${when("puzzle")} I post a verse as an acronym, like *TLIMS; ISNW*.`,
    "💬 Reply with the reference, the decoded words, or both. First right answer wins!",
    `💡 Hints at ${when("hint")} and ${when("bookHint")} · answer at ${when("reveal")}`,
    "",
    "🎯 *Points*",
    `• Reference + words: ${ANSWER_POINTS.both}  ·  Reference: ${ANSWER_POINTS.reference}  ·  Words: ${ANSWER_POINTS.decoded}`,
    `• ⚡ Up to +${SPEED_BONUS[0].bonus} for speed, before the first hint`,
    `• 👍 +${ON_TRACK_POINTS} for the start of the verse  ·  ✅ +${LATE_POINTS} for the next ${LATE_SPOTS} after the winner`,
    "",
    "🎮 *More games* (first right answer wins)",
    ...(hasRiddles() ? [`• 🧩 ${when("riddle")} Bible Riddle: ${RIDDLE_POINTS} pts`] : []),
    `• 🔁 ${when("review")} Midday Review: ${REVIEW_POINTS.both} / ${REVIEW_POINTS.reference} / ${REVIEW_POINTS.decoded} pts${reviewNote}`,
    ...(hasEmojiBible() ? [`• 😀 ${when("emoji")} Emoji Bible: ${EMOJI_POINTS} pts`] : []),
    "",
    "🔥 Solve days in a row to build a streak and earn badges.",
    "",
    "📋 !today · !schedule · !leaderboard · !week · !me · !streak · !commands",
  ].join("\n");
}
