import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Scripture } from "../src/types";

// No real AI or Google Sheet in tests
const fakes = vi.hoisted(() => {
  const john: Scripture = {
    book: "John", chapter: 3, verseStart: 16, verseEnd: 16, translation: "KJV",
    clue: "For God so loved the world that He gave His only begotten Son",
    text: "For God so loved the world, that he gave his only begotten Son...",
  };
  const psalm: Scripture = {
    book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 1, hint: "herder",
    clue: "The LORD is my shepherd; I shall not want.", text: "The LORD is my shepherd; I shall not want.",
  };
  return { john, psalm, verses: [john] as Scripture[] };
});
vi.mock("../src/sheet", () => ({ loadScriptures: vi.fn(async () => fakes.verses) }));
vi.mock("../src/ai", () => ({
  aiReadGuess: vi.fn(async () => null),
  makeHint: vi.fn(async () => "behest; lifelong"),
  celebrate: vi.fn(async (name: string) => `Haaaa! ${name} is sozzled!`),
}));

import * as core from "../src/core";
import * as ai from "../src/ai";
import * as state from "../src/state";

const MIN = 60_000;
const AMA = "111@c.us";
const KOFI = "222@c.us";
const START = new Date(2026, 2, 4, 7, 0);   // Wednesday 4 March 2026, 7:00 AM local time

let postedAt = 0;
const textOf = (r: core.Reply | null | undefined) => (r && "text" in r ? r.text : "");
const home = process.cwd();

beforeEach(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "core-test-")));  // fresh state.json
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  fakes.verses = [fakes.john];
  await core.newPuzzle();
  postedAt = START.getTime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  process.chdir(home);
});

describe("newPuzzle", () => {
  it("posts the acronym and saves today's verse", async () => {
    const text = await core.newPuzzle();
    expect(text).toContain("*FGSLTWTHGHOBS...*");
    expect(text).not.toContain("Hint:");
    expect(state.load().today).toMatchObject({ book: "John", postedAt });
  });

  it("includes the sheet's hint when there is one", async () => {
    fakes.verses = [fakes.psalm];
    expect(await core.newPuzzle()).toContain("💡 Hint: herder");
  });

  it("doesn't repeat a verse until all have been used", async () => {
    fakes.verses = [fakes.john, fakes.psalm];         // John was already used in beforeEach
    await core.newPuzzle();
    expect(state.load().today?.book).toBe("Psalms");
    await core.newPuzzle();                            // everything used: starts over
    expect(state.load().used).toHaveLength(1);
  });
});

