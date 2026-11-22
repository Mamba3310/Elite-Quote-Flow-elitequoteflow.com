const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.env.TELEGRAM_WEBHOOK_URL;

if (!token || !secret || !url) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_WEBHOOK_URL.");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message"],
  }),
});

let payload = null;
try {
  payload = await response.json();
} catch {
  payload = null;
}

if (!response.ok || !payload?.ok) {
  console.error(`Telegram rejected the webhook (${response.status}).`);
  process.exit(1);
}

console.log(`Webhook set for ${url}`);
