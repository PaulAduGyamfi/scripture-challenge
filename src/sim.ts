import readline from "node:readline";
import * as core from "./core";

let fakeMinutes = 0; // "/wait 20" pretends 20 minutes have passed, to test speed points
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Commands: /new /wait 20 /hint /reveal /board /week /me Name /streak Name /help, or  Name: message");

rl.on("line", async (line: string) => {
  try {
    const [cmd, arg = ""] = line.split(" ");
    let out: string | core.Post | null = null;
    if (cmd === "/new") { fakeMinutes = 0; out = await core.newPuzzle(); }
    else if (cmd === "/wait") { fakeMinutes += Number(arg) || 0; out = `(${fakeMinutes} min since the puzzle)`; }
    else if (cmd === "/hint") out = await core.hint();
    else if (cmd === "/reveal") out = await core.reveal();
    else if (cmd === "/board") out = core.leaderboard("season");
    else if (cmd === "/week") out = core.leaderboard("week");
    else if (cmd === "/me") out = core.myStats(arg.toLowerCase());
    else if (cmd === "/streak") out = core.streak(arg.toLowerCase());
    else if (cmd === "/help") out = core.help();
    else if (line.includes(":")) {
      const i = line.indexOf(":");
      const name = line.slice(0, i).trim();
      const sentAt = Date.now() + fakeMinutes * 60_000;
      const reply = await core.handleMessage(name.toLowerCase(), name, line.slice(i + 1), sentAt);
      out = !reply ? null : reply.kind === "wrong" ? "[wrong] 🤔 (reaction only)" : `[${reply.kind}] ${reply.text}`;
    }
    if (out) console.log("\nBOT: " + (typeof out === "string" ? out : out.text) + "\n");
  } catch (err) {
    console.error("Error:", err);
  }
});