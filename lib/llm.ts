// Every text-in, text-out model call goes through here, to one of three
// providers: the Claude Code CLI (your subscription, no key), the Anthropic
// API, or any OpenAI-compatible API (OpenAI, OpenRouter, Ollama, LM Studio).
// Two tiers: `fast` for bounded judgement calls (scoring, field extraction),
// `best` for what a person reads and sends (facts, CV, letter).

import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "./store.ts";

export type Llm = (prompt: string) => Promise<string>;

let cachedCliPath: string | null | undefined;

/** Path to the Claude Code CLI, or null. CLAUDE_BIN overrides; cached. */
export function claudeCliPath(): string | null {
  if (cachedCliPath !== undefined) return cachedCliPath;
  const override = process.env.CLAUDE_BIN;
  if (override) {
    cachedCliPath = spawnSync(override, ["--version"], { timeout: 10_000 }).status === 0 ? override : null;
    return cachedCliPath;
  }
  const which = spawnSync("which", ["claude"], { timeout: 10_000, encoding: "utf8" });
  const found = which.status === 0 ? which.stdout.split("\n")[0]?.trim() : "";
  cachedCliPath = found || null;
  return cachedCliPath;
}

/**
 * Prompt on stdin, from the OS temp dir so no project CLAUDE.md or permission
 * prompt leaks in. A tailored CV + letter is long output, hence five minutes.
 * `model` overrides `CLAUDE_CLI_MODEL` for this one call; an alias like
 * "haiku" or "sonnet" resolves to that family's latest model.
 */
