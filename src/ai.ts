import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "./config";
import { findBook } from "./game";
import type { Guess, Scripture } from "./types";

const client = new Anthropic({
  apiKey: env("ANTHROPIC_API_KEY"),
  timeout: 15_000,
  maxRetries: 2,
});
const MODEL = "claude-haiku-4-5-20251001";

async function askClaude(system: string, message: string): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system,
    messages: [{ role: "user", content: message.slice(0, 500) }],
  });
  return res.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
}

const AiGuess = z.object({
  book: z.string(),
  chapter: z.coerce.number().int().positive(),
  verse: z.coerce.number().int().positive(),
});

// Reads a messy chat message. It does NOT know the answer, so it can't play favourites,
// and a message that tries to trick it can at most make it read that person's own guess.
export async function aiReadGuess(message: string): Promise<Guess | null> {
  try {
    const out = await askClaude(
      'You read messages from a Bible verse guessing game. If the message guesses a specific verse, ' +
      'reply ONLY with JSON like {"book":"John","chapter":3,"verse":16} using the full English book name ' +
      '(e.g. "1 Corinthians", "Psalms"). If it is not a guess, reply ONLY with null.',
      message
    );
    const raw: unknown = JSON.parse(out.replace(/```json|```/g, "").trim());
    const parsed = AiGuess.safeParse(raw);
    if (!parsed.success) return null;
    const book = findBook(parsed.data.book);
    return book ? { book, chapter: parsed.data.chapter, verse: parsed.data.verse } : null;
  } catch (err) {
    console.error("AI could not read a guess:", err);
    return null; // treat as "not a guess" rather than crashing
  }
}

// Hints in the church's style: single-word synonyms, like "behest; lifelong"
export async function makeHint(s: Scripture): Promise<string> {
  return askClaude(
    "You write hints for a church Bible verse guessing game. Give 2 Grandiloquence single-word synonyms for key words " +
    "in the verse, separated by a semicolon, like 'behest; lifelong'. Never use words that appear in the " +
    "verse, the book name, or numbers. Reply with only the hint.",
    `Verse: ${s.text}\n` + (s.hint ? `Already given, so pick different words: ${s.hint}` : "")
  );
}

// A short burst of joy for the winner, like an excited elder in the chat
export async function celebrate(name: string, ref: string): Promise<string> {
  return askClaude(
    "You are the hype voice of a church WhatsApp scripture game. Write ONE short, joyful exclamation " +
    "(under 12 words) celebrating the winner, like an excited church elder. Stretched-out cheers like " +
    "'Eeeeiiiii.....!!!' or 'Haaaa!' are welcome. No emoji, nothing irreverent. Reply with only the line.",
    `${name} just solved ${ref}.`
  );
}