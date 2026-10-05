// One node:http server, server-rendered HTML, no framework. Bound to loopback:
// there is no login, and data/ holds CVs and API keys. Never expose it to the
// internet.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { activeRuns, getRun, listRuns, loadRuns, stopRun, subscribe, subscribeAll, type AgentEvent, type AgentRun } from "./lib/agent.ts";
import { startApply, startContact, startSearch } from "./lib/agents/run.ts";
import { cvText } from "./lib/cvtext.ts";
import { refuse } from "./lib/guard.ts";
import { addJob, defaultFetch, discover, runDir, scoreOne, tailorOne, triageAndScore } from "./lib/engine.ts";
import { setDailyCap, setPolicy, setStopped, type Mode } from "./lib/policy.ts";
import { BOARDS_PATH } from "./lib/sources/boards.ts";
import { refreshSponsors } from "./lib/sponsors.ts";
import { writeJson } from "./lib/store.ts";
import { devFormPage, recordDevSubmission } from "./web/devform.ts";
import { runPage } from "./web/run.ts";
import { settingsPage } from "./web/settings.ts";
import { appliedPatch, followedUpPatch } from "./lib/followup.ts";
import { getJob, getPerson, listJobs, listPeople, savePerson, updateJob } from "./lib/jobs.ts";
import { bestLlm, PROVIDERS, readProviderSettings, saveProviderSettings, type Provider } from "./lib/llm.ts";
import { blankPerson, buildIntakePrompt, buildQuestionsPrompt, factsFromAnswers, parseIntake, parseQuestions } from "./lib/profile.ts";
import type { JobStatus, Person } from "./lib/types.ts";
import { homePage } from "./web/home.ts";
import type { Step } from "./web/home.ts";
import { jobPage } from "./web/job.ts";
import { cvPageCount } from "./lib/pdf.ts";
import { esc, page } from "./web/layout.ts";
import { workspacePage } from "./web/workspace.ts";

const PORT = Number(process.env.PORT ?? 7420);
const HOST = process.env.HOST ?? "127.0.0.1";

// ---------- background work: model calls take a minute, a page should not ----------

const busy = new Map<string, string>();
const lastError = new Map<string, string>();

function bg(key: string, label: string, work: () => Promise<unknown>): void {
  if (busy.has(key)) return;
  busy.set(key, label);
  lastError.delete(key);
  work()
    .catch((e) => lastError.set(key, (e as Error).message))
    .finally(() => busy.delete(key));
}

// ---------- request helpers ----------

/** Both url-encoded and multipart forms, through the platform parser Node ships. */
async function form(req: http.IncomingMessage): Promise<FormData> {
  const r = new Request("http://local/", {
    method: "POST",
    headers: { "content-type": req.headers["content-type"] ?? "application/x-www-form-urlencoded" },
    body: Readable.toWeb(req) as ReadableStream,
    // @ts-expect-error node needs duplex for a streamed body
    duplex: "half",
  });
  return r.formData();
}
const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "").trim();
const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

const send = (res: http.ServerResponse, status: number, html: string) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};
const redirect = (res: http.ServerResponse, to: string) => {
  res.writeHead(303, { location: to });
  res.end();
};
const notFound = (res: http.ServerResponse, what: string) => send(res, 404, page("Not found", `<div class="empty">No such ${what}.</div>`));

const ID = /^[a-z0-9-]{1,20}$/;
const JOB = /^[0-9a-f]{12}$/;
const STEPS: Step[] = ["profile", "find", "apply", "followup", "track"];

function workspace(p: Person, step: Step, flash?: string): string {
  return workspacePage(step, {
    p, jobs: listJobs().filter((j) => j.personId === p.id), busy, errors: lastError, flash,
    runs: activeRuns().filter((r) => r.personId === p.id),
  });
}

