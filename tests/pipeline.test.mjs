import { fixture, goodPack, job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { addJob, discover, runDir, tailorOne, triageAndScore } from "../lib/engine.ts";
import { addWorkingDays, appliedPatch, dueFollowUps, followedUpPatch } from "../lib/followup.ts";
import { getJob, listJobs, savePerson, saveJobs, upsertJobs } from "../lib/jobs.ts";
import { renderCv } from "../lib/pdf.ts";
import { SPONSORS_PATH } from "../lib/sponsors.ts";
import { BOARDS_PATH } from "../lib/sources/boards.ts";
import { writeJson } from "../lib/store.ts";

test("follow-ups land on working days", () => {
  assert.equal(addWorkingDays("2026-09-11", 1), "2026-09-14"); // Friday -> Monday
  assert.equal(addWorkingDays("2026-09-10", 5), "2026-09-17");
  assert.deepEqual(appliedPatch("2026-09-10").followUps, ["2026-09-17", "2026-09-24"]);
  const applied = job({ status: "applied", followUps: ["2026-09-17", "2026-09-24"] });
  assert.equal(dueFollowUps([applied], "2026-09-16").length, 0);
  assert.equal(dueFollowUps([applied], "2026-09-18").length, 1);
  assert.deepEqual(followedUpPatch(applied).followUps, ["2026-09-24"]);
  assert.equal(dueFollowUps([{ ...applied, status: "interview" }], "2026-09-30").length, 0);
});

test("a re-run never walks over a job already on file", () => {
  saveJobs([]);
  upsertJobs([job({ id: "x1", status: "applied" })]);
  const { added } = upsertJobs([job({ id: "x1", status: "new" }), job({ id: "x2" })]);
  assert.deepEqual(added.map((j) => j.id), ["x2"]);
  assert.equal(getJob("x1").status, "applied");
});

test("the CV renders, and a character the font cannot draw degrades instead of throwing", async () => {
  const bytes = await renderCv(person({ name: "Łukasz Żółć →" }), goodPack(), "en");
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 1500);
});

test("paste → score-ready job → tailored pack with both PDFs on disk", async () => {
  saveJobs([]);
  savePerson(person());
  const pasted = "Customer Success Manager at Adyen in Amsterdam. We want 3+ years of experience and Salesforce.";
  const added = await addJob("a", { url: "", text: pasted }, { llm: async () => '{"title":"Customer Success Manager","company":"Adyen","location":"Amsterdam"}' });
  assert.equal(added.company, "Adyen");
  assert.equal((await addJob("a", { url: "", text: pasted })).id, added.id, "pasting the same ad twice is one job");

  const done = await tailorOne(added.id, async () => JSON.stringify(goodPack()));
  assert.equal(done.error, undefined);
  assert.equal(done.status, "drafted");
  for (const f of ["CV.pdf", "Letter.pdf"]) assert.ok(fs.statSync(path.join(runDir(added.id), f)).size > 1000);

  const failed = await tailorOne(added.id, async () => JSON.stringify(goodPack({ summary: "Grew revenue 45%." })));
  assert.match(failed.error, /tailoring failed twice/);
  assert.equal(failed.pack.summary, goodPack().summary, "a failed re-draft keeps the last good pack");
});

test("discovery: sponsor check on the card, detail only for survivors, then triage + score", async () => {
  saveJobs([]);
  savePerson(person({ id: "b", needsSponsor: true, salaryFloor: 4357, targetRoles: ["Data Analyst"], locations: ["Amsterdam"] }));
  writeJson(SPONSORS_PATH, [{ name: "Globex B.V.", kvk: "1" }, { name: "Acme B.V.", kvk: "2" }]);
  writeJson(BOARDS_PATH, [{ company: "Acme", kind: "lever", slug: "acme" }, { company: "Dead", kind: "greenhouse", slug: "dead" }]);
  const fetched = [];
  const report = await discover("b", {
    delayMs: 0,
    fetchPage: async (url) => {
      fetched.push(url);
      if (url.includes("seeMoreJobPostings")) return fixture("linkedin-search.html");
      if (url.includes("lever.co")) return JSON.stringify([...JSON.parse(fixture("lever.json")), { id: "c3", text: "Data Analyst", hostedUrl: "https://jobs.lever.co/acme/c3", categories: { location: "São Paulo" }, descriptionPlain: "x" }]);
      if (url.includes("greenhouse")) throw new Error("404 from greenhouse");
      return fixture("linkedin-job.html");
    },
  });
  assert.equal(report.boards, 1);
  assert.deepEqual(report.failed, [{ board: "Dead (greenhouse)", error: "404 from greenhouse" }]);
  const acme = listJobs().find((j) => j.company === "Acme");
  assert.equal(acme.title, "Data Analyst", "the board job whose title fits was added; Backend Engineer was not");
  assert.equal(listJobs().some((j) => j.title === "Data Analyst" && j.location === "São Paulo"), false, "a global board's foreign office is skipped");
  assert.equal(listJobs().filter((j) => j.company === "Acme").length, 1);
  assert.match(acme.description, /build dashboards/);
  assert.equal(acme.salary, "4000-5000 EUR per month");
  assert.equal(acme.source, "board");
  assert.equal(report.searches, 3, "three pages of the same fixture: the repeats are skipped, not re-added");
  assert.equal(report.detailed, 1, "only the sponsor got a detail request");
  assert.equal(report.filtered, 9);
  const globex = listJobs().find((j) => j.company === "Globex");
  assert.equal(globex.status, "new");
  assert.match(globex.description, /award-winning/);
  assert.equal(globex.applicants, 181);

  const result = await triageAndScore("b", async () => '{"score": 7, "reasoning": "Strong analyst match; no Looker."}');
  assert.equal(result.scored, 2);
  assert.equal(getJob(globex.id).score.score, 7);
  assert.equal(getJob(globex.id).status, "scored");
});

test("a job hunt in Germany: no IND register needed, Berlin is searched, a board keeps Berlin and skips Amsterdam", async () => {
  saveJobs([]);
  writeJson(SPONSORS_PATH, []);
  savePerson(person({ id: "de", country: "Germany", locations: ["Berlin"], needsSponsor: true, targetRoles: ["Data Analyst"] }));
  writeJson(BOARDS_PATH, [{ company: "Acme", kind: "lever", slug: "acme" }]);
  const fetched = [];
  await discover("de", {
    delayMs: 0,
    fetchPage: async (url) => {
      fetched.push(url);
      if (!url.includes("lever.co")) return "";
      return JSON.stringify([
        { id: "b1", text: "Data Analyst", hostedUrl: "https://jobs.lever.co/acme/b1", categories: { location: "Berlin, Germany" }, descriptionPlain: "Dashboards in Berlin." },
        { id: "b2", text: "Data Analyst", hostedUrl: "https://jobs.lever.co/acme/b2", categories: { location: "Amsterdam" }, descriptionPlain: "Dashboards in Amsterdam." },
      ]);
    },
  });
  assert.ok(fetched.some((u) => u.includes("location=Berlin%2C+Germany")), "LinkedIn is asked for Berlin, Germany");
  const mine = listJobs().filter((j) => j.personId === "de");
  assert.deepEqual(mine.map((j) => j.location), ["Berlin, Germany"]);
  assert.notEqual(mine[0].status, "filtered", "the Dutch sponsor register is not applied outside the Netherlands");
});
