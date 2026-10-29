import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Riddle, Scripture, Story } from "../src/types";

// Characterization tests: they record what the game does today, message by message, so a refactor
// that changes any of it shows up as a snapshot diff. They are not a spec. If a change is meant to
// alter behaviour, run `npx vitest run -u test/day.characterization.test.ts` and review the diff.
//
// They call the functions in src/core.ts in the order bot.ts's cron jobs and commands would, because
// bot.ts can't be imported in a test (it starts WhatsApp at once). Not covered here: command routing
// (including the !puzzle alias and admin commands), the @tag bot.ts's replyTo adds, and the
// one-message-a-minute batching of late replies.

// The bot runs on church time (bot.ts sets process.env.TZ), and day keys, week keys and !schedule's
// time zone all depend on it, so pin it before anything reads the clock.
const fakes = vi.hoisted(() => {
  process.env.TZ = "America/New_York";
  // 24 earlier mornings (Psalms 101-124 verse 1) so the Midday Review has old verses to choose from
  const old: Scripture[] = Array.from({ length: 24 }, (_, i) => ({
    book: "Psalms",
    chapter: 101 + i,
    verseStart: 1,
    verseEnd: 1,
    clue: `Old verse number ${101 + i}`,
    text: `Old verse number ${101 + i}.`,
  }));
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
  const riddles: Riddle[] = [
    {
      riddle: "I built a boat on dry land and waited for rain. Who am I?",
      answers: ["noah"],
      reference: "Genesis 6-9",
    },
    { riddle: "My strength was in my hair. Who am I?", answers: ["samson"], reference: "Judges 16" },
  ];
  const stories: Story[] = [
    { story: "Jonah and the big fish", answers: ["jonah"], reference: "Jonah 1-2" },
    { story: "David and Goliath", answers: ["goliath", "david and goliath"], emoji: "🧒🪨🗡️🗿" },
  ];
  // The one free-text Emoji Bible answer the fake AI judge accepts
  const judgedCorrect = "the prophet who ran from Nineveh and ended up inside a whale";
  return { old, john, psalm, riddles, stories, judgedCorrect, verses: [...old, john, psalm] as Scripture[] };
});

vi.mock("../src/sheet", () => ({
  loadScriptures: vi.fn(async () => fakes.verses),
  loadStories: vi.fn(async () => fakes.stories),
  loadRiddles: vi.fn(async () => fakes.riddles),
}));
vi.mock("../src/ai", () => ({
  aiReadGuess: vi.fn(async () => null),
  makeHint: vi.fn(async () => "behest; lifelong"),
  celebrate: vi.fn(async (name: string) => `Haaaa! ${name} has been eating the Word!`),
  makeEmoji: vi.fn(async () => "🐋🙏🌊"),
  judgeStoryGuess: vi.fn(async (text: string) => (text === fakes.judgedCorrect ? "correct" : "not_a_guess")),
  judgeRiddleGuess: vi.fn(async () => "not_a_guess"),
}));

import * as core from "../src/core";
import * as state from "../src/state";

const AMA = "111@c.us";
const KOFI = "222@c.us";
const ESI = "333@c.us";
const YAW = "444@c.us";
const AKUA = "555@c.us";
const NAMES: Record<string, string> = {
  [AMA]: "Ama",
  [KOFI]: "Kofi",
  [ESI]: "Esi",
  [YAW]: "Yaw",
  [AKUA]: "Akua",
};

const SNAPSHOTS = "./__snapshots__/day.characterization";
const home = process.cwd();

beforeEach(() => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "day-test-"))); // fresh state.json and backups/
  fakes.verses = [...fakes.old, fakes.john, fakes.psalm];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(Math, "random").mockReturnValue(0); // pick() always takes the first candidate
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("RIDDLES_CSV_URL", "https://example.test/riddles.csv");
  vi.stubEnv("STORIES_CSV_URL", "https://example.test/stories.csv");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.chdir(home);
});

// ---------- A transcript of everything the game sends back ----------
type Out = string | core.Post | core.Reply | null | undefined | void;

function render(out: Out): string {
  if (out === null || out === undefined) return "(nothing)";
  if (typeof out === "string") return out;
  if ("kind" in out && out.kind === "react") return `[react ${out.emoji}]`;
  const kind = "kind" in out ? `[${out.kind}] ` : "";
  const mentions = out.mentions.length ? `\n(mentions: ${out.mentions.join(", ")})` : "";
  return `${kind}${out.text}${mentions}`;
}

