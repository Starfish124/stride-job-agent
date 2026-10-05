import crypto from "node:crypto";
import path from "node:path";
import { linkedinJobId } from "./sources/linkedin.ts";
import { DATA_DIR, readJson, writeJson } from "./store.ts";
import type { Job, Person } from "./types.ts";

export const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
export const PEOPLE_PATH = path.join(DATA_DIR, "people.json");
export const RUNS_DIR = path.join(DATA_DIR, "runs");

/**
 * Tracking params, a trailing slash, a mixed-case host and LinkedIn's
 * per-country subdomains all name the same ad. Strip them before hashing or
 * the dedupe silently does nothing.
 */
const TRACKING = /^(utm_|trk|ref|refid|trackingid|position|pagenum|source|src|gclid|fbclid|from|origin|cmp)/i;

export function normaliseUrl(url: string): string {
  const li = linkedinJobId(url);
  if (li) return `https://www.linkedin.com/jobs/view/${li}`;
  const u = new URL(url);
  // On Indeed and some ATSs the query IS the job (viewjob?jk=…). Keep the
  // query, minus the tracking noise, sorted so two links to one ad agree.
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = keep.length ? `?${new URLSearchParams(keep)}` : "";
  return u.origin.toLowerCase() + u.pathname.replace(/\/+$/, "") + query;
}

/** 12 hex of sha256 over the normalised url, or over the text for a pasted ad with no link. */
export function jobId(url: string, text = ""): string {
  const key = url ? normaliseUrl(url) : text.trim().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export function listJobs(): Job[] {
  return readJson<Job[]>(JOBS_PATH, []);
}

export function saveJobs(jobs: Job[]): void {
  writeJson(JOBS_PATH, jobs);
}

export function getJob(id: string): Job | undefined {
  return listJobs().find((j) => j.id === id);
}

/** Read-modify-write one job. Returns the updated job, or undefined when unknown. */
export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const jobs = listJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return undefined;
  Object.assign(job, patch);
  saveJobs(jobs);
  return job;
}

/**
 * Add the ones we have not seen. A job already on file is left untouched: it
 * may carry a score, a pack or an application, and a re-run of a search must
 * never walk over that.
 */
export function upsertJobs(incoming: Job[]): { added: Job[] } {
  const jobs = listJobs();
  const have = new Set(jobs.map((j) => j.id));
  const added = incoming.filter((j) => !have.has(j.id) && have.add(j.id));
  if (added.length) saveJobs([...added, ...jobs]);
  return { added };
}

export function listPeople(): Person[] {
  return readJson<Person[]>(PEOPLE_PATH, []);
}

export function getPerson(id: string): Person | undefined {
  return listPeople().find((p) => p.id === id);
}

export function savePerson(person: Person): void {
  const people = listPeople().filter((p) => p.id !== person.id);
  writeJson(PEOPLE_PATH, [...people, person]);
}
