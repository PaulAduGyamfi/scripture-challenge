import fs from "node:fs";
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/sheet", () => import("./helpers/core-setup").then(f => f.sheetMock));
vi.mock("../src/ai", () => import("./helpers/core-setup").then(f => f.aiMock));

import * as core from "../src/core";
import * as ai from "../src/ai";
import * as state from "../src/state";
import {
  fakes,
  MIN,
  AMA,
  KOFI,
  ESI,
  YAW,
  AKUA,
  postedAt,
  textOf,
  freshGameEachTest,
} from "./helpers/core-setup";

// The morning puzzle: posting it, answers, the winner, bonus spots, !today, hints and the reveal
freshGameEachTest();

describe("newPuzzle", () => {
  it("keeps a history of every morning verse, even after a reset", async () => {
    fakes.verses = [fakes.john, fakes.psalm];
    await core.newPuzzle();
    await core.newPuzzle(); // all used: the used list starts over
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
    expect(await core.newPuzzle()).toContain("💡 *Hint:* herder");
  });

  it("doesn't repeat a verse until all have been used", async () => {
    fakes.verses = [fakes.john, fakes.psalm]; // John was already used in beforeEach
    await core.newPuzzle();
    expect(state.load().today?.book).toBe("Psalms");
    await core.newPuzzle(); // everything used: starts over
    expect(state.load().used).toHaveLength(1);
  });
});

describe("handleMessage", () => {
  it("flags wrong references for a reaction, and ignores chatter", async () => {
    expect(await core.handleMessage(AMA, "Ama", "John 3:17", postedAt + MIN)).toEqual({
      kind: "react",
      emoji: "🤔",
    });
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
    [29, 5],
    [30, 5],
    [31, 3],
    [120, 3],
    [121, 1],
    [240, 1],
    [241, 0],
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
    expect(textOf(reply)).toContain("@111 *got it first* in ⏱️ 2 min");
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
      text: expect.stringMatching(/Correct, @222! \*\+1 point\*[\s\S]*@111 got it first/),
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
      () => new Promise(r => setTimeout(() => r("slow cheer"), 50))
    );
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
    vi.mocked(ai.aiReadGuess).mockImplementationOnce(
      () =>
        new Promise(r => {
          finish = () => r({ book: "John", chapter: 3, verse: 16 });
        })
    );
    const answer = core.handleMessage(AMA, "Ama", "john three sixteen", postedAt + MIN);
    return { answer, finish: () => finish() };
  }

  it("a hint waits for an answer that was already being checked", async () => {
    const { answer, finish } = slowAiAnswer();
    const hint = core.hint(); // noon arrives while the AI is thinking
    await vi.waitFor(() => expect(ai.aiReadGuess).toHaveBeenCalled());
    finish();
    expect((await answer)?.kind).toBe("win");
    expect(await hint).toBeNull(); // someone won first, so no hint goes out
    expect(state.load().scores[AMA]?.points).toBe(11);
  });

  it("a new puzzle isn't overwritten by a slow answer to yesterday's", async () => {
    const { answer, finish } = slowAiAnswer();
    fakes.verses = [fakes.psalm];
    const puzzle = core.newPuzzle(); // 7 AM arrives while the AI is thinking
    await vi.waitFor(() => expect(ai.aiReadGuess).toHaveBeenCalled());
    finish();
    await answer;
    await puzzle;
    expect(state.load()).toMatchObject({ today: { book: "Psalms" }, winner: null });
  });
});

