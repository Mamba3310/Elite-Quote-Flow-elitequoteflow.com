# Telegram bridge

A Cloudflare Worker that lets you message a Cursor cloud agent from Telegram when your computer is off.

A private message starts an agent on `Elite-Quote-Flow-elitequoteflow.com`, or continues the agent already bound to that chat. The worker waits for the run to finish and sends the reply back to Telegram.

This is separate from the public quote site. Deploying it does not change `elitequoteflow.com`.

## One-time setup

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Send `/start` to `@userinfobot` and copy your numeric user id.
3. In Cursor, open Dashboard → API Keys and create a user API key. The key needs access to Cloud Agents on this GitHub repo.
4. Create a long random string for `TELEGRAM_WEBHOOK_SECRET`.

From this folder:

```bash
npx wrangler deploy
```

Then store the secrets. Wrangler prompts for each value and does not keep it in the repo:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_ALLOWED_USER_IDS
npx wrangler secret put CURSOR_API_KEY
```

`TELEGRAM_ALLOWED_USER_IDS` is your numeric id. Separate extra ids with commas. Until this is set, the bot only replies with the sender's id and does not start an agent.

Point Telegram at the worker URL printed by deploy. The path is `/telegram`.

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
TELEGRAM_WEBHOOK_URL=https://quoteflow-telegram-bridge.<account>.workers.dev/telegram \
node scripts/set-webhook.mjs
```

## Use it

Message the bot in a private chat.

- Any text starts an agent, or continues the current one.
- `/status` shows the bound agent.
- `/attach bc-...` continues an existing agent. The id is the last part of `https://cursor.com/agents/bc-...`.
- `/new` makes the next message start a fresh agent.
- `/cancel` stops the active run.
- `/whoami` shows the Telegram user id.
- `/help` lists the commands.

The agent link in the reply opens that same run on the web. Your laptop does not need to be on.

Only allowlisted users in private chats can start work. Other people get no reply. Photos and files are not forwarded.
