import { describe, it, expect, vi, beforeEach } from "vitest";

const CSV = [
  "Book,Chapter,VerseStart,VerseEnd,Clue,Text,Acronym,Hint,Translation",
  "Jn,3,16,,For God so loved the world,,,,KJV",
  "Romans,8,38,39,neither death nor life,For I am persuaded...,NDNL,angels,",
  "Hezekiah,1,1,,not a real book,,,,",          // skipped: unknown book
  "John,abc,1,,bad chapter,,,,",                 // skipped: chapter not a number
  "John,1,5,3,ends before it starts,,,,",        // skipped: VerseEnd < VerseStart
].join("\n");

const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status }));

// sheet.ts remembers the last good copy, so each test loads a fresh module
async function freshSheet() {
  vi.resetModules();
  return import("../src/sheet");
}

beforeEach(() => {
  vi.stubEnv("SHEET_CSV_URL", "https://example.test/sheet.csv");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadScriptures", () => {
  it("turns good rows into scriptures and skips bad ones", async () => {
    vi.stubGlobal("fetch", respond(CSV));
    const { loadScriptures } = await freshSheet();
    const verses = await loadScriptures();

    expect(verses).toEqual([
      { book: "John", chapter: 3, verseStart: 16, verseEnd: 16, clue: "For God so loved the world",
        text: "For God so loved the world", acronym: undefined, hint: undefined, translation: "KJV" },
      { book: "Romans", chapter: 8, verseStart: 38, verseEnd: 39, clue: "neither death nor life",
        text: "For I am persuaded...", acronym: "NDNL", hint: "angels", translation: undefined },
    ]);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it("throws when the sheet has no usable rows", async () => {
    vi.stubGlobal("fetch", respond("Book,Chapter,VerseStart,Clue\nNope,1,1,x"));
    const { loadScriptures } = await freshSheet();
    await expect(loadScriptures()).rejects.toThrow(/no usable rows/);
  });

  it("falls back to the last good copy when Google Sheets is down", async () => {
    const { loadScriptures } = await freshSheet();
    vi.stubGlobal("fetch", respond(CSV));
    const first = await loadScriptures();

    vi.stubGlobal("fetch", respond("", 503));
    expect(await loadScriptures()).toEqual(first);
  });

  it("throws on a download error when there is no earlier copy", async () => {
    vi.stubGlobal("fetch", respond("", 503));
    const { loadScriptures } = await freshSheet();
    await expect(loadScriptures()).rejects.toThrow(/HTTP 503/);
  });
});

describe("loadStories", () => {
  const STORIES = [
    "Story,Answers,Reference,Emoji",
    "Jonah and the big fish,jonah,Jonah 1-2,",
    'David and Goliath,"goliath, david and goliath",,🧒🪨',
    ",missing story,,",                                // skipped
  ].join("\n");

  it("reads the Stories tab and splits the answers", async () => {
    vi.stubEnv("STORIES_CSV_URL", "https://example.test/stories.csv");
    vi.stubGlobal("fetch", respond(STORIES));
    const { loadStories } = await freshSheet();
    expect(await loadStories()).toEqual([
      { story: "Jonah and the big fish", answers: ["jonah"], reference: "Jonah 1-2", emoji: undefined },
      { story: "David and Goliath", answers: ["goliath", "david and goliath"], reference: undefined, emoji: "🧒🪨" },
    ]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("returns nothing when there's no Stories tab", async () => {
    vi.stubEnv("STORIES_CSV_URL", "");
    const { loadStories } = await freshSheet();
    expect(await loadStories()).toEqual([]);
  });

  it("explains when the link is the /edit link instead of the published CSV", async () => {
    vi.stubEnv("STORIES_CSV_URL", "https://docs.google.com/spreadsheets/d/x/edit");
    vi.stubGlobal("fetch", respond("<!DOCTYPE html><html>sign in</html>"));
    const { loadStories } = await freshSheet();
    await expect(loadStories()).rejects.toThrow(/Publish to web/);
  });
});
