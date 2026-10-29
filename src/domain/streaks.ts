import { DAY, dayKey } from "./calendar";

// The parts of a player (see Player in src/state.ts) that streaks and badges read
interface StreakRecord {
  streak: number;
  bestStreak: number;
  lastSolvedDay: string | null;
}
interface BadgeRecord {
  wins: number;
  fastestMin: number | null;
  bestStreak: number;
  emojiWins: number;
  riddleWins: number;
}

// ---------- Streaks and badges ----------
// Win and streak badges. Win badges follow the season's wins; streak badges last forever.
export const BADGES: { icon: string; name: string; earned: (p: BadgeRecord) => boolean }[] = [
  { icon: "🌱", name: "First Fruits", earned: p => p.wins >= 1 },
  { icon: "📖", name: "Word Eater", earned: p => p.wins >= 10 },
  { icon: "🌊", name: "Sozzled", earned: p => p.wins >= 25 },
  { icon: "👑", name: "Elder", earned: p => p.wins >= 50 },
  { icon: "⚡", name: "Quick Draw", earned: p => p.fastestMin !== null && p.fastestMin < 1 },
  { icon: "🔥", name: "On Fire", earned: p => p.bestStreak >= 3 },
  { icon: "🕊️", name: "Faithful", earned: p => p.bestStreak >= 7 },
  { icon: "⛰️", name: "Unshakeable", earned: p => p.bestStreak >= 30 },
  { icon: "😀", name: "Emoji Master", earned: p => p.emojiWins >= 10 },
  { icon: "🧩", name: "Riddle Master", earned: p => p.riddleWins >= 10 },
];
export const badgesOf = (p: BadgeRecord) => BADGES.filter(b => b.earned(p)).map(b => `${b.icon} ${b.name}`);

// Counts a correct answer (win or late) toward the player's daily streak
export function recordSolve(p: StreakRecord, postedAt: number): void {
  const day = dayKey(postedAt);
  if (p.lastSolvedDay === day) return;
  p.streak = p.lastSolvedDay === dayKey(postedAt - DAY) ? p.streak + 1 : 1;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.lastSolvedDay = day;
}

// A streak only counts once they've solved the latest puzzle. If they solved the one before
// but not this one yet, it's "on the line": not claimed, but not lost until they miss the day.
export function streakNow(
  s: { today: { postedAt: number } | null },
  p: StreakRecord
): { current: number; onTheLine: number } {
  const latest = s.today?.postedAt;
  if (latest === undefined || p.lastSolvedDay === null) return { current: 0, onTheLine: 0 };
  if (p.lastSolvedDay === dayKey(latest)) return { current: p.streak, onTheLine: 0 };
  if (p.lastSolvedDay === dayKey(latest - DAY)) return { current: 0, onTheLine: p.streak };
  return { current: 0, onTheLine: 0 };
}
