import test from "node:test";
import assert from "node:assert/strict";
import {
  accessFor,
  bytesToDataUrl,
  composePrompt,
  cursorClient,
  formatRun,
  handleUpdate,
  imageAttachment,
  interpret,
  pollChats,
  publicError,
  readImageText,
  splitTelegram,
  telegramClient,
  usableTranscript,
  webhookAuthorized,
  wrapPrompt,
} from "./session.js";

const env = {
  TELEGRAM_ALLOWED_USER_IDS: "42",
  TELEGRAM_BOT_TOKEN: "123456:secret-token",
  CURSOR_API_KEY: "cur_test_key",
  CURSOR_REPO_URL: "https://github.com/Mamba3310/Elite-Quote-Flow-elitequoteflow.com",
  CURSOR_STARTING_REF: "main",
};

function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async put(key, value) {
      data.set(key, structuredClone(value));
    },
    async list(prefix) {
      return [...data.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value: structuredClone(value) }));
    },
  };
}

function message(updateId, text, userId = 42, type = "private") {
  return {
    update_id: updateId,
    message: { message_id: updateId, text, from: { id: userId }, chat: { id: 42, type } },
  };
}

function recorder() {
  const sent = [];
  const calls = [];
  return {
    sent,
    calls,
    telegram: {
      async send(chatId, text) {
        sent.push({ chatId, text });
      },
    },
    cursor: {
      async create(text, userText) {
        calls.push({ op: "create", text, userText });
        return {
          ok: true,
          status: 200,
          data: {
            agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1", name: "Telegram task" },
            run: { id: "run-1", status: "CREATING" },
          },
        };
      },
      async follow(agentId, text) {
        calls.push({ op: "follow", agentId, text });
        return { ok: true, status: 200, data: { run: { id: "run-2", status: "CREATING" } } };
      },
      async steer() {
        throw new Error("steer should not be called");
      },
      async getAgent() {
        return { ok: true, status: 200, data: { id: "bc-1", status: "IDLE", latestRunId: "run-1", url: "https://cursor.com/agents/bc-1" } };
      },
      async getRun() {
        return { ok: true, status: 200, data: { id: "run-1", status: "FINISHED", result: "Shipped." } };
      },
      async cancel() {
        return { ok: true, status: 200, data: { id: "run-1" } };
      },
    },
  };
}

test("webhook secret matches the full header and ignores a different length", () => {
  assert.equal(webhookAuthorized("abc", "abc"), true);
  assert.equal(webhookAuthorized("abd", "abc"), false);
  assert.equal(webhookAuthorized("abcd", "abc"), false);
  assert.equal(webhookAuthorized("", "abc"), false);
  assert.equal(webhookAuthorized("abc", ""), false);
});

test("public errors strip credentials", () => {
  const text = publicError(new Error("failed Bearer cur_test_key bot 123456:secret-token"));
  assert.equal(text.includes("cur_test_key"), false);
  assert.equal(text.includes("secret-token"), false);
  assert.match(text, /Bearer \[redacted\]/);
});

test("commands and long replies are parsed for Telegram", () => {
  assert.deepEqual(interpret("/help@EliteBridge"), { type: "help" });
  assert.deepEqual(interpret("/attach bc-123"), { type: "attach", id: "bc-123" });
  assert.equal(interpret("fix the header").type, "prompt");
  const parts = splitTelegram(`${"a".repeat(20)}\n${"b".repeat(20)}`, 25);
  assert.ok(parts.every((part) => part.length <= 25));
  assert.equal(parts.join(""), `${"a".repeat(20)}${"b".repeat(20)}`);
  assert.match(wrapPrompt("hello", env.CURSOR_REPO_URL), /hello/);
  assert.match(formatRun({ status: "FINISHED", result: "Shipped.", git: { branches: [{ prUrl: "https://github.com/pr/1" }] } }, { url: "https://cursor.com/agents/bc-1" }), /https:\/\/github.com\/pr\/1/);
});

test("a stranger gets silence and an unconfigured bot only reveals the sender id", async () => {
  const store = memoryStore();
  const first = recorder();
  const denied = await handleUpdate({
    store,
    cursor: first.cursor,
    telegram: first.telegram,
    env,
    update: message(1, "hello", 7),
  });
  assert.equal(denied.ignored, true);
  assert.equal(first.sent.length, 0);
  assert.equal(first.calls.length, 0);

  const second = recorder();
  await handleUpdate({
    store,
    cursor: second.cursor,
    telegram: second.telegram,
    env: { ...env, TELEGRAM_ALLOWED_USER_IDS: "" },
    update: message(2, "/start", 7),
  });
  assert.match(second.sent[0].text, /user id is 7/);
  assert.equal(second.calls.length, 0);
});

