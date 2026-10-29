import {
  parseReference,
  mightBeReference,
  isCorrect,
  formatRef,
  matchesDecode,
  namesStory,
  startsVerse,
  quotesVerse,
} from "./domain/matching";
import { aiReadGuess, makeHint, makeEmoji, judgeStoryGuess, judgeRiddleGuess } from "./ai";
import { loadScriptures, loadStories, loadRiddles } from "./sheet";
import * as state from "./state";
import type { Scripture } from "./types";
import { dayKey } from "./domain/calendar";
import { oldVerses, REVIEW_MIN_POOL } from "./domain/review";
import { EMOJI_POINTS, REVIEW_POINTS, RIDDLE_POINTS } from "./domain/scoring";
import { lateAnswer, onTrackAnswer, winEmoji, winReview, winRiddle, winToday } from "./answers";
import { fullRef, pick, puzzleOf, riddleAnswer, type Reply } from "./format";
import { when } from "./schedule";

// bot.ts, sim.ts and the tests use everything through core
export { replyTo, type Post, type Reply } from "./format";
export { SCHEDULE, timeOf } from "./schedule";
export {
  todayPuzzle,
  leaderboard,
  myStats,
  streak,
  backupState,
  reminder,
  schedule,
  commands,
  help,
} from "./replies";

// Everything that changes state.json waits its turn here, one at a time, in order.
// Without this, a slow AI check could let a later answer "win", or an answer that was
// waiting on the AI could save over the 12 PM hint or the new puzzle with an old copy.
let queue: Promise<unknown> = Promise.resolve();
function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

// ---------- Game ----------
export async function newPuzzle(): Promise<string> {
  const all = await loadScriptures(); // download outside the queue: answers keep flowing
  return inOrder(async () => pickPuzzle(all));
}

function pickPuzzle(all: Scripture[]): string {
  const s = state.load();
  let pool = all.filter(v => !s.used.includes(formatRef(v)));
  if (pool.length === 0) {
    s.used = [];
    pool = all;
  } // every verse used: start over
  const chosen = pick(pool);
  if (!chosen) throw new Error("No scriptures available");

  Object.assign(s, {
    today: { ...chosen, postedAt: Date.now() },
    winner: null,
    hintsGiven: 0,
    revealed: false,
    lateSolvers: [],
    hints: [],
    onTrack: [],
  });
  s.used.push(formatRef(chosen));
  if (s.history.length === 0) s.history = s.used.slice(0, -1); // first run: start from what's been used
  s.history.push(formatRef(chosen));
  if (s.review) s.review.closed = true; // in case its closing time was missed
  state.save(s);

  const hintLine = chosen.hint ? `\n\n💡 Hint: ${chosen.hint}` : "";
  return (
    `☀️ Good morning! Today's scripture:\n\n📜 *${puzzleOf(chosen)}*${hintLine}\n\n` +
    `💬 Reply with the reference, the decoded words, or both for the most points! 🎯\n🏆 First correct answer wins! ⏱️ Go go go! 🚀`
  );
}

