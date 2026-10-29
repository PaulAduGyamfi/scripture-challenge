// Player records: creating them, season and week resets, rankings, streak and badge news
import { weekKey } from "./domain/calendar";
import { badgesOf } from "./domain/streaks";
import type { State, Player } from "./state";

// "🔥 3-day streak!" and any badges earned since `before`
export function newsLines(p: Player, before: string[]): string {
  const lines: string[] = [];
  if (p.streak >= 2) lines.push(`🔥 *${p.streak}-day streak!*`);
  for (const b of badgesOf(p)) if (!before.includes(b)) lines.push(`🎖️ New badge: *${b}*`);
  return lines.length ? "\n\n" + lines.join("\n") : "";
}

// A player's record, reset automatically at each new season (year) and week.
export function getPlayer(s: State, id: string, name: string, now: number): Player {
  const season = new Date(now).getFullYear();
  const week = weekKey(now);
  const p: Player = s.scores[id] ?? {
    name,
    points: 0,
    wins: 0,
    fastestMin: null,
    season,
    week,
    weekPoints: 0,
    streak: 0,
    bestStreak: 0,
    lastSolvedDay: null,
    emojiWins: 0,
    riddleWins: 0,
  };
  if (p.season !== season)
    Object.assign(p, { season, points: 0, wins: 0, fastestMin: null, emojiWins: 0, riddleWins: 0 });
  if (p.week !== week) Object.assign(p, { week, weekPoints: 0 });
  p.name = name;
  s.scores[id] = p;
  return p;
}

export type Ranked = Player & { id: string; score: number };

export function ranked(s: State, kind: "season" | "week", now = Date.now()): Ranked[] {
  const season = new Date(now).getFullYear();
  const week = weekKey(now);
  return Object.entries(s.scores)
    .map(([id, p]) => ({ ...p, id, score: kind === "week" ? p.weekPoints : p.points }))
    .filter(p => (kind === "week" ? p.week === week : p.season === season) && p.score > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins);
}
