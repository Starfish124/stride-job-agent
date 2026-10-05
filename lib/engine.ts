// The stages, shared by the server and the CLI. Every dependency that touches
// the network or the model is injectable so the tests never do either.

import fs from "node:fs";
import path from "node:path";
import { detectLanguage, fromLinkedIn, fromLlm, fromPage } from "./extract.ts";
import { getJob, getPerson, jobId, listJobs, RUNS_DIR, saveJobs, updateJob, upsertJobs } from "./jobs.ts";
import { bestLlm, fastLlm, type Llm } from "./llm.ts";
import { renderCv, renderLetter } from "./pdf.ts";
import { isNetherlands, usesIndRegister, validatePerson } from "./profile.ts";
import { scoreJob } from "./score.ts";
import { detailUrl, linkedinJobId, PAGE_SIZE, parseSearch, searchUrl } from "./sources/linkedin.ts";
import { matchSponsor, sponsorIndex } from "./sponsors.ts";
import { DATA_DIR, readJson } from "./store.ts";
import { tailor } from "./tailor.ts";
import { boardJobs, readBoards } from "./sources/boards.ts";
import { cardTriage, rankSurvivors, terms } from "./triage.ts";
import type { Job, Person } from "./types.ts";

export type Fetch = (url: string) => Promise<string>;

export interface Config {
  /** Survivors that reach a paid score per run. */
  maxScorePerRun: number;
  /** LinkedIn result pages (10 cards each) per role × location. */
  pages: number;
  /** LinkedIn's f_TPR window. r604800 = past week. */
  window: string;
  /** Pause between LinkedIn requests. Polite, and what keeps the guest endpoint answering. */
  delayMs: number;
}

export function readConfig(): Config {
  const c = readJson<Partial<Config>>(path.join(DATA_DIR, "config.json"), {});
  return {
    maxScorePerRun: Number(c.maxScorePerRun ?? 25),
    pages: Number(c.pages ?? 3),
    window: String(c.window ?? "r604800"),
    delayMs: Number(c.delayMs ?? 1500),
  };
}

export const defaultFetch: Fetch = async (url) => {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "accept-language": "en-GB,en;q=0.9,nl;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.text();
};

function usable(personId: string): Person {
  const p = getPerson(personId);
  if (!p) throw new Error(`no person "${personId}"`);
  const problems = validatePerson(p);
  if (problems.length) throw new Error(`${p.name || p.id} is not ready: ${problems.join("; ")}`);
  return p;
}

function blankJob(personId: string, source: Job["source"], url: string, text = ""): Job {
  return {
    id: jobId(url, text), personId, source, url, title: "", company: "", location: "", postedAt: "",
    applicants: -1, addedAt: new Date().toISOString(), status: "new", description: "", language: "en", salary: "", contact: "",
  };
}

/** A job pasted by hand: its text, its link, or both. Returns the stored job (existing one if already on file). */
export async function addJob(
  personId: string,
  input: { url: string; text: string },
  deps: { llm?: Llm; fetchPage?: Fetch } = {},
): Promise<Job> {
  if (!getPerson(personId)) throw new Error(`no person "${personId}"`);
  const url = input.url.trim();
  const pasted = input.text.trim();
  if (!url && !pasted) throw new Error("paste the ad text or its link");
  const job = blankJob(personId, "paste", url, pasted);
  const existing = getJob(job.id);
  if (existing) return existing;

  const llm = deps.llm ?? fastLlm;
  // A LinkedIn link is read through the logged-out job endpoint, which answers
  // where the normal page would demand a login.
  const source = linkedinJobId(url) ? detailUrl(url)! : url;
  const fields = pasted ? await fromLlm(pasted, llm) : await fromPage(await (deps.fetchPage ?? defaultFetch)(source), llm);
  const { via: _via, applicants, postedAt, ...rest } = fields;
  Object.assign(job, rest, { applicants: applicants ?? -1, postedAt: postedAt || job.postedAt });
  if (!job.description) job.error = "could not read a job description from that page — paste the text instead";
  job.sponsor = job.company ? matchSponsor(job.company, sponsorIndex()) : null;
  upsertJobs([job]);
  return job;
}

export async function scoreOne(id: string, llm: Llm = fastLlm): Promise<Job> {
  const job = getJob(id);
  if (!job) throw new Error(`no job ${id}`);
  const p = usable(job.personId);
  try {
    return updateJob(id, { score: await scoreJob(job, p, llm), status: job.status === "new" || job.status === "filtered" ? "scored" : job.status, error: undefined })!;
  } catch (e) {
    return updateJob(id, { error: (e as Error).message })!;
  }
}

export function runDir(id: string): string {
  return path.join(RUNS_DIR, id);
}

/** Pack + both PDFs into data/runs/<id>/. */
export async function tailorOne(id: string, llm: Llm = bestLlm): Promise<Job> {
  const job = getJob(id);
  if (!job) throw new Error(`no job ${id}`);
  const p = usable(job.personId);
  try {
    const pack = await tailor(job, p, llm);
    const dir = runDir(id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, "CV.pdf"), await renderCv(p, pack, job.language), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "Letter.pdf"), await renderLetter(p, job, pack), { mode: 0o600 });
    const next = ["new", "filtered", "scored"].includes(job.status) ? "drafted" : job.status;
    return updateJob(id, { pack, status: next, error: undefined })!;
  } catch (e) {
    return updateJob(id, { error: (e as Error).message })!;
  }
}

