// How applying is allowed to happen: a mode per host, a daily cap, a kill
// switch, and the checks every apply run passes before it starts. All data,
// all editable on the Settings page — except LinkedIn, which is locked.

import path from "node:path";
import { normaliseCompany } from "./sponsors.ts";
import { DATA_DIR, readJson, writeJson } from "./store.ts";
import type { Job } from "./types.ts";

export type Mode = "prepare" | "fill-and-wait" | "auto";
export const MODES: Mode[] = ["prepare", "fill-and-wait", "auto"];

const POLICY_PATH = path.join(DATA_DIR, "apply-policy.json");
const STOP_PATH = path.join(DATA_DIR, "stop.json");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

/** Easy Apply automation is what gets accounts restricted. Not a setting. */
export const LOCKED: Record<string, Mode> = { "linkedin.com": "prepare" };

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function readPolicy(): Record<string, Mode> {
  const p = readJson<Record<string, string>>(POLICY_PATH, {});
  const out: Record<string, Mode> = {};
  for (const [h, m] of Object.entries(p)) if (MODES.includes(m as Mode)) out[h] = m as Mode;
  return { ...out, ...LOCKED };
}

export function setPolicy(host: string, mode: Mode): void {
  const h = host.toLowerCase().replace(/^www\./, "").trim();
  if (!h || h in LOCKED || !MODES.includes(mode)) return;
  writeJson(POLICY_PATH, { ...readJson<Record<string, string>>(POLICY_PATH, {}), [h]: mode }, 0o644);
}

/** The mode for a url: the host, or any parent domain of it; unknown → fill-and-wait; no url → prepare. */
export function modeFor(url: string): Mode {
  const host = hostOf(url);
  if (!host) return "prepare";
  const policy = readPolicy();
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const m = policy[parts.slice(i).join(".")];
    if (m) return m;
  }
  return "fill-and-wait";
}

export const isLinkedIn = (url: string) => /(^|\.)linkedin\.com$/.test(hostOf(url));

/**
 * How the agent may apply. A LinkedIn ad is never submitted on LinkedIn: the
 * agent finds the same posting on the employer's own site and fills it there,
 * always stopping before the final submit, since that host is unknown until
 * it gets there. Easy Apply stays with the person.
 */
export function agentMode(url: string): Mode {
  return isLinkedIn(url) ? "fill-and-wait" : modeFor(url);
}

export function isStopped(): { stopped: boolean; reason: string } {
  const s = readJson<{ stopped?: boolean; reason?: string }>(STOP_PATH, {});
  return { stopped: s.stopped === true, reason: String(s.reason ?? "") };
}

export function setStopped(stopped: boolean, reason = ""): void {
  writeJson(STOP_PATH, { stopped, reason, at: new Date().toISOString() }, 0o644);
}

export function readLimits(): { dailyCap: number } {
  const c = readJson<{ dailyCap?: number }>(CONFIG_PATH, {});
  return { dailyCap: Number(c.dailyCap ?? 15) };
}

export function setDailyCap(n: number): void {
  writeJson(CONFIG_PATH, { ...readJson<Record<string, unknown>>(CONFIG_PATH, {}), dailyCap: Math.max(0, Math.floor(n)) }, 0o644);
}

const APPLIED = new Set(["applied", "followed_up", "interview", "offer"]);

/** Why this job cannot be applied to right now, or null when it can. */
export function canApply(job: Job, jobs: Job[], today = new Date().toISOString().slice(0, 10)): string | null {
  if (!job.pack) return "no CV and letter drafted yet";
  if (APPLIED.has(job.status)) return "already applied";
  const stop = isStopped();
  if (stop.stopped) return `applications are paused: ${stop.reason || "stop switch is on"}`;
  const mine = jobs.filter((j) => j.personId === job.personId && j.id !== job.id);
  const todays = mine.filter((j) => j.appliedAt === today).length;
  const { dailyCap } = readLimits();
  if (todays >= dailyCap) return `daily cap of ${dailyCap} reached`;
  const company = normaliseCompany(job.company);
  const twin = company && mine.find((j) => APPLIED.has(j.status) && normaliseCompany(j.company) === company);
  if (twin) return `already applied at ${job.company} (${twin.title})`;
  return null;
}
