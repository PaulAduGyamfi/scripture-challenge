import { describe, it, expect, vi } from "vitest";

vi.mock("../src/sheet", () => import("./helpers/core-setup").then(f => f.sheetMock));
vi.mock("../src/ai", () => import("./helpers/core-setup").then(f => f.aiMock));

import * as core from "../src/core";
import * as state from "../src/state";
import {
  MIN,
  AMA,
  KOFI,
  ESI,
  YAW,
  AKUA,
  START,
  postedAt,
  textOf,
  freshGameEachTest,
} from "./helpers/core-setup";

// Streaks, badges, leaderboards, !me, and the help, commands and schedule replies
freshGameEachTest();

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
    expect(textOf(await solveOnDay(1, AMA, "Ama", true))).toContain("🔥 *2-day streak!*");
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
    expect(textOf(await solveOnDay(0))).toContain("🎖️ New badge: *🌱 First Fruits*");
    await solveOnDay(1);
    const third = textOf(await solveOnDay(2));
    expect(third).toContain("🎖️ New badge: *🔥 On Fire*");
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
    for (const [id, name] of [
      [KOFI, "Kofi"],
      [ESI, "Esi"],
      [YAW, "Yaw"],
      [AKUA, "Akua"],
    ] as const) {
      await core.handleMessage(id, name, "John 3:16", Date.now() + MIN);
    }
    const reply = await core.handleMessage(AMA, "Ama", "John 3:16", Date.now() + 2 * MIN);
    expect(textOf(reply)).toContain("All 3 bonus spots are taken today");
    expect(textOf(reply)).toContain("🔥 *2-day streak!*");
    expect(state.load().scores[AMA]).toMatchObject({ streak: 2, bestStreak: 2 });
  });

  it("shows the streak with !streak, and when it has ended", async () => {
    expect(core.streak(AMA).text).toContain("No streak yet");
    await solveOnDay(0);
    await solveOnDay(1);
    expect(core.streak(AMA)).toEqual({
      text: expect.stringContaining("@111 is on a 2-day streak! (best: 2)"),
      mentions: [AMA],
    });
    vi.setSystemTime(START.getTime() + 3 * 24 * 60 * MIN);
    await core.newPuzzle();
    expect(core.streak(AMA).text).toContain("streak has ended (best: 2)");
  });

  it("doesn't claim a streak until today's puzzle is solved", async () => {
    await solveOnDay(0);
    await solveOnDay(1);
    vi.setSystemTime(START.getTime() + 2 * 24 * 60 * MIN);
    await core.newPuzzle(); // day 3's puzzle, not answered yet
    expect(core.streak(AMA).text).toContain("@111, your 2-day streak is on the line!");
    expect(core.streak(AMA).text).not.toContain("is on a");
    expect(core.myStats(AMA).text).toContain("Streak: *0 days* (best 2)");
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
    expect(core.replyTo(AMA, { text: "🥇 @222: 11 pts", mentions: [KOFI] })).toEqual({
      text: "@111 🥇 @222: 11 pts",
      mentions: [AMA, KOFI],
    });
  });

  it("doesn't tag twice when the reply already tags them", () => {
    const stats = { text: "📊 @111: ⭐ 11 pts", mentions: [AMA] };
    expect(core.replyTo(AMA, stats)).toEqual(stats);
  });
});

