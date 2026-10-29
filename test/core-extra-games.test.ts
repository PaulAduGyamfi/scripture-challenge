import { describe, it, expect, vi } from "vitest";
import type { Riddle, Story } from "../src/types";

vi.mock("../src/sheet", () => import("./helpers/core-setup").then(f => f.sheetMock));
vi.mock("../src/ai", () => import("./helpers/core-setup").then(f => f.aiMock));

import * as core from "../src/core";
import * as ai from "../src/ai";
import * as state from "../src/state";
import { fakes, MIN, AMA, KOFI, ESI, START, postedAt, textOf, freshGameEachTest } from "./helpers/core-setup";

// Midday Review, Emoji Bible and Bible Riddle
freshGameEachTest();

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
    withHistory(22); // 22 + today - 14 recent = 9 old: not enough
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
    expect(chapter).toBeLessThanOrEqual(117); // not one of the 14 most recent (118-130)
  });

  it("doesn't repeat a review verse until all have had a turn", async () => {
    withHistory();
    const seen = new Set<string>();
    for (let i = 0; i < 17; i++) {
      await core.newReview();
      seen.add(reviewRef());
    }
    expect(seen.size).toBe(17);
    await core.newReview(); // all 17 used: starts over
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
    expect(await core.handleMessage(KOFI, "Kofi", reviewRef(), TWO_PM + 2 * MIN)).toEqual({
      kind: "react",
      emoji: "👏",
    });
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
    await core.handleMessage(KOFI, "Kofi", "John 3:16", postedAt + MIN); // morning solved
    withHistory();
    await core.newReview();
    expect(await core.handleMessage(AMA, "Ama", "Psalms 150:1", TWO_PM + MIN)).toEqual({
      kind: "react",
      emoji: "🤔",
    });
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
    expect(core.todayPuzzle()).toMatchObject({
      text: expect.stringContaining("✅ Won by @111"),
      mentions: [AMA],
    });
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
    expect(text).not.toContain("Jonah"); // never gives the answer away
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
    expect(await core.handleMessage(KOFI, "Kofi", "Jonah", SEVEN_PM + 2 * MIN)).toEqual({
      kind: "react",
      emoji: "👏",
    });
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
    for (let i = 0; i < 2; i++) {
      await postGame([fakes.jonah, fakes.goliath]);
      titles.add(state.load().emojiGame?.story ?? "");
    }
    expect(titles.size).toBe(2);
    await postGame([fakes.jonah, fakes.goliath]); // both used: starts over
    expect(state.load().storiesUsed).toHaveLength(1);
  });

  it("lets the AI accept the story named in other words", async () => {
    await postGame();
    vi.mocked(ai.judgeStoryGuess).mockResolvedValueOnce("correct");
    const reply = await core.handleMessage(
      AMA,
      "Ama",
      "the prophet in the belly of the fish!",
      SEVEN_PM + MIN
    );
    expect(reply?.kind).toBe("win");
    expect(ai.judgeStoryGuess).toHaveBeenCalledWith(
      "the prophet in the belly of the fish!",
      expect.objectContaining({ story: "Jonah and the big fish", emoji: "🐋🙏🌊" })
    );
    expect(state.load().scores[AMA]?.points).toBe(2);
  });

  it("reacts 🤔 when the AI says it's a guess at a different story, and ignores chatter", async () => {
    await postGame();
    vi.mocked(ai.judgeStoryGuess).mockResolvedValueOnce("wrong");
    expect(await core.handleMessage(KOFI, "Kofi", "noah and the flood", SEVEN_PM + MIN)).toEqual({
      kind: "react",
      emoji: "🤔",
    });
    expect(await core.handleMessage(KOFI, "Kofi", "good evening family", SEVEN_PM + MIN)).toBeNull(); // judged not_a_guess
    expect(state.load().emojiGame?.closed).toBe(false);
  });

  it("only asks the AI when it could matter", async () => {
    await postGame();
    await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + MIN); // a listed answer: no AI needed
    await core.handleMessage(KOFI, "Kofi", "the man in the whale", SEVEN_PM + MIN); // game already won
    await core.handleMessage(KOFI, "Kofi", "🙌🙌", SEVEN_PM + MIN); // no words
    expect(ai.judgeStoryGuess).not.toHaveBeenCalled();
  });

  it("doesn't judge reference guesses meant for the morning puzzle", async () => {
    await postGame();
    await core.handleMessage(AMA, "Ama", "John 3:17", SEVEN_PM + MIN);
    expect(ai.judgeStoryGuess).not.toHaveBeenCalled();
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
      name: "Ama",
      points: 18,
      wins: 0,
      fastestMin: null,
      season: 2026,
      week: "x",
      weekPoints: 0,
      streak: 0,
      bestStreak: 0,
      lastSolvedDay: null,
      emojiWins: 9,
      riddleWins: 0,
    };
    state.save(s);
    await postGame();
    expect(textOf(await core.handleMessage(AMA, "Ama", "jonah", SEVEN_PM + MIN))).toContain(
      "🎖️ New badge: 😀 Emoji Master!"
    );
  });
});

