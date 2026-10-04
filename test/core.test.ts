import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Scripture, Story } from "../src/types";

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
  // 30 past verses (Psalms 101-130 verse 1) for the Midday Review
  const old: Scripture[] = Array.from({ length: 30 }, (_, i) => ({
    book: "Psalms", chapter: 101 + i, verseStart: 1, verseEnd: 1,
    clue: `Old verse number ${101 + i}`, text: `Old verse number ${101 + i}.`,
  }));
  const jonah: Story = { story: "Jonah and the big fish", answers: ["jonah"], reference: "Jonah 1-2" };
  const goliath: Story = { story: "David and Goliath", answers: ["goliath", "david and goliath"], emoji: "🧒🪨🗡️🗿" };
  return { john, psalm, old, jonah, goliath, verses: [john] as Scripture[], stories: [] as Story[] };
});
vi.mock("../src/sheet", () => ({
  loadScriptures: vi.fn(async () => fakes.verses),
  loadStories: vi.fn(async () => fakes.stories),
}));
vi.mock("../src/ai", () => ({
  aiReadGuess: vi.fn(async () => null),
  makeHint: vi.fn(async () => "behest; lifelong"),
  celebrate: vi.fn(async (name: string) => `Haaaa! ${name} is sozzled!`),
  makeEmoji: vi.fn(async () => "🐋🙏🌊"),
}));

import * as core from "../src/core";
import * as ai from "../src/ai";
import * as state from "../src/state";

const MIN = 60_000;
const AMA = "111@c.us";
const KOFI = "222@c.us";
const ESI = "333@c.us";
const YAW = "444@c.us";
const AKUA = "555@c.us";
const START = new Date(2026, 2, 4, 7, 0);   // Wednesday 4 March 2026, 7:00 AM local time

let postedAt = 0;
const textOf = (r: core.Reply | null | undefined) => (r && "text" in r ? r.text : "");
const home = process.cwd();

beforeEach(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "core-test-")));  // fresh state.json
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  fakes.verses = [fakes.john];
  fakes.stories = [];
  await core.newPuzzle();
  postedAt = START.getTime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  process.chdir(home);
});

describe("newPuzzle", () => {
  it("keeps a history of every morning verse, even after a reset", async () => {
    fakes.verses = [fakes.john, fakes.psalm];
    await core.newPuzzle();
    await core.newPuzzle();                            // all used: the used list starts over
    expect(state.load().history).toEqual(["John 3:16", "Psalms 23:1", expect.any(String)]);
  });

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
    expect(await core.handleMessage(AMA, "Ama", "John 3:17", postedAt + MIN)).toEqual({ kind: "react", emoji: "🤔" });
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

describe("bonus spots after the winner", () => {
  const answer = (id: string, name: string) => core.handleMessage(id, name, "John 3:16", postedAt + 5 * MIN);

  it("gives +1 to the next 3 correct answers only", async () => {
    await answer(AMA, "Ama");
    expect(textOf(await answer(KOFI, "Kofi"))).toContain("+1 point (bonus spot 1 of 3)");
    await answer(ESI, "Esi");
    expect(textOf(await answer(YAW, "Yaw"))).toContain("bonus spot 3 of 3");

    const fourth = await answer(AKUA, "Akua");
    expect(textOf(fourth)).toContain("All 3 bonus spots are taken today");
    expect(textOf(fourth)).not.toContain("+1");

    const scores = state.load().scores;
    expect([KOFI, ESI, YAW].map(id => scores[id]?.points)).toEqual([1, 1, 1]);
    expect(scores[AKUA]).toMatchObject({ points: 0, streak: 1 });   // no points, but it counts for the streak
  });

  it("answers each late person only once", async () => {
    await answer(AMA, "Ama");
    for (const [id, name] of [[KOFI, "Kofi"], [ESI, "Esi"], [YAW, "Yaw"], [AKUA, "Akua"]] as const) await answer(id, name);
    expect(await answer(AKUA, "Akua")).toBeNull();
    expect(await answer(KOFI, "Kofi")).toBeNull();
  });
});

describe("!today", () => {
  it("says when there's no puzzle yet", () => {
    fs.rmSync("state.json");
    expect(core.todayPuzzle().text).toContain("No puzzle yet");
  });

  it("shows the puzzle and every hint so far while it's open", async () => {
    fakes.verses = [fakes.psalm];
    await core.newPuzzle();
    await core.hint();
    expect(core.todayPuzzle()).toEqual({
      text: "📜 Today's scripture: *TLIMS; ISNW*\n💡 Hint: herder\n💡 Extra hint: behest; lifelong\n\n" +
        "⏳ Nobody has got it yet. First correct answer wins! 🏆",
      mentions: [],
    });
  });

  it("tags who solved it, without giving away the answer, and counts the spots left", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + 3 * MIN);
    await core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + 4 * MIN);
    const today = core.todayPuzzle();
    expect(today.mentions).toEqual([AMA]);
    expect(today.text).toContain("✅ Solved by @111 in ⏱️ 3 min!");
    expect(today.text).toContain("2 of 3 bonus spots left");
    expect(today.text).not.toContain("John 3:16");
  });

  it("says when every bonus spot is taken", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    for (const id of [KOFI, ESI, YAW]) await core.handleMessage(id, "x", "John 3:16", postedAt + 2 * MIN);
    expect(core.todayPuzzle().text).toContain("All 3 bonus spots are taken");
  });

  it("shows the answer once it has been revealed", async () => {
    await core.reveal();
    expect(core.todayPuzzle().text).toContain("Nobody got it. It was 📖 John 3:16 (KJV)");
  });
});

