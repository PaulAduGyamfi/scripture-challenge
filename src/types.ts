// Every Bible book, spelled exactly as the bot expects. Typos here are caught by TypeScript.
export const BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
    "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
    "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
    "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
    "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
    "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
    "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
    "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
  ] as const;

  export type Book = (typeof BOOKS)[number]
  
  export interface Scripture {
    book: Book;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    clue: string;
    text: string;
    acronym?: string;
    hint?: string;
    translation?: string;
  }

  export interface Guess {
    book: Book;
    chapter: number;
    verse: number;
  }

  export type AnswerType = "both" | "reference" | "decoded"

  // One row of the Stories tab, for the Emoji Bible game
  export interface Story {
    story: string;          // "Jonah and the big fish", shown when solved
    answers: string[];      // any one of these counts as correct: ["jonah"]
    reference?: string;     // "Jonah 1-2"
    emoji?: string;         // your own clue; empty means the AI makes one
  }
