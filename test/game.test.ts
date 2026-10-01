import { describe, it, expect } from "vitest";
import { findBook, makeAcronym, parseReference, mightBeReference, isCorrect, formatRef, matchesDecode } from "../src/game";
import type { Scripture } from "../src/types";

const romans: Scripture = {
  book: "Romans", chapter: 8, verseStart: 38, verseEnd: 39,
  clue: "neither death, nor life", text: "For I am persuaded that neither death nor life...",
};

describe("findBook", () => {
  it("knows full names, ignoring case and spaces", () => {
    expect(findBook("john")).toBe("John");
    expect(findBook("1 Corinthians")).toBe("1 Corinthians");
    expect(findBook("1corinthians")).toBe("1 Corinthians");
  });

  it("knows common abbreviations", () => {
    expect(findBook("jn")).toBe("John");
    expect(findBook("Ps")).toBe("Psalms");
    expect(findBook("revelations")).toBe("Revelation");
  });

  it("accepts an unambiguous start of a name", () => {
    expect(findBook("deut")).toBe("Deuteronomy");
    expect(findBook("1 cor")).toBe("1 Corinthians");
  });

  it("refuses ambiguous or too-short input", () => {
    expect(findBook("jo")).toBeNull();      // Joshua, Job, Joel, John, Jonah...
    expect(findBook("j")).toBeNull();
    expect(findBook("1 j")).toBeNull();
    expect(findBook("hello")).toBeNull();
  });

  it("isn't fooled by built-in JavaScript names", () => {
    expect(findBook("constructor")).toBeNull();
    expect(findBook("__proto__")).toBeNull();
  });
});

describe("makeAcronym", () => {
  it("matches the example in the code comment", () => {
    expect(makeAcronym("because David did what was right in the eyes of the LORD, and did not turn aside"))
      .toBe("BDDWWRITEOTL, ADNTA...");
  });

  it("keeps semicolons and drops the ... when the verse is complete", () => {
    expect(makeAcronym("The LORD is my shepherd; I shall not want.")).toBe("TLIMS; ISNW");
  });

  it("ignores punctuation-only words", () => {
    expect(makeAcronym("Jesus wept — truly")).toBe("JWT...");
  });
});

describe("parseReference", () => {
  it.each([
    ["John 3:16", { book: "John", chapter: 3, verse: 16 }],
    ["jn 3 16", { book: "John", chapter: 3, verse: 16 }],
    ["1 cor 13v4", { book: "1 Corinthians", chapter: 13, verse: 4 }],
    ["first john 4:8", { book: "1 John", chapter: 4, verse: 8 }],
    ["I think it's rom 8.28!!", { book: "Romans", chapter: 8, verse: 28 }],
    ["Song of Solomon 2:1", { book: "Song of Solomon", chapter: 2, verse: 1 }],
    ["song 2 1", { book: "Song of Solomon", chapter: 2, verse: 1 }],
    ["psalm 23 verse 1", { book: "Psalms", chapter: 23, verse: 1 }],
    ["john chapter 3 vs 16", { book: "John", chapter: 3, verse: 16 }],
    ["1st john 4:8", { book: "1 John", chapter: 4, verse: 8 }],
    ["I think it is 1 john 4:8", { book: "1 John", chapter: 4, verse: 8 }],
    ["1 kgs 3:9", { book: "1 Kings", chapter: 3, verse: 9 }],
    ["gen 1:1", { book: "Genesis", chapter: 1, verse: 1 }],
    ["jas 1:5", { book: "James", chapter: 1, verse: 5 }],
    ["1cor13:4", { book: "1 Corinthians", chapter: 13, verse: 4 }],
  ])("reads %j", (msg, expected) => {
    expect(parseReference(msg)).toEqual(expected);
  });

  it("returns null when there is no reference", () => {
    expect(parseReference("good morning everyone")).toBeNull();
    expect(parseReference("hello 3:16")).toBeNull();
  });
});

describe("mightBeReference", () => {
  it.each(["john three sixteen", "the shepherd psalm twenty three", "1 cor thirteen four", "chapter 3 of the gospel"])(
    "is worth an AI look: %j", msg => expect(mightBeReference(msg)).toBe(true));

  it.each(["see you at 5pm", "it is 5 o'clock", "meeting at 7, act fast", "we have 2 tickets", "john is coming"])(
    "is not worth an AI look: %j", msg => expect(mightBeReference(msg)).toBe(false));
});

describe("isCorrect", () => {
  it("accepts any verse inside the range", () => {
    expect(isCorrect({ book: "Romans", chapter: 8, verse: 38 }, romans)).toBe(true);
    expect(isCorrect({ book: "Romans", chapter: 8, verse: 39 }, romans)).toBe(true);
  });

  it("rejects wrong verse, chapter, book, or no guess", () => {
    expect(isCorrect({ book: "Romans", chapter: 8, verse: 40 }, romans)).toBe(false);
    expect(isCorrect({ book: "Romans", chapter: 9, verse: 38 }, romans)).toBe(false);
    expect(isCorrect({ book: "John", chapter: 8, verse: 38 }, romans)).toBe(false);
    expect(isCorrect(null, romans)).toBe(false);
  });
});

describe("formatRef", () => {
  it("formats single verses and ranges", () => {
    expect(formatRef({ book: "John", chapter: 3, verseStart: 16, verseEnd: 16 })).toBe("John 3:16");
    expect(formatRef(romans)).toBe("Romans 8:38-39");
  });
});

describe("matchesDecode", () => {
  const clue = "For God so loved the world that He gave His only begotten Son";

  it("accepts the exact words, ignoring case and punctuation", () => {
    expect(matchesDecode("for god so loved the world, that he gave his only begotten son!", clue)).toBe(true);
  });

  it("accepts a missing word and chatter around the answer", () => {
    expect(matchesDecode("Is it: God so loved the world that He gave His only begotten Son? amen", clue)).toBe(true);
  });

  it("allows one typo in longer words", () => {
    expect(matchesDecode("For God so lovd the wrld that He gave His only begoten Son", clue)).toBe(true);
  });

  it("rejects too few words or the wrong order", () => {
    expect(matchesDecode("God so loved the world", clue)).toBe(false);
    expect(matchesDecode("Son begotten only His gave He that world the loved so God For", clue)).toBe(false);
  });

  it("rejects empty input", () => {
    expect(matchesDecode("", clue)).toBe(false);
    expect(matchesDecode("anything", "")).toBe(false);
  });
});
