import { goodPack, job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { getRun, parseStreamLine, startRun, stopRun, subscribe } from "../lib/agent.ts";
import { buildSearchPrompt, parseFound } from "../lib/agents/search.ts";
import { buildApplyPrompt, parseApplyResult } from "../lib/agents/apply.ts";
import { buildContactPrompt, parseContacts } from "../lib/agents/contact.ts";
import { agentMode, canApply, modeFor, setPolicy, setStopped, setDailyCap } from "../lib/policy.ts";

/** A child process that plays back stdout lines, then exits. */
function fakeSpawn(lines, code = 0, delayMs = 5) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    child.kill = () => child.emit("close", null);
    setTimeout(() => {
      for (const l of lines) child.stdout.emit("data", Buffer.from(`${l}\n`));
      child.emit("close", code);
    }, delayMs);
    return child;
  };
  return { spawn, calls };
}
const done = (run) => new Promise((r) => (run.status !== "running" ? r(run) : subscribe(run.id, (e) => e.kind === "status" && run.status !== "running" && r(run))));

test("stream-json lines become events; the noise does not", () => {
  const text = parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Opening Indeed." }] } }));
  assert.equal(text.kind, "text");
  const tool = parseStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "navigate", input: { url: "https://x" } }] } }));
  assert.equal(tool.kind, "tool");
  assert.match(tool.text, /⚙ navigate .*https:\/\/x/);
  assert.equal(parseStreamLine(JSON.stringify({ type: "result", result: "[]", is_error: false })).kind, "result");
  assert.equal(parseStreamLine(JSON.stringify({ type: "result", result: "Not logged in", is_error: true })).kind, "error");
  assert.equal(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.equal(parseStreamLine("not json"), null);
});

test("a run plays through to done with its result, and subscribers hear every event", async () => {
  const { spawn, calls } = fakeSpawn([
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Looking." }] } }),
    JSON.stringify({ type: "result", result: '[{"url":"https://x/1","title":"Data Analyst"}]' }),
  ]);
  const heard = [];
  const run = startRun("search", "a", "prompt", { spawn, timeoutMs: 5000 });
  subscribe(run.id, (e) => heard.push(e.kind));
  await done(run);
  assert.equal(run.status, "done");
  assert.match(run.result, /Data Analyst/);
  assert.deepEqual(heard, ["text", "result", "status"]);
  assert.ok(calls[0].args.includes("--chrome") && calls[0].args.includes("stream-json"));
  assert.ok(calls[0].args.includes("mcp__claude-in-chrome__*"), "browser tools must be pre-allowed under -p");
  assert.equal(calls[0].args[calls[0].args.indexOf("--disallowedTools") + 1], "Agent");
  assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(getRun(run.id), run);
});

test("a non-zero exit fails the run; an error envelope fails it even at exit 0; stop kills it", async () => {
  const bad = startRun("search", "a", "p", { spawn: fakeSpawn([], 1).spawn });
  await done(bad);
  assert.equal(bad.status, "failed");
  const env = startRun("search", "a", "p", { spawn: fakeSpawn([JSON.stringify({ type: "result", result: "Not logged in", is_error: true })], 0).spawn });
  await done(env);
  assert.equal(env.status, "failed");
  assert.match(env.events.at(-1).text, /Not logged in/);
  const slow = startRun("search", "a", "p", { spawn: fakeSpawn([], 0, 500).spawn });
  assert.equal(stopRun(slow.id), true);
  assert.equal(slow.status, "stopped");
  assert.equal(stopRun(slow.id), false);
});

test("search prompt and result", () => {
  const prompt = buildSearchPrompt(person({ needsSponsor: true, locations: ["Amsterdam"] }), { maxJobs: 10, knownUrls: ["https://k/1"] });
  assert.match(prompt, /nl\.indeed\.com\/jobs\?q=Customer%20Success%20Manager&l=Amsterdam/);
  assert.match(prompt, /Never apply/);
  assert.match(prompt, /https:\/\/k\/1/);
  assert.match(prompt, /skip ads that say no sponsorship/);
  const found = parseFound('Here you go:\n[{"url":"https://a/1","title":"X","company":"C"},{"title":"no url"},{"url":"ftp://bad","title":"Y"}]\nDone.');
  assert.deepEqual(found.map((f) => f.url), ["https://a/1"]);
  assert.equal(found[0].salary, "");
  assert.deepEqual(parseFound("no array here"), []);
});