describe("Bible Riddle", () => {
  const TEN_AM = START.getTime() + 3 * 60 * MIN;
  async function postRiddle(riddles: Riddle[] = [fakes.noah]) {
    fakes.riddles = riddles;
    vi.setSystemTime(TEN_AM);
    return core.newRiddle();
  }

  it("does nothing without a Riddles tab", async () => {
    expect(await postRiddle([])).toBeNull();
    expect(state.load().riddle).toBeNull();
  });

  it("posts the riddle without giving the answer away", async () => {
    const text = await postRiddle();
    expect(text).toContain("🧩 *Bible Riddle*");
    expect(text).toContain("I built a boat on dry land");
    expect(text).toContain("3 points! Closes at 12 PM");
    expect(text?.toLowerCase()).not.toContain("noah");
  });

  it("gives the first right answer 3 points", async () => {
    await postRiddle();
    const reply = await core.handleMessage(AMA, "Ama", "Noah!", TEN_AM + 4 * MIN);
    expect(reply).toMatchObject({ kind: "win", mentions: [AMA] });
    expect(textOf(reply)).toContain("@111 solved the riddle in ⏱️ 4 min!");
    expect(textOf(reply)).toContain("It's *Noah* (📖 Genesis 6-9)");
    expect(state.load().scores[AMA]).toMatchObject({ points: 3, riddleWins: 1, wins: 0 });
    expect(state.load().riddle?.closed).toBe(true);
  });

  it("claps for late right answers and leaves the morning puzzle alone", async () => {
    await postRiddle();
    await core.handleMessage(AMA, "Ama", "noah", TEN_AM + MIN);
    expect(await core.handleMessage(KOFI, "Kofi", "Noah", TEN_AM + 2 * MIN)).toEqual({
      kind: "react",
      emoji: "👏",
    });
    expect(textOf(await core.handleMessage(ESI, "Esi", "John 3:16", TEN_AM + 3 * MIN))).toContain("Esi");
    expect(state.load().winner?.id).toBe(ESI);
  });

  it("lets the AI accept the answer in other words, and 🤔 a different answer", async () => {
    await postRiddle();
    vi.mocked(ai.judgeRiddleGuess).mockResolvedValueOnce("wrong");
    expect(await core.handleMessage(KOFI, "Kofi", "moses", TEN_AM + MIN)).toEqual({
      kind: "react",
      emoji: "🤔",
    });
    vi.mocked(ai.judgeRiddleGuess).mockResolvedValueOnce("correct");
    expect((await core.handleMessage(AMA, "Ama", "the man who built the ark", TEN_AM + 2 * MIN))?.kind).toBe(
      "win"
    );
    expect(ai.judgeRiddleGuess).toHaveBeenCalledWith(
      "the man who built the ark",
      expect.objectContaining({ answers: ["noah"] })
    );
  });

  it("doesn't ask the AI about reference guesses meant for the morning puzzle", async () => {
    await postRiddle();
    await core.handleMessage(AMA, "Ama", "John 3:17", TEN_AM + MIN);
    expect(ai.judgeRiddleGuess).not.toHaveBeenCalled();
  });

  it("reveals the answer at 12 PM if nobody got it, then ignores answers", async () => {
    await postRiddle();
    expect(await core.closeRiddle()).toContain("The answer was *Noah* (📖 Genesis 6-9)");
    expect(await core.closeRiddle()).toBeNull();
    expect(await core.handleMessage(AMA, "Ama", "noah", TEN_AM + 130 * MIN)).toBeNull();
  });

  it("doesn't repeat a riddle until every riddle has been used", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2; i++) {
      await postRiddle([fakes.noah, fakes.samson]);
      seen.add(state.load().riddle?.riddle ?? "");
    }
    expect(seen.size).toBe(2);
    await postRiddle([fakes.noah, fakes.samson]); // both used: starts over
    expect(state.load().riddlesUsed).toHaveLength(1);
  });

  it("shows in !today", async () => {
    await postRiddle();
    expect(core.todayPuzzle().text).toContain(
      "🧩 *Bible Riddle*: I built a boat on dry land and waited for rain. Who am I?\n⏳ Open until 12 PM"
    );
    await core.handleMessage(AMA, "Ama", "noah", TEN_AM + MIN);
    expect(core.todayPuzzle().text).toContain("✅ Solved by @111: it was *Noah*");
  });

  it("is in !schedule and gets a reminder only when there's a Riddles tab", () => {
    vi.stubEnv("RIDDLES_CSV_URL", "");
    expect(core.schedule()).not.toContain("Bible Riddle");
    expect(core.reminder("riddle")).toBeNull();
    vi.stubEnv("RIDDLES_CSV_URL", "https://example.test/riddles.csv");
    expect(core.schedule()).toContain("🧩 10 AM: Bible Riddle, until 12 PM");
    expect(core.reminder("riddle")).toContain("10 AM, in 10 minutes");
    vi.unstubAllEnvs();
  });
});
