import { listRuns } from "../lib/agent.ts";
import { claudeCliPath, DEFAULT_MODELS, keySource, llmProblem, OPENAI_BASE, PROVIDERS, readLlmConfig, readProviderSettings, type Provider } from "../lib/llm.ts";
import { hostOf, isStopped, LOCKED, MODES, readLimits, readPolicy } from "../lib/policy.ts";
import { readBoards } from "../lib/sources/boards.ts";
import { readSponsors } from "../lib/sponsors.ts";
import type { Job } from "../lib/types.ts";
import { esc, page } from "./layout.ts";

const KNOWN_HOSTS = ["greenhouse.io", "lever.co", "recruitee.com", "workable.com", "smartrecruiters.com", "myworkdayjobs.com", "indeed.com"];

const LABEL: Record<Provider, string> = { "claude-cli": "Claude Code (your subscription, no key)", anthropic: "Anthropic API key", openai: "OpenAI-compatible API (OpenAI, OpenRouter, Ollama, LM Studio)" };

/** The AI provider card. A saved key is never written into the page, only whether one is set. */
function aiCard(): string {
  const s = readProviderSettings();
  const active = readLlmConfig().provider;
  const problem = llmProblem();
  const model = (p: Provider, tier: "fast" | "best", name: string) =>
    `<input name="${name}" value="${esc(s[p][tier])}" placeholder="${esc(DEFAULT_MODELS[p][tier] || (tier === "fast" ? "blank = same as best" : "model name"))}">`;
  const key = (p: "anthropic" | "openai", name: string) => {
    const src = keySource(p);
    return `<input type="password" name="${name}" autocomplete="off" placeholder="${src === "env" ? "set in the environment" : src === "file" ? "saved — leave blank to keep" : "paste the key"}">
${src === "file" ? `<label style="font-weight:400;margin-top:6px"><input type="checkbox" name="${name}Clear"> forget the saved key</label>` : ""}`;
  };
  const cli = claudeCliPath();
  return `<div class="card"><h3>AI provider</h3><p class="small mute">Reads CVs, scores jobs, writes CVs and letters. <b>fast</b> scores and reads ads; <b>best</b> writes what gets sent. The browser agents (search, apply, contact) always run in Claude Code, whatever you pick here.</p>
${problem ? `<div class="notice warn">${esc(problem)}</div>` : `<div class="notice ok">Ready: ${esc(LABEL[active])}.</div>`}
${process.env.JOB_AGENT_PROVIDER ? `<p class="small mute">JOB_AGENT_PROVIDER is set in the environment and wins over the choice below.</p>` : ""}
<form method="post" action="/settings/ai">
<label>Use</label><select name="provider">${PROVIDERS.map((p) => `<option value="${p}" ${s.provider === p ? "selected" : ""}>${esc(LABEL[p])}</option>`).join("")}</select>
<details ${s.provider === "claude-cli" ? "open" : ""}><summary>Claude Code</summary><p class="small mute">${cli ? `Found at <span class="mono">${esc(cli)}</span>.` : "Not found on this machine."}</p>
<div class="two"><div><label>fast model</label>${model("claude-cli", "fast", "cliFast")}</div><div><label>best model</label>${model("claude-cli", "best", "cliBest")}</div></div></details>
<details ${s.provider === "anthropic" ? "open" : ""}><summary>Anthropic API</summary><label>API key</label>${key("anthropic", "anthropicKey")}
<div class="two"><div><label>fast model</label>${model("anthropic", "fast", "anthropicFast")}</div><div><label>best model</label>${model("anthropic", "best", "anthropicBest")}</div></div></details>
<details ${s.provider === "openai" ? "open" : ""}><summary>OpenAI-compatible API</summary><label>Base URL</label><input name="openaiBase" value="${esc(s.openai.baseUrl)}" placeholder="${OPENAI_BASE} (Ollama: http://127.0.0.1:11434/v1)">
<label>API key <span class="mute" style="font-weight:400">(blank for a local server)</span></label>${key("openai", "openaiKey")}
<div class="two"><div><label>fast model</label>${model("openai", "fast", "openaiFast")}</div><div><label>best model</label>${model("openai", "best", "openaiBest")}</div></div></details>
<p style="margin-top:14px"><button>Save</button></p>
<p class="hint">Saved in <span class="mono">data/providers.json</span>, readable only by your user. Environment variables win: JOB_AGENT_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL.</p></form></div>`;
}

