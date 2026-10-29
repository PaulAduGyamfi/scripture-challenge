export const DAY = 24 * 60 * 60_000;

// "2026-03-04" for the given moment. Without a time zone it uses the process's (bot.ts sets TZ).
export function dayKey(ms: number, timeZone?: string): string {
  if (timeZone) return zonedDate(ms, timeZone);
  // "2026-03-04" in local time
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, "0")).join("-");
}

// Identifies the Monday-to-Sunday week.
// Without a time zone this keeps the original code, whose key is local Monday midnight written in
// UTC: the Monday in time zones west of UTC (like the bot's), the Sunday east of it. Saved players'
// `week` values depend on it, so it stays. With a time zone, the key is that zone's Monday.
export function weekKey(ms: number, timeZone?: string): string {
  if (timeZone) {
    const [y = 0, m = 1, d = 1] = zonedDate(ms, timeZone).split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// "2026-03-04" in the given time zone
function zonedDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ms);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
