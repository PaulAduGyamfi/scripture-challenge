// Shared by the game (core.ts, answers.ts) and the read-only replies (replies.ts)
import { formatRef, makeAcronym } from "./domain/matching";
import type { RiddleGame } from "./state";
import type { Scripture } from "./types";

// A message that @mentions people: bot.ts passes `mentions` to WhatsApp so the tags ping
export interface Post {
  text: string;
  mentions: string[]; // WhatsApp IDs of everyone tagged in text
}

// What handleMessage hands back to bot.ts
export type Reply =
  | (Post & { kind: "win" | "late" | "onTrack" }) // late: correct after the winner; onTrack: part of it
  | { kind: "react"; emoji: string }; // no message, just an emoji on theirs (🤔 wrong, 👏 right but late)

// "123456@c.us" -> "@123456", which WhatsApp shows as the person's name
export const tag = (id: string) => `@${id.split("@")[0]}`;

// Every reply tags the person it answers: "@Ama 📋 Commands...".
// Replies that already tag them (like !me) are left alone, so nobody is tagged twice.
export function replyTo(senderId: string, out: string | Post): Post {
  const post = typeof out === "string" ? { text: out, mentions: [] } : out;
  if (post.mentions.includes(senderId)) return post;
  return { text: `${tag(senderId)} ${post.text}`, mentions: [senderId, ...post.mentions] };
}

export function formatTime(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} hr ${Math.round(minutes % 60)} min`;
}

// "1 Kings 15:5 (ESV)"
export function fullRef(v: Scripture): string {
  return formatRef(v) + (v.translation ? ` (${v.translation})` : "");
}

// The verse as it appears in every message: the reference in bold, then the text as a quote
//   📖 *John 3:16 (KJV)*
//   > For God so loved the world...
export function verseBlock(v: Scripture): string {
  const quote = v.text
    .split("\n")
    .map(line => `> ${line}`)
    .join("\n");
  return `📖 *${fullRef(v)}*\n${quote}`;
}

// "1 point", "2 points"
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const puzzleOf = (v: Scripture) => v.acronym || makeAcronym(v.clue);

// The first listed answer, capitalised: "noah" -> "Noah"
export const riddleAnswer = (r: RiddleGame) => (r.answers[0] ?? "").replace(/^./, c => c.toUpperCase());

export const pick = <T>(items: readonly T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)];