// sentAt = when the person sent the message, in milliseconds
export function handleMessage(
  senderId: string,
  senderName: string,
  text: string,
  sentAt = Date.now()
): Promise<Reply | null> {
  return inOrder(async () => {
    const s = state.load();
    const today = s.today && !s.revealed ? s.today : null; // after the reveal, nothing left to win
    const review = s.review && !s.review.closed ? s.review : null;
    const game = s.emojiGame && dayKey(s.emojiGame.postedAt) === dayKey(sentAt) ? s.emojiGame : null;
    const riddle = s.riddle && dayKey(s.riddle.postedAt) === dayKey(sentAt) ? s.riddle : null;
    if (!today && !review && !game && !riddle) return null;

    // The AI only looks at messages that might be a reference, so "see you at 5pm" costs nothing
    const guess =
      !today && !review
        ? null
        : (parseReference(text) ?? (mightBeReference(text) ? await aiReadGuess(text) : null));
    const matches = (v: Scripture) => ({ ref: isCorrect(guess, v), words: matchesDecode(text, v.clue) });

    // The morning puzzle comes first; the review only gets answers that are clearly for it
    const forToday = today ? matches(today) : { ref: false, words: false };
    if (today && (forToday.ref || forToday.words)) {
      if (s.winner) return lateAnswer(s, senderId, senderName, sentAt);
      return winToday(s, today, forToday, senderId, senderName, sentAt);
    }
    // Knows the verse but hasn't decoded it all: +1 once, and the puzzle stays open for the full answer
    if (today && !s.winner && (startsVerse(text, today.clue) || quotesVerse(text, today.text))) {
      return onTrackAnswer(s, senderId, senderName, sentAt);
    }
    // Today's review, even once it's closed, so a late right answer gets 👏, not 🤔
    const lastReview = s.review && dayKey(s.review.verse.postedAt) === dayKey(sentAt) ? s.review : null;
    const forReview = lastReview ? matches(lastReview.verse) : { ref: false, words: false };
    if (lastReview && (forReview.ref || forReview.words)) {
      if (!lastReview.closed) return winReview(s, lastReview, forReview, senderId, senderName, sentAt);
      return lastReview.winner ? { kind: "react", emoji: "👏" } : null; // after the reveal: nothing
    }

    // Bible Riddle and Emoji Bible answers are names, so they're checked last: open games first,
    // then today's closed ones, so a late right answer gets 👏 (or nothing, once revealed)
    if (riddle && !riddle.closed && namesStory(text, riddle.answers))
      return winRiddle(s, riddle, senderId, senderName, sentAt);
    if (game && !game.closed && namesStory(text, game.answers))
      return winEmoji(s, game, senderId, senderName, sentAt);
    for (const g of [riddle, game]) {
      if (g?.closed && namesStory(text, g.answers)) return g.winner ? { kind: "react", emoji: "👏" } : null;
    }
    // Not one of the listed answers: while a game is open, the AI judges it ("Jonah in the belly of
    // the fish" counts; just describing the emoji doesn't). Reference guesses were for the other puzzles, so skip those.
    const judgeable = !guess && /[a-z]{3}/i.test(text);
    let judgedWrong = false;
    if (riddle && !riddle.closed && judgeable) {
      const verdict = await judgeRiddleGuess(text, riddle);
      if (verdict === "correct") return winRiddle(s, riddle, senderId, senderName, sentAt);
      if (verdict === "wrong") {
        console.log(
          `Bible Riddle answer judged wrong for "${riddle.answers[0] ?? ""}": ${text.slice(0, 100)}`
        );
        judgedWrong = true;
      }
    }
    if (game && !game.closed && judgeable) {
      const verdict = await judgeStoryGuess(text, game);
      if (verdict === "correct") return winEmoji(s, game, senderId, senderName, sentAt);
      if (verdict === "wrong") {
        console.log(`Emoji Bible guess judged wrong for "${game.story}": ${text.slice(0, 100)}`);
        judgedWrong = true;
      }
    }
    if (judgedWrong) return { kind: "react", emoji: "🤔" };

    const somethingOpen = (today && !s.winner) || review;
    return guess && somethingOpen ? { kind: "react", emoji: "🤔" } : null; // no spam, just a reaction
  });
}

// The scheduled hints skip a solved puzzle; the admin's !grouphint passes evenIfSolved to give one anyway
export async function hint({ evenIfSolved = false } = {}): Promise<string | null> {
  const s = await inOrder(async () => {
    const s = state.load();
    if (!s.today || (s.winner && !evenIfSolved)) return null;
    s.hintsGiven += 1;
    state.save(s);
    return s;
  });
  const today = s?.today;
  if (!s || !today) return null;
  const line =
    s.hintsGiven === 1 // AI writes the hint outside the queue
      ? "💡 Extra hint: " +
        (await makeHint(today).catch(() => `the first word is "${today.clue.split(/\s+/)[0] ?? ""}"`))
      : `🔦 Last hint: it's in the book of 📘 ${today.book}!`;

  await inOrder(async () => {
    // remember it for !today
    const now = state.load();
    if (now.today?.postedAt !== today.postedAt) return; // a new puzzle came out meanwhile
    now.hints.push(line);
    state.save(now);
  });
  return s.hintsGiven === 1
    ? line.replace("Extra hint:", "Extra hint (no more ⚡ speed bonus today):")
    : line;
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
    if (pool.length === 0) {
      s.reviewed = [];
      pool = eligible;
    } // all reviewed: start over
    const ref = pick(pool);
    const chosen = ref ? byRef.get(ref) : undefined;
    if (!ref || !chosen) return null;

    s.review = { verse: { ...chosen, postedAt: Date.now() }, winner: null, closed: false };
    s.reviewed.push(ref);
    state.save(s);

    const morningOpen = s.today && !s.winner && !s.revealed;
    return (
      `🔁 *Midday Review* 🧠\nA verse we've had before. Do you remember it?\n\n📜 *${puzzleOf(chosen)}*\n\n` +
      `🎯 First correct answer wins ${REVIEW_POINTS.both} points! Closes at ${when("closeReview")} ⏳` +
      (morningOpen ? "\n☀️ This morning's puzzle is still open too. Send !today to see it" : "")
    );
  });
}

