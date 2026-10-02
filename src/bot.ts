import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import cron from "node-cron";
import * as core from "./core";
import { optionalEnv } from "./config";

const GROUP_ID = optionalEnv("GROUP_ID");    // empty on the very first run
const ADMIN_ID = optionalEnv("ADMIN_ID");    // you, for test commands
const TZ = optionalEnv("TZ_NAME") ?? "America/New_York";

// Fail fast on a mistyped time zone instead of posting at the wrong hour
try { new Intl.DateTimeFormat("en-US", { timeZone: TZ }); }
catch { throw new Error(`TZ_NAME "${TZ}" isn't a real time zone (try America/Chicago)`); }
// Run the whole bot on church time, so the week and season reset at the same midnight the
// cron jobs use. Otherwise a UTC server would reset before the Sunday 8 PM wrap-up.
process.env.TZ = TZ;

// Log unexpected errors instead of dying silently; pm2 keeps the logs
process.on("unhandledRejection", err => console.error("Unhandled error:", err));

const client = new Client({
  authStrategy: new LocalAuth(),              // remembers the login
  puppeteer: { args: ["--no-sandbox"] },
});

// ---------- Human-like pacing ----------
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const humanPause = () => wait(3_000 + Math.random() * 7_000);  // 3 to 10 seconds
let lastLateReply = 0;                                          // for "already solved" replies

// Plain text, or text with @mentions that WhatsApp should turn into tags
type Outgoing = string | core.Post | null;
const asPost = (out: string | core.Post): core.Post => typeof out === "string" ? { text: out, mentions: [] } : out;

async function replyLikeAPerson(msg: Message, out: string | core.Post): Promise<void> {
  const { text, mentions } = core.replyTo(msg.author ?? msg.from, out);   // always tags who asked
  try {
    await (await msg.getChat()).sendStateTyping();  // shows "typing..." like a person
  } catch {
    // Nice to have only; WhatsApp Web updates sometimes break it
  }
  await humanPause();
  await msg.reply(text, undefined, { mentions });
}

async function post(out: Outgoing): Promise<void> {
  if (!out || !GROUP_ID) return;
  const { text, mentions } = asPost(out);
  await client.sendMessage(GROUP_ID, text, { mentions });
}

const withIntro = (intro: string, p: core.Post): core.Post => ({ ...p, text: intro + p.text });

// An emoji reaction instead of a message, so guesses never spam the group
async function react(msg: Message, emoji: string): Promise<void> {
  try {
    await msg.react(emoji);
    console.log(`Reacted ${emoji} to ${msg.id._serialized}`);
  } catch (err) {
    console.error(`Couldn't react ${emoji}:`, err);   // nice to have only, but say why
  }
}

client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", () => {
  console.log("Bot is ready");
  if (!GROUP_ID) console.log("No GROUP_ID yet. Send any message in your test group to see its ID.");
});

// If WhatsApp logs the bot out, exit so pm2 restarts it and shows a fresh QR code
client.on("disconnected", reason => {
  console.error("Disconnected from WhatsApp:", reason);
  process.exit(1);
});

async function onMessage(msg: Message): Promise<void> {
  if (!GROUP_ID) {                                  // first run: show group IDs as messages arrive
    if (msg.from.endsWith("@g.us")) console.log(`Group ID: ${msg.from}  <- put this in .env as GROUP_ID`);
    return;
  }
  if (msg.fromMe || msg.from !== GROUP_ID) return;   // ignore every other chat
  const senderId = msg.author ?? msg.from;
  const body = msg.body.trim();
  if (!body) return;
  if (!ADMIN_ID) console.log(`Message from ${senderId}  <- if that's you, put it in .env as ADMIN_ID`);

  // Anyone can use these
  const command = body.toLowerCase();
  if (command === "!leaderboard") return replyLikeAPerson(msg, core.leaderboard("season"));
  if (command === "!week") return replyLikeAPerson(msg, core.leaderboard("week"));
  if (command === "!me") return replyLikeAPerson(msg, core.myStats(senderId));
  if (command === "!streak") return replyLikeAPerson(msg, core.streak(senderId));
  if (command === "!today" || command === "!puzzle") return replyLikeAPerson(msg, core.todayPuzzle());
  if (command === "!commands") return replyLikeAPerson(msg, core.commands());
  if (command === "!help") return replyLikeAPerson(msg, core.help());

  if (ADMIN_ID && senderId === ADMIN_ID) {          // test commands, only for you
    if (body === "!new") return post(await core.newPuzzle());
    if (body === "!hint") return post(await core.hint());
    if (body === "!reveal") return post(await core.reveal());
    if (body === "!review") return post(await core.newReview());
    if (body === "!closereview") return post(await core.closeReview());
  }

  const contact = await msg.getContact();
  const name = contact.pushname || contact.name || "Someone";
  const sentAt = msg.timestamp * 1000;              // WhatsApp's send time, in ms
  const reply = await core.handleMessage(senderId, name, body, sentAt); // winner decided here
  if (!reply) return;
  if (reply.kind === "react") return react(msg, reply.emoji);

  // At most one "already solved" reply per minute, so a rush of late answers isn't spammy.
  // Their points (if they got a bonus spot) still count; a 👏 tells them they were right.
  if (reply.kind === "late") {
    if (Date.now() - lastLateReply < 60_000) return react(msg, "👏");
    lastLateReply = Date.now();
  }
  if (reply.kind === "win") await react(msg, "🔥");
  await replyLikeAPerson(msg, reply);               // quotes the winning message
}

// One bad message must never take the bot down
client.on("message", msg => {
  onMessage(msg).catch(err => console.error("Error handling message:", err));
});

const at = (time: string, job: () => Promise<void>) =>
  cron.schedule(time, () => { job().catch(err => console.error(`Job ${time} failed:`, err)); }, { timezone: TZ });

at("55 6 * * *", async () => { core.backupState(); });       // 6:55 AM backup of state.json
at("0 7 * * *",  async () => post(await core.newPuzzle()));   // 7:00 AM puzzle
at("0 12 * * *", async () => post(await core.hint()));        // noon hint
at("0 14 * * *", async () => post(await core.newReview()));   // 2 PM Midday Review
at("0 17 * * *", async () => post(await core.closeReview())); // 5 PM review closes
at("0 18 * * *", async () => post(await core.hint()));        // 6 PM book hint
at("0 21 * * *", async () => post(await core.reveal()));      // 9 PM reveal
at("0 20 * * 0", async () =>                                   // Sunday 8 PM weekly wrap-up
  post(withIntro("That's a wrap on the week! Final standings:\n\n", core.leaderboard("week"))));
at("0 20 31 12 *", async () =>                                 // Dec 31 season finale
  post(withIntro("Season's over! Congratulations to this year's top solvers:\n\n", core.leaderboard("season"))));

client.initialize().catch(err => {
  console.error("Couldn't start WhatsApp:", err);
  process.exit(1);
});