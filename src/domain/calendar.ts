export const DAY = 24 * 60 * 60_000;

// "2026-03-04" for the given moment. Without a time zone it uses the process's (bot.ts sets TZ).
export function dayKey(ms: number, timeZone?: string): string {
  if (timeZone) return new Date(wallClock(ms, timeZone)).toISOString().slice(0, 10);
  // "2026-03-04" in local time
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, "0")).join("-");
}

// Identifies the Monday-to-Sunday week. The key is Monday midnight written in UTC: the Monday in
// time zones west of UTC (like the bot's), the Sunday east of it. Saved players' `week` values use
// this format, so with a time zone it's built the same way and keys always match the saved ones.
export function weekKey(ms: number, timeZone?: string): string {
  if (timeZone) {
    const monday = new Date(wallClock(ms, timeZone));
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const offset = wallClock(monday.getTime(), timeZone) - monday.getTime();
    return new Date(monday.getTime() - offset).toISOString().slice(0, 10);
  }
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// The time on the clock in the given zone, as if it were UTC (so the UTC getters read it)
function wallClock(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(ms);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}
