import { fixture } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardJobs, boardUrl, parseBoard } from "../lib/sources/boards.ts";

test("greenhouse: entity-escaped html becomes a description", () => {
  const jobs = parseBoard({ company: "Globex", kind: "greenhouse", slug: "globex" }, fixture("greenhouse.json"));
  assert.equal(jobs.length, 3);
  const ams = jobs.find((j) => j.location === "Amsterdam");
  assert.equal(ams.title, "Account Manager");
  assert.equal(ams.url, "https://job-boards.greenhouse.io/globex/jobs/1000002");
  assert.match(ams.description, /^This is Globex\nGlobex provides payments/);
  assert.ok(!/<|&lt;/.test(ams.description));
  assert.equal(ams.postedAt, "2026-09-09");
});

test("lever: description plus lists, salary with its period", () => {
  const jobs = parseBoard({ company: "Acme", kind: "lever", slug: "acme" }, fixture("lever.json"));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Data Analyst");
  assert.match(jobs[0].description, /build dashboards\.\nRequirements\nSQL\nTableau/);
  assert.equal(jobs[0].salary, "4000-5000 EUR per month");
  assert.equal(jobs[0].postedAt, "2025-09-10");
  assert.equal(jobs[1].salary, "");
});

test("recruitee: offers with html descriptions and a space-separated date", () => {
  const jobs = parseBoard({ company: "Hooli", kind: "recruitee", slug: "hooli" }, fixture("recruitee.json"));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Copywriting Intern");
  assert.equal(jobs[0].url, "https://careers.hooli.example/o/copywriting-intern-1");
  assert.equal(jobs[0].postedAt, "2026-09-07");
  assert.ok(jobs[0].description.length > 500 && !/<p>/.test(jobs[0].description));
});

test("boardJobs fetches the right url and drops jobs without a link", async () => {
  const b = { company: "Acme", kind: "lever", slug: "acme" };
  assert.equal(boardUrl(b), "https://api.lever.co/v0/postings/acme?mode=json");
  const jobs = await boardJobs(b, async () => JSON.stringify([{ text: "No link" }, { text: "Ok", hostedUrl: "https://x/1" }]));
  assert.deepEqual(jobs.map((j) => j.title), ["Ok"]);
});
