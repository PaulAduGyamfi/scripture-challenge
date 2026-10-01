import "dotenv/config";
import readline from "node:readline"
import { aiReadGuess } from "./ai"
import { makeAcronym, parseReference, isCorrect, formatRef } from "./game";
import { scriptures } from "./scriptures";

const today = scriptures[Math.floor(Math.random() * scriptures.length)];
if (!today) throw new Error("scriptures.ts is empty");

console.log("Today's scripture: " + makeAcronym(today.clue));
console.log("Answer like this ->  Sarah: John 3:16\n");

let winner: string | null = null;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on("line", async (line: string) => {
  const split = line.indexOf(":");
  if (split === -1) return console.log("Use the format  Name: answer");
  const name = line.slice(0, split).trim();
  const answer = line.slice(split + 1);

  const guess = parseReference(answer) ?? (/\d/.test(answer) ? await aiReadGuess(answer) : null);

  if (!guess) return console.log("(bot can't read a reference, ignoring)");
  if (!isCorrect(guess, today)) return console.log(`Not quite, ${name}. Keep trying!`);
  if (winner) return console.log(`Correct, ${name}, but ${winner} got it first!`);

  winner = name;
  console.log(`YES! ${name} got it first: ${formatRef(today)}`);
});