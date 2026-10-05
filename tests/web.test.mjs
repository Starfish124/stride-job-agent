import { job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { competition, order } from "../web/table.ts";
import { nextStep } from "../web/home.ts";

const scored = (over) => job({ score: { score: 7, reasoning: "x", at: "" }, ...over });

test("table order: fit, then the emptier field, unknown applicants last, then freshest", () => {
  const a = scored({ id: "a", applicants: 200 });
  const b = scored({ id: "b", applicants: 5 });
  const c = scored({ id: "c", applicants: -1 });
  const d = scored({ id: "d", applicants: 5, postedAt: "2026-09-10" });
  const e = job({ id: "e" });
  assert.deepEqual(order([e, c, a, b, d]).map((j) => j.id), ["d", "b", "a", "c", "e"]);
});

test("competition labels", () => {
  const today = new Date("2026-09-10T12:00:00Z");
  assert.deepEqual(competition(job({ applicants: 0, postedAt: "2026-09-10" }), today).map((c) => c.label), ["just posted", "first applicants"]);
  assert.deepEqual(competition(job({ applicants: 181, postedAt: "2026-09-01" }), today).map((c) => c.label), ["181 applicants"]);
  assert.deepEqual(competition(job({ applicants: 250 }), today).map((c) => c.cls), ["warn"]);
  assert.deepEqual(competition(job(), today), []);
});

test("next step follows the state of the record", () => {
  assert.equal(nextStep(person({ facts: [] }), []).step, "profile");
  assert.equal(nextStep(person({ reviewed: false }), []).label, "Review the facts from the CV");
  assert.equal(nextStep(person(), []).step, "find");
  assert.equal(nextStep(person(), [scored({ status: "scored" })]).step, "apply");
  assert.equal(nextStep(person(), [job({ status: "drafted" })]).label, "1 ready to apply");
  assert.equal(nextStep(person(), [job({ status: "applied", followUps: ["2020-01-01"] })]).step, "followup");
});

import { refuse } from "../lib/guard.ts";

test("guard: loopback and same-origin pass; other sites, rebound DNS names and opaque origins are refused", () => {
  const local = { host: "127.0.0.1:7420" };
  assert.equal(refuse("GET", local), null);
  assert.equal(refuse("POST", { ...local, origin: "http://127.0.0.1:7420", "sec-fetch-site": "same-origin" }), null);
  assert.equal(refuse("POST", local), null, "curl on this machine sends no Origin");
  assert.match(refuse("POST", { ...local, origin: "https://evil.example" }), /origin/);
  assert.match(refuse("POST", { ...local, "sec-fetch-site": "cross-site" }), /cross-site/);
  assert.match(refuse("POST", { ...local, origin: "null" }), /opaque/);
  assert.match(refuse("GET", { host: "rebound.evil.example:7420" }), /host/);
  assert.equal(refuse("GET", { host: "jobs.example.com" }, "https://jobs.example.com"), null, "PUBLIC_URL's host is allowed");
});

import { goodPack } from "./helpers.mjs";
import { workspacePage } from "../web/workspace.ts";
import { jobPage } from "../web/job.ts";
import { homePage } from "../web/home.ts";
import { settingsPage } from "../web/settings.ts";

test("every page renders, in the Netherlands and elsewhere", () => {
  for (const country of ["Netherlands", "Germany"]) {
    const p = person({ country, needsSponsor: true });
    const jobs = [job({ status: "drafted", pack: goodPack() }), job({ id: "def456def456", status: "scored", score: { score: 8, reasoning: "x", at: "" } })];
    const ctx = { p, jobs, busy: new Map(), errors: new Map() };
    for (const step of ["profile", "find", "apply", "followup", "track"]) assert.match(workspacePage(step, ctx), /<h2>/, step);
    assert.match(jobPage(jobs[0], p, undefined, undefined, jobs), /CV\.pdf/);
    assert.match(homePage([p], jobs, new Map()), /People/);
  }
  assert.match(settingsPage([]), /Kill switch/);
});
