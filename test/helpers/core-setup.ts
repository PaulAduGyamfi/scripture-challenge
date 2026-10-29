import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi, beforeEach, afterEach } from "vitest";
import type { Reply } from "../../src/core";
import type { Riddle, Scripture, Story } from "../../src/types";

// Shared by the core-*.test.ts files. Each of them mocks the sheet and the AI with these:
//   vi.mock("../src/sheet", () => import("./helpers/core-setup").then(f => f.sheetMock));
//   vi.mock("../src/ai", () => import("./helpers/core-setup").then(f => f.aiMock));

// No real AI or Google Sheet in tests
const john: Scripture = {
  book: "John",
  chapter: 3,
  verseStart: 16,
  verseEnd: 16,
  translation: "KJV",
  clue: "For God so loved the world that He gave His only begotten Son",
  text: "For God so loved the world, that he gave his only begotten Son...",
};
const psalm: Scripture = {
  book: "Psalms",
  chapter: 23,
  verseStart: 1,
  verseEnd: 1,
  hint: "herder",
  clue: "The LORD is my shepherd; I shall not want.",
  text: "The LORD is my shepherd; I shall not want.",
};
// 30 past verses (Psalms 101-130 verse 1) for the Midday Review
const old: Scripture[] = Array.from({ length: 30 }, (_, i) => ({
  book: "Psalms",
  chapter: 101 + i,
  verseStart: 1,
  verseEnd: 1,
  clue: `Old verse number ${101 + i}`,
  text: `Old verse number ${101 + i}.`,
}));
const jonah: Story = { story: "Jonah and the big fish", answers: ["jonah"], reference: "Jonah 1-2" };
const goliath: Story = {
  story: "David and Goliath",
  answers: ["goliath", "david and goliath"],
  emoji: "🧒🪨🗡️🗿",
};
const noah: Riddle = {
  riddle: "I built a boat on dry land and waited for rain. Who am I?",
  answers: ["noah"],
  reference: "Genesis 6-9",
};
const samson: Riddle = { riddle: "My strength was in my hair. Who am I?", answers: ["samson"] };
export const fakes = {
  john,
  psalm,
  old,
  jonah,
  goliath,
  noah,
  samson,
  verses: [john] as Scripture[],
  stories: [] as Story[],
  riddles: [] as Riddle[],
};

export const sheetMock = {
  loadScriptures: vi.fn(async () => fakes.verses),
  loadStories: vi.fn(async () => fakes.stories),
  loadRiddles: vi.fn(async () => fakes.riddles),
};
export const aiMock = {
  aiReadGuess: vi.fn(async () => null),
  makeHint: vi.fn(async () => "behest; lifelong"),
  celebrate: vi.fn(async (name: string) => `Haaaa! ${name} is sozzled!`),
  makeEmoji: vi.fn(async () => "🐋🙏🌊"),
  judgeStoryGuess: vi.fn(async () => "not_a_guess"),
  judgeRiddleGuess: vi.fn(async () => "not_a_guess"),
};

export const MIN = 60_000;
export const AMA = "111@c.us";
export const KOFI = "222@c.us";
export const ESI = "333@c.us";
export const YAW = "444@c.us";
export const AKUA = "555@c.us";
export const START = new Date(2026, 2, 4, 7, 0); // Wednesday 4 March 2026, 7:00 AM local time

export const postedAt = START.getTime(); // when beforeEach posts the day's puzzle
export const textOf = (r: Reply | null | undefined) => (r && "text" in r ? r.text : "");
const home = process.cwd();

// Every test starts in an empty folder (a fresh state.json) with John 3:16 posted at START.
// core is imported here, not at the top, so the test file's mocks are in place before it loads.
export function freshGameEachTest(): void {
  beforeEach(async () => {
    const core = await import("../../src/core");
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "core-test-"))); // fresh state.json
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    fakes.verses = [fakes.john];
    fakes.stories = [];
    fakes.riddles = [];
    await core.newPuzzle();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.chdir(home);
  });
}
