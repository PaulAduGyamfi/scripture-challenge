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
// cron jobs use. Otherwise a UTC server would reset before the Sunday 8:05 PM wrap-up.
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
let heldReplies: core.Post[] = [];                              // late / on-track replies waiting their turn
let heldTimer: NodeJS.Timeout | null = null;

// Plain text, or text with @mentions that WhatsApp should turn into tags
type Outgoing = string | core.Post | null;
const asPost = (out: string | core.Post): core.Post => typeof out === "string" ? { text: out, mentions: [] } : out;

async function replyLikeAPerson(msg: Message, out: string | core.Post): Promise<void> {
  const { text, mentions } = core.replyTo(msg.author ?? msg.from, out);   // always tags who asked
  console.log(`[trace] replying to ${msg.from}`);
  try {
    await (await msg.getChat()).sendStateTyping();  // shows "typing..." like a person
  } catch {
    // Nice to have only; WhatsApp Web updates sometimes break it
  }
  console.log("[trace] typing done");
  await humanPause();
  const quoted = messageId(msg);                    // quotes their message, when WhatsApp gives us its ID
  if (quoted) {
    try {
      await client.sendMessage(msg.from, text, { mentions, quotedMessageId: quoted });
      console.log(`[trace] sent, quoting ${quoted}`);
      return;
    } catch (err) {                                 // the quote is nice to have; the reply is not
      console.error(`Couldn't quote ${quoted}, sending without it:`, err);
    }
  }
  await client.sendMessage(msg.from, text, { mentions });
  console.log("[trace] sent, no quote");
}

async function post(out: Outgoing): Promise<void> {
  if (!out || !GROUP_ID) return;
  const { text, mentions } = asPost(out);
  await client.sendMessage(GROUP_ID, text, { mentions });
}

const withIntro = (intro: string, p: core.Post): core.Post => ({ ...p, text: intro + p.text });

// whatsapp-web.js 1.34.7 sometimes leaves msg.id._serialized empty, and then quietly skips
// reactions and quotes. WhatsApp's ID is "fromMe_chat_id", plus "_sender" in groups, so build it.
const idPart = (x: unknown) => typeof x === "string" ? x : (x as { _serialized?: string } | undefined)?._serialized;
function messageId(msg: Message): string | undefined {
  const id = msg.id as Partial<Message["id"]> & { participant?: unknown };
  if (id._serialized) return id._serialized;
  const chat = idPart(id.remote);
  if (!id.id || !chat) return undefined;
  const sender = idPart(id.participant);
  return [String(Boolean(id.fromMe)), chat, id.id, ...(sender ? [sender] : [])].join("_");
}

// An emoji reaction instead of a message, so guesses never spam the group
async function react(msg: Message, emoji: string): Promise<void> {
  const id = messageId(msg);
  if (!id) {
    console.error(`Couldn't react ${emoji}: no message ID in`, JSON.stringify(msg.id));
    return;
  }
  try {
    await client.sendReaction(id, emoji);
    console.log(`Reacted ${emoji} to ${id}`);
  } catch (err) {
    console.error(`Couldn't react ${emoji}:`, err);   // nice to have only, but say why
  }
}

client.on("qr", qr => qrcode.generate(qr, { small: true }));

client.on("ready", () => {
  console.log("Bot is ready");
  if (!GROUP_ID) console.log("No GROUP_ID yet. Send any message in your test group to see its ID.");
});

// Closes Chrome before exiting. Otherwise it can outlive the bot, still holding the
// WhatsApp session, and the next start fails with "Target closed" until it finally lets go.
let quitting = false;
async function quit(code: number): Promise<void> {
  if (quitting) return;
  quitting = true;
  const giveUp = wait(5_000).then(() => console.error("Chrome didn't close in time"));
  await Promise.race([client.destroy().catch(err => console.error("Couldn't close Chrome:", err)), giveUp]);
  process.exit(code);
}

// pm2 sends SIGINT to stop or restart the bot
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { console.log(`${signal}: shutting down`); void quit(0); });
}