export interface DiscoveryReport {
  searches: number;
  cards: number;
  added: number;
  /** Not on the sponsor register. */
  filtered: number;
  detailed: number;
  stoppedEarly: string;
  /** Career boards read, and the ones that failed with why. */
  boards: number;
  failed: { board: string; error: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * LinkedIn guest search for every target role × location. The sponsor check
 * runs on the search card, so only survivors cost a detail request.
 * Filtered jobs are stored too, with the reason, so a drop is visible.
 */
export async function discover(
  personId: string,
  deps: { fetchPage?: Fetch; delayMs?: number } = {},
): Promise<DiscoveryReport> {
  const p = usable(personId);
  const cfg = readConfig();
  const fetchPage = deps.fetchPage ?? defaultFetch;
  const delay = deps.delayMs ?? cfg.delayMs;
  const index = sponsorIndex();
  if (usesIndRegister(p) && index.keys.length === 0) throw new Error("no sponsor register on file — run `npm run jobs -- sponsors` first");

  const report: DiscoveryReport = { searches: 0, cards: 0, added: 0, filtered: 0, detailed: 0, stoppedEarly: "", boards: 0, failed: [] };
  const known = new Set(listJobs().map((j) => j.id));
  const fresh = new Map<string, Job>();
  const places = p.locations.length ? p.locations : [p.country];

  search: for (const role of p.targetRoles) {
    for (const place of places) {
      for (let page = 0; page < cfg.pages; page++) {
        let html: string;
        try {
          html = await fetchPage(searchUrl(role, place, page, cfg.window, p.country));
        } catch (e) {
          // 429 means back off for today, not try harder.
          report.stoppedEarly = (e as Error).message;
          break search;
        }
        report.searches++;
        const cards = parseSearch(html);
        report.cards += cards.length;
        for (const c of cards) {
          const job = blankJob(personId, "linkedin", c.url);
          if (known.has(job.id) || fresh.has(job.id)) continue;
          Object.assign(job, { title: c.title, company: c.company, location: c.location, postedAt: c.postedAt });
          job.sponsor = matchSponsor(c.company, index);
          const v = cardTriage(job, p);
          if (!v.keep) Object.assign(job, { status: "filtered", triage: v.reason });
          fresh.set(job.id, job);
        }
        await sleep(delay);
        if (cards.length < PAGE_SIZE) break; // last page
      }
    }
  }

  // Career boards: the whole board in one request, description included, so
  // only a title that names the work the person wants becomes a job.
  const wanted = terms(p);
  const titleFits = (title: string) => wanted.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(title));
  // A board is global (Databricks lists 870 jobs worldwide), and unlike a
  // LinkedIn search it was not asked for a city. Keep their country, their
  // cities, remote, and the unstated.
  const wantedPlaces = [...p.locations, p.country, ...(isNetherlands(p.country) ? ["nederland"] : []), "remote", "hybrid"]
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  const placeFits = (loc: string) => !loc.trim() || wantedPlaces.some((l) => loc.toLowerCase().includes(l));
  for (const board of readBoards()) {
    try {
      const jobs = await boardJobs(board, fetchPage);
      report.boards++;
      for (const c of jobs) {
        if (!titleFits(c.title) || !placeFits(c.location)) continue;
        const job = blankJob(personId, "board", c.url);
        if (known.has(job.id) || fresh.has(job.id)) continue;
        Object.assign(job, {
          title: c.title, company: c.company, location: c.location, postedAt: c.postedAt,
          description: c.description, salary: c.salary, language: detectLanguage(c.description),
        });
        job.sponsor = matchSponsor(c.company, index);
        const v = cardTriage(job, p);
        if (!v.keep) Object.assign(job, { status: "filtered", triage: v.reason });
        fresh.set(job.id, job);
      }
    } catch (e) {
      report.failed.push({ board: `${board.company} (${board.kind})`, error: (e as Error).message });
    }
  }

  for (const job of fresh.values()) {
    if (job.status === "filtered") {
      report.filtered++;
      continue;
    }
    if (job.description) continue; // a board job arrived complete
    const url = detailUrl(job.url);
    if (!url || report.stoppedEarly) continue;
    try {
      const ad = fromLinkedIn(await fetchPage(url));
      if (ad) {
        Object.assign(job, { description: ad.description, language: ad.language, salary: ad.salary, applicants: ad.applicants ?? -1 });
        if (!job.postedAt && ad.postedAt) job.postedAt = ad.postedAt;
      }
      report.detailed++;
    } catch (e) {
      report.stoppedEarly = (e as Error).message;
    }
    await sleep(delay);
  }

  report.added = upsertJobs([...fresh.values()]).added.length;
  return report;
}

/**
 * Triage every unjudged job of one person, then score the top of what
 * survives. Jobs past the batch cap stay "new" and compete again next run.
 */
export async function triageAndScore(personId: string, llm: Llm = fastLlm): Promise<{ filtered: number; scored: number; failed: number }> {
  const p = usable(personId);
  const jobs = listJobs();
  const pending = jobs.filter((j) => j.personId === personId && j.status === "new" && !j.score);
  const { keep, drop } = rankSurvivors(pending, p, readConfig().maxScorePerRun);
  for (const { job, reason } of drop) Object.assign(job, { status: "filtered", triage: reason });
  saveJobs(jobs);
  let scored = 0;
  let failed = 0;
  for (const job of keep) {
    const after = await scoreOne(job.id, llm);
    if (after.score) scored++;
    else failed++;
  }
  return { filtered: drop.length, scored, failed };
}