function transcript() {
  const lines: string[] = [];
  const clock = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return {
    // Sets the clock, runs one scheduled job or command, and records what it returned
    async at(date: Date, label: string, run: () => Out | Promise<Out>) {
      vi.setSystemTime(date);
      lines.push(`=== ${clock()} ${label}`, render(await run()), "");
    },
    // A player's message, sent now
    async says(date: Date, id: string, text: string) {
      vi.setSystemTime(date);
      const reply = await core.handleMessage(id, NAMES[id] ?? id, text, date.getTime());
      lines.push(`=== ${clock()} ${NAMES[id]} (${id}): ${JSON.stringify(text)}`, render(reply), "");
    },
    text: () => lines.join("\n"),
  };
}

// Every public command, as the player `id` would send them
async function allCommands(t: ReturnType<typeof transcript>, date: Date, id: string) {
  await t.at(date, "!today", () => core.todayPuzzle());
  await t.at(date, "!schedule", () => core.schedule());
  await t.at(date, `!leaderboard (asked by ${NAMES[id]})`, () => core.leaderboard("season", id));
  await t.at(date, `!week (asked by ${NAMES[id]})`, () => core.leaderboard("week", id));
  await t.at(date, `!me (${NAMES[id]})`, () => core.myStats(id));
  await t.at(date, `!streak (${NAMES[id]})`, () => core.streak(id));
  await t.at(date, "!commands", () => core.commands());
  await t.at(date, "!help", () => core.help());
}

// 24 earlier mornings, so the review has at least 10 verses that are 14+ puzzles old
async function seedEarlierMornings(before: Date) {
  for (let i = 24; i >= 1; i--) {
    vi.setSystemTime(new Date(before.getFullYear(), before.getMonth(), before.getDate() - i, 7, 0));
    await core.newPuzzle();
  }
}

const sat = (h: number, m = 0) => new Date(2026, 3, 11, h, m); // Saturday 11 April 2026 (EDT)
const sun = (h: number, m = 0) => new Date(2026, 3, 12, h, m); // Sunday 12 April 2026 (EDT)

describe("one game weekend, as it plays today", () => {
  it("records every message and the final state.json", async () => {
    await seedEarlierMornings(sat(0));

    // ---------- Saturday: everything gets won ----------
    const t = transcript();
    await t.at(sat(6, 50), "reminder: puzzle", () => core.reminder("puzzle"));
    await t.at(sat(6, 55), "backup", () => core.backupState());
    await t.at(sat(7), "newPuzzle", () => core.newPuzzle());
    await t.says(sat(7, 2), KOFI, "For God so loved the world that he"); // the start of the verse
    await t.says(sat(7, 4), AMA, "John 3:16 For God so loved the world that He gave His only begotten Son");
    await t.says(sat(7, 10), KOFI, "jn 3 16");
    await t.says(sat(7, 12), ESI, "John 3:16");
    await t.says(sat(7, 15), YAW, "john 3:16");
    await t.says(sat(7, 20), AKUA, "John 3:16"); // after all 3 bonus spots
    await t.at(sat(9, 50), "reminder: riddle", () => core.reminder("riddle"));
    await t.at(sat(10), "newRiddle", () => core.newRiddle());
    await t.says(sat(10, 5), ESI, "noah");
    await t.at(sat(12), "closeRiddle", () => core.closeRiddle());
    await t.at(sat(12), "hint (12 PM)", () => core.hint());
    await t.at(sat(13, 50), "reminder: review", () => core.reminder("review"));
    await t.at(sat(14), "newReview", () => core.newReview());
    await t.says(sat(14, 30), YAW, "Psalms 101:1 Old verse number 101");
    await t.at(sat(17), "closeReview", () => core.closeReview());
    await t.at(sat(18), "hint (6 PM, the book)", () => core.hint());
    await t.at(sat(18, 50), "reminder: emoji", () => core.reminder("emoji"));
    await t.at(sat(19), "newEmojiGame", () => core.newEmojiGame());
    await t.says(sat(19, 10), AKUA, fakes.judgedCorrect); // the fake AI judge accepts this one
    await t.at(sat(20), "closeEmojiGame", () => core.closeEmojiGame());
    await t.at(sat(21), "reveal", () => core.reveal());
    await allCommands(t, sat(21, 30), KOFI);
    await expect(t.text()).toMatchFileSnapshot(`${SNAPSHOTS}/saturday.txt`);

    // ---------- Sunday: nobody wins, so every reveal path runs, then the weekly wrap ----------
    const u = transcript();
    await u.at(sun(6, 50), "reminder: puzzle", () => core.reminder("puzzle"));
    await u.at(sun(6, 55), "backup", () => core.backupState());
    await u.at(sun(7), "newPuzzle", () => core.newPuzzle());
    await u.says(sun(8), KOFI, "John 3:17"); // a wrong reference
    await u.says(sun(8, 5), ESI, "good morning family"); // chatter
    await u.at(sun(9, 50), "reminder: riddle", () => core.reminder("riddle"));
    await u.at(sun(10), "newRiddle", () => core.newRiddle());
    await u.at(sun(12), "closeRiddle", () => core.closeRiddle());
    await u.at(sun(12), "hint (12 PM)", () => core.hint());
    await u.at(sun(13, 50), "reminder: review", () => core.reminder("review"));
    await u.at(sun(14), "newReview", () => core.newReview());
    await u.at(sun(17), "closeReview", () => core.closeReview());
    await u.at(sun(18), "hint (6 PM, the book)", () => core.hint());
    await u.at(sun(18, 50), "reminder: emoji", () => core.reminder("emoji"));
    await u.at(sun(19), "newEmojiGame", () => core.newEmojiGame());
    await u.at(sun(20), "closeEmojiGame", () => core.closeEmojiGame());
    // bot.ts posts this with the intro "That's a wrap on the week! Final standings:", which lives in bot.ts
    await u.at(sun(20, 5), "weekly wrap (leaderboard: week)", () => core.leaderboard("week"));
    await u.at(sun(21), "reveal", () => core.reveal());
    await allCommands(u, sun(21, 30), KOFI);
    await expect(u.text()).toMatchFileSnapshot(`${SNAPSHOTS}/sunday.txt`);

    await expect(JSON.stringify(state.load(), null, 2) + "\n").toMatchFileSnapshot(
      `${SNAPSHOTS}/state-final.json`
    );
    expect(fs.readdirSync("backups").sort()).toEqual(["state-2026-04-11.json", "state-2026-04-12.json"]);
  });
});

