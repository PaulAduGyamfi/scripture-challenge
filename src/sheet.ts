import Papa from "papaparse";
import { z } from "zod";
import { env } from "./config";
import { findBook } from "./game";
import type { Scripture } from "./types";

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

export async function loadScriptures(): Promise<Scripture[]> {
  try {
    const res = await fetch(env("SHEET_CSV_URL"), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Sheet download failed: HTTP ${res.status}`);
    const { data } = Papa.parse<Record<string, string>>(await res.text(), { header: true, skipEmptyLines: true });

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