// ---------- Schedule ----------
// Every scheduled post, in one place (cron format: minute hour day month weekday).
// bot.ts runs these; !schedule, !help and the bot's messages read their times from here.
export const SCHEDULE = {
  puzzleSoon: "50 6 * * *", // the "... in 10 minutes" reminders
  backup: "55 6 * * *",
  puzzle: "0 7 * * *",
  riddleSoon: "50 9 * * *",
  riddle: "0 10 * * *",
  closeRiddle: "0 12 * * *",
  hint: "0 12 * * *",
  reviewSoon: "50 13 * * *",
  review: "0 14 * * *",
  closeReview: "0 17 * * *",
  bookHint: "0 18 * * *",
  emojiSoon: "50 18 * * *",
  emoji: "0 19 * * *",
  closeEmoji: "0 20 * * *",
  reveal: "0 21 * * *",
  weeklyWrap: "5 20 * * 0",
  seasonFinale: "0 20 31 12 *",
} as const;

// "0 14 * * *" -> "2 PM", "5 20 * * 0" -> "8:05 PM"
export function timeOf(cron: string): string {
  const [min = 0, hour = 0] = cron.split(" ").map(Number);
  const minutes = min ? `:${String(min).padStart(2, "0")}` : "";
  return `${hour % 12 || 12}${minutes} ${hour < 12 ? "AM" : "PM"}`;
}
export const when = (job: keyof typeof SCHEDULE) => timeOf(SCHEDULE[job]);