describe("hint after the reveal", () => {
  // Characterizes current behaviour: hint() checks for a winner but ignores `revealed`, so an admin
  // !grouphint after the 9 PM reveal still posts a hint and counts it. Step 4:8 will change this
  // (no hints once the answer is out); update this test then.
  it("still posts a hint once the answer has been revealed", async () => {
    vi.setSystemTime(sat(7));
    await core.newPuzzle();
    vi.setSystemTime(sat(21));
    expect(await core.reveal()).toContain("Nobody got it today!");

    const hint = await core.hint();
    expect(hint).toBe("💡 *Extra hint* _(no more ⚡ speed bonus today)_: behest; lifelong");
    expect(state.load()).toMatchObject({
      revealed: true,
      hintsGiven: 1,
      hints: ["💡 *Extra hint:* behest; lifelong"],
    });
  });
});

describe("across the end of daylight saving time", () => {
  // America/New_York falls back from EDT to EST at 2 AM on Sunday 1 November 2026, so Saturday's
  // 7 AM puzzle and Sunday's are 25 hours apart.
  it("records week keys and streaks for a Saturday and Sunday across the change", async () => {
    const satOct31 = (h: number, m = 0) => new Date(2026, 9, 31, h, m);
    const sunNov1 = (h: number, m = 0) => new Date(2026, 10, 1, h, m);
    fakes.verses = [fakes.john, fakes.psalm]; // Saturday is John 3:16, Sunday Psalm 23:1
    const days: Record<string, unknown>[] = [];
    const record = (label: string) => {
      const s = state.load();
      days.push({
        label,
        puzzlePostedAt: s.today ? new Date(s.today.postedAt).toISOString() : null,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
        players: Object.fromEntries(
          Object.entries(s.scores).map(([id, p]) => [
            NAMES[id],
            {
              week: p.week,
              weekPoints: p.weekPoints,
              streak: p.streak,
              bestStreak: p.bestStreak,
              lastSolvedDay: p.lastSolvedDay,
            },
          ])
        ),
        weekLeaderboard: core.leaderboard("week").text,
        amaStreak: core.streak(AMA).text,
      });
    };

    vi.setSystemTime(satOct31(7));
    await core.newPuzzle();
    await core.handleMessage(AMA, "Ama", "John 3:16", satOct31(7, 5).getTime());
    vi.setSystemTime(satOct31(21));
    record("Saturday 31 October, 9 PM (EDT)");

    vi.setSystemTime(sunNov1(7));
    await core.newPuzzle();
    await core.handleMessage(AMA, "Ama", "Psalms 23:1", sunNov1(7, 5).getTime());
    await core.handleMessage(KOFI, "Kofi", "Psalms 23:1", sunNov1(7, 6).getTime());
    vi.setSystemTime(sunNov1(21));
    record("Sunday 1 November, 9 PM (EST)");

    await expect(JSON.stringify(days, null, 2) + "\n").toMatchFileSnapshot(`${SNAPSHOTS}/dst.json`);
  });
});
