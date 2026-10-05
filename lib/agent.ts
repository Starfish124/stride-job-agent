// The one runner every browser task goes through: `claude -p --chrome`, its
// stream-json turned into an event log per run, kept in memory for the
// widget and appended to disk as evidence. Claude in Chrome runs in your own
// Chrome, logged in as you.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { claudeCliPath } from "./llm.ts";
import { DATA_DIR } from "./store.ts";

export type AgentTask = "search" | "apply" | "contact";

export interface AgentEvent {
  at: string;
  kind: "text" | "tool" | "result" | "error" | "status";
  text: string;
}

export interface AgentRun {
  id: string;
  task: AgentTask;
  personId: string;
  jobId?: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  /** The model's final answer, for the task's parser. */
  result?: string;
  events: AgentEvent[];
}

export const RUNS_DIR = path.join(DATA_DIR, "agent-runs");
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

type Spawn = typeof nodeSpawn;

const runs = new Map<string, AgentRun>();
const procs = new Map<string, ChildProcess>();
const subs = new Map<string, Set<(e: AgentEvent) => void>>();
const finishers = new Map<string, ((run: AgentRun) => void)[]>();
const everyone = new Set<(run: AgentRun, e: AgentEvent) => void>();

/** One line of `--output-format stream-json` → one event, or null for the lines nobody needs to see. */
export function parseStreamLine(line: string): AgentEvent | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  const at = new Date().toISOString();
  if (o.type === "assistant") {
    const content = ((o.message as Record<string, unknown>)?.content as Record<string, unknown>[]) ?? [];
    const parts: string[] = [];
    for (const c of content) {
      if (c.type === "text" && String(c.text).trim()) parts.push(String(c.text).trim());
      if (c.type === "tool_use") {
        const input = JSON.stringify(c.input ?? {});
        parts.push(`⚙ ${c.name} ${input.length > 140 ? `${input.slice(0, 140)}…` : input}`);
      }
    }
    if (!parts.length) return null;
    const tool = content.every((c) => c.type === "tool_use");
    return { at, kind: tool ? "tool" : "text", text: parts.join("\n") };
  }
  if (o.type === "result") {
    return { at, kind: o.is_error ? "error" : "result", text: String(o.result ?? "") };
  }
  return null;
}

function emit(run: AgentRun, e: AgentEvent): void {
  run.events.push(e);
  fs.appendFileSync(path.join(RUNS_DIR, `${run.id}.jsonl`), `${JSON.stringify(e)}\n`);
  for (const fn of subs.get(run.id) ?? []) fn(e);
  for (const fn of everyone) fn(run, e);
}

function persist(run: AgentRun): void {
  const { events: _e, ...meta } = run;
  fs.writeFileSync(path.join(RUNS_DIR, `${run.id}.json`), JSON.stringify(meta, null, 2), { mode: 0o600 });
}

function finish(run: AgentRun, status: AgentRun["status"], note?: string): void {
  if (run.status !== "running") return;
  run.status = status;
  run.endedAt = new Date().toISOString();
  emit(run, { at: run.endedAt, kind: "status", text: note ?? status });
  persist(run);
  procs.delete(run.id);
  for (const fn of finishers.get(run.id) ?? []) fn(run);
  finishers.delete(run.id);
  // Late subscribers get the stored events; live ones are done. A task's
  // onDone may still annotate for a while (scoring), hence the grace period.
  setTimeout(() => subs.delete(run.id), 10 * 60_000).unref();
}