describe("handleMessage", () => {
  it("flags wrong references for a reaction, and ignores chatter", async () => {
    expect(await core.handleMessage(AMA, "Ama", "John 3:17", postedAt + MIN)).toEqual({ kind: "wrong" });
    expect(await core.handleMessage(AMA, "Ama", "good morning family", postedAt + MIN)).toBeNull();
  });

  it("doesn't react to wrong guesses once the day is over", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(await core.handleMessage(KOFI, "Kofi", "John 3:17", postedAt + 2 * MIN)).toBeNull();
  });

  it("stays quiet when no puzzle has been posted", async () => {
    fs.rmSync("state.json");
    expect(await core.handleMessage(AMA, "Ama", "John 3:16")).toBeNull();
  });

  it.each([
    ["reference only", "John 3:16", 6],
    ["decoded only", "For God so loved the world that He gave His only begotten Son", 3],
    ["both", "John 3:16 For God so loved the world that He gave His only begotten Son", 10],
  ])("scores %s", async (_, answer, base) => {
    const reply = await core.handleMessage(AMA, "Ama", answer, postedAt + 10 * MIN);
    expect(reply?.kind).toBe("win");
    expect(state.load().scores[AMA]?.points).toBe(base + 5);
  });

  it.each([
    [29, 5], [30, 5], [31, 3], [120, 3], [121, 1], [240, 1], [241, 0],
  ])("gives the right speed bonus at %i minutes", async (minutes, bonus) => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + minutes * MIN);
    expect(state.load().scores[AMA]?.points).toBe(6 + bonus);
  });

  it("gives no speed bonus once a hint has gone out", async () => {
    await core.hint();
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(state.load().scores[AMA]?.points).toBe(6);
  });

  it("@mentions the winner and shows the verse", async () => {
    const reply = await core.handleMessage(AMA, "Ama", "jn 3 16", postedAt + 90_000);
    expect(reply && "mentions" in reply ? reply.mentions : []).toEqual([AMA]);
    expect(textOf(reply)).toContain("Haaaa! Ama is sozzled!");
    expect(textOf(reply)).toContain("@111 got it first in ⏱️ 2 min");
    expect(textOf(reply)).toContain("John 3:16 (KJV)");
    expect(textOf(reply)).toContain("#1 on the leaderboard");
  });

  it("uses a backup cheer when the AI is down", async () => {
    vi.mocked(ai.celebrate).mockRejectedValueOnce(new Error("down"));
    const reply = await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(textOf(reply)).toMatch(/Eeeeiii|Haaaa|Woooooow/);
  });

  it("asks the AI only when the message might be a reference", async () => {
    await core.handleMessage(AMA, "Ama", "no numbers here", postedAt + MIN);
    await core.handleMessage(AMA, "Ama", "see you at 5pm", postedAt + MIN);
    expect(ai.aiReadGuess).not.toHaveBeenCalled();
    vi.mocked(ai.aiReadGuess).mockResolvedValueOnce({ book: "John", chapter: 3, verse: 16 });
    const reply = await core.handleMessage(AMA, "Ama", "john three sixteen", postedAt + MIN);
    expect(ai.aiReadGuess).toHaveBeenCalledOnce();
    expect(reply?.kind).toBe("win");
  });

  it("gives late correct answers +1 point and tags the winner", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    const late = await core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + 2 * MIN);
    expect(late).toEqual({
      kind: "late",
      text: expect.stringMatching(/Correct, @222! \+1 point.*@111 got it first/),
      mentions: [KOFI, AMA],
    });
    expect(state.load().scores[KOFI]).toMatchObject({ points: 1, weekPoints: 1, wins: 0 });
  });

  it("gives the late point only once per person, and nothing to the winner answering again", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    await core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + 2 * MIN);
    expect(await core.handleMessage(KOFI, "Kofi", "jn 3 16", postedAt + 3 * MIN)).toBeNull();
    expect(await core.handleMessage(AMA, "Ama", "jn 3 16", postedAt + 3 * MIN)).toBeNull();
    expect(state.load().scores[KOFI]?.points).toBe(1);
    expect(state.load().scores[AMA]?.points).toBe(11);
  });

  it("closes the day once the answer is revealed", async () => {
    await core.reveal();
    expect(await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + 15 * 60 * MIN)).toBeNull();
    expect(await core.handleMessage(KOFI, "Kofi", "John 3:17", postedAt + 15 * 60 * MIN)).toBeNull();
    expect(state.load()).toMatchObject({ winner: null, scores: {} });
  });

  it("lets the first message win even if its AI cheer is slow", async () => {
    vi.mocked(ai.celebrate).mockImplementationOnce(
      () => new Promise(r => setTimeout(() => r("slow cheer"), 50)));
    const [first, second] = await Promise.all([
      core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN),
      core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + MIN),
    ]);
    expect(first?.kind).toBe("win");
    expect(second?.kind).toBe("late");
  });
});

describe("taking turns", () => {
  // An answer that needs the AI, which takes a moment to reply
  function slowAiAnswer() {
    let finish!: () => void;
    vi.mocked(ai.aiReadGuess).mockImplementationOnce(() =>
      new Promise(r => { finish = () => r({ book: "John", chapter: 3, verse: 16 }); }));
    const answer = core.handleMessage(AMA, "Ama", "john three sixteen", postedAt + MIN);
    return { answer, finish: () => finish() };
  }

  it("a hint waits for an answer that was already being checked", async () => {
    const { answer, finish } = slowAiAnswer();
    const hint = core.hint();                       // noon arrives while the AI is thinking
    await vi.waitFor(() => expect(ai.aiReadGuess).toHaveBeenCalled());
    finish();
    expect((await answer)?.kind).toBe("win");
    expect(await hint).toBeNull();                  // someone won first, so no hint goes out
    expect(state.load().scores[AMA]?.points).toBe(11);
  });

  it("a new puzzle isn't overwritten by a slow answer to yesterday's", async () => {
    const { answer, finish } = slowAiAnswer();
    fakes.verses = [fakes.psalm];
    const puzzle = core.newPuzzle();                // 7 AM arrives while the AI is thinking
    await vi.waitFor(() => expect(ai.aiReadGuess).toHaveBeenCalled());
    finish();
    await answer;
    await puzzle;
    expect(state.load()).toMatchObject({ today: { book: "Psalms" }, winner: null });
  });
});

describe("hint and reveal", () => {
  it("gives an AI hint first, then the book", async () => {
    expect(await core.hint()).toContain("behest; lifelong");
    expect(await core.hint()).toContain("book of 📘 John");
  });

  it("falls back to the first word when the AI is down", async () => {
    vi.mocked(ai.makeHint).mockRejectedValueOnce(new Error("down"));
    expect(await core.hint()).toContain('the first word is "For"');
  });

  it("says nothing once someone has won", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(await core.hint()).toBeNull();
    expect(await core.reveal()).toBeNull();
  });

  it("reveals the answer when nobody got it", async () => {
    expect(await core.reveal()).toContain("It was 📖 John 3:16 (KJV)");
  });
});

