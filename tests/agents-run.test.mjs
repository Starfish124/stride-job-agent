import { fixture, goodPack, job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { subscribe } from "../lib/agent.ts";
import { ingestFound, startApply, startContact, startSearch } from "../lib/agents/run.ts";
import { runDir, tailorOne } from "../lib/engine.ts";
import { getJob, jobId, listJobs, saveJobs, savePerson, upsertJobs } from "../lib/jobs.ts";
import { setPolicy } from "../lib/policy.ts";
import { SPONSORS_PATH } from "../lib/sponsors.ts";
import { writeJson } from "../lib/store.ts";

function agentThatSays(result) {
  return (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working…" }] } })}\n`));
      child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "result", result })}\n`));
      child.emit("close", 0);
    }, 5);
    return child;
  };
}
/** Resolves once the task's own wrap-up line arrives (or the run ends without one). */
const finished = (run, wrapUp = /./) =>
  new Promise((r) => subscribe(run.id, (e) => e.kind === "status" && run.status !== "running" && wrapUp.test(e.text) && setTimeout(() => r(run), 10)));

test("agent search: found jobs are ingested, sponsor-checked and scored", async () => {
  saveJobs([]);
  savePerson(person({ id: "b", needsSponsor: true, salaryFloor: 4357, targetRoles: ["Data Analyst"] }));
  writeJson(SPONSORS_PATH, [{ name: "Globex International B.V.", kvk: "1" }]);
  const found = JSON.stringify([
    { url: "https://nl.indeed.com/viewjob?jk=1", title: "Data Analyst", company: "Globex", location: "Amsterdam", description: "SQL and dashboards for a ticketing platform." },
    { url: "https://nl.indeed.com/viewjob?jk=2", title: "Data Analyst", company: "Some Bakery", location: "Amsterdam", description: "x" },
  ]);
  const run = startSearch("b", { spawn: agentThatSays(found), llm: async () => '{"score": 7, "reasoning": "Fits."}' });
  await finished(run, /new jobs added/);
  assert.equal(run.status, "done");
  assert.match(run.events.at(-1).text, /2 new jobs added, 1 scored/);
  const jobs = listJobs().filter((j) => j.personId === "b");
  assert.equal(jobs.length, 2);
  assert.equal(jobs.find((j) => j.company === "Globex").sponsor.match, "exact");
  assert.equal(jobs.find((j) => j.company === "Globex").score.score, 7);
  assert.equal(jobs.find((j) => j.company === "Some Bakery").status, "filtered");
  assert.equal(jobs.every((j) => j.source === "agent"), true);
  // ingestFound on the same urls adds nothing
  assert.equal(ingestFound("b", JSON.parse(found)).added, 0);
});

test("agent search: a run cut short still keeps the jobs it saved on the way", async () => {
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    child.kill = () => {};
    setTimeout(() => {
      const saved = [{ url: "https://nl.indeed.com/viewjob?jk=9", title: "Data Analyst", company: "Globex", location: "Amsterdam", description: "SQL." }];
      fs.writeFileSync(path.join(opts.cwd, "found.json"), JSON.stringify(saved));
      child.emit("close", 1);
    }, 5);
    return child;
  };
  const run = startSearch("b", { spawn, llm: async () => '{"score": 6, "reasoning": "Fits."}' });
  await finished(run, /new jobs added/);
  assert.equal(run.status, "failed");
  assert.match(run.events.at(-1).text, /1 new jobs added/);
  assert.ok(getJob(jobId("https://nl.indeed.com/viewjob?jk=9")));
});

test("apply: guards refuse, fill-and-wait leaves the job waiting, resume submits", async () => {
  saveJobs([]);
  savePerson(person());
  const j = job({ id: "aaaaaaaaaaaa", url: "https://jobs.acme.example/apply/1", company: "Acme" });
  upsertJobs([j]);
  assert.throws(() => startApply(j.id), /no CV and letter/);
  await tailorOne(j.id, async () => JSON.stringify(goodPack()));
  assert.ok(fs.existsSync(path.join(runDir(j.id), "CV.pdf")));

  setPolicy("acme.example", "fill-and-wait");
  const wait = startApply(j.id, { spawn: agentThatSays('{"outcome":"waiting","note":"all filled, CV not attached (needs-file)"}') });
  await finished(wait);
  assert.equal(getJob(j.id).status, "waiting");
  assert.match(getJob(j.id).note, /needs-file/);
  assert.equal(getJob(j.id).runId, wait.id);

  const go = startApply(j.id, { resume: true, spawn: agentThatSays('{"outcome":"submitted","note":"Thank you, reference ACME-1"}') });
  await finished(go);
  assert.equal(getJob(j.id).status, "applied");
  assert.equal(getJob(j.id).followUps.length, 2);
  assert.throws(() => startApply(j.id), /already applied/);

  const linked = job({ id: "bbbbbbbbbbbb", url: "https://www.linkedin.com/jobs/view/1", pack: goodPack(), company: "Other" });
  upsertJobs([linked]);
  // A LinkedIn ad is filled on the employer's own site, never submitted by the agent.
  await tailorOne(linked.id, async () => JSON.stringify(goodPack()));
  const viaLi = startApply(linked.id, { spawn: agentThatSays('{"outcome":"waiting","note":"found it on the careers site"}') });
  await finished(viaLi);
  assert.equal(getJob(linked.id).status, "waiting");
});

test("apply: a blocked run leaves an error on the job, not a status change", async () => {
  const j = getJob("aaaaaaaaaaaa");
  savePerson(person());
  const other = job({ id: "cccccccccccc", url: "https://jobs.beta.example/1", company: "Beta", pack: goodPack() });
  upsertJobs([other]);
  await tailorOne(other.id, async () => JSON.stringify(goodPack()));
  const run = startApply(other.id, { spawn: agentThatSays('{"outcome":"blocked","note":"login wall"}') });
  await finished(run);
  assert.equal(getJob(other.id).status, "drafted");
  assert.match(getJob(other.id).error, /blocked: login wall/);
});

test("contact: found people land on the job", async () => {
  const run = startContact("aaaaaaaaaaaa", { spawn: agentThatSays('[{"name":"Sam Jansen","title":"Recruiter","url":"https://www.linkedin.com/in/samj"}]') });
  await finished(run, /contacts found/);
  assert.deepEqual(getJob("aaaaaaaaaaaa").contacts, [{ name: "Sam Jansen", title: "Recruiter", url: "https://www.linkedin.com/in/samj" }]);
});