export function startRun(
  task: AgentTask,
  personId: string,
  prompt: string,
  opts: { jobId?: string; timeoutMs?: number; spawn?: Spawn; onDone?: (run: AgentRun) => void } = {},
): AgentRun {
  const run: AgentRun = {
    id: crypto.randomBytes(6).toString("hex"),
    task, personId, jobId: opts.jobId, status: "running", startedAt: new Date().toISOString(), events: [],
  };
  fs.mkdirSync(path.join(RUNS_DIR, run.id), { recursive: true, mode: 0o700 });
  runs.set(run.id, run);
  persist(run);
  if (opts.onDone) finishers.set(run.id, [opts.onDone]);

  const bin = claudeCliPath();
  const spawn = opts.spawn ?? nodeSpawn;
  if (!bin && !opts.spawn) {
    finish(run, "failed", "Claude Code CLI not found");
    return run;
  }
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(
    bin ?? "claude",
    // -p cannot answer a permission prompt: without the allow-list every browser
    // call comes back "Claude in Chrome requires permission" (measured 2026-09-11).
    // No subagents: the stock "browser" agent never commits an action, so an
    // auto-mode apply handed to it would never press submit.
    ["-p", "--chrome", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
      "--allowedTools", "mcp__claude-in-chrome__*", "--disallowedTools", "Agent"],
    { cwd: path.join(RUNS_DIR, run.id), env },
  );
  procs.set(run.id, child);
  emit(run, { at: run.startedAt, kind: "status", text: `started ${task}` });

  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish(run, "failed", `timed out after ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60000} minutes`);
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let buf = "";
  let stderr = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const e = parseStreamLine(line);
      if (!e) continue;
      if (e.kind === "result") run.result = e.text;
      emit(run, e);
    }
  });
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  child.on("error", (err) => {
    clearTimeout(timer);
    finish(run, "failed", err.message);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (buf.trim()) {
      const e = parseStreamLine(buf);
      if (e) {
        if (e.kind === "result") run.result = e.text;
        emit(run, e);
      }
    }
    if (run.status !== "running") return; // stopped by hand
    const errored = run.events.find((e) => e.kind === "error");
    if (code === 0 && !errored) finish(run, "done");
    else finish(run, "failed", (errored ? errored.text : `claude exited ${code}${stderr ? `: ${stderr}` : ""}`).slice(0, 300));
  });
  child.stdin?.write(prompt);
  child.stdin?.end();
  return run;
}

/** A status line added after the run ended, e.g. what a task did with the result. Reaches live listeners too. */
export function annotate(run: AgentRun, text: string): void {
  emit(run, { at: new Date().toISOString(), kind: "status", text });
}

export function stopRun(id: string): boolean {
  const run = runs.get(id);
  const proc = procs.get(id);
  if (!run || run.status !== "running") return false;
  // Mark it first: the close handler fires on the kill and must see "stopped", not "running".
  finish(run, "stopped", "stopped by hand");
  proc?.kill("SIGKILL");
  return true;
}

export function getRun(id: string): AgentRun | undefined {
  return runs.get(id);
}

/** Newest first. */
export function listRuns(): AgentRun[] {
  return [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function activeRuns(): AgentRun[] {
  return listRuns().filter((r) => r.status === "running");
}

export function subscribe(id: string, fn: (e: AgentEvent) => void): () => void {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(fn);
  return () => subs.get(id)?.delete(fn);
}

/** Every event of every run, as it happens. For the terminal dashboard. */
export function subscribeAll(fn: (run: AgentRun, e: AgentEvent) => void): () => void {
  everyone.add(fn);
  return () => everyone.delete(fn);
}

/** On start-up: the last 50 runs from disk. A run that was running when the server died is marked stopped. */
export function loadRuns(): void {
  if (!fs.existsSync(RUNS_DIR)) return;
  const metas = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json")).sort().slice(-50);
  for (const f of metas) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")) as AgentRun;
      const log = path.join(RUNS_DIR, `${meta.id}.jsonl`);
      meta.events = fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AgentEvent)
        : [];
      if (meta.status === "running") {
        meta.status = "stopped";
        meta.endedAt = new Date().toISOString();
      }
      runs.set(meta.id, meta);
    } catch {
      // a half-written file from a crash is not worth failing start-up over
    }
  }
}
