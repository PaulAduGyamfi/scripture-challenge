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

// Splits text into words exactly the way makeAcronym does
const words = (s: string): string[] =>
  s.split(/\s+/).map(w => w.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean);

// True if two words match, allowing one typo in words of 4+ letters
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// True if the message contains at least 80% of the clue's words, in order.
// A missing word ("Therefore"), extra words around it, and one typo per longer word are all fine.
export function matchesDecode(message: string, clue: string): boolean {
  const target = words(clue);
  const said = words(message);
  if (target.length === 0 || said.length === 0) return false;

  // Count the longest run of clue words found in order (a "longest common subsequence")
  let prev: number[] = new Array<number>(said.length + 1).fill(0);
  for (const t of target) {
    const row: number[] = new Array<number>(said.length + 1).fill(0);
    for (let j = 1; j <= said.length; j++) {
      row[j] = closeEnough(said[j - 1] ?? "", t)
        ? (prev[j - 1] ?? 0) + 1
        : Math.max(prev[j] ?? 0, row[j - 1] ?? 0);
    }
    prev = row;
  }
  const matched = prev[said.length] ?? 0;
  return matched / target.length >= 0.8;
}