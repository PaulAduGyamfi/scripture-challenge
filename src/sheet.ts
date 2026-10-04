import Papa from "papaparse";
import { z } from "zod";
import { env, optionalEnv } from "./config";
import { findBook } from "./game";
import type { Scripture, Story } from "./types";

// What one row of the Google Sheet must look like. Empty cells arrive as "".
const Row = z.object({
  Book: z.string().trim().min(1, "Book is empty"),
  Chapter: z.coerce.number().int().positive("Chapter must be a number"),
  VerseStart: z.coerce.number().int().positive("VerseStart must be a number"),
  VerseEnd: z.string().trim().optional(),
  Clue: z.string().trim().min(1, "Clue is empty"),
  Text: z.string().trim().optional(),
  Acronym: z.string().trim().optional(),
  Hint: z.string().trim().optional(),
  Translation: z.string().trim().optional(),
});

let lastGood: Scripture[] = []; // used if Google Sheets is down

// Downloads a published sheet tab as rows of { header: value }
async function fetchCsv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Sheet download failed: HTTP ${res.status}`);
  const body = await res.text();
  if (/^\s*<(!doctype|html)/i.test(body)) {
    throw new Error("That sheet link gives a web page, not CSV. Use File > Share > Publish to web > CSV, " +
      "and copy the link ending in output=csv (not the /edit link).");
  }
  return Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true }).data;
}

export async function loadScriptures(): Promise<Scripture[]> {
  try {
    const data = await fetchCsv(env("SHEET_CSV_URL"));

    const good: Scripture[] = [];
    data.forEach((raw, i) => {
      const where = `Sheet row ${i + 2}`; // row 1 is the headers
      const r = Row.safeParse(raw);
      if (!r.success) {
        const problems = r.error.issues.map(x => `${x.path.map(String).join(".")}: ${x.message}`);
        return console.warn(`${where} skipped: ${problems.join("; ")}`);
      }
      const book = findBook(r.data.Book);
      if (!book) return console.warn(`${where} skipped: unknown book "${r.data.Book}"`);
      const verseEnd = r.data.VerseEnd ? Number(r.data.VerseEnd) : r.data.VerseStart;
      if (!Number.isInteger(verseEnd) || verseEnd < r.data.VerseStart) {
        return console.warn(`${where} skipped: VerseEnd must be a number, not before VerseStart`);
      }
      good.push({
        book, chapter: r.data.Chapter, verseStart: r.data.VerseStart, verseEnd,
        clue: r.data.Clue, text: r.data.Text || r.data.Clue,
        acronym: r.data.Acronym || undefined, hint: r.data.Hint || undefined,
        translation: r.data.Translation || undefined,
      });
    });

    if (good.length === 0) throw new Error("The sheet has no usable rows");
    lastGood = good;
    return good;
  } catch (err) {
    if (lastGood.length > 0) {
      console.error("Couldn't refresh the sheet, using the last good copy:", err);
      return lastGood;
    }
    throw err;
  }
}
// ---------- Stories tab, for Emoji Bible ----------
const StoryRow = z.object({
  Story: z.string().trim().min(1, "Story is empty"),
  Answers: z.string().trim().min(1, "Answers is empty"),
  Reference: z.string().trim().optional(),
  Emoji: z.string().trim().optional(),
});

let lastGoodStories: Story[] = [];

// Returns [] when STORIES_CSV_URL isn't set, so the game simply doesn't run
export async function loadStories(): Promise<Story[]> {
  const url = optionalEnv("STORIES_CSV_URL");
  if (!url) return [];
  try {
    const good: Story[] = [];
    (await fetchCsv(url)).forEach((raw, i) => {
      const r = StoryRow.safeParse(raw);
      if (!r.success) {
        const problems = r.error.issues.map(x => `${x.path.map(String).join(".")}: ${x.message}`);
        return console.warn(`Stories row ${i + 2} skipped: ${problems.join("; ")}`);
      }
      good.push({
        story: r.data.Story,
        answers: r.data.Answers.split(",").map(a => a.trim()).filter(Boolean),
        reference: r.data.Reference || undefined,
        emoji: r.data.Emoji || undefined,
      });
    });
    if (good.length === 0) throw new Error("The Stories tab has no usable rows");
    lastGoodStories = good;
    return good;
  } catch (err) {
    if (lastGoodStories.length > 0) {
      console.error("Couldn't refresh the Stories tab, using the last good copy:", err);
      return lastGoodStories;
    }
    throw err;
  }
}
