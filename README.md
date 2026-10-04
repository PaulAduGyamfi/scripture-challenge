# Scripture Challenge 📖

A daily Bible verse challenge for church WhatsApp groups. Every morning the bot posts a verse as an acronym, and members race to name the reference, decode the words, or both.

```
☀️ Good morning! Today's scripture:

📜 *TLIMS; ISNW*

💬 Reply with the reference, the decoded words, or both for the most points! 🎯
🏆 First correct answer wins! ⏱️ Go go go! 🚀
```

> Psalm 23:1, "The LORD is my shepherd; I shall not want."

## How the game works

| Time | What happens |
|---|---|
| 7:00 AM | Today's verse is posted as an acronym |
| 12:00 PM | Extra hint, written by AI (the speed bonus ends) |
| 2:00 PM | 🔁 Midday Review: a verse from 2+ weeks ago, open until 5 PM |
| 5:00 PM | Midday Review closes (answer revealed if nobody got it) |
| 6:00 PM | Last hint: the book of the Bible |
| 7:00 PM | 😀 Emoji Bible: name the Bible story told in emoji, open until 8 PM |
| 9:00 PM | If nobody got it, the answer is revealed and the day closes |
| Sunday 8:05 PM | Weekly standings |
| Dec 31, 8 PM | Season finale |

**Points**

| Answer | Points |
|---|---|
| Reference + decoded words | 10 |
| Reference only (John 3:16) | 6 |
| Decoded words only | 3 |
| Speed bonus, before any hint | +5 within 30 min, +3 within 2 hr, +1 within 4 hr |
| One of the next 3 correct answers after the winner | +1 |
| Midday Review (first correct only) | 5 / 3 / 2 for both / reference / decoded |
| Emoji Bible (first correct only) | 2 |

- **Forgiving answers:** the bot understands "jn 3 16", "first john 4:8", "Song of Solomon 2:1" and similar. Messier guesses like "john three sixteen" are read by AI.
- **Typos are fine:** decoded words can have small typos, or a word missing.
- **Reactions instead of spam:** wrong references get a 🤔 reaction instead of a message.
- **Streaks and badges:** solving on days in a row builds a streak, and players earn badges (🌱 First Fruits, 📖 Word Eater, 🔥 On Fire…).
- **Seasons and weeks:** each calendar year is a season, and the weekly board resets every Monday.

**Commands anyone can send in the group**

| Command | Shows |
|---|---|
| `!today` | Today's puzzle, the hints so far, and who solved it |
| `!help` | Rules and commands |
| `!leaderboard` | Season standings |
| `!week` | This week's standings |
| `!me` | Your points, streak and badges |
| `!streak` | Your current streak |
| `!commands` | Just the list of commands |

The admin can also send `!new`, `!grouphint`, `!reveal`, `!review`, `!closereview`, `!emoji` and `!closeemoji` to run a step early, which is handy for testing.

**About the Midday Review:** it reuses verses the group had at least 14 puzzles ago, so it never uses up your sheet faster. It's also good for memorising Scripture. It switches on by itself once there are 10 old verses to choose from, about 3–4 weeks after you start.

## Before you start

You'll need:

- **A spare phone number for the bot.** The bot logs into WhatsApp the way WhatsApp Web does. Use a number you don't mind dedicating to it, not your personal one. The bot ignores messages sent from its own number, so you'll play from your usual phone.
- **A computer that stays on.** A small Linux server is best. A $6–12/month VPS with at least 1–2 GB of RAM works, because the bot runs a hidden Chrome browser.
- **Node.js 22 or newer.**
- **A Claude API key** from [console.anthropic.com](https://console.anthropic.com). Usage is light: the AI is only used for hints, cheers and the occasional messy guess.
- **A Google account**, for the sheet of verses.

> ⚠️ This bot uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), an unofficial WhatsApp client. WhatsApp doesn't officially support bots on personal accounts, so there's a small risk of the number being banned. That's another reason to use a spare number.

## Setup

### 1. Make your verse sheet

Create a Google Sheet with these column headers in row 1, spelled exactly like this:

| Book | Chapter | VerseStart | VerseEnd | Clue | Text | Acronym | Hint | Translation |
|---|---|---|---|---|---|---|---|---|
| John | 3 | 16 | | For God so loved the world | For God so loved the world, that he gave his only begotten Son... | | | KJV |
| Romans | 8 | 38 | 39 | neither death, nor life, nor angels | For I am persuaded, that neither death, nor life... | | | KJV |

