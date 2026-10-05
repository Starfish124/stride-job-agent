import { goodPack, job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPack, checkTitle, numbersIn, peopleSearches, tailor } from "../lib/tailor.ts";
import { parseScore, scoreJob } from "../lib/score.ts";
import { parseIntake, validatePerson, visibleFacts } from "../lib/profile.ts";

test("a clean pack passes", () => {
  assert.equal(checkPack(goodPack(), person(), job()), null);
});

test("an invented number fails the pack", () => {
  const pack = goodPack({ summary: "Five years in hospitality, 40% faster check-ins." });
  assert.match(checkPack(pack, person(), job()), /the number 40 is not in their facts/);
  // A number from the ad itself is fair to quote back.
  assert.equal(checkPack(goodPack({ letter: "Your ask for 3+ years fits me." }), person(), job()), null);
});

test("a suppressed term fails the pack", () => {
  assert.match(checkPack(goodPack({ followUp: "Before that I was at Hotel Grim." }), person(), job()), /suppressed "Hotel Grim"/);
});

test("a skill, a fact id or a note that was not earned fails the pack", () => {
  assert.match(checkPack(goodPack({ skills: ["Salesforce", "SQL"] }), person(), job()), /skill "SQL"/);
  assert.match(checkPack(goodPack({ bullets: [{ factId: "r9", text: "x" }] }), person(), job()), /does not exist/);
  assert.match(checkPack(goodPack({ bullets: [{ factId: "s1", text: "x" }] }), person(), job()), /cites skill fact/);
  assert.match(checkPack(goodPack({ connectNote: "x".repeat(301) }), person(), job()), /301 characters, over 300/);
});

test("the target title may only reuse held or job-title words", () => {
  // Held: "Front Office Manager". Job: "Customer Success Manager".
  assert.equal(checkTitle("Customer Success Manager", person(), job()), null);
  assert.equal(checkTitle("Front Office Manager", person(), job()), null);
  assert.match(checkTitle("Director of Operations", person(), job()), /"director" is not in a title they held/);
  assert.match(checkTitle("Head of Customer Success and Onboarding Operations Lead", person(), job()), /over 6/);
  assert.match(checkTitle("", person(), job()), /empty/);
});

test("an invented target title fails the whole pack", () => {
  assert.match(checkPack(goodPack({ title: "VP of Everything" }), person(), job()), /target title word "vp"/);
});

test("numbersIn treats 1.000, 1,000 and 1000 as one number", () => {
  assert.deepEqual(numbersIn("1.000 and 1,000 and 1000, 30%."), ["1000", "1000", "1000", "30"]);
});

test("tailor regenerates once with the problem spelled out, then fails loudly", async () => {
  const prompts = [];
  const bad = JSON.stringify(goodPack({ summary: "Led 99 people." }));
  const fixed = JSON.stringify(goodPack());
  const pack = await tailor(job(), person(), async (p) => (prompts.push(p), prompts.length === 1 ? bad : fixed));
  assert.equal(pack.skills.length, 2);
  assert.match(prompts[1], /PREVIOUS DRAFT WAS REJECTED: the number 99/);
  await assert.rejects(tailor(job(), person(), async () => bad), /tailoring failed twice: the number 99/);
});

test("people searches name the contact when the ad gives one", () => {
  const links = peopleSearches(job({ contact: "Sam Jansen", title: "Senior Customer Success Manager (m/v/x)" }));
  assert.equal(links[0].label, "Sam Jansen");
  assert.match(links[0].url, /keywords=Sam%20Jansen%20Adyen/);
  assert.match(links[2].url, /keywords=Customer%20Success%20Manager%20manager%20Adyen/);
});

test("scores are bounded and leaks are discarded", async () => {
  assert.equal(parseScore('{"score": 47, "reasoning": "x"}'), null);
  assert.equal(parseScore('{"score": 8, "reasoning": ""}'), null);
  assert.equal(parseScore('here: {"score": 7.6, "reasoning": "Good fit."}').score, 8);
  // a note after the JSON, with braces in it, must not sink the score (seen live 2026-09-11)
  assert.equal(parseScore('{"score": 7, "reasoning": "Fits {mostly}."}\n\nNote: I used {SQL} as the anchor.').score, 7);
  assert.equal(parseScore('{"score": 6, "reasoning": "The role\'s framing as \'Data Science\' is the gap."').score, 6);
  const loose = parseScore('{"score": 6, "reasoning": "Title drift from "Analyst" to "Data Science Associate" is the gap.');
  assert.equal(loose.score, 6);
  assert.equal(loose.reasoning, 'Title drift from "Analyst" to "Data Science Associate" is the gap.');
  assert.equal(parseScore('{"reasoning": "Says "fits".", "score": 8}').reasoning, 'Says "fits".');
  assert.equal(parseScore("I would rate this highly."), null);
  await assert.rejects(scoreJob(job(), person(), async () => '{"score": 8, "reasoning": "Like Hotel Grim."}'), /suppressed term/);
});

test("a person is unusable until reviewed, and intake always comes back unreviewed", () => {
  assert.deepEqual(validatePerson(person()), []);
  assert.match(validatePerson(person({ reviewed: false })).join(), /not reviewed/);
  assert.match(validatePerson(person({ facts: [{ id: "a1", kind: "achievement", under: "r1", text: "x" }] })).join(), /needs at least one role/);
  const draft = parseIntake(
    '{"name":"Anna","email":"a@x.nl","targetRoles":["CSM"],"facts":[{"id":"r1","kind":"role","title":"Manager","org":"Okura","text":"x"},{"id":"z","kind":"hobby","text":"x"}]}',
    "a",
    person(),
  );
  assert.equal(draft.reviewed, false);
  assert.equal(draft.facts.length, 1, "an unknown fact kind is dropped");
  assert.deepEqual(draft.suppress, ["Hotel Grim"], "a re-intake keeps the hand-written suppress list");
});

test("a suppressed role and everything under it never reach a prompt, a check or the CV", () => {
  const p = person({
    suppress: ["Red Lion"],
    facts: [
      ...person().facts,
      { id: "r2", kind: "role", title: "Bar staff", org: "The Red Lion pub", dates: "2018 - 2020", text: "" },
      { id: "a9", kind: "achievement", under: "r2", text: "Served 200 guests a night." },
    ],
  });
  const ids = visibleFacts(p).map((f) => f.id);
  assert.ok(!ids.includes("r2") && !ids.includes("a9"));
  assert.ok(ids.includes("r1"));
  assert.match(checkPack(goodPack({ bullets: [{ factId: "a9", text: "Served guests." }] }), p, job()), /does not exist or is suppressed/);
  assert.match(checkPack(goodPack({ summary: "Served 200 guests." }), p, job()), /the number 200/);
});