describe("on the right track", () => {
  it("gives +1 for the start of the verse and keeps the puzzle open", async () => {
    const reply = await core.handleMessage(AMA, "Ama", "For God so loved the world that", postedAt + MIN);
    expect(reply).toEqual({
      kind: "onTrack",
      text: expect.stringContaining("👍 @111, you're on the right track! *+1 point*"),
      mentions: [AMA],
    });
    expect(state.load()).toMatchObject({ winner: null, onTrack: [AMA] });
    expect(state.load().scores[AMA]).toMatchObject({ points: 1, wins: 0, streak: 0 });
  });

  it("gives +1 for a 5-word quote from the verse", async () => {
    const reply = await core.handleMessage(KOFI, "Kofi", "he gave his only begotten", postedAt + MIN);
    expect(reply?.kind).toBe("onTrack");
  });

  it("gives it once per person, and they can still win in full", async () => {
    await core.handleMessage(AMA, "Ama", "For God so loved the world", postedAt + MIN);
    expect(
      await core.handleMessage(AMA, "Ama", "For God so loved the world that", postedAt + 2 * MIN)
    ).toBeNull();
    expect((await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + 3 * MIN))?.kind).toBe("win");
    expect(state.load().scores[AMA]?.points).toBe(1 + 6 + 5);
  });

  it("gives nothing once someone has won", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(
      await core.handleMessage(KOFI, "Kofi", "For God so loved the world", postedAt + 2 * MIN)
    ).toBeNull();
    expect(state.load().scores[KOFI]).toBeUndefined();
  });

  it("is reset by the next puzzle", async () => {
    await core.handleMessage(AMA, "Ama", "For God so loved the world", postedAt + MIN);
    await core.newPuzzle();
    expect(state.load().onTrack).toEqual([]);
  });
});

describe("bonus spots after the winner", () => {
  const answer = (id: string, name: string) => core.handleMessage(id, name, "John 3:16", postedAt + 5 * MIN);

  it("gives +1 to the next 3 correct answers only", async () => {
    await answer(AMA, "Ama");
    expect(textOf(await answer(KOFI, "Kofi"))).toContain("*+1 point* (bonus spot 1 of 3)");
    await answer(ESI, "Esi");
    expect(textOf(await answer(YAW, "Yaw"))).toContain("bonus spot 3 of 3");

    const fourth = await answer(AKUA, "Akua");
    expect(textOf(fourth)).toContain("All 3 bonus spots are taken today");
    expect(textOf(fourth)).not.toContain("+1");

    const scores = state.load().scores;
    expect([KOFI, ESI, YAW].map(id => scores[id]?.points)).toEqual([1, 1, 1]);
    expect(scores[AKUA]).toMatchObject({ points: 0, streak: 1 }); // no points, but it counts for the streak
  });

  it("answers each late person only once", async () => {
    await answer(AMA, "Ama");
    for (const [id, name] of [
      [KOFI, "Kofi"],
      [ESI, "Esi"],
      [YAW, "Yaw"],
      [AKUA, "Akua"],
    ] as const)
      await answer(id, name);
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
      text:
        "📜 Today's scripture: *TLIMS; ISNW*\n💡 *Hint:* herder\n💡 *Extra hint:* behest; lifelong\n\n" +
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
    expect(core.todayPuzzle().text).toContain("Nobody got it. It was 📖 *John 3:16 (KJV)*");
  });
});

describe("hint and reveal", () => {
  it("gives an AI hint first, then the book", async () => {
    expect(await core.hint()).toBe("💡 *Extra hint* _(no more ⚡ speed bonus today)_: behest; lifelong");
    expect(await core.hint()).toContain("book of 📘 *John*");
  });

  it("remembers each hint for !today", async () => {
    await core.hint();
    await core.hint();
    expect(state.load().hints).toEqual([
      "💡 *Extra hint:* behest; lifelong",
      "🔦 *Last hint:* it's in the book of 📘 *John*!",
    ]);
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

  it("still gives a hint after someone has won when the admin asks for one", async () => {
    await core.handleMessage(AMA, "Ama", "John 3:16", postedAt + MIN);
    expect(await core.hint({ evenIfSolved: true })).toContain("behest; lifelong");
    expect(await core.hint({ evenIfSolved: true })).toContain("book of 📘 *John*");
  });

  it("reveals the answer when nobody got it", async () => {
    expect(await core.reveal()).toContain("It was:\n\n📖 *John 3:16 (KJV)*");
  });
});