| Column | Required? | What it's for |
|---|---|---|
| Book | ✅ | Full name or a common short form (Jn, Ps, 1 Cor) |
| Chapter | ✅ | Number |
| VerseStart | ✅ | Number |
| VerseEnd | | For a range like 38–39. Leave empty for one verse. |
| Clue | ✅ | The words that become the acronym. End with `.` for a full verse; otherwise the puzzle ends in `...` |
| Text | | The full verse, shown when someone wins. Defaults to the clue. |
| Acronym | | Your own acronym, if you don't want the automatic one |
| Hint | | A hint posted with the puzzle |
| Translation | | Shown after the reference, like "John 3:16 (KJV)" |

Then publish it: **File → Share → Publish to web**, choose the sheet and **Comma-separated values (.csv)**, and copy the link. You can add verses anytime, because the bot re-reads the sheet each morning. Rows with mistakes are skipped and logged, and never crash the bot.

#### Optional: the Stories tab, for Emoji Bible

Add a second tab called **Stories** with these headers:

| Story | Answers | Reference | Emoji |
|---|---|---|---|
| Jonah and the big fish | jonah | Jonah 1–2 | |
| David and Goliath | goliath, david and goliath | 1 Samuel 17 | 🧒🪨🗡️🗿 |

- **Story** (required): the name, shown when someone gets it.
- **Answers** (required): words that count as correct, separated by commas. Any one is enough, and small typos are fine.
- **Reference**: shown with the answer.
- **Emoji**: your own clue. Leave it empty and the AI makes one.

Publish this tab on its own (**File → Share → Publish to web**, choose **Stories** and **CSV**). Each tab gets its own link, and that link goes in `STORIES_CSV_URL`. Without it, Emoji Bible simply doesn't run.

### 2. Get the code

On your server:

```bash
git clone https://github.com/PaulAduGyamfi/scripture-challenge.git
cd scripture-challenge
npm ci
npm run build
```

If Chrome won't start later on a fresh Linux server, install its system libraries:

```bash
npx puppeteer browsers install chrome --install-deps
```

### 3. Fill in your settings

```bash
cp .env.example .env
nano .env
```

| Setting | What to put |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `SHEET_CSV_URL` | The CSV link from step 1 |
| `STORIES_CSV_URL` | Optional: the Stories tab's CSV link, for Emoji Bible |
| `GROUP_ID` | Leave empty for now (step 4) |
| `ADMIN_ID` | Leave empty for now (step 4) |
| `TZ_NAME` | Your church's time zone, like `America/Chicago`, `Europe/London` or `Africa/Accra` ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)). All posting times use this zone. |

### 4. Log in and find your group

```bash
npm start
```

1. **Scan the QR code.** A QR code appears in the terminal. On the bot's phone, go to **WhatsApp → Settings → Linked devices → Link a device** and scan it.
2. **Get the group ID.** Once it says `Bot is ready`, send a message in your group from any phone. The bot prints `Group ID: 1203...@g.us`. Put that in `.env` as `GROUP_ID`. If it prints several groups, send a message in yours and use the ID that appears right after.
3. **Restart.** Press `Ctrl+C` and run `npm start` again.
4. **Get your admin ID.** Send a message in the group from **your own** phone. The bot prints `Message from 1234...@c.us`. Put that in `.env` as `ADMIN_ID`.
5. **Restart again.** Press `Ctrl+C` and run `npm start`. Send `!help` in the group; the bot should reply. Try `!new` to post a puzzle right away.

The login is saved in `.wwebjs_auth/`, so you only scan once. Keep that folder private.

### 5. Keep it running

