import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake the Anthropic SDK so tests never call the real API (or need a key)
const create = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  return vi.fn();
});
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create }; },
}));

import { aiReadGuess, makeHint, celebrate } from "../src/ai";

const claudeSays = (text: string) =>
  create.mockResolvedValueOnce({ content: [{ type: "text", text }] });

beforeEach(() => {
  create.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("aiReadGuess", () => {
  it("turns Claude's JSON into a guess with the proper book name", async () => {
    claudeSays('{"book":"Psalm","chapter":23,"verse":1}');
    expect(await aiReadGuess("the shepherd psalm, 23 verse 1")).toEqual({ book: "Psalms", chapter: 23, verse: 1 });
  });

  it("copes with code fences and numbers sent as text", async () => {
    claudeSays('```json\n{"book":"John","chapter":"3","verse":"16"}\n```');
    expect(await aiReadGuess("john three sixteen")).toEqual({ book: "John", chapter: 3, verse: 16 });
  });

  it.each([
    ["not a guess", "null"],
    ["garbage", "I think it's John"],
    ["unknown book", '{"book":"Hezekiah","chapter":1,"verse":1}'],
    ["bad numbers", '{"book":"John","chapter":0,"verse":16}'],
  ])("returns null for %s", async (_, reply) => {
    claudeSays(reply);
    expect(await aiReadGuess("something with 1 number")).toBeNull();
  });

  it("returns null instead of crashing when the API fails", async () => {
    create.mockRejectedValueOnce(new Error("overloaded"));
    expect(await aiReadGuess("john 3 16?")).toBeNull();
  });

  it("only sends the first 500 characters", async () => {
    claudeSays("null");
    await aiReadGuess("x".repeat(2000));
    expect(create.mock.calls[0]?.[0].messages[0].content).toHaveLength(500);
  });
});

describe("makeHint", () => {
  it("returns Claude's trimmed reply and mentions the hint already given", async () => {
    claudeSays("  behest; lifelong \n");
    const hint = await makeHint({
      book: "John", chapter: 3, verseStart: 16, verseEnd: 16, clue: "For God so loved", text: "For God so loved", hint: "adored",
    });
    expect(hint).toBe("behest; lifelong");
    expect(create.mock.calls[0]?.[0].messages[0].content).toContain("adored");
  });
});

describe("celebrate", () => {
  it("sends the winner's name and the reference", async () => {
    claudeSays("Haaaa! Ama has been eating the Word! 📖");
    expect(await celebrate("Ama", "John 3:16")).toBe("Haaaa! Ama has been eating the Word! 📖");
    expect(create.mock.calls[0]?.[0].messages[0].content).toBe("Ama just solved John 3:16.");
  });
});