describe("help and commands", () => {
  const PLAYER_COMMANDS = [
    "!today",
    "!schedule",
    "!leaderboard",
    "!week",
    "!me",
    "!streak",
    "!commands",
    "!help",
  ];

  it("!help lists the points and every other command", () => {
    const text = core.help();
    expect(text).toContain("Up to *+5* for speed");
    for (const cmd of PLAYER_COMMANDS.filter(c => c !== "!help")) expect(text).toContain(cmd);
    expect(text).not.toContain("!new");
  });

  it("!help only lists the extra games that are switched on", () => {
    vi.stubEnv("RIDDLES_CSV_URL", "");
    vi.stubEnv("STORIES_CSV_URL", "");
    expect(core.help()).not.toMatch(/Bible Riddle|Emoji Bible/);
    vi.stubEnv("RIDDLES_CSV_URL", "https://example.test/riddles.csv");
    vi.stubEnv("STORIES_CSV_URL", "https://example.test/stories.csv");
    expect(core.help()).toContain("- 🧩 10 AM Bible Riddle: *3 pts*");
    expect(core.help()).toContain("- 😀 7 PM Emoji Bible: *2 pts*");
    vi.unstubAllEnvs();
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
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN); // just to learn this week's key
    const s = state.load();
    const week = s.scores[AMA]?.week ?? "";
    delete s.scores[AMA];
    for (let n = 1; n <= 20; n++) {
      s.scores[`${n}@c.us`] = {
        name: `P${n}`,
        points: 210 - n * 10,
        wins: 1,
        fastestMin: 5,
        season: 2026,
        week,
        weekPoints: 210 - n * 10,
        streak: 0,
        bestStreak: 0,
        lastSolvedDay: null,
        emojiWins: 0,
        riddleWins: 0,
      };
    }
    state.save(s);
  }

  it("shows the top 10, then 5 honourable mentions, and no more", async () => {
    await crowd();
    const board = core.leaderboard("season");
    expect(board.text).toContain("🥇 @1  *200 pts*");
    expect(board.text).toContain("10. @10  *110 pts*");
    expect(board.text).toContain("🎖️ *Honourable mentions*\n11. @11  *100 pts*");
    expect(board.text).toContain("15. @15  *60 pts*");
    expect(board.text).not.toContain("@16");
    expect(board.mentions).toHaveLength(15);
  });

  it("tells someone further down where they stand", async () => {
    await crowd();
    expect(core.leaderboard("week", "18@c.us").text).toContain("📍 You're #18 with *30 pts*");
    expect(core.leaderboard("week", "3@c.us").text).not.toContain("📍"); // already on the board
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
    expect(board.text).toContain("🥇 @111  *22 pts* · 2 wins");
    expect(board.text).toContain("🥈 @222  *11 pts* · 1 win");
  });

  it("starts a fresh weekly board on Monday but keeps the season", async () => {
    await win(AMA, "Ama");
    vi.setSystemTime(new Date(2026, 2, 9, 7, 0)); // next Monday
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
      text: expect.stringMatching(
        /@111 · \*#1 this season\*\n⭐ \*11 points\* · 🏅 1 win[\s\S]*Fastest solve: 3 min[\s\S]*Streak: \*1 day\* \(best 1\)[\s\S]*Badges:\* 🌱 First Fruits/
      ),
      mentions: [AMA],
    });
    expect(core.myStats(KOFI)).toEqual({
      text: expect.stringContaining("@222, no points yet"),
      mentions: [KOFI],
    });
  });
});

describe("!schedule", () => {
  it.each([
    ["0 7 * * *", "7 AM"],
    ["0 12 * * *", "12 PM"],
    ["0 14 * * *", "2 PM"],
    ["5 20 * * 0", "8:05 PM"],
    ["55 6 * * *", "6:55 AM"],
    ["0 0 * * *", "12 AM"],
  ])("reads %j as %s", (cron, time) => expect(core.timeOf(cron)).toBe(time));

  it("lists the day in order, with the closing times", () => {
    const text = core.schedule();
    const order = [
      "Morning puzzle",
      "Extra hint",
      "Midday Review, until 5 PM",
      "Last hint",
      "The answer",
      "Weekly standings",
    ];
    const positions = order.map(o => text.indexOf(o));
    expect(positions.every(p => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain("☀️ *7 AM*: Morning puzzle");
    expect(text).toContain("📅 *Sundays 8:05 PM*");
  });

  it("marks the Midday Review as coming soon until there are enough old verses", () => {
    expect(core.schedule()).toContain("_(starting soon)_");
    const s = state.load();
    s.history = Array.from({ length: 30 }, (_, i) => `Psalms ${i + 1}:1`);
    state.save(s);
    expect(core.schedule()).not.toContain("starting soon");
  });

  it("only lists Emoji Bible when there's a Stories tab", () => {
    vi.stubEnv("STORIES_CSV_URL", "");
    expect(core.schedule()).not.toContain("Emoji Bible");
    vi.stubEnv("STORIES_CSV_URL", "https://example.test/stories.csv");
    expect(core.schedule()).toContain("😀 *7 PM*: Emoji Bible, until 8 PM");
    vi.unstubAllEnvs();
  });

  it("posts a reminder 10 minutes before the puzzle, the review and Emoji Bible", () => {
    expect(core.SCHEDULE.puzzleSoon).toBe("50 6 * * *");
    expect(core.SCHEDULE.reviewSoon).toBe("50 13 * * *");
    expect(core.SCHEDULE.emojiSoon).toBe("50 18 * * *");
    expect(core.reminder("puzzle")).toContain("7 AM, in 10 minutes");
  });

  it("skips the review reminder while the Midday Review is still starting soon", () => {
    expect(core.reminder("review")).toBeNull();
    const s = state.load();
    s.history = Array.from({ length: 30 }, (_, i) => `Psalms ${i + 1}:1`);
    state.save(s);
    expect(core.reminder("review")).toContain("Midday Review* starts at 2 PM");
  });

  it("skips the Emoji Bible reminder when there's no Stories tab", () => {
    vi.stubEnv("STORIES_CSV_URL", "");
    expect(core.reminder("emoji")).toBeNull();
    vi.stubEnv("STORIES_CSV_URL", "https://example.test/stories.csv");
    expect(core.reminder("emoji")).toContain("Emoji Bible* starts at 7 PM");
    vi.unstubAllEnvs();
  });

  it("uses the same times in !help", () => {
    expect(core.help()).toContain("Hints at 12 PM and 6 PM · answer at 9 PM");
  });
});