// closeReview time: closes the review, revealing the answer if nobody got it
// ---------- Bible Riddle ----------
// riddle time: a Bible riddle from the Riddles tab. Returns null if there's no Riddles tab.
export async function newRiddle(): Promise<string | null> {
  const riddles = await loadRiddles();
  if (riddles.length === 0) return null;
  return inOrder(async () => {
    const s = state.load();
    const fresh = riddles.filter(r => !s.riddlesUsed.includes(r.riddle));
    const startOver = fresh.length === 0; // every riddle used: start over
    const chosen = pick(startOver ? riddles : fresh);
    if (!chosen) return null;
    s.riddle = { ...chosen, postedAt: Date.now(), winner: null, closed: false };
    s.riddlesUsed = [...(startOver ? [] : s.riddlesUsed), chosen.riddle];
    state.save(s);
    return (
      `🧩 *Bible Riddle* 🤔\n\n${chosen.riddle}\n\n` +
      `🎯 First right answer wins ${RIDDLE_POINTS} points! Closes at ${when("closeRiddle")} ⏳`
    );
  });
}

// closeRiddle time: closes the riddle, revealing the answer if nobody got it
export function closeRiddle(): Promise<string | null> {
  return inOrder(async () => {
    const s = state.load();
    const r = s.riddle;
    if (!r || r.closed) return null;
    r.closed = true;
    state.save(s);
    return (
      `🧩 Bible Riddle closed! Nobody got it 😮\nThe answer was *${riddleAnswer(r)}*` +
      (r.reference ? ` (📖 ${r.reference})` : "") +
      `. New riddle tomorrow at ${when("riddle")}! 🙌`
    );
  });
}

// ---------- Emoji Bible ----------
// emoji time: a Bible story told in emoji, from the Stories tab. Returns null if there's no Stories tab.
export async function newEmojiGame(): Promise<string | null> {
  const stories = await loadStories();
  if (stories.length === 0) return null;
  const fresh = stories.filter(st => !state.load().storiesUsed.includes(st.story));
  const startOver = fresh.length === 0; // every story used: start over
  const chosen = pick(startOver ? stories : fresh);
  if (!chosen) return null;
  const emoji = chosen.emoji ?? (await makeEmoji(chosen.story)); // the AI call happens outside the queue

  return inOrder(async () => {
    const s = state.load();
    s.emojiGame = { ...chosen, emoji, postedAt: Date.now(), winner: null, closed: false };
    s.storiesUsed = [...(startOver ? [] : s.storiesUsed), chosen.story];
    state.save(s);
    return (
      `😀 *Emoji Bible* 🎬\nWhich Bible story is this?\n\n${emoji}\n\n` +
      `🎯 Name the story (who or where, not what the emoji show)! First right answer wins ${EMOJI_POINTS} points. ` +
      `Closes at ${when("closeEmoji")} ⏳`
    );
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
    return (
      `😀 Emoji Bible closed! Nobody got it 😮\n${g.emoji} was *${g.story}*` +
      (g.reference ? ` (📖 ${g.reference})` : "") +
      `. See you tomorrow at ${when("emoji")}! 🙌`
    );
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
    return (
      `🔁 Midday Review closed! Nobody got it 😮 It was 📖 ${fullRef(r.verse)}:\n\n"${r.verse.text}"` +
      (morningOpen
        ? `\n\n☀️ This morning's puzzle is still open until ${when("reveal")}. Send !today to see it 💪`
        : "")
    );
  });
}