describe("hint and reveal", () => {
  it("gives an AI hint first, then the book", async () => {
    expect(await core.hint()).toBe("💡 Extra hint (no more ⚡ speed bonus today): behest; lifelong");
    expect(await core.hint()).toContain("book of 📘 John");
  });

  it("remembers each hint for !today", async () => {
    await core.hint();
    await core.hint();
    expect(state.load().hints).toEqual(["💡 Extra hint: behest; lifelong", "🔦 Last hint: it's in the book of 📘 John!"]);
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

  it("counts answers after the bonus spots are taken", async () => {
    await solveOnDay(0);
    vi.setSystemTime(START.getTime() + 24 * 60 * MIN);
    await core.newPuzzle();
    for (const [id, name] of [[KOFI, "Kofi"], [ESI, "Esi"], [YAW, "Yaw"], [AKUA, "Akua"]] as const) {
      await core.handleMessage(id, name, "John 3:16", Date.now() + MIN);
    }
    const reply = await core.handleMessage(AMA, "Ama", "John 3:16", Date.now() + 2 * MIN);
    expect(textOf(reply)).toContain("All 3 bonus spots are taken today");
    expect(textOf(reply)).toContain("🔥 2-day streak!");
    expect(state.load().scores[AMA]).toMatchObject({ streak: 2, bestStreak: 2 });
  });

  it("shows the streak with !streak, and when it has ended", async () => {
    expect(core.streak(AMA).text).toContain("No streak yet");
    await solveOnDay(0);
    await solveOnDay(1);
    expect(core.streak(AMA)).toEqual({ text: expect.stringContaining("@111 is on a 2-day streak! (best: 2)"), mentions: [AMA] });
    vi.setSystemTime(START.getTime() + 3 * 24 * 60 * MIN);
    await core.newPuzzle();
    expect(core.streak(AMA).text).toContain("streak has ended (best: 2)");
  });

  it("doesn't claim a streak until today's puzzle is solved", async () => {
    await solveOnDay(0);
    await solveOnDay(1);
    vi.setSystemTime(START.getTime() + 2 * 24 * 60 * MIN);
    await core.newPuzzle();                            // day 3's puzzle, not answered yet
    expect(core.streak(AMA).text).toContain("@111, your 2-day streak is on the line!");
    expect(core.streak(AMA).text).not.toContain("is on a");
    expect(core.myStats(AMA).text).toContain("Streak: 0 days (best 2)");
    expect(core.myStats(AMA).text).toContain("Your 2-day streak is on the line");
    await core.handleMessage(AMA, "Ama", "John 3:16", Date.now() + MIN);
    expect(core.streak(AMA).text).toContain("is on a 3-day streak!");
  });
});

describe("replyTo", () => {
  it("tags the person being answered", () => {
    expect(core.replyTo(AMA, "📋 *Commands*")).toEqual({ text: "@111 📋 *Commands*", mentions: [AMA] });
  });

  it("keeps the other people a reply already tags", () => {
    expect(core.replyTo(AMA, { text: "🥇 @222: 11 pts", mentions: [KOFI] }))
      .toEqual({ text: "@111 🥇 @222: 11 pts", mentions: [AMA, KOFI] });
  });

  it("doesn't tag twice when the reply already tags them", () => {
    const stats = { text: "📊 @111: ⭐ 11 pts", mentions: [AMA] };
    expect(core.replyTo(AMA, stats)).toEqual(stats);
  });
});

describe("help and commands", () => {
  const PLAYER_COMMANDS = ["!today", "!leaderboard", "!week", "!me", "!streak", "!commands", "!help"];

  it("!help lists the points and every command", () => {
    const text = core.help();
    expect(text).toContain("+5 within 30 min, +3 within 2 hr, +1 within 4 hr");
    for (const cmd of PLAYER_COMMANDS) expect(text).toContain(cmd);
    expect(text).not.toContain("!new");
  });

  it("!commands lists just the commands", () => {
    const text = core.commands();
    expect(text.startsWith("📋 *Commands*")).toBe(true);
    for (const cmd of PLAYER_COMMANDS) expect(text).toContain(cmd);
    expect(text).not.toContain("Points");
    expect(text).not.toContain("!new");
  });
});

describe("big leaderboards", () => {
  // 20 players: "1@c.us" has 200 pts, "2@c.us" 190 ... "20@c.us" 10
  async function crowd() {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);   // just to learn this week's key
    const s = state.load();
    const week = s.scores[AMA]?.week ?? "";
    delete s.scores[AMA];
    for (let n = 1; n <= 20; n++) {
      s.scores[`${n}@c.us`] = {
        name: `P${n}`, points: 210 - n * 10, wins: 1, fastestMin: 5, season: 2026, week,
        weekPoints: 210 - n * 10, streak: 0, bestStreak: 0, lastSolvedDay: null, emojiWins: 0,
      };
    }
    state.save(s);
  }

  it("shows the top 10, then 5 honourable mentions, and no more", async () => {
    await crowd();
    const board = core.leaderboard("season");
    expect(board.text).toContain("🥇 @1: 200 pts");
    expect(board.text).toContain("10. @10: 110 pts");
    expect(board.text).toContain("🎖️ *Honourable mentions*\n11. @11: 100 pts");
    expect(board.text).toContain("15. @15: 60 pts");
    expect(board.text).not.toContain("@16");
    expect(board.mentions).toHaveLength(15);
  });

  it("tells someone further down where they stand", async () => {
    await crowd();
    expect(core.leaderboard("week", "18@c.us").text).toContain("📍 You're #18 with 30 pts");
    expect(core.leaderboard("week", "3@c.us").text).not.toContain("📍");    // already on the board
  });

  it("leaves out the honourable mentions when there aren't enough players", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(core.leaderboard().text).not.toContain("Honourable");
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
    expect(core.myStats(KOFI)).toEqual({ text: expect.stringContaining("@222, no points yet"), mentions: [KOFI] });
  });
});