test("the first message creates an agent and a repeat continues it", async () => {
  const store = memoryStore();
  const io = recorder();
  const started = await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update: message(1, "Add a health check") });
  assert.equal(started.scheduleAlarm, true);
  assert.equal(io.calls[0].op, "create");
  assert.match(io.calls[0].text, /Add a health check/);
  assert.match(io.sent[0].text, /cursor.com\/agents\/bc-1/);
  assert.equal(store.data.get("chat:42").agentId, "bc-1");

  const again = await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update: message(1, "Add a health check") });
  assert.equal(again.duplicate, true);
  assert.equal(io.calls.length, 1);

  await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update: message(2, "Also cover timeouts") });
  assert.equal(io.calls.at(-1).op, "follow");
  assert.equal(store.data.get("chat:42").watchRunId, "run-2");
});

test("a busy agent is steered instead of starting a second run", async () => {
  const store = memoryStore({
    "chat:42": { lastUpdateId: 1, agentId: "bc-1", agentUrl: "https://cursor.com/agents/bc-1", pending: true, watchRunId: "run-1" },
  });
  const calls = [];
  const sent = [];
  const cursor = {
    async follow(agentId, text) {
      calls.push({ op: "follow", agentId, text });
      return { ok: false, status: 409, message: "agent_busy" };
    },
    async getAgent() {
      return { ok: true, status: 200, data: { latestRunId: "run-1", status: "RUNNING" } };
    },
    async steer(agentId, text) {
      calls.push({ op: "steer", agentId, text });
      return { ok: true, status: 202, data: { delivery: "queued" } };
    },
  };
  const outcome = await handleUpdate({
    store,
    cursor,
    telegram: { async send(chatId, text) { sent.push({ chatId, text }); } },
    env,
    update: message(2, "Check the empty state too"),
  });
  assert.equal(outcome.scheduleAlarm, true);
  assert.equal(calls[1].op, "steer");
  assert.equal(store.data.get("chat:42").skipRunId, "run-1");
  assert.match(sent[0].text, /Queued/);
});

test("/new clears the binding and /attach checks the agent id", async () => {
  const store = memoryStore({
    "chat:42": { lastUpdateId: 1, agentId: "bc-1", agentUrl: "https://cursor.com/agents/bc-1", pending: false },
  });
  const io = recorder();
  await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update: message(2, "/new") });
  assert.equal(store.data.get("chat:42").agentId, null);
  await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update: message(3, "/attach not-an-id") });
  assert.match(io.sent.at(-1).text, /bc-\.\.\./);
  assert.equal(io.calls.length, 0);
});

test("polling delivers a finished run once", async () => {
  const store = memoryStore({
    "chat:42": {
      lastUpdateId: 1,
      agentId: "bc-1",
      pending: true,
      watchRunId: "run-1",
      deliveredRunId: null,
      pollFailures: 0,
    },
  });
  const sent = [];
  const cursor = {
    async getAgent() {
      return { ok: true, data: { id: "bc-1", status: "IDLE", latestRunId: "run-1", url: "https://cursor.com/agents/bc-1" } };
    },
    async getRun() {
      return { ok: true, data: { id: "run-1", status: "FINISHED", result: "Shipped the health check." } };
    },
  };
  const telegram = { async send(chatId, text) { sent.push({ chatId, text }); } };
  const pending = await pollChats({ store, cursor, telegram });
  assert.equal(pending, 0);
  assert.match(sent[0].text, /Shipped the health check/);
  const again = await pollChats({ store, cursor, telegram });
  assert.equal(again, 0);
  assert.equal(sent.length, 1);
});

test("a queued steer waits until the agent is idle before delivering the skipped run", async () => {
  const store = memoryStore({
    "chat:42": { agentId: "bc-1", pending: true, watchRunId: null, skipRunId: "run-1", pollFailures: 0 },
  });
  let status = "RUNNING";
  const sent = [];
  const cursor = {
    async getAgent() {
      return { ok: true, data: { status, latestRunId: "run-1", url: "https://cursor.com/agents/bc-1" } };
    },
    async getRun() {
      return { ok: true, data: { id: "run-1", status: "FINISHED", result: "Done after the extra note." } };
    },
  };
  const telegram = { async send(_chatId, text) { sent.push(text); } };
  assert.equal(await pollChats({ store, cursor, telegram }), 1);
  assert.equal(sent.length, 0);
  status = "IDLE";
  assert.equal(await pollChats({ store, cursor, telegram }), 0);
  assert.match(sent[0], /Done after the extra note/);
});

