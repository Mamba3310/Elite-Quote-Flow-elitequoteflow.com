const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export const HELP = [
  "This bot reaches a Cursor cloud agent for Elite Quote Flow.",
  "Your computer can stay off. The agent runs in Cursor's cloud.",
  "",
  "Send a message to start an agent, or to continue the one this chat is using.",
  "Send a photo of text and the bot reads it into that message.",
  "/status shows that agent",
  "/attach bc-... continues an existing agent",
  "/new starts a fresh agent on your next message",
  "/new <task> starts a fresh agent now",
  "/cancel stops the run that is still going",
  "/whoami shows your Telegram user id",
  "/help shows this message",
].join("\n");

export function webhookAuthorized(headerValue, secret) {
  if (!secret || !headerValue) return false;
  const a = new TextEncoder().encode(String(headerValue));
  const b = new TextEncoder().encode(String(secret));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\bcur_[A-Za-z0-9_]+\b/g, "[redacted]")
    .slice(0, 300);
}

export function splitTelegram(text, limit = 3900) {
  const value = String(text ?? "");
  if (value.length <= limit) return [value];
  const parts = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.5)) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export function interpret(text) {
  const trimmed = String(text ?? "").trim();
  const command = trimmed.match(/^\/([a-z]+)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/i);
  if (!command) return { type: "prompt", text: trimmed };
  const name = command[1].toLowerCase();
  const rest = (command[2] || "").trim();
  if (name === "start" || name === "help") return { type: "help" };
  if (name === "status") return { type: "status" };
  if (name === "cancel" || name === "stop") return { type: "cancel" };
  if (name === "new" || name === "reset") return { type: "new", text: rest };
  if (name === "id" || name === "whoami") return { type: "whoami" };
  if (name === "attach" || name === "use") {
    const id = rest.split(/\s+/)[0] || "";
    return { type: "attach", id };
  }
  return { type: "prompt", text: trimmed };
}

const MAX_IMAGE_BYTES = 1_000_000;
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;
export const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export function imageAttachment(message) {
  const photos = Array.isArray(message?.photo) ? message.photo.filter((photo) => photo?.file_id) : [];
  if (photos.length) {
    const readable = photos.filter((photo) => !photo.file_size || photo.file_size <= MAX_IMAGE_BYTES);
    const pool = readable.length ? readable : photos;
    const best = pool.reduce((current, photo) => ((photo.file_size || 0) >= (current.file_size || 0) ? photo : current));
    return { fileId: best.file_id, mime: "image/jpeg", tooLarge: !readable.length };
  }
  const document = message?.document;
  if (document?.file_id && IMAGE_MIME.test(document.mime_type || "")) {
    return {
      fileId: document.file_id,
      mime: document.mime_type,
      tooLarge: Boolean(document.file_size && document.file_size > MAX_IMAGE_BYTES),
    };
  }
  return null;
}

