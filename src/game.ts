import { BOOKS, type Book, type Guess, type Scripture } from "./types"

const ALIASES: Record<string, Book> = {
  jn: "John", jhn: "John", mt: "Matthew", matt: "Matthew", mk: "Mark", mrk: "Mark", lk: "Luke",
  ps: "Psalms", psalm: "Psalms", psa: "Psalms", prov: "Proverbs", pr: "Proverbs", phil: "Philippians",
  php: "Philippians", rom: "Romans", roman: "Romans", heb: "Hebrews", hebrw: "Hebrews", hebrew: "Hebrews", rev: "Revelation", revelations: "Revelation",
  isa: "Isaiah", jer: "Jeremiah", gal: "Galatians", eph: "Ephesians", col: "Colossians", colo: "Colossians",
  gen: "Genesis", ex: "Exodus", lev: "Leviticus", num: "Numbers", dt: "Deuteronomy", josh: "Joshua",
  jdg: "Judges", judg: "Judges", "1sam": "1 Samuel", "2sam": "2 Samuel", "1kgs": "1 Kings", "2kgs": "2 Kings",
  "1chr": "1 Chronicles", "2chr": "2 Chronicles", neh: "Nehemiah", est: "Esther", eccl: "Ecclesiastes",
  song: "Song of Solomon", songs: "Song of Solomon", songofsongs: "Song of Solomon", sos: "Song of Solomon",
  lam: "Lamentations", ezek: "Ezekiel", ezk: "Ezekiel", dan: "Daniel", hos: "Hosea", obad: "Obadiah",
  mic: "Micah", nah: "Nahum", hab: "Habakkuk", zeph: "Zephaniah", hag: "Haggai", zech: "Zechariah",
  mal: "Malachi", jas: "James", phlm: "Philemon", philem: "Philemon",
};

const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, "")

export function findBook(raw: string): Book | null {
  const key = squash(raw);
  const alias = Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined;  // not "constructor" etc.
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


// "1st john" / "first john" -> "1 john"
const numberBooks = (text: string): string => text.toLowerCase()
  .replace(/\b(first|1st)\s/g, "1 ").replace(/\b(second|2nd)\s/g, "2 ").replace(/\b(third|3rd)\s/g, "3 ");

// The book name just before a chapter number, trying 3 words, then 2, then 1,
// so "song of solomon" and "1 john" win over "solomon" and "john"
function bookBefore(text: string): Book | null {
  const before = text.replace(/\b(chapter|chap|ch)\.?\s*$/, "");
  for (let n = 3; n >= 1; n--) {
    const name = before.match(new RegExp(`(?:[1-3]\\s*)?[a-z]+(?:\\s+[a-z]+){${n - 1}}[\\s.]*$`))?.[0];
    const book = name ? findBook(name.replace(/[\s.]+$/, "")) : null;
    if (book) return book;
  }
  return null;
}

// Finds things like "John 3:16", "jn 3 16", "1 cor 13v4", "first john 4:8",
// "Song of Solomon 2:1", "psalm 23 verse 1", "john chapter 3 vs 16"
export function parseReference(message: string): Guess | null {
  const text = numberBooks(message);
  const chapterVerse = /(\d+)\s*(?::|\.|v(?:erse|s)?\.?|\s)\s*(\d+)/g;
  for (const m of text.matchAll(chapterVerse)) {
    const book = bookBefore(text.slice(0, m.index));
    if (book) return { book, chapter: Number(m[1]), verse: Number(m[2]) };
  }
  return null;
}

const NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred)\b/;

// True if a message might be a reference the simple parser missed, like "john three sixteen".
// Only these are worth an AI call; "see you at 5pm" is not.
export function mightBeReference(message: string): boolean {
  const text = numberBooks(message);
  if (!/\d/.test(text) && !NUMBER_WORD.test(text)) return false;
  if (/\b(chapter|verse)\b/.test(text)) return true;
  const words = text.match(/[1-3](?=\s*[a-z])|[a-z]+/g) ?? [];
  return words.some((_, i) => [1, 2, 3].some(n => {
    const phrase = words.slice(i, i + n).join(" ");
    const key = squash(phrase);   // a short start like "act" (fast) is too loose; "acts" or "jn" is fine
    return (Object.hasOwn(ALIASES, key) || BOOKS.some(b => squash(b) === key) || key.length >= 4) && findBook(phrase) !== null;
  }));
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

// True if two words match, allowing one typo in words of `minLength`+ letters:
// a wrong, missing or extra letter, or two neighbouring letters swapped ("golaith")
function closeEnough(a: string, b: string, minLength = 4): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < minLength || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].flatMap((c, k) => (c === b[k] ? [] : [k]));
    const [x, y] = diff;
    if (diff.length === 2 && x !== undefined && y === x + 1 && a[x] === b[y] && a[y] === b[x]) return true;
  }
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

const SMALL_WORDS = new Set(["the", "a", "an", "and", "of", "in", "on", "to", "his", "her"]);

// Emoji Bible: true if the message names the story. Every important word of one answer must
// appear ("goliath" or "david and goliath"), with extra chatter around it. Typos are only forgiven
// in names of 6+ letters, because short Bible names are often one letter apart (abel/babel, dagon/dragon).
export function namesStory(message: string, answers: string[]): boolean {
  const plain = (t: string) => words(t.replace(/['’]s\b/gi, ""));    // "noah's ark" -> noah, ark
  const said = plain(message);
  return answers.some(answer => {
    const needed = plain(answer).filter(w => !SMALL_WORDS.has(w));
    const same = (s: string, w: string) => s === `${w}s` || w === `${s}s` || closeEnough(s, w, 6);   // noahs = noah
    return needed.length > 0 && needed.every(w => said.some(s => same(s, w)));
  });
}