test("the Cursor client posts a create without putting the key in the body", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    return new Response(JSON.stringify({ agent: { id: "bc-1" }, run: { id: "run-1" } }), { status: 200 });
  };
  const client = cursorClient(env, fetchImpl);
  const response = await client.create("wrapped prompt", "Add a health check");
  assert.equal(response.ok, true);
  assert.equal(seen[0].url, "https://api.cursor.com/v1/agents");
  const body = JSON.parse(seen[0].options.body);
  assert.equal(body.repos[0].url, env.CURSOR_REPO_URL);
  assert.equal(body.repos[0].startingRef, "main");
  assert.equal(body.autoCreatePR, false);
  assert.equal(body.name.startsWith("Telegram Add a health"), true);
  assert.equal(JSON.stringify(body).includes(env.CURSOR_API_KEY), false);
  assert.equal(seen[0].options.headers.Authorization, "Bearer cur_test_key");
  assert.equal(accessFor(env, 42), "allowed");
});

test("a photo is read and the text starts the agent", async () => {
  const store = memoryStore();
  const io = recorder();
  const seen = [];
  io.telegram.download = async (fileId) => {
    seen.push(fileId);
    return new Uint8Array([1, 2, 3]);
  };
  const ai = {
    async run(model, input) {
      seen.push({ model, image: input.image.slice(0, 23) });
      return { result: "Labor 2 hours\nMaterials $40" };
    },
  };
  const update = {
    update_id: 9,
    message: {
      message_id: 9,
      caption: "Turn this into a quote",
      photo: [{ file_id: "small", file_size: 20 }, { file_id: "large", file_size: 900 }],
      from: { id: 42 },
      chat: { id: 42, type: "private" },
    },
  };
  const outcome = await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env: { ...env, AI: ai }, update });
  assert.equal(outcome.scheduleAlarm, true);
  assert.deepEqual(seen, ["large", { model: "@cf/meta/llama-3.2-11b-vision-instruct", image: "data:image/jpeg;base64," }]);
  assert.match(io.calls[0].text, /Turn this into a quote/);
  assert.match(io.calls[0].text, /Labor 2 hours/);
  assert.equal(io.sent.some((item) => /stay on your phone/.test(item.text)), false);
});

test("a photo with no readable text does not start an agent", async () => {
  const store = memoryStore();
  const io = recorder();
  io.telegram.download = async () => new Uint8Array([9]);
  const ai = { async run() { return { result: "(no text)" }; } };
  const update = {
    update_id: 10,
    message: {
      photo: [{ file_id: "only", file_size: 40 }],
      from: { id: 42 },
      chat: { id: 42, type: "private" },
    },
  };
  const outcome = await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env: { ...env, AI: ai }, update });
  assert.equal(outcome.scheduleAlarm, false);
  assert.equal(io.calls.length, 0);
  assert.match(io.sent[0].text, /could not read any text/);
});

test("a non-image file is refused and the photo disclaimer is gone", async () => {
  const store = memoryStore();
  const io = recorder();
  const update = {
    update_id: 11,
    message: {
      document: { file_id: "doc", mime_type: "application/pdf" },
      from: { id: 42 },
      chat: { id: 42, type: "private" },
    },
  };
  await handleUpdate({ store, cursor: io.cursor, telegram: io.telegram, env, update });
  assert.match(io.sent[0].text, /photo of text/);
  assert.doesNotMatch(io.sent[0].text, /Photos and files stay on your phone/);
  assert.equal(io.calls.length, 0);
  assert.equal(imageAttachment({ photo: [{ file_id: "big", file_size: 2_000_000 }, { file_id: "ok", file_size: 500 }] }).fileId, "ok");
  assert.equal(usableTranscript("(no text)"), "");
  assert.match(composePrompt("Caption", "Hello"), /Text read from the photo:\nHello/);
  const encoded = bytesToDataUrl(new Uint8Array([104, 105]), "image/png");
  assert.equal(encoded, "data:image/png;base64,aGk=");
  const read = await readImageText({ async run() { return { response: "Invoice 12" }; } }, new Uint8Array([1]));
  assert.equal(read, "Invoice 12");
});

test("telegram download fetches the file and rejects a path escape", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/getFile")) {
      return new Response(JSON.stringify({ result: { file_path: "photos/note.jpg", file_size: 4 } }), { status: 200 });
    }
    return new Response(Uint8Array.from([7, 8]), { status: 200 });
  };
  const client = telegramClient(env, fetchImpl);
  const bytes = await client.download("Abc_123");
  assert.deepEqual([...bytes], [7, 8]);
  assert.match(calls[0], /getFile\?file_id=Abc_123$/);
  assert.match(calls[1], /\/file\/bot123456:secret-token\/photos\/note\.jpg$/);
  await assert.rejects(
    () => telegramClient(env, async () => new Response(JSON.stringify({ result: { file_path: "../secret" } }), { status: 200 })).download("Abc_123"),
    /no path/,
  );
});
