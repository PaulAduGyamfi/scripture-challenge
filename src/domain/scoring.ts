import type { AnswerType } from "../types";

// ---------- Points ----------
export const ANSWER_POINTS: Record<AnswerType, number> = { both: 10, reference: 6, decoded: 3 };
export const SPEED_BONUS = [
  // minutes after the puzzle was posted
  { withinMin: 30, bonus: 5 },
  { withinMin: 120, bonus: 3 },
  { withinMin: 240, bonus: 1 },
] as const;
export const LATE_POINTS = 1; // for each of the next correct answers after the winner
export const LATE_SPOTS = 3; // how many of them
export const ON_TRACK_POINTS = 1; // the start of the verse or a quote from it: once, round stays open

// Midday Review: a verse from 2+ weeks ago, worth less, no speed bonus or bonus spots
export const REVIEW_POINTS: Record<AnswerType, number> = { both: 5, reference: 3, decoded: 2 };

export const EMOJI_POINTS = 2; // Emoji Bible, first correct answer only
export const RIDDLE_POINTS = 3; // Bible Riddle, first correct answer only

export function scoreAnswer(type: AnswerType, minutes: number, hintsGiven: number) {
  const base = ANSWER_POINTS[type];
  const tier = hintsGiven === 0 ? SPEED_BONUS.find(t => minutes <= t.withinMin) : undefined;
  const bonus = tier?.bonus ?? 0;
  return { base, bonus, points: base + bonus };
}

export type Matched = { ref: boolean; words: boolean };
export const answerType = (m: Matched): AnswerType =>
  m.ref && m.words ? "both" : m.ref ? "reference" : "decoded";