export function bytesToDataUrl(bytes, mime = "image/jpeg") {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function visionText(result) {
  if (!result) return "";
  if (typeof result === "string") return result.trim();
  return String(result.response || result.description || result.result || "").trim();
}

export function usableTranscript(text) {
  const value = String(text || "").trim();
  if (!value || /^\(no text\)$/i.test(value) || /^no text( visible| found)?\.?$/i.test(value)) return "";
  return value.slice(0, 8000);
}

export function composePrompt(caption, transcript) {
  const note = String(caption || "").trim();
  const text = String(transcript || "").trim();
  if (text && note) return `${note}\n\nText read from the photo:\n${text}`;
  if (text) return `Text read from the photo:\n${text}`;
  return note;
}

export async function readImageText(ai, bytes, mime = "image/jpeg") {
  if (!ai || typeof ai.run !== "function") throw new Error("Photo reading is not configured.");
  if (!bytes?.byteLength) throw new Error("The photo was empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("That photo is too large to read.");
  const result = await ai.run(VISION_MODEL, {
    messages: [{
      role: "user",
      content: "Transcribe every piece of visible text exactly. Keep line breaks. Do not describe the picture. If there is no text, reply with exactly (no text).",
    }],
    image: bytesToDataUrl(bytes, mime),
    max_tokens: 1024,
  });
  return usableTranscript(visionText(result));
}

export function accessFor(env, userId) {
  const ids = String(env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (ids.length === 0) return "unconfigured";
  return ids.includes(String(userId)) ? "allowed" : "denied";
}

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function wrapPrompt(text, repoUrl) {
  return [
    "This message arrived from the owner's Telegram bot.",
    "Their computer may be off. Do the work in this repository and reply in plain text that fits a phone.",
    "Put the outcome in the first paragraphs. Include links to any pull request you open.",
    `Repository: ${repoUrl}`,
    "",
    text,
  ].join("\n");
}

export function formatRun(run, agent) {
  const status = run?.status;
  const headline = status === "FINISHED"
    ? "Done."
    : status === "CANCELLED"
      ? "Cancelled."
      : status === "EXPIRED"
        ? "The run expired."
        : `Stopped (${status || "unknown"}).`;
  const lines = [headline];
  if (run?.result) lines.push("", String(run.result).trim());
  if (agent?.url) lines.push("", agent.url);
  for (const branch of run?.git?.branches || []) {
    if (branch.prUrl) lines.push(branch.prUrl);
    else if (branch.branch) lines.push(`${branch.repoUrl || ""} ${branch.branch}`.trim());
  }
  return lines.join("\n").trim();
}

function chatKey(chatId) {
  return `chat:${chatId}`;
}

function freshChat() {
  return {
    lastUpdateId: 0,
    agentId: null,
    agentUrl: null,
    pending: false,
    watchRunId: null,
    skipRunId: null,
    deliveredRunId: null,
    pollFailures: 0,
  };
}

function agentName(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return `Telegram ${flat}`.slice(0, 100);
}

function apiMessage(data, status) {
  const raw = data?.error?.message || data?.message || data?.error || "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
  const clean = text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bcur_[A-Za-z0-9_]+\b/g, "[redacted]")
    .slice(0, 240);
  return clean || `HTTP ${status}`;
}

export function cursorClient(env, fetchImpl = fetch) {
  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`https://api.cursor.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.CURSOR_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 200) };
      }
    }
    return { ok: response.ok, status: response.status, data, message: apiMessage(data, response.status) };
  }

  return {
    request,
    create(text, userText) {
      return request("/v1/agents", {
        method: "POST",
        body: {
          prompt: { text },
          name: agentName(userText),
          repos: [{ url: env.CURSOR_REPO_URL, startingRef: env.CURSOR_STARTING_REF || "main" }],
          autoCreatePR: false,
        },
      });
    },
    follow(agentId, text) {
      return request(`/v1/agents/${agentId}/runs`, {
        method: "POST",
        body: { prompt: { text } },
      });
    },
    steer(agentId, text) {
      return request(`/v1/agents/${agentId}/runs`, {
        method: "POST",
        body: { prompt: { text }, delivery: "steer" },
      });
    },
    getAgent(agentId) {
      return request(`/v1/agents/${agentId}`);
    },
    getRun(agentId, runId) {
      return request(`/v1/agents/${agentId}/runs/${runId}`);
    },
    cancel(agentId, runId) {
      return request(`/v1/agents/${agentId}/runs/${runId}/cancel`, { method: "POST" });
    },
  };
}

export function telegramClient(env, fetchImpl = fetch) {
  return {
    async send(chatId, text) {
      for (const part of splitTelegram(text)) {
        const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: part,
            disable_web_page_preview: true,
          }),
        });
        if (!response.ok) throw new Error(`Telegram send failed (${response.status})`);
      }
    },
    async download(fileId) {
      if (!fileId || /[^A-Za-z0-9_-]/.test(fileId)) throw new Error("Telegram file id is not valid.");
      const metaResponse = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
      if (!metaResponse.ok) throw new Error(`Telegram file lookup failed (${metaResponse.status})`);
      const meta = await metaResponse.json();
      const path = meta?.result?.file_path;
      if (!path || path.includes("..") || path.startsWith("/")) throw new Error("Telegram file lookup returned no path.");
      const size = Number(meta?.result?.file_size || 0);
      if (size > MAX_IMAGE_BYTES) throw new Error("That photo is too large to read.");
      const fileResponse = await fetchImpl(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
      if (!fileResponse.ok) throw new Error(`Telegram file download failed (${fileResponse.status})`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("That photo is too large to read.");
      return bytes;
    },
  };
}

async function loadChat(store, chatId, updateId) {
  const existing = (await store.get(chatKey(chatId))) || freshChat();
  if (updateId != null && existing.lastUpdateId >= updateId) return { duplicate: true, chat: existing };
  existing.lastUpdateId = updateId ?? existing.lastUpdateId;
  return { duplicate: false, chat: existing };
}

function repoReady(env) {
  return Boolean(env.CURSOR_API_KEY && env.CURSOR_REPO_URL);
}

export async function handleUpdate({ store, cursor, telegram, env, update }) {
  const message = update?.message;
  if (!message || message.chat?.type !== "private") return { ignored: true };
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const access = accessFor(env, userId);
  if (access === "denied") return { ignored: true };

  const loaded = await loadChat(store, chatId, update.update_id);
  if (loaded.duplicate) return { duplicate: true };
  const chat = loaded.chat;
  const typed = message.text || message.caption || "";
  let action = typed ? interpret(typed) : { type: "notext" };
  const image = imageAttachment(message);
  const readsImage = image && (action.type === "notext" || action.type === "prompt" || action.type === "new");

  if (access === "unconfigured") {
    await store.put(chatKey(chatId), chat);
    await telegram.send(chatId, `This bot is closed until an allowlist is set. Your Telegram user id is ${userId}. Add it to TELEGRAM_ALLOWED_USER_IDS, then send /help.`);
    return { scheduleAlarm: false };
  }

  try {
    if (readsImage) {
      if (image.tooLarge) throw new Error("That photo is too large to read.");
      const bytes = await telegram.download(image.fileId);
      const transcript = await readImageText(env.AI, bytes, image.mime);
      if (!transcript && (action.type === "notext" || (action.type === "new" && !action.text))) {
        await store.put(chatKey(chatId), chat);
        await telegram.send(chatId, "I could not read any text in that photo. Try a closer, well-lit picture.");
        return { scheduleAlarm: false };
      }
      const combined = composePrompt(action.type === "notext" ? "" : action.text, transcript);
      if (action.type === "new") action = { type: "new", text: combined };
      else action = { type: "prompt", text: combined };
    }
    if (action.type === "notext") {
      await store.put(chatKey(chatId), chat);
      const otherFile = message.document || message.video || message.audio || message.voice || message.sticker;
      await telegram.send(chatId, otherFile
        ? "Send a text message or a photo of text. Other files stay on your phone."
        : "Send a text message or a photo of text.");
      return { scheduleAlarm: false };
    }
    if (action.type === "whoami") {
      await store.put(chatKey(chatId), chat);
      await telegram.send(chatId, `Your Telegram user id is ${userId}.`);
      return { scheduleAlarm: false };
    }
    if (action.type === "help") {
      await store.put(chatKey(chatId), chat);
      await telegram.send(chatId, HELP);
      return { scheduleAlarm: false };
    }
    if (!repoReady(env)) {
      await store.put(chatKey(chatId), chat);
      await telegram.send(chatId, "The bridge is missing CURSOR_API_KEY or CURSOR_REPO_URL, so it cannot start an agent yet.");
      return { scheduleAlarm: false };
    }
    if (action.type === "status") {
      await store.put(chatKey(chatId), chat);
      await sendStatus(cursor, telegram, chatId, chat);
      return { scheduleAlarm: Boolean(chat.pending) };
    }
    if (action.type === "cancel") {
      const scheduleAlarm = await cancelRun(cursor, telegram, chatId, chat);
      await store.put(chatKey(chatId), chat);
      return { scheduleAlarm };
    }
    if (action.type === "attach") {
      const scheduleAlarm = await attachAgent(cursor, telegram, chatId, chat, action.id);
      await store.put(chatKey(chatId), chat);
      return { scheduleAlarm };
    }
    if (action.type === "new" && !action.text) {
      clearAgent(chat);
      await store.put(chatKey(chatId), chat);
      await telegram.send(chatId, "Cleared. The next message starts a new agent. The previous agent stays in Cursor.");
      return { scheduleAlarm: false };
    }

    const prompt = action.type === "new" ? action.text : action.text;
    const scheduleAlarm = action.type === "new" || !chat.agentId
      ? await startAgent(cursor, telegram, env, chatId, chat, prompt)
      : await continueAgent(cursor, telegram, env, chatId, chat, prompt);
    await store.put(chatKey(chatId), chat);
    return { scheduleAlarm };
  } catch (error) {
    await store.put(chatKey(chatId), chat);
    await telegram.send(chatId, `Something went wrong. ${publicError(error)}`);
    return { scheduleAlarm: Boolean(chat.pending) };
  }
}

function clearAgent(chat) {
  chat.agentId = null;
  chat.agentUrl = null;
  chat.pending = false;
  chat.watchRunId = null;
  chat.skipRunId = null;
}

async function sendStatus(cursor, telegram, chatId, chat) {
  if (!chat.agentId) {
    await telegram.send(chatId, "No agent yet. Send a message to start one, or /attach bc-... to continue one.");
    return;
  }
  const agentResponse = await cursor.getAgent(chat.agentId);
  if (!agentResponse.ok) {
    await telegram.send(chatId, `I could not read that agent. ${agentResponse.message}`);
    return;
  }
  const agent = agentResponse.data;
  const lines = [agent.name || "Cloud agent", agent.status || "unknown", agent.url || chat.agentUrl].filter(Boolean);
  if (agent.latestRunId) {
    const runResponse = await cursor.getRun(chat.agentId, agent.latestRunId);
    if (runResponse.ok) lines.push(`Run ${runResponse.data.status}`);
  }
  await telegram.send(chatId, lines.join("\n"));
}

async function cancelRun(cursor, telegram, chatId, chat) {
  if (!chat.agentId) {
    await telegram.send(chatId, "No agent is bound to this chat.");
    return false;
  }
  const agentResponse = await cursor.getAgent(chat.agentId);
  if (!agentResponse.ok) {
    await telegram.send(chatId, `I could not read that agent. ${agentResponse.message}`);
    return Boolean(chat.pending);
  }
  const runId = chat.watchRunId || agentResponse.data.latestRunId;
  if (!runId) {
    await telegram.send(chatId, "That agent has no run to cancel.");
    return false;
  }
  const runResponse = await cursor.getRun(chat.agentId, runId);
  if (runResponse.ok && isTerminal(runResponse.data.status)) {
    await telegram.send(chatId, `That run already ${runResponse.data.status.toLowerCase()}.`);
    return false;
  }
  const cancelled = await cursor.cancel(chat.agentId, runId);
  if (!cancelled.ok) {
    await telegram.send(chatId, `I could not cancel that run. ${cancelled.message}`);
    return Boolean(chat.pending);
  }
  chat.pending = false;
  chat.watchRunId = null;
  chat.skipRunId = null;
  await telegram.send(chatId, "Cancelled. Send another message to continue this agent, or /new to start over.");
  return false;
}

async function attachAgent(cursor, telegram, chatId, chat, agentId) {
  if (!/^bc-[A-Za-z0-9-]+$/.test(agentId || "")) {
    await telegram.send(chatId, "Use /attach bc-... with the agent id from its Cursor link.");
    return false;
  }
  const agentResponse = await cursor.getAgent(agentId);
  if (!agentResponse.ok) {
    await telegram.send(chatId, `I could not attach to that agent. ${agentResponse.message}`);
    return false;
  }
  const agent = agentResponse.data;
  chat.agentId = agent.id || agentId;
  chat.agentUrl = agent.url || null;
  chat.pending = false;
  chat.watchRunId = null;
  chat.skipRunId = null;
  let scheduleAlarm = false;
  if (agent.latestRunId) {
    const runResponse = await cursor.getRun(chat.agentId, agent.latestRunId);
    if (runResponse.ok && !isTerminal(runResponse.data.status)) {
      chat.pending = true;
      chat.watchRunId = agent.latestRunId;
      scheduleAlarm = true;
    }
  }
  const extra = scheduleAlarm ? "\nIt is still running. I will send the result here." : "\nMessages now continue this agent.";
  await telegram.send(chatId, `Attached to ${agent.name || chat.agentId}.${extra}\n${chat.agentUrl || ""}`.trim());
  return scheduleAlarm;
}

async function startAgent(cursor, telegram, env, chatId, chat, prompt) {
  const created = await cursor.create(wrapPrompt(prompt, env.CURSOR_REPO_URL), prompt);
  if (!created.ok) {
    await telegram.send(chatId, `I could not start an agent. ${created.message}`);
    return false;
  }
  const agent = created.data.agent;
  const run = created.data.run;
  chat.agentId = agent.id;
  chat.agentUrl = agent.url;
  chat.pending = true;
  chat.watchRunId = run.id;
  chat.skipRunId = null;
  chat.pollFailures = 0;
  await telegram.send(chatId, `Started.\n${agent.url}\nI will message you here when it finishes. Your computer can stay off.`);
  return true;
}

async function continueAgent(cursor, telegram, env, chatId, chat, prompt) {
  const wrapped = wrapPrompt(prompt, env.CURSOR_REPO_URL);
  const follow = await cursor.follow(chat.agentId, wrapped);
  if (follow.ok) {
    chat.pending = true;
    chat.watchRunId = follow.data.run.id;
    chat.skipRunId = null;
    chat.pollFailures = 0;
    await telegram.send(chatId, `Sent.\n${chat.agentUrl || `https://cursor.com/agents/${chat.agentId}`}\nI will message you here when it finishes.`);
    return true;
  }
  if (follow.status !== 409) {
    await telegram.send(chatId, `I could not send that message. ${follow.message}`);
    return Boolean(chat.pending);
  }
  const current = await cursor.getAgent(chat.agentId);
  const currentRunId = current.ok ? current.data.latestRunId : chat.watchRunId;
  const steer = await cursor.steer(chat.agentId, wrapped);
  if (steer.status === 403) {
    await telegram.send(chatId, "The agent is still working and cannot take another message yet. Try again when /status says it is idle.");
    return Boolean(chat.pending);
  }
  if (!steer.ok) {
    await telegram.send(chatId, `The agent is busy and did not take that message. ${steer.message}`);
    return Boolean(chat.pending);
  }
  chat.pending = true;
  chat.pollFailures = 0;
  if (steer.data?.delivery === "queued") {
    chat.watchRunId = null;
    chat.skipRunId = currentRunId || null;
    await telegram.send(chatId, `Queued. It will run after the current one finishes.\n${chat.agentUrl || ""}`.trim());
  } else {
    chat.watchRunId = steer.data?.runId || currentRunId || null;
    chat.skipRunId = null;
    await telegram.send(chatId, `Added to the run that is already going.\n${chat.agentUrl || ""}`.trim());
  }
  return true;
}

function chatKeyToId(key) {
  return key.slice("chat:".length);
}

export async function pollChats({ store, cursor, telegram }) {
  const chats = await store.list("chat:");
  let pending = 0;
  for (const item of chats) {
    const chat = item.value;
    const chatId = chatKeyToId(item.key);
    if (!chat?.pending || !chat.agentId) continue;
    try {
      const stillPending = await deliverOne(cursor, telegram, chat, chatId);
      if (stillPending) pending += 1;
      else chat.pollFailures = 0;
    } catch (error) {
      chat.pollFailures = (chat.pollFailures || 0) + 1;
      pending += 1;
      if (chat.pollFailures === 5) {
        await telegram.send(chatId, `I cannot read the agent run right now. I will keep checking. ${publicError(error)}`);
      }
    }
    await store.put(item.key, chat);
  }
  return pending;
}

async function deliverOne(cursor, telegram, chat, chatId) {
  const agentResponse = await cursor.getAgent(chat.agentId);
  if (!agentResponse.ok) throw new Error(agentResponse.message);
  const agent = agentResponse.data;
  if (agent.url) chat.agentUrl = agent.url;
  let runId = chat.watchRunId;
  if (!runId) {
    if (!agent.latestRunId || agent.latestRunId === chat.skipRunId) {
      if (agent.status === "IDLE" && agent.latestRunId && agent.latestRunId === chat.skipRunId) runId = agent.latestRunId;
      else return true;
    } else {
      runId = agent.latestRunId;
      chat.watchRunId = runId;
    }
  }
  const runResponse = await cursor.getRun(chat.agentId, runId);
  if (!runResponse.ok) throw new Error(runResponse.message);
  if (!isTerminal(runResponse.data.status)) return true;
  if (chat.deliveredRunId !== runResponse.data.id) {
    await telegram.send(chatId, formatRun(runResponse.data, agent));
    chat.deliveredRunId = runResponse.data.id;
  }
  chat.pending = false;
  chat.watchRunId = null;
  chat.skipRunId = null;
  return false;
}
