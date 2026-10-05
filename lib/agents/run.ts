// Starting the three agent tasks and folding their results back into the
// jobs. Each returns the run so the widget can be opened on it.

import fs from "node:fs";
import path from "node:path";
import { annotate, RUNS_DIR, startRun, type AgentRun } from "../agent.ts";
import { detectLanguage } from "../extract.ts";
import { runDir, triageAndScore } from "../engine.ts";
import { appliedPatch } from "../followup.ts";
import { getJob, getPerson, jobId, listJobs, updateJob, upsertJobs } from "../jobs.ts";
import { fastLlm, type Llm } from "../llm.ts";
import { agentMode, canApply } from "../policy.ts";
import { validatePerson } from "../profile.ts";
import { matchSponsor, sponsorIndex } from "../sponsors.ts";
import { cardTriage } from "../triage.ts";
import type { Job } from "../types.ts";
import { buildApplyPrompt, parseApplyResult } from "./apply.ts";
import { buildContactPrompt, parseContacts } from "./contact.ts";
import { buildSearchPrompt, parseFound, type Found } from "./search.ts";

const MAX_AGENT_JOBS = 15;

type Deps = { spawn?: NonNullable<Parameters<typeof startRun>[3]>["spawn"]; llm?: Llm };

/** Each found job becomes a record, sponsor-matched and card-triaged like any other. */
export function ingestFound(personId: string, found: Found[]): { added: number } {
  const p = getPerson(personId);
  if (!p) throw new Error(`no person "${personId}"`);
  const index = sponsorIndex();
  const jobs: Job[] = [];
  for (const f of found) {
    const job: Job = {
      id: jobId(f.url), personId, source: "agent", url: f.url, title: f.title, company: f.company, location: f.location,
      postedAt: f.postedAt, applicants: -1, addedAt: new Date().toISOString(), status: "new",
      description: f.description, language: detectLanguage(f.description), salary: f.salary, contact: "",
      sponsor: matchSponsor(f.company, index),
    };
    const v = cardTriage(job, p);
    if (!v.keep) Object.assign(job, { status: "filtered", triage: v.reason });
    jobs.push(job);
  }
  return { added: upsertJobs(jobs).added.length };
}

export function startSearch(personId: string, deps: Deps = {}): AgentRun {
  const p = getPerson(personId);
  if (!p) throw new Error(`no person "${personId}"`);
  const problems = validatePerson(p);
  if (problems.length) throw new Error(`${p.name || p.id} is not ready: ${problems[0]}`);
  const knownUrls = listJobs().filter((j) => j.personId === personId && j.url).map((j) => j.url);
  return startRun("search", personId, buildSearchPrompt(p, { maxJobs: MAX_AGENT_JOBS, knownUrls }), {
    spawn: deps.spawn,
    onDone: async (run) => {
      // The final answer, plus what the agent saved on the way: a timed-out or
      // stopped search still keeps every job it found.
      const saved = path.join(RUNS_DIR, run.id, "found.json");
      const found = [...parseFound(run.result ?? ""), ...(fs.existsSync(saved) ? parseFound(fs.readFileSync(saved, "utf8")) : [])];
      const { added } = ingestFound(personId, found);
      const scored = added ? (await triageAndScore(personId, deps.llm ?? fastLlm)).scored : 0;
      annotate(run, `${added} new jobs added, ${scored} scored`);
    },
  });
}

/** The apply run. Refuses (throws) when a guard says no, so the UI shows why. */
export function startApply(id: string, deps: Deps & { resume?: boolean } = {}): AgentRun {
  const job = getJob(id);
  const p = job && getPerson(job.personId);
  if (!job || !p) throw new Error(`no job ${id}`);
  const why = deps.resume ? null : canApply(job, listJobs());
  if (why) throw new Error(why);
  const mode = deps.resume ? "auto" : agentMode(job.url);
  if (mode === "prepare") throw new Error("this site is set to 'prepare': open the apply page and submit by hand");
  if (!job.pack) throw new Error("no CV and letter drafted yet");
  const dir = runDir(job.id);
  for (const f of ["CV.pdf", "Letter.pdf"]) if (!fs.existsSync(path.join(dir, f))) throw new Error(`${f} is missing — re-draft the pack`);
  const run = startRun("apply", job.personId, buildApplyPrompt(job, p, job.pack, mode, deps.resume), {
    jobId: job.id,
    spawn: deps.spawn,
    onDone: (r) => {
      if (r.status !== "done" || !r.result) {
        updateJob(job.id, { error: r.events.at(-1)?.text ?? "the apply run did not finish" });
        return;
      }
      const { outcome, note } = parseApplyResult(r.result);
      if (outcome === "submitted") updateJob(job.id, { ...appliedPatch(), note, error: undefined });
      else if (outcome === "waiting") updateJob(job.id, { status: "waiting", note, error: undefined });
      else updateJob(job.id, { note, error: `${outcome}: ${note}` });
    },
  });
  updateJob(job.id, { runId: run.id, error: undefined });
  return run;
}

export function startContact(id: string, deps: Deps = {}): AgentRun {
  const job = getJob(id);
  if (!job) throw new Error(`no job ${id}`);
  const run = startRun("contact", job.personId, buildContactPrompt(job), {
    jobId: job.id,
    spawn: deps.spawn,
    onDone: (r) => {
      if (r.status !== "done" || !r.result) return;
      const contacts = parseContacts(r.result);
      if (contacts.length) updateJob(job.id, { contacts });
      annotate(r, `${contacts.length} contacts found`);
    },
  });
  return run;
}