describe("Midday Review", () => {
  const TWO_PM = START.getTime() + 7 * 60 * MIN;

  // As if the 30 old psalms were earlier mornings, followed by today's John 3:16
  function withHistory(count = 30) {
    fakes.verses = [fakes.john, ...fakes.old];
    const s = state.load();
    s.history = [...fakes.old.slice(0, count).map(v => `Psalms ${v.chapter}:1`), "John 3:16"];
    state.save(s);
    vi.setSystemTime(TWO_PM);
  }
  const reviewRef = () => {
    const v = state.load().review?.verse;
    return v ? `${v.book} ${v.chapter}:${v.verseStart}` : "";
  };

  it("waits until there are enough old verses", async () => {
    withHistory(22);                                   // 22 + today - 14 recent = 9 old: not enough
    expect(await core.newReview()).toBeNull();
    expect(state.load().review).toBeNull();
  });

  it("posts a verse from 2+ weeks ago, clearly labelled", async () => {
    withHistory();
    const text = await core.newReview();
    expect(text).toContain("🔁 *Midday Review*");
    expect(text).toContain("Closes at 5 PM");
    expect(text).toContain("This morning's puzzle is still open too");
    const chapter = state.load().review?.verse.chapter ?? 0;
    expect(chapter).toBeGreaterThanOrEqual(101);
    expect(chapter).toBeLessThanOrEqual(117);         // not one of the 14 most recent (118-130)
  });

  it("doesn't repeat a review verse until all have had a turn", async () => {
    withHistory();
    const seen = new Set<string>();
    for (let i = 0; i < 17; i++) { await core.newReview(); seen.add(reviewRef()); }
    expect(seen.size).toBe(17);
    await core.newReview();                            // all 17 used: starts over
    expect(state.load().reviewed).toHaveLength(1);
  });

  it("gives the first correct answer the smaller review points, without counting a win", async () => {
    withHistory();
    await core.newReview();
    const reply = await core.handleMessage(AMA, "Ama", reviewRef(), TWO_PM + 4 * MIN);
    expect(reply?.kind).toBe("win");
    expect(textOf(reply)).toContain("@111 won the *Midday Review* in ⏱️ 4 min");
    expect(textOf(reply)).toContain("Reference: ✨ 3 points ✨");
    expect(textOf(reply)).toContain("This morning's puzzle is still open");
    expect(state.load().scores[AMA]).toMatchObject({ points: 3, wins: 0, streak: 0 });
    expect(state.load().review).toMatchObject({ closed: true, winner: { id: AMA } });
  });

  it("just reacts 👏 to correct review answers after the winner", async () => {
    withHistory();
    await core.newReview();
    await core.handleMessage(AMA, "Ama", reviewRef(), TWO_PM + MIN);
    expect(await core.handleMessage(KOFI, "Kofi", reviewRef(), TWO_PM + 2 * MIN)).toEqual({ kind: "react", emoji: "👏" });
    expect(state.load().scores[KOFI]).toBeUndefined();
  });

  it("still sends morning answers to the morning puzzle", async () => {
    withHistory();
    await core.newReview();
    const reply = await core.handleMessage(AMA, "Ama", "John 3:16", TWO_PM);
    expect(textOf(reply)).toContain("got it first");
    expect(state.load().review?.closed).toBe(false);
  });

  it("reacts 🤔 to a wrong reference while only the review is open", async () => {
    await core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + MIN);   // morning solved
    withHistory();
    await core.newReview();
    expect(await core.handleMessage(AMA, "Ama", "Psalms 150:1", TWO_PM + MIN)).toEqual({ kind: "react", emoji: "🤔" });
  });

  it("reveals the answer at 5 PM if nobody got it, then ignores answers", async () => {
    withHistory();
    await core.newReview();
    const ref = reviewRef();
    expect(await core.closeReview()).toContain(`Nobody got it 😮 It was 📖 ${ref}`);
    expect(await core.closeReview()).toBeNull();
    expect(await core.handleMessage(AMA, "Ama", ref, TWO_PM + 4 * 60 * MIN)).toBeNull();
  });

  it("closes quietly at 5 PM if someone already won", async () => {
    withHistory();
    await core.newReview();
    await core.handleMessage(AMA, "Ama", reviewRef(), TWO_PM + MIN);
    expect(await core.closeReview()).toBeNull();
  });

  it("shows up in !today, after the morning puzzle", async () => {
    withHistory();
    await core.newReview();
    const open = core.todayPuzzle().text;
    expect(open.indexOf("Today's scripture")).toBeLessThan(open.indexOf("Midday Review"));
    expect(open).toContain("⏳ Open until 5 PM");
    await core.handleMessage(AMA, "Ama", reviewRef(), TWO_PM + MIN);
    expect(core.todayPuzzle()).toMatchObject({ text: expect.stringContaining("✅ Won by @111"), mentions: [AMA] });
  });

  it("is closed by the next morning's puzzle if 5 PM was missed", async () => {
    withHistory();
    await core.newReview();
    await core.newPuzzle();
    expect(state.load().review?.closed).toBe(true);
  });
});

