import { describe, it, expect } from "vitest";
import { plural, verseBlock } from "../src/format";
import type { Scripture } from "../src/types";

const john: Scripture = {
  book: "John",
  chapter: 3,
  verseStart: 16,
  verseEnd: 16,
  translation: "KJV",
  clue: "For God so loved the world",
  text: "For God so loved the world...",
};

describe("plural", () => {
  it.each([
    [0, "points"],
    [1, "point"],
    [2, "points"],
  ])("%i -> %s", (n, word) => {
    expect(plural(n, "point")).toBe(`${n} ${word}`);
  });
});

describe("verseBlock", () => {
  it("shows the reference in bold, then the verse as a WhatsApp quote", () => {
    expect(verseBlock(john)).toBe("📖 *John 3:16 (KJV)*\n> For God so loved the world...");
  });

  it("quotes every line of a verse that spans several", () => {
    const psalm = {
      ...john,
      book: "Psalms" as const,
      chapter: 23,
      verseStart: 1,
      verseEnd: 2,
      translation: undefined,
    };
    expect(verseBlock({ ...psalm, text: "The LORD is my shepherd;\nI shall not want." })).toBe(
      "📖 *Psalms 23:1-2*\n> The LORD is my shepherd;\n> I shall not want."
    );
  });
});
