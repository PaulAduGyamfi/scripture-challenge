// What happens when someone answers correctly: points, streaks, badges and the reply.
// These save state.json, so only handleMessage calls them, inside the inOrder queue in core.ts (I2).
import { celebrate } from "./ai";
import { formatRef } from "./domain/matching";
import {
  EMOJI_POINTS,
  LATE_POINTS,
  LATE_SPOTS,
  ON_TRACK_POINTS,
  REVIEW_POINTS,
  RIDDLE_POINTS,
  answerType,
  scoreAnswer,
  type Matched,
} from "./domain/scoring";
import { badgesOf, recordSolve } from "./domain/streaks";
import { formatTime, fullRef, pick, riddleAnswer, tag, type Reply } from "./format";
import { getPlayer, newsLines, ranked } from "./players";
import * as state from "./state";
import type { State, Review, EmojiGame, RiddleGame } from "./state";
import type { AnswerType } from "./types";

const ANSWER_LABEL: Record<AnswerType, string> = {
  both: "Reference + decoded",
  reference: "Reference",
  decoded: "Decoded",
};

// Backup cheers in case the AI is unavailable
const CHEERS = [
  "🎉 Eeeeiiiii.....!!! 🙌",
  "🔥 Haaaa! We have a winner! 🏆",
  "😲 Woooooow! Somebody has been eating the Word! 📖🍽️",
  "🙌 Eeeeiii! This one is sozzled in the Word!! 📖🔥",
];

async function cheer(name: string, ref: string): Promise<string> {
  try {
    return await celebrate(name, ref);
  } catch {
    return pick(CHEERS) ?? "🎉 Well done!";
  }
}

// First correct answer to the morning puzzle
export async function winToday(
  s: State,
  today: NonNullable<State["today"]>,
  m: Matched,
  senderId: string,
  senderName: string,
  sentAt: number
): Promise<Reply> {
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
    text:
      `${shout}\n\n🥇 ${tag(senderId)} got it first in ⏱️ ${formatTime(minutes)}!\n` +
      `🎯 ${ANSWER_LABEL[type]}: ${base}${bonusText} = ✨ ${points} points ✨\n\n` +
      `📖 ${fullRef(today)}:\n"${today.text}"\n\n` +
      `📊 Season total: ${p.points} points (#${rank} on the leaderboard) 🏆` +
      newsLines(p, before),
    mentions: [senderId],
  };
}

// The start of the verse or a 5-word quote from it: +1 the first time, a nudge to finish
export function onTrackAnswer(s: State, senderId: string, senderName: string, sentAt: number): Reply | null {
  if (s.onTrack.includes(senderId)) return null;
  const p = getPlayer(s, senderId, senderName, sentAt);
  p.points += ON_TRACK_POINTS;
  p.weekPoints += ON_TRACK_POINTS;
  s.onTrack.push(senderId);
  state.save(s);
  return {
    kind: "onTrack",
    text:
      `👍 ${tag(senderId)}, you're on the right track! +${ON_TRACK_POINTS} point. ` +
      "Finish the decode or add the reference to win it 🏆",
    mentions: [senderId],
  };
}

// First correct answer to the Midday Review: smaller prize, no bonus spots after it
export async function winReview(
  s: State,
  review: Review,
  m: Matched,
  senderId: string,
  senderName: string,
  sentAt: number
): Promise<Reply> {
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
    text:
      `${shout}\n\n🔁 ${tag(senderId)} won the *Midday Review* in ⏱️ ${formatTime(minutes)}!\n` +
      `🎯 ${ANSWER_LABEL[type]}: ✨ ${points} points ✨\n\n` +
      `📖 ${fullRef(review.verse)}:\n"${review.verse.text}"\n\n` +
      `📊 Season total: ${p.points} points` +
      (s.today && !s.winner && !s.revealed
        ? "\n\n☀️ This morning's puzzle is still open! Send !today to see it"
        : ""),
    mentions: [senderId],
  };
}

// First correct answer to Emoji Bible
export async function winEmoji(
  s: State,
  game: EmojiGame,
  senderId: string,
  senderName: string,
  sentAt: number
): Promise<Reply> {
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
    text:
      `🎉 ${tag(senderId)} got it in ⏱️ ${formatTime(minutes)}! ${game.emoji}\n` +
      `😀 It's *${game.story}*` +
      (game.reference ? ` (📖 ${game.reference})` : "") +
      "\n" +
      `✨ +${EMOJI_POINTS} points ✨` +
      newsLines(p, before),
    mentions: [senderId],
  };
}

// First correct answer to the Bible Riddle
export function winRiddle(
  s: State,
  riddle: RiddleGame,
  senderId: string,
  senderName: string,
  sentAt: number
): Reply {
  const minutes = Math.max(0, (sentAt - riddle.postedAt) / 60_000);
  const p = getPlayer(s, senderId, senderName, sentAt);
  const before = badgesOf(p);
  p.points += RIDDLE_POINTS;
  p.weekPoints += RIDDLE_POINTS;
  p.riddleWins += 1;
  riddle.winner = { id: senderId, name: senderName, points: RIDDLE_POINTS, minutes };
  riddle.closed = true;
  state.save(s);
  return {
    kind: "win",
    text:
      `🧩 ${tag(senderId)} solved the riddle in ⏱️ ${formatTime(minutes)}!\n` +
      `💡 It's *${riddleAnswer(riddle)}*` +
      (riddle.reference ? ` (📖 ${riddle.reference})` : "") +
      "\n" +
      `✨ +${RIDDLE_POINTS} points ✨` +
      newsLines(p, before),
    mentions: [senderId],
  };
}

// Correct, but someone already won. The next 3 people get +1; after that it's just a well done
// (both count for their streak), so copying the answer from the chat isn't worth much.
export function lateAnswer(s: State, senderId: string, senderName: string, sentAt: number): Reply | null {
  const winner = s.winner;
  if (!winner || !s.today || senderId === winner.id || s.lateSolvers.includes(senderId)) return null;
  s.lateSolvers.push(senderId);
  const spot = s.lateSolvers.length;
  const firstBy = `${tag(winner.id)} got it first today 🏃💨`;

  const p = getPlayer(s, senderId, senderName, sentAt);
  const before = badgesOf(p);
  recordSolve(p, s.today.postedAt); // every correct answer keeps the streak going

  if (spot > LATE_SPOTS) {
    state.save(s);
    return {
      kind: "late",
      text:
        `✅ Correct, ${tag(senderId)}! 👏 All ${LATE_SPOTS} bonus spots are taken today. ${firstBy}` +
        newsLines(p, before),
      mentions: [senderId, winner.id],
    };
  }

  p.points += LATE_POINTS;
  p.weekPoints += LATE_POINTS;
  state.save(s);
  return {
    kind: "late",
    text:
      `✅ Correct, ${tag(senderId)}! +${LATE_POINTS} point (bonus spot ${spot} of ${LATE_SPOTS}) 👏 ${firstBy}` +
      newsLines(p, before),
    mentions: [senderId, winner.id],
  };
}
