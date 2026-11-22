import { DurableObject } from "cloudflare:workers";
import {
  cursorClient,
  handleUpdate,
  pollChats,
  publicError,
  telegramClient,
  webhookAuthorized,
} from "./session.js";

function durableStore(storage) {
  return {
    async get(key) {
      const value = await storage.get(key);
      return value ?? null;
    },
    async put(key, value) {
      await storage.put(key, value);
    },
    async list(prefix) {
      const map = await storage.list({ prefix });
      return [...map.entries()].map(([key, value]) => ({ key, value }));
    },
  };
}

export class TelegramBridge extends DurableObject {
  async fetch(request) {
    const update = await request.json();
    const outcome = await handleUpdate({
      store: durableStore(this.ctx.storage),
      cursor: cursorClient(this.env),
      telegram: telegramClient(this.env),
      env: this.env,
      update,
    });
    if (outcome.scheduleAlarm) {
      const current = await this.ctx.storage.getAlarm();
      if (!current) await this.ctx.storage.setAlarm(Date.now() + 15_000);
    }
    return Response.json({ ok: true });
  }

  async alarm() {
    try {
      const pending = await pollChats({
        store: durableStore(this.ctx.storage),
        cursor: cursorClient(this.env),
        telegram: telegramClient(this.env),
      });
      if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 20_000);
    } catch (error) {
      console.error(publicError(error));
      await this.ctx.storage.setAlarm(Date.now() + 20_000);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }
    if (!webhookAuthorized(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = await request.text();
    if (body.length > 1_000_000) return new Response("Payload too large", { status: 413 });
    let update;
    try {
      update = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!update || typeof update !== "object") return new Response("Bad request", { status: 400 });
    const stub = env.BRIDGE.get(env.BRIDGE.idFromName("owner"));
    return stub.fetch("https://bridge.internal/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  },
};
