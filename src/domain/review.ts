// Midday Review: which earlier morning verses can come back
export const REVIEW_MIN_AGE = 14; // only verses at least this many puzzles old
export const REVIEW_MIN_POOL = 10; // don't start until there are this many to choose from

// Morning verses old enough to come back as a review
export const oldVerses = (s: { history: string[] }) => [...new Set(s.history.slice(0, -REVIEW_MIN_AGE))];