// ---------- routes ----------

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  const post = req.method === "POST";
  const flash = url.searchParams.get("ok") ?? undefined;

  if (parts.length === 0) return send(res, 200, homePage(listPeople(), listJobs(), busy, activeRuns()));

  // ----- the terminal dashboard's feed: every run's events, and the counts -----
  if (parts[0] === "api" && parts[1] === "stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const out = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const label = (r: AgentRun) => {
      const j = r.jobId ? getJob(r.jobId) : undefined;
      return { id: r.id, task: r.task, personId: r.personId, status: r.status, job: j ? `${j.title} @ ${j.company}` : "" };
    };
    const stats = () => {
      const jobs = listJobs();
      return JSON.stringify(listPeople().map((p) => {
        const mine = jobs.filter((j) => j.personId === p.id);
        const n = (f: (j: (typeof mine)[number]) => unknown) => mine.filter(f).length;
        return {
          id: p.id, name: p.name, jobs: mine.length, filtered: n((j) => j.status === "filtered"), scored: n((j) => j.score),
          drafted: n((j) => j.pack), waiting: n((j) => j.status === "waiting"),
          applied: n((j) => ["applied", "followed_up", "interview", "offer"].includes(j.status)),
        };
      }));
    };
    const line = (r: AgentRun, e: AgentEvent) =>
      out("event", { run: label(r), event: e, t: new Date(e.at).toLocaleTimeString("en-GB", { hour12: false }) });
    let last = stats();
    res.write(`event: stats\ndata: ${last}\n\n`);
    for (const r of listRuns().slice(0, 12).reverse()) for (const e of r.events) line(r, e);
    out("live", {});
    const off = subscribeAll(line);
    // Jobs also change outside agent runs (LinkedIn search, scoring): poll the counts.
    const tick = setInterval(() => {
      const now = stats();
      if (now !== last) res.write(`event: stats\ndata: ${(last = now)}\n\n`);
      else res.write(": ping\n\n");
    }, 3000);
    req.on("close", () => {
      off();
      clearInterval(tick);
    });
    return;
  }

  // ----- agent runs: the widget and its live feed -----
  if (parts[0] === "run" && parts[1]) {
    const run = getRun(parts[1]);
    const p = run && getPerson(run.personId);
    if (!run || !p) return notFound(res, "run");
    const job = run.jobId ? getJob(run.jobId) : undefined;
    if (!post && !parts[2]) return send(res, 200, runPage(run, p, job));
    if (!post && parts[2] === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const from = Number(url.searchParams.get("from") ?? 0);
      const push = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      for (const e of run.events.slice(from)) push(e);
      if (run.status !== "running") return void res.end();
      const off = subscribe(run.id, (e) => {
        push(e);
        if (e.kind === "status" && run.status !== "running") {
          off();
          res.end();
        }
      });
      req.on("close", off);
      return;
    }
    if (post && parts[2] === "stop") stopRun(run.id);
    return redirect(res, `/run/${run.id}`);
  }

  // ----- settings -----
  if (parts[0] === "settings") {
    if (!post) return send(res, 200, settingsPage(listJobs(), flash));
    const f = await form(req);
    const what = parts[1];
    if (what === "policy") setPolicy(str(f, "host"), str(f, "mode") as Mode);
    if (what === "stop") setStopped(str(f, "stopped") === "1", str(f, "reason"));
    if (what === "cap") setDailyCap(Number(str(f, "dailyCap")));
    if (what === "ai") {
      const s = readProviderSettings();
      // A blank key field keeps the saved key: the page never holds it to send back.
      const key = (old: string, name: string) => (f.get(`${name}Clear`) != null ? "" : str(f, name) || old);
      const provider = str(f, "provider") as Provider;
      saveProviderSettings({
        provider: PROVIDERS.includes(provider) ? provider : s.provider,
        "claude-cli": { fast: str(f, "cliFast"), best: str(f, "cliBest") },
        anthropic: { key: key(s.anthropic.key, "anthropicKey"), fast: str(f, "anthropicFast"), best: str(f, "anthropicBest") },
        openai: { key: key(s.openai.key, "openaiKey"), baseUrl: str(f, "openaiBase"), fast: str(f, "openaiFast"), best: str(f, "openaiBest") },
      });
    }
    if (what === "boards") {
      const boards = str(f, "boards")
        .split(/\r?\n/)
        .map((l) => l.split(",").map((x) => x.trim()))
        .filter((x) => x.length === 3 && x.every(Boolean))
        .map(([company, kind, slug]) => ({ company, kind, slug }));
      writeJson(BOARDS_PATH, boards, 0o644);
    }
    if (what === "sponsors") bg("sponsors", "Refreshing the IND register", () => refreshSponsors(defaultFetch));
    return redirect(res, "/settings?ok=Saved");
  }

  // ----- the stand-in application form, for testing the apply agent (DEV_FORM=1) -----
  if (parts[0] === "dev" && parts[1] === "form" && process.env.DEV_FORM === "1") {
    if (!post) {
      const tag = url.searchParams.get("job") ?? "demo";
      const job = listJobs().find((j) => j.url.endsWith(`/dev/form?job=${tag}`));
      return send(res, 200, devFormPage(tag, job?.title));
    }
    const f = await form(req);
    const fields: Record<string, string> = {};
    for (const [k, v] of f.entries()) fields[k] = v instanceof File ? `file:${v.name}:${v.size}` : String(v);
    recordDevSubmission(fields);
    return send(res, 200, page("Application received", `<div class="notice ok">Thank you, ${esc(fields.first)} — your application has been received. Reference ACME-${Date.now().toString(36).toUpperCase()}.</div>`));
  }

  // ----- people -----
  if (parts[0] === "p") {
    if (parts[1] === "new" && post) {
      const f = await form(req);
      const id = str(f, "id").toLowerCase();
      if (!ID.test(id)) return send(res, 400, page("Bad id", `<div class="notice bad">The id must be 1–20 lower-case letters, digits or dashes.</div>`));
      if (!getPerson(id)) savePerson({ ...blankPerson(id), name: str(f, "name") });
      return redirect(res, `/p/${id}/profile`);
    }
    const p = ID.test(parts[1] ?? "") ? getPerson(parts[1]) : undefined;
    if (!p) return notFound(res, "person");
    const action = parts[2] ?? "";

    if (!post) {
      if (!action) return redirect(res, `/p/${p.id}/find`);
      if (STEPS.includes(action as Step)) return send(res, 200, workspace(p, action as Step, flash));
      return notFound(res, "page");
    }

    if (action === "intake") {
      const f = await form(req);
      let cv = str(f, "cv");
      const file = f.get("file");
      try {
        if (!cv && file instanceof File && file.size > 0) cv = cvText(file.name, Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        return send(res, 400, workspace({ ...p }, "profile", undefined).replace('<h2>1. Profile</h2>', `<div class="notice bad">${esc((e as Error).message)}</div><h2>1. Profile</h2>`));
      }
      if (!cv) return send(res, 400, workspace(p, "profile").replace('<h2>1. Profile</h2>', `<div class="notice bad">Choose a file or paste the CV first.</div><h2>1. Profile</h2>`));
      const goal = str(f, "goal");
      savePerson({ ...p, goal });
      bg(`person:${p.id}`, "Reading the CV into facts", async () => {
        const draft = parseIntake(await bestLlm(buildIntakePrompt(cv, goal)), p.id, getPerson(p.id));
        if (!draft) throw new Error("the model did not return usable facts — try again");
        savePerson({ ...draft, cv });
      });
      return redirect(res, `/p/${p.id}/profile`);
    }
    if (action === "filters") {
      const f = await form(req);
      savePerson({
        ...p,
        targetRoles: lines(str(f, "targetRoles")),
        country: str(f, "country"),
        locations: lines(str(f, "locations")),
        languages: lines(str(f, "languages")),
        salaryFloor: Number(str(f, "salaryFloor")) || 0,
        needsSponsor: f.get("needsSponsor") != null,
        suppress: lines(str(f, "suppress")),
        email: str(f, "email") || p.email,
        phone: str(f, "phone") || p.phone,
        location: str(f, "location") || p.location,
        linkedin: str(f, "linkedin") || p.linkedin,
      });
      return redirect(res, `/p/${p.id}/profile?ok=Filters+saved`);
    }
    if (action === "fact" && parts[4] === "remove") {
      const id = parts[3];
      // Removing a role also removes the achievements hanging under it.
      savePerson({ ...p, facts: p.facts.filter((x) => x.id !== id && x.under !== id), reviewed: false });
      return redirect(res, `/p/${p.id}/profile`);
    }
    if (action === "reviewed") {
      savePerson({ ...p, reviewed: true });
      return redirect(res, `/p/${p.id}/find?ok=Profile+reviewed.+Now+find+jobs.`);
    }
    if (action === "questions") {
      bg(`person:${p.id}`, "Writing questions to ask them", async () => {
        const questions = parseQuestions(await bestLlm(buildQuestionsPrompt(getPerson(p.id)!)), getPerson(p.id)!);
        if (!questions.length) throw new Error("no questions came back — try again");
        savePerson({ ...getPerson(p.id)!, questions });
      });
      return redirect(res, `/p/${p.id}/profile`);
    }
    if (action === "answers") {
      const f = await form(req);
      const answers = (p.questions ?? []).map((q, i) => ({ under: str(f, `u${i}`) || q.under, text: str(f, `a${i}`) }));
      const facts = factsFromAnswers(p, answers);
      if (facts.length) savePerson({ ...p, facts: [...p.facts, ...facts], questions: [], reviewed: false });
      return redirect(res, `/p/${p.id}/profile?ok=Added+${facts.length}+fact${facts.length === 1 ? "" : "s"}.+Re-check+and+mark+reviewed.`);
    }
    if (action === "save") {
      try {
        const next = { ...blankPerson(p.id), ...JSON.parse(str(await form(req), "json")), id: p.id };
        savePerson(next);
      } catch (e) {
        return send(res, 400, page("Bad JSON", `<div class="notice bad">${esc((e as Error).message)}</div><p><a href="/p/${p.id}/profile">Back</a></p>`));
      }
      return redirect(res, `/p/${p.id}/profile?ok=Saved`);
    }
    if (action === "add") {
      const f = await form(req);
      try {
        const job = await addJob(p.id, { url: str(f, "url"), text: str(f, "text") });
        if (!job.score && job.description) bg(job.id, "Scoring", () => scoreOne(job.id));
        return redirect(res, `/job/${job.id}`);
      } catch (e) {
        return send(res, 400, workspace(p, "find").replace('<h2>2. Find jobs</h2>', `<div class="notice bad">${esc((e as Error).message)}</div><h2>2. Find jobs</h2>`));
      }
    }
    if (action === "discover") {
      bg(p.id, `Searching LinkedIn and career sites for ${p.name}`, async () => {
        const r = await discover(p.id);
        await triageAndScore(p.id);
        if (r.stoppedEarly) throw new Error(`stopped early: ${r.stoppedEarly}`);
      });
      return redirect(res, `/p/${p.id}/find`);
    }
    if (action === "score") {
      bg(p.id, `Scoring ${p.name}'s new jobs`, () => triageAndScore(p.id));
      return redirect(res, `/p/${p.id}/find`);
    }
    if (action === "agent-search") {
      try {
        return redirect(res, `/run/${startSearch(p.id).id}`);
      } catch (e) {
        return send(res, 400, workspace(p, "find").replace("<h2>2. Find jobs</h2>", `<div class="notice bad">${esc((e as Error).message)}</div><h2>2. Find jobs</h2>`));
      }
    }
    return notFound(res, "action");
  }

  // ----- jobs -----
  if (parts[0] === "job" && JOB.test(parts[1] ?? "")) {
    const job = getJob(parts[1]);
    const p = job && getPerson(job.personId);
    if (!job || !p) return notFound(res, "job");
    const action = parts[2];
    if (!post && !action) {
      const pages = job.pack ? await cvPageCount(p, job.pack, job.language) : undefined;
      return send(res, 200, jobPage(job, p, busy.get(job.id), lastError.get(job.id), listJobs(), pages));
    }
    if (!post && (action === "CV.pdf" || action === "Letter.pdf")) {
      const file = path.join(runDir(job.id), action);
      if (!fs.existsSync(file)) return notFound(res, "PDF yet");
      // The agent cannot drive a native file picker, so it attaches the PDF from
      // inside the employer's page with fetch(). Readable cross-origin only while
      // this job's apply run is live.
      const cors = activeRuns().some((r) => r.task === "apply" && r.jobId === job.id)
        ? { "access-control-allow-origin": "*", "access-control-allow-private-network": "true" }
        : {};
      if (req.method === "OPTIONS") return void res.writeHead(204, cors).end();
      res.writeHead(200, { ...cors, "content-type": "application/pdf", "content-disposition": `inline; filename="${p.name.replace(/[^\w.-]+/g, "_")}-${action}"` });
      return void fs.createReadStream(file).pipe(res);
    }
    if (!post) return notFound(res, "page");
    if (action === "apply" || action === "contact") {
      try {
        const run = action === "apply" ? startApply(job.id, { resume: url.searchParams.get("resume") === "1" }) : startContact(job.id);
        return redirect(res, `/run/${run.id}`);
      } catch (e) {
        lastError.set(job.id, (e as Error).message);
        return redirect(res, `/job/${job.id}`);
      }
    }
    if (action === "score") bg(job.id, "Scoring", () => scoreOne(job.id));
    if (action === "tailor") bg(job.id, "Drafting the CV, letter and LinkedIn messages", () => tailorOne(job.id));
    if (action === "status") {
      const s = str(await form(req), "status") as JobStatus;
      if (s === "applied") updateJob(job.id, appliedPatch());
      else if (s === "followed_up") updateJob(job.id, followedUpPatch(job));
      else if (["interview", "offer", "rejected"].includes(s)) updateJob(job.id, { status: s, followUps: [] });
    }
    return redirect(res, req.headers.referer?.includes(`/p/${p.id}/`) ? req.headers.referer : `/job/${job.id}`);
  }

  return notFound(res, "page");
}

loadRuns();
http
  .createServer((req, res) => {
    const why = refuse(req.method, req.headers);
    if (why) return send(res, 403, page("Refused", `<div class="notice bad">Refused: ${esc(why)}.</div>`));
    route(req, res).catch((e) => send(res, 500, page("Error", `<div class="notice bad">${esc((e as Error).message)}</div>`)));
  })
  .listen(PORT, HOST, () => console.log(`job-agent on http://${HOST}:${PORT}`));