// If WhatsApp logs the bot out, exit so pm2 restarts it and shows a fresh QR code
client.on("disconnected", reason => {
  console.error("Disconnected from WhatsApp:", reason);
  void quit(1);
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
  if (command === "!leaderboard") return replyLikeAPerson(msg, core.leaderboard("season", senderId));
  if (command === "!week") return replyLikeAPerson(msg, core.leaderboard("week", senderId));
  if (command === "!me") return replyLikeAPerson(msg, core.myStats(senderId));
  if (command === "!streak") return replyLikeAPerson(msg, core.streak(senderId));
  if (command === "!schedule") return replyLikeAPerson(msg, core.schedule());
  if (command === "!today" || command === "!puzzle") return replyLikeAPerson(msg, core.todayPuzzle());
  if (command === "!commands") return replyLikeAPerson(msg, core.commands());
  if (command === "!help") return replyLikeAPerson(msg, core.help());

  if (ADMIN_ID && senderId === ADMIN_ID) {          // test commands, only for you
    if (body === "!new") return post(await core.newPuzzle());
    if (body === "!grouphint") return post(await core.hint());
    if (body === "!reveal") return post(await core.reveal());
    if (body === "!review") return post(await core.newReview());
    if (body === "!closereview") return post(await core.closeReview());
    if (body === "!emoji") return post(await core.newEmojiGame());
    if (body === "!closeemoji") return post(await core.closeEmojiGame());
  }

  const contact = await msg.getContact();
  const name = contact.pushname || contact.name || "Someone";
  const sentAt = msg.timestamp * 1000;              // WhatsApp's send time, in ms
  const reply = await core.handleMessage(senderId, name, body, sentAt); // winner decided here
  if (!reply) return;
  if (reply.kind === "react") return react(msg, reply.emoji);

  // At most one late or "on the right track" message per minute, so a rush of answers isn't spammy.
  // Anyone inside that minute gets a 👏 (late) or 👍 (on track) now, and their reply is held and
  // posted with the others when the minute is up, so nobody goes unanswered if the reaction fails.
  if (reply.kind === "late" || reply.kind === "onTrack") {
    const waitMs = 60_000 - (Date.now() - lastLateReply);
    if (waitMs > 0) {
      heldReplies.push({ text: reply.text, mentions: reply.mentions });
      heldTimer ??= setTimeout(postHeldReplies, waitMs);
      return react(msg, reply.kind === "late" ? "👏" : "👍");
    }
    lastLateReply = Date.now();
  }
  if (reply.kind === "win") await react(msg, "🔥");
  await replyLikeAPerson(msg, reply);               // quotes the winning message
}

// Everyone held back by the one-a-minute rule, in one message
function postHeldReplies(): void {
  heldTimer = null;
  const replies = heldReplies;
  heldReplies = [];
  if (replies.length === 0) return;
  lastLateReply = Date.now();
  post({
    text: replies.map(r => r.text).join("\n\n"),
    mentions: [...new Set(replies.flatMap(r => r.mentions))],
  }).catch(err => console.error("Couldn't post held replies:", err));
}

// One bad message must never take the bot down
// TEMPORARY: tracing why replies stopped. Remove once fixed.
const trace = (msg: Message) =>
  `from=${msg.from} author=${msg.author} fromMe=${msg.fromMe} id=${JSON.stringify(msg.id)} body=${JSON.stringify(msg.body.slice(0, 30))}`;
client.on("message_create", msg => console.log(`[trace] message_create ${trace(msg)}`));

client.on("message", msg => {
  console.log(`[trace] message ${trace(msg)}`);
  onMessage(msg).catch(err => console.error("Error handling message:", err));
});

const at = (time: string, job: () => Promise<void>) =>
  cron.schedule(time, () => { job().catch(err => console.error(`Job ${time} failed:`, err)); }, { timezone: TZ });

const { SCHEDULE: S } = core;
at(S.puzzleSoon,  async () => post(core.reminder("puzzle")));      // 10-minute heads-ups
at(S.reviewSoon,  async () => post(core.reminder("review")));
at(S.emojiSoon,   async () => post(core.reminder("emoji")));
at(S.backup,      async () => { core.backupState(); });
at(S.puzzle,      async () => post(await core.newPuzzle()));
at(S.hint,        async () => post(await core.hint()));            // AI hint
at(S.review,      async () => post(await core.newReview()));       // Midday Review
at(S.closeReview, async () => post(await core.closeReview()));
at(S.bookHint,    async () => post(await core.hint()));            // the book
at(S.emoji,       async () => post(await core.newEmojiGame()));    // Emoji Bible
at(S.closeEmoji,  async () => post(await core.closeEmojiGame()));
at(S.reveal,      async () => post(await core.reveal()));
at(S.weeklyWrap,  async () =>                                      // after Emoji Bible closes
  post(withIntro("That's a wrap on the week! Final standings:\n\n", core.leaderboard("week"))));
at(S.seasonFinale, async () =>                                 // Dec 31 season finale
  post(withIntro("Season's over! Congratulations to this year's top solvers:\n\n", core.leaderboard("season"))));

client.initialize().catch(err => {
  console.error("Couldn't start WhatsApp:", err);
  void quit(1);
});