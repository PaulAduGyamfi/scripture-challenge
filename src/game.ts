import { BOOKS, type Book, type Guess, type Scripture } from "./types"

const ALIASES: Record<string, Book> = {
  jn: "John", jhn: "John", mt: "Matthew", matt: "Matthew", mk: "Mark", mrk: "Mark", lk: "Luke",
  ps: "Psalms", psalm: "Psalms", psa: "Psalms", prov: "Proverbs", pr: "Proverbs", phil: "Philippians",
  php: "Philippians", rom: "Romans", roman: "Romans", heb: "Hebrews", hebrw: "Hebrews", hebrew: "Hebrews", rev: "Revelation", revelations: "Revelation",
  isa: "Isaiah", jer: "Jeremiah", gal: "Galatians", eph: "Ephesians", col: "Colossians", colo: "Colossians"
};

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, "")

export function findBook(raw: string): Book | null {
  const key = squash(raw);
  const alias = ALIASES[key]
  if(alias){
    return alias;
  }
  const exact = BOOKS.find(b => squash(b) === key);
  if(exact){
    return exact;
  }
  if(key.replace(/^[1-3]/, "").length < 2){
    return null;
  }
  const matches = BOOKS.filter(b => squash(b).startsWith(key))

  return matches.length === 1 && matches[0] ? matches[0] : null
}

// Matches the church's style: letters run together, phrases split at commas,
// "..." when the clue stops mid-verse.
// "because David did what was right in the eyes of the LORD, and did not turn aside"
//   -> "BDDWWRITEOTL, ADNTA..."
export function makeAcronym(clue: string): string {
  let out = "";
  for(const word of clue.trim().split(/\s+/)){
    const match = word.replace(/[^A-Za-z]/g, "")
    const first = match ? match[0] : ""
    if(!first) continue;
    out += first.toUpperCase();
    const end = word.match(/[,;:.!?]+["')”’»]?$/)?.[0];
    if(end){
      out += (/^[,;:]/.test(end) ? end[0] : "") + " ";
    }
  }
  out = out.trim().replace(/[,;:]$/, "");
  const fullVerse = /[.!?]["')]?$/.test(clue.trim());
  return fullVerse ? out : out + "...";
}


// Finds things like "John 3:16", "jn 3 16", "1 cor 13v4", "first john 4:8"
export function parseReference(message: string): Guess | null {
  const text = message.toLowerCase()
    .replace(/\bfirst\s/g, "1 ").replace(/\bsecond\s/g, "2 ").replace(/\bthird\s/g, "3 ");
  const re = /([1-3]?\s*[a-z]+)\.?\s*(\d+)\s*(?::|v|\.|\s)\s*(\d+)/g;
  for (const [, rawBook, chapter, verse] of text.matchAll(re)) {
    if (!rawBook || !chapter || !verse) continue;
    const book = findBook(rawBook);
    if (book) return { book, chapter: Number(chapter), verse: Number(verse) };
  }
  return null;
}

export function isCorrect(guess: Guess | null, s: Scripture): boolean {
  return guess !== null && guess.book === s.book && guess.chapter === s.chapter && guess.verse >= s.verseStart 
  && guess.verse <= s.verseEnd;
}

export function formatRef(s: Pick<Scripture, "book" | "chapter" | "verseStart" | "verseEnd">): string {
  const v = s.verseStart === s.verseEnd ? `${s.verseStart}` : `${s.verseStart}-${s.verseEnd}`;
  return `${s.book} ${s.chapter}:${v}`;
}