describe("Emoji Bible", () => {
  const SEVEN_PM = START.getTime() + 12 * 60 * MIN;
  async function postGame(stories: Story[] = [fakes.jonah]) {
    fakes.stories = stories;
    vi.setSystemTime(SEVEN_PM);
    return core.newEmojiGame();
  }

  it("does nothing without a Stories tab", async () => {
    expect(await postGame([])).toBeNull();
    expect(state.load().emojiGame).toBeNull();
  });

  it("posts the AI's emoji when the sheet has none", async () => {
    const text = await postGame([fakes.jonah]);
    expect(text).toContain("😀 *Emoji Bible*");
    expect(text).toContain("🐋🙏🌊");
    expect(text).toContain("Closes at 8 PM");
    expect(text).not.toContain("Jonah");                 // never gives the answer away
    expect(ai.makeEmoji).toHaveBeenCalledWith("Jonah and the big fish");
  });

  it("uses your own emoji from the sheet without asking the AI", async () => {
    expect(await postGame([fakes.goliath])).toContain("🧒🪨🗡️🗿");
    expect(ai.makeEmoji).not.toHaveBeenCalled();
  });

  it("gives the first person to name the story 2 points", async () => {
    await postGame();
    const reply = await core.handleMessage(AMA, "Ama", "is it jonah??", SEVEN_PM + 3 * MIN);
    expect(reply).toMatchObject({ kind: "win", mentions: [AMA] });
    expect(textOf(reply)).toContain("@111 got it in ⏱️ 3 min!");
    expect(textOf(reply)).toContain("It's *Jonah and the big fish* (📖 Jonah 1-2)");
    expect(state.load().scores[AMA]).toMatchObject({ points: 2, emojiWins: 1, wins: 0 });
  });

  it("accepts any listed answer, with a typo", async () => {
    await postGame([fakes.goliath]);
    expect((await core.handleMessage(AMA, "Ama", "Golaith!", SEVEN_PM + MIN))?.kind).toBe("win");
  });

  it("claps for late right answers and ignores wrong ones", async () => {
    await postGame();
    await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + MIN);
    expect(await core.handleMessage(KOFI, "Kofi", "Jonah", SEVEN_PM + 2 * MIN)).toEqual({ kind: "react", emoji: "👏" });
    expect(await core.handleMessage(ESI, "Esi", "moses?", SEVEN_PM + 2 * MIN)).toBeNull();
    expect(state.load().scores[KOFI]).toBeUndefined();
  });

  it("still sends morning answers to the morning puzzle", async () => {
    await postGame();
    expect(textOf(await core.handleMessage(AMA, "Ama", "John 3:16", SEVEN_PM))).toContain("got it first");
    expect(state.load().emojiGame?.closed).toBe(false);
  });

  it("reveals the story at 8 PM if nobody got it, then ignores answers", async () => {
    await postGame();
    expect(await core.closeEmojiGame()).toContain("🐋🙏🌊 was *Jonah and the big fish* (📖 Jonah 1-2)");
    expect(await core.closeEmojiGame()).toBeNull();
    expect(await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + 70 * MIN)).toBeNull();
  });

  it("doesn't repeat a story until every story has been used", async () => {
    const titles = new Set<string>();
    for (let i = 0; i < 2; i++) { await postGame([fakes.jonah, fakes.goliath]); titles.add(state.load().emojiGame?.story ?? ""); }
    expect(titles.size).toBe(2);
    await postGame([fakes.jonah, fakes.goliath]);       // both used: starts over
    expect(state.load().storiesUsed).toHaveLength(1);
  });

  it("shows in !today", async () => {
    await postGame();
    expect(core.todayPuzzle().text).toContain("😀 *Emoji Bible*: 🐋🙏🌊\n⏳ Open until 8 PM");
    await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + MIN);
    expect(core.todayPuzzle().text).toContain("✅ Won by @111: it was *Jonah and the big fish*");
  });

  it("awards Emoji Master after 10 wins", async () => {
    const s = state.load();
    s.scores[AMA] = {
      name: "Ama", points: 18, wins: 0, fastestMin: null, season: 2026, week: "x", weekPoints: 0,
      streak: 0, bestStreak: 0, lastSolvedDay: null, emojiWins: 9,
    };
    state.save(s);
    await postGame();
    expect(textOf(await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + MIN))).toContain("🎖️ New badge: 😀 Emoji Master!");
  });
});