export function callClaudeCli(prompt: string, timeoutMs = 300_000, model?: string): Promise<string> {
  const bin = claudeCliPath();
  if (!bin) return Promise.reject(new Error("Claude Code CLI not found. Install it, or pick another AI provider in Settings."));
  const args = ["-p", "--output-format", "json"];
  const m = model ?? process.env.CLAUDE_CLI_MODEL;
  if (m) args.push("--model", m);
  return new Promise<string>((resolve, reject) => {
    const env = { ...process.env };
    // Bill the subscription, never a stray key in the environment.
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(bin, args, { cwd: os.tmpdir(), env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let result: string;
      try {
        result = extractCliResult(stdout);
      } catch (e) {
        return reject(e);
      }
      if (code !== 0) return reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 400)}`));
      resolve(result);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * `--output-format json` wraps the answer; unwrap defensively. An error
 * envelope throws: over SSH the CLI answers "Not logged in · Please run
 * /login" as its *result*, and passing that on as a model answer surfaces
 * later as a baffling "could not be parsed".
 */
export function extractCliResult(stdout: string): string {
  let o: Record<string, unknown> | null = null;
  try {
    o = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return stdout; // Not JSON: plain -p output.
  }
  if (o?.is_error === true) throw new Error(`Claude CLI: ${String(o.result ?? "error")}`);
  return typeof o?.result === "string" ? o.result : stdout;
}

/** The first `{` to the last `}`, parsed. Null when the model answered in prose. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  // The first "}" that closes a parseable object, not the last one in the
  // text: a model that adds a note after its JSON may put braces in it.
  for (let end = raw.indexOf("}", start); end > 0; end = raw.indexOf("}", end + 1)) {
    try {
      const v = JSON.parse(raw.slice(start, end + 1));
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      // not closed yet, try the next brace
    }
  }
  // Seen live 2026-09-11: a complete object with only the final "}" missing.
  try {
    const v = JSON.parse(`${raw.slice(start).trimEnd()}}`);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export type Provider = "claude-cli" | "anthropic" | "openai";
export type Tier = "fast" | "best";
export const PROVIDERS: Provider[] = ["claude-cli", "anthropic", "openai"];

/** What Settings stores, per provider, so switching back and forth keeps each one's key and models. */
export interface ProviderSettings {
  provider: Provider;
  "claude-cli": { fast: string; best: string };
  anthropic: { key: string; fast: string; best: string };
  openai: { key: string; baseUrl: string; fast: string; best: string };
}

/** One provider, resolved: environment over file over defaults. */
export interface LlmConfig {
  provider: Provider;
  key: string;
  baseUrl: string;
  fast: string;
  best: string;
}

/** 0600, apart from config.json (which is written 0644): it holds API keys. */
export const PROVIDERS_PATH = path.join(DATA_DIR, "providers.json");

/** Blank model fields fall back to these. OpenAI-compatible servers name their models too differently to guess. */
export const DEFAULT_MODELS: Record<Provider, { fast: string; best: string }> = {
  "claude-cli": { fast: "haiku", best: "sonnet" },
  anthropic: { fast: "claude-haiku-4-5-20251001", best: "claude-sonnet-5-5" },
  openai: { fast: "", best: "" },
};
export const OPENAI_BASE = "https://api.openai.com/v1";

export function readProviderSettings(): ProviderSettings {
  const s = readJson<Partial<ProviderSettings>>(PROVIDERS_PATH, {});
  return {
    provider: PROVIDERS.includes(s.provider as Provider) ? (s.provider as Provider) : "claude-cli",
    "claude-cli": { fast: "", best: "", ...s["claude-cli"] },
    anthropic: { key: "", fast: "", best: "", ...s.anthropic },
    openai: { key: "", baseUrl: "", fast: "", best: "", ...s.openai },
  };
}

export function saveProviderSettings(s: ProviderSettings): void {
  writeJson(PROVIDERS_PATH, s);
}

export function readLlmConfig(env: NodeJS.ProcessEnv = process.env, s = readProviderSettings()): LlmConfig {
  const provider = PROVIDERS.includes(env.JOB_AGENT_PROVIDER as Provider) ? (env.JOB_AGENT_PROVIDER as Provider) : s.provider;
  const d = DEFAULT_MODELS[provider];
  const own = s[provider];
  const key = provider === "anthropic" ? env.ANTHROPIC_API_KEY || s.anthropic.key : provider === "openai" ? env.OPENAI_API_KEY || s.openai.key : "";
  const baseUrl = provider === "openai" ? (env.OPENAI_BASE_URL || s.openai.baseUrl || OPENAI_BASE).replace(/\/+$/, "") : "";
  const best = own.best || d.best;
  // An OpenAI-compatible server with one model: fast falls back to best.
  return { provider, key, baseUrl, fast: own.fast || d.fast || best, best };
}

/** Where the key came from, for Settings. Never the key itself. */
export function keySource(provider: "anthropic" | "openai", env: NodeJS.ProcessEnv = process.env, s = readProviderSettings()): "env" | "file" | "" {
  if (env[provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"]) return "env";
  return s[provider].key ? "file" : "";
}

const TIMEOUT_MS = 300_000;

/** A failed API call: the status and the start of the body, never the request (which carries the key). */
async function apiError(name: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  return new Error(`${name} answered ${r.status}${body ? `: ${body}` : ""}`);
}

export async function complete(prompt: string, tier: Tier, deps: { config?: LlmConfig; fetch?: typeof fetch } = {}): Promise<string> {
  const c = deps.config ?? readLlmConfig();
  const go = deps.fetch ?? fetch;
  const model = c[tier];
  if (c.provider === "claude-cli") return callClaudeCli(prompt, TIMEOUT_MS, model);
  if (!model) throw new Error(`No ${tier} model set for ${c.provider}. Add one in Settings.`);
  if (c.provider === "anthropic") {
    if (!c.key) throw new Error("No Anthropic API key. Add one in Settings.");
    const r = await go("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw await apiError("Anthropic", r);
    const o = (await r.json()) as { content?: { type: string; text?: string }[] };
    return (o.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  // OpenAI-compatible. A local server (Ollama, LM Studio) needs no key. The body
  // stays minimal: servers disagree on max_tokens naming and some models reject
  // a temperature.
  const r = await go(`${c.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw await apiError("The OpenAI-compatible API", r);
  const o = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return o.choices?.[0]?.message?.content ?? "";
}

/** Why no model call can work right now, or null. Shown on the home page and in Settings. */
export function llmProblem(c: LlmConfig = readLlmConfig()): string | null {
  if (c.provider === "claude-cli" && !claudeCliPath()) return "Claude Code is not installed. Install it, or pick another AI provider in Settings.";
  if (c.provider === "anthropic" && !c.key) return "No Anthropic API key yet. Add one in Settings.";
  if (c.provider === "openai" && !c.best) return "No model name for the OpenAI-compatible API yet. Add one in Settings.";
  return null;
}

/** Bounded, rubric-following judgement calls: scoring, reading an ad into fields. */
export const fastLlm: Llm = (prompt) => complete(prompt, "fast");
/** What a person reads and sends: the facts from their CV, the CV bullets, the letter. */
export const bestLlm: Llm = (prompt) => complete(prompt, "best");