test("apply prompt carries the sheet, the files and the right ending; results parse", () => {
  const p = person({ needsSponsor: true, salaryFloor: 4357 });
  const wait = buildApplyPrompt(job({ url: "https://acme.example/apply" }), p, goodPack(), "fill-and-wait");
  assert.match(wait, /Full name: Anna de Vries/);
  assert.match(wait, /sponsorship is required/);
  assert.match(wait, /€4357/);
  assert.match(wait, /https?:\/\/\S+\/job\/\w+\/CV\.pdf  \(name it Anna_de_Vries-CV\.pdf\)/);
  assert.doesNotMatch(wait, /already filled/);
  assert.match(wait, /Do NOT press the final submit/);
  assert.doesNotMatch(wait, /Hotel Grim/);
  const li = buildApplyPrompt(job({ url: "https://www.linkedin.com/jobs/view/1" }), p, goodPack(), "fill-and-wait");
  assert.match(li, /own careers site/);
  assert.match(li, /Do not apply on LinkedIn/);
  assert.equal(agentMode("https://www.linkedin.com/jobs/view/1"), "fill-and-wait");
  const auto = buildApplyPrompt(job(), person(), goodPack(), "auto");
  assert.match(auto, /press the final submit button/);
  assert.match(auto, /no sponsorship needed/);
  assert.deepEqual(parseApplyResult('{"outcome":"waiting","note":"all but the file"}'), { outcome: "waiting", note: "all but the file" });
  assert.equal(parseApplyResult("I got confused").outcome, "failed");
  assert.equal(parseApplyResult('{"outcome":"maybe"}').outcome, "failed");
});

test("contact prompt and result", () => {
  const prompt = buildContactPrompt(job({ title: "Senior Data Analyst", contact: "Sam Jansen" }));
  assert.match(prompt, /The ad names: Sam Jansen/);
  assert.match(prompt, /head of Data Analyst/);
  assert.match(prompt, /Do NOT connect/);
  const c = parseContacts('[{"name":"Sam","title":"Recruiter","url":"https://www.linkedin.com/in/sam"},{"name":"X","url":"https://x.com"}]');
  assert.deepEqual(c, [{ name: "Sam", title: "Recruiter", url: "https://www.linkedin.com/in/sam" }]);
});

test("policy: linkedin is locked, unknown hosts fill-and-wait, parents apply to subdomains", () => {
  assert.equal(modeFor("https://www.linkedin.com/jobs/view/1"), "prepare");
  setPolicy("linkedin.com", "auto");
  assert.equal(modeFor("https://nl.linkedin.com/jobs/view/1"), "prepare");
  assert.equal(modeFor("https://job-boards.greenhouse.io/adyen/jobs/1"), "fill-and-wait");
  setPolicy("greenhouse.io", "auto");
  assert.equal(modeFor("https://job-boards.greenhouse.io/adyen/jobs/1"), "auto");
  assert.equal(modeFor(""), "prepare");
});

test("guards: pack, stop switch, daily cap, one per company", () => {
  const ready = job({ id: "j1", pack: goodPack(), company: "Adyen" });
  assert.equal(canApply(ready, []), null);
  assert.match(canApply(job({ id: "j0" }), []), /no CV and letter/);
  assert.match(canApply(job({ id: "j0", pack: goodPack(), status: "applied" }), []), /already applied$/);
  setStopped(true, "checking something");
  assert.match(canApply(ready, []), /paused: checking something/);
  setStopped(false);
  assert.match(canApply(ready, [job({ id: "j2", company: "Adyen N.V.", status: "applied", title: "Other" })]), /already applied at Adyen \(Other\)/);
  setDailyCap(1);
  assert.match(canApply(ready, [job({ id: "j3", company: "Else", status: "applied", appliedAt: "2026-09-10" })], "2026-09-10"), /daily cap of 1/);
  setDailyCap(15);
});