export function settingsPage(jobs: Job[], flash?: string): string {
  const policy = readPolicy();
  const stop = isStopped();
  const { dailyCap } = readLimits();
  const seen = new Set<string>([...KNOWN_HOSTS, ...Object.keys(policy), ...jobs.map((j) => hostOf(j.url)).filter(Boolean)]);
  const hosts = [...seen].filter((h) => !(h in LOCKED)).sort();
  const row = (h: string) => `<tr><td><b>${esc(h)}</b></td><td><form class="row" method="post" action="/settings/policy"><input type="hidden" name="host" value="${esc(h)}"><select name="mode" style="width:auto">${MODES.map((m) => `<option ${(policy[h] ?? "fill-and-wait") === m ? "selected" : ""}>${m}</option>`).join("")}</select><button class="quiet">Save</button></form></td><td class="small mute">${policy[h] ? "" : "default"}</td></tr>`;
  const runs = listRuns().slice(0, 15);
  return page(
    "Settings",
    `<h1>Settings</h1><p class="mute">How far the agent may go, per site. Everything here is a file under <span class="mono">data/</span>.</p>
${flash ? `<div class="notice ok">${esc(flash)}</div>` : ""}
${aiCard()}
<div class="two"><div>
<div class="card"><h3>Kill switch</h3><p class="small mute">While on, no apply run starts. Running ones can be stopped from their page.</p>
<form method="post" action="/settings/stop" class="row"><input name="reason" placeholder="why" value="${esc(stop.reason)}" style="width:auto;flex:1"><button class="${stop.stopped ? "" : "quiet"}" name="stopped" value="${stop.stopped ? "0" : "1"}">${stop.stopped ? "Paused — resume" : "Pause all applying"}</button></form>
${stop.stopped ? `<div class="notice warn" style="margin:10px 0 0">Applying is paused${stop.reason ? `: ${esc(stop.reason)}` : ""}.</div>` : ""}</div>
<div class="card"><h3>Daily cap</h3><form method="post" action="/settings/cap" class="row"><input name="dailyCap" type="number" min="0" value="${dailyCap}" style="width:100px"><span class="small mute">applications per person per day</span><button class="quiet">Save</button></form></div>
<div class="card"><h3>Career boards</h3><p class="small mute">${readBoards().length} boards read on every search. One per line: <span class="mono">company, greenhouse|lever|recruitee, slug</span>.</p>
<form method="post" action="/settings/boards"><textarea name="boards" rows="8" class="mono">${esc(readBoards().map((b) => `${b.company}, ${b.kind}, ${b.slug}`).join("\n"))}</textarea><p><button class="quiet">Save boards</button></p></form>
<p class="small mute">IND sponsor register: ${readSponsors().length.toLocaleString("en")} companies. <form class="inline" method="post" action="/settings/sponsors"><button class="quiet">Refresh</button></form></p></div>
</div><div>
<div class="card"><h3>Apply policy per site</h3><p class="small mute"><b>prepare</b>: the pack is drafted, the person submits. <b>fill-and-wait</b>: the agent fills the form and stops before submit. <b>auto</b>: the agent submits.</p>
<div class="wrap"><table><tr><td><b>linkedin.com</b></td><td><span class="tag">prepare</span> <span class="small mute">locked — Easy Apply automation gets accounts restricted</span></td><td></td></tr>${hosts.map(row).join("")}</table></div>
<form method="post" action="/settings/policy" class="row" style="margin-top:10px"><input name="host" placeholder="another host, e.g. careers.example.com" style="width:auto;flex:1"><select name="mode" style="width:auto">${MODES.map((m) => `<option>${m}</option>`).join("")}</select><button class="quiet">Add</button></form></div>
<div class="card"><h3>Recent agent runs</h3>${runs.length ? `<table>${runs.map((r) => `<tr><td><a href="/run/${r.id}">${esc(r.task)}</a></td><td><span class="tag ${{ running: "accent", done: "ok", failed: "bad", stopped: "warn" }[r.status]}">${r.status}</span></td><td class="small mute">${esc(r.personId)} · ${esc(r.startedAt.slice(0, 16).replace("T", " "))}</td></tr>`).join("")}</table>` : `<p class="small mute">None yet.</p>`}</div>
</div></div>`,
    { nav: [{ href: "/", label: "People" }] },
  );
}
