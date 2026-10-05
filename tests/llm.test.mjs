import "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCliResult, parseJsonObject } from "../lib/llm.ts";

test("the CLI's error envelope throws instead of posing as an answer", () => {
  assert.equal(extractCliResult('{"is_error":false,"result":"{\\"score\\":7}"}'), '{"score":7}');
  assert.throws(() => extractCliResult('{"is_error":true,"result":"Not logged in · Please run /login"}'), /Not logged in/);
  assert.equal(extractCliResult("plain text"), "plain text");
});

test("parseJsonObject finds the object in a chatty answer", () => {
  assert.deepEqual(parseJsonObject('Sure! {"a": 1} Hope that helps.'), { a: 1 });
  assert.equal(parseJsonObject("no json"), null);
  assert.equal(parseJsonObject("[1,2]"), null);
});

import { complete, keySource, readLlmConfig, readProviderSettings, saveProviderSettings } from "../lib/llm.ts";
import { settingsPage } from "../web/settings.ts";

/** A fake fetch that records the call and answers with `body`. */
function fakeFetch(body, status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { f, calls };
}

const anthropic = { provider: "anthropic", key: "sk-ant-SECRET", baseUrl: "", fast: "claude-fast", best: "claude-best" };
const openai = { provider: "openai", key: "", baseUrl: "http://127.0.0.1:11434/v1", fast: "llama3", best: "llama3" };

test("anthropic: messages API, key in x-api-key, the tier picks the model, text blocks joined", async () => {
  const { f, calls } = fakeFetch({ content: [{ type: "text", text: "hel" }, { type: "tool_use" }, { type: "text", text: "lo" }] });
  assert.equal(await complete("hi", "best", { config: anthropic, fetch: f }), "hello");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-SECRET");
  assert.ok(calls[0].init.headers["anthropic-version"]);
  assert.equal(calls[0].body.model, "claude-best");
  assert.deepEqual(calls[0].body.messages, [{ role: "user", content: "hi" }]);
  await complete("hi", "fast", { config: anthropic, fetch: f });
  assert.equal(calls[1].body.model, "claude-fast");
});

test("openai-compatible: base URL, no auth header without a key, first choice returned", async () => {
  const { f, calls } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
  assert.equal(await complete("hi", "fast", { config: openai, fetch: f }), "ok");
  assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["messages", "model"]);
  await complete("hi", "fast", { config: { ...openai, key: "sk-x" }, fetch: f });
  assert.equal(calls[1].init.headers.authorization, "Bearer sk-x");
});

test("a failed call says the status and the body, never the key; a missing key or model says where to fix it", async () => {
  const { f } = fakeFetch('{"error":{"message":"invalid x-api-key"}}', 401);
  await assert.rejects(complete("hi", "best", { config: anthropic, fetch: f }), (e) => /401/.test(e.message) && !e.message.includes("SECRET"));
  await assert.rejects(complete("hi", "best", { config: { ...anthropic, key: "" }, fetch: f }), /Settings/);
  await assert.rejects(complete("hi", "best", { config: { ...openai, best: "" }, fetch: f }), /Settings/);
});

test("config: environment beats the file, blank models fall back, fast falls back to best", () => {
  saveProviderSettings({ ...readProviderSettings(), provider: "openai", openai: { key: "file-key", baseUrl: "", fast: "", best: "m" } });
  const fromFile = readLlmConfig({});
  assert.equal(fromFile.provider, "openai");
  assert.equal(fromFile.key, "file-key");
  assert.equal(fromFile.baseUrl, "https://api.openai.com/v1");
  assert.equal(fromFile.fast, "m");
  const fromEnv = readLlmConfig({ JOB_AGENT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "env-key" });
  assert.equal(fromEnv.provider, "anthropic");
  assert.equal(fromEnv.key, "env-key");
  assert.match(fromEnv.best, /^claude-/);
  assert.equal(keySource("openai", {}), "file");
  assert.equal(keySource("anthropic", { ANTHROPIC_API_KEY: "x" }), "env");
});

test("the settings page never contains a saved key", () => {
  saveProviderSettings({ ...readProviderSettings(), provider: "anthropic", anthropic: { key: "sk-ant-NEVER-SHOWN", fast: "", best: "" } });
  const html = settingsPage([]);
  assert.ok(!html.includes("NEVER-SHOWN"));
  assert.match(html, /AI provider/);
});