describe("streaks and badges", () => {
  // Posts a new puzzle `days` after START and has `id` answer it
  async function solveOnDay(days: number, id = AMA, name = "Ama", late = false) {
    vi.setSystemTime(START.getTime() + days * 24 * 60 * MIN);
    await core.newPuzzle();
    if (late) await core.handleMessage(KOFI, "Kofi", "John 3:16", Date.now() + MIN);
    return core.handleMessage(id, name, "John 3:16", Date.now() + 2 * MIN);
  }

  it("counts days in a row, from wins and late answers alike", async () => {
    await solveOnDay(0);
    expect(textOf(await solveOnDay(1, AMA, "Ama", true))).toContain("🔥 2-day streak!");
    expect(state.load().scores[AMA]).toMatchObject({ streak: 2, bestStreak: 2 });
  });

  it("starts over after a missed day but remembers the best", async () => {
    await solveOnDay(0);
    await solveOnDay(1);
    await solveOnDay(2);
    await solveOnDay(4);
    expect(state.load().scores[AMA]).toMatchObject({ streak: 1, bestStreak: 3 });
  });

  it("announces new badges once", async () => {
    expect(textOf(await solveOnDay(0))).toContain("🎖️ New badge: 🌱 First Fruits!");
    await solveOnDay(1);
    const third = textOf(await solveOnDay(2));
    expect(third).toContain("🎖️ New badge: 🔥 On Fire!");
    expect(third).not.toContain("First Fruits");
  });

  it("awards Quick Draw for a solve under a minute", async () => {
    const reply = await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + 30_000);
    expect(textOf(reply)).toContain("⚡ Quick Draw");
  });

  it("shows the streak with !streak, and when it has ended", async () => {
    expect(core.streak(AMA).text).toContain("No streak yet");
    await solveOnDay(0);
    await solveOnDay(1);
    expect(core.streak(AMA)).toEqual({ text: expect.stringContaining("@111 is on a 2-day streak! (best: 2)"), mentions: [AMA] });
    vi.setSystemTime(START.getTime() + 3 * 24 * 60 * MIN);
    expect(core.streak(AMA).text).toContain("streak has ended (best: 2)");
  });
});

describe("help", () => {
  it("lists the points and every command", () => {
    const text = core.help();
    expect(text).toContain("+5 within 30 min, +3 within 2 hr, +1 within 4 hr");
    for (const cmd of ["!leaderboard", "!week", "!me", "!streak", "!help"]) expect(text).toContain(cmd);
    expect(text).not.toContain("!new");
  });
});

describe("leaderboards and stats", () => {
  async function win(id: string, name: string, minutes = 1) {
    await core.newPuzzle();
    await core.handleMessage(id, name, "John 3:16", Date.now() + minutes * MIN);
  }

  it("is empty before anyone scores", () => {
    expect(core.leaderboard()).toEqual({ text: expect.stringContaining("No points yet"), mentions: [] });
  });

  it("ranks players with medals and tags them", async () => {
    await win(AMA, "Ama");
    await win(AMA, "Ama");
    await win(KOFI, "Kofi");
    const board = core.leaderboard("season");
    expect(board.mentions).toEqual([AMA, KOFI]);
    expect(board.text).toContain("🥇 @111: 22 pts (🏅 2 wins)");
    expect(board.text).toContain("🥈 @222: 11 pts (🏅 1 wins)");
  });

  it("starts a fresh weekly board on Monday but keeps the season", async () => {
    await win(AMA, "Ama");
    vi.setSystemTime(new Date(2026, 2, 9, 7, 0));    // next Monday
    expect(core.leaderboard("week").mentions).toEqual([]);
    expect(core.leaderboard("season").mentions).toEqual([AMA]);
  });

  it("starts a fresh season in the new year", async () => {
    await win(AMA, "Ama");
    vi.setSystemTime(new Date(2027, 0, 1, 7, 0));
    expect(core.leaderboard("season").mentions).toEqual([]);
    await win(AMA, "Ama");
    expect(state.load().scores[AMA]).toMatchObject({ points: 11, wins: 1, season: 2027 });
  });

  it("shows a player's own stats", async () => {
    await win(AMA, "Ama", 3);
    expect(core.myStats(AMA)).toEqual({
      text: expect.stringMatching(/@111: ⭐ 11 pts, 🏅 1 wins, 🏆 #1 this season[\s\S]*Fastest solve: 3 min[\s\S]*Streak: 1 days \(best 1\)[\s\S]*Badges: 🌱 First Fruits/),
      mentions: [AMA],
    });
    expect(core.myStats(KOFI).mentions).toEqual([]);
  });
});