Use [pm2](https://pm2.keymetrics.io) so the bot restarts if it crashes and starts again after a server reboot:

```bash
npm install -g pm2
pm2 start dist/bot.js --name scripture-bot   # run from the project folder
pm2 save
pm2 startup                                  # then run the command it prints
```

Useful commands:

```bash
pm2 logs scripture-bot      # see what the bot is doing
pm2 restart scripture-bot   # restart it
```

The bot reads its code and `.env` only when it starts. After changing either, restart it.

## Updating

When the code changes, pull, rebuild and restart, all in one go:

```bash
npm run deploy
```

Skipping the restart is the most common mistake: the bot keeps running the old code until it restarts.

### Automatic deploys (optional)

If you run your own copy of this repo on GitHub, every push to `main` can deploy itself once the tests pass.

1. **Make a deploy key on your own computer:**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/scripture_deploy -N "" -C "github-deploy"
   ```
2. **Allow it on the server, for deploying only.** Add one line to `~/.ssh/authorized_keys`, with your folder path and the contents of `scripture_deploy.pub`:
   ```
   restrict,command="cd /root/scripture-challenge && ./scripts/deploy.sh" ssh-ed25519 AAAA... github-deploy
   ```
   The `restrict,command=` part means this key can only run the deploy script, never open a shell.
3. **Add three repository secrets** (Settings → Secrets and variables → Actions). With the [GitHub CLI](https://cli.github.com), run from the project folder:
   ```bash
   gh secret set DEPLOY_SSH_KEY < ~/.ssh/scripture_deploy
   gh secret set DEPLOY_HOST --body "YOUR_SERVER_IP"
   ssh-keyscan YOUR_SERVER_IP | gh secret set DEPLOY_KNOWN_HOSTS
   ```
4. **Deploy once by hand** on the server, with `git pull && npm run deploy`. After that, pushes deploy themselves. Watch them in the **Actions** tab.

The deploy job runs only when the tests pass and the push is to `main`, and it logs in as `root`. If your server uses another user, change `root@` in `.github/workflows/test.yml`.

## Backups

Every morning at 6:55 the bot copies its scores (`state.json`) into `backups/`, keeping 30 days. If `state.json` is ever damaged, the bot refuses to start instead of wiping scores. To restore, copy the newest backup over it:

```bash
cp backups/state-2026-03-04.json state.json
pm2 restart scripture-bot
```

These backups live on the same server. For extra safety, copy the `backups/` folder somewhere else now and then.

## Making it your own

| To change | Edit |
|---|---|
| Posting times | The `at("...")` lines at the bottom of `src/bot.ts` (cron format). If you move hint times, update the wording in `help()` in `src/core.ts` too. |
| Points, speed bonus, badges | Top of `src/core.ts` |
| Messages and emoji | `src/core.ts` |
| The winner's cheer | The `celebrate` prompt in `src/ai.ts`. Teach it your church's own sayings. |
| Hint style | The `makeHint` prompt in `src/ai.ts` |

## Trying it without WhatsApp

Play a whole game in your terminal. It needs `ANTHROPIC_API_KEY` and `SHEET_CSV_URL` in `.env`. It saves to the same `state.json` as the bot, so run it in a separate copy of the project, never in your live server's folder.

```bash
npm run sim
```

```
/new                  post a puzzle
/review               post a Midday Review (needs enough old verses)
Ama: John 3:16        answer as "Ama"
/wait 45              pretend 45 minutes passed
/hint  /reveal  /board  /week  /me ama  /streak ama  /today  /commands  /help
```

## Development

```bash
npm test            # run the tests
npm run typecheck   # check types
npm run dev         # run the bot straight from the TypeScript source
```

The tests fake the AI, the sheet and WhatsApp, so they run offline with no keys.

| File | What's in it |
|---|---|
| `src/bot.ts` | WhatsApp connection, commands, schedule |
| `src/core.ts` | The game: puzzles, scoring, streaks, leaderboards |
| `src/game.ts` | Reading references, acronyms, checking decoded answers |
| `src/ai.ts` | Claude calls: reading messy guesses, hints, cheers |
| `src/sheet.ts` | Loading verses from the Google Sheet |
| `src/state.ts` | Saving scores to `state.json`, backups |
| `src/sim.ts` | The terminal version |

## Troubleshooting

| Problem | Likely cause |
|---|---|
| The bot doesn't reply to anything | It's not running (`pm2 list`), `GROUP_ID` is for a different group, or you're typing from the bot's own number |
| Old behaviour after updating | The bot wasn't restarted. Run `pm2 restart scripture-bot`. |
| `Disconnected from WhatsApp: LOGOUT` | WhatsApp logged the bot out. Stop it, delete `.wwebjs_auth/`, start it, and scan the QR again. |
| `Missing ... in your .env file` | That setting is empty in `.env` |
| A verse never comes up | Its sheet row has a mistake. `pm2 logs` shows `Sheet row N skipped: ...` |
| `state.json looks damaged` | Restore from `backups/` (see Backups) |

## License

[MIT](LICENSE). Free to use, change and share, including for your own church.
