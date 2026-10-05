import { job, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardTriage, phrases, rankSurvivors, requiresDutch, rulesOutSponsorship, speaksDutch, statedMonthly, triage } from "../lib/triage.ts";

const sponsored = (over = {}) => person({ needsSponsor: true, salaryFloor: 4357, ...over });
const sponsor = { match: "exact", name: "Adyen N.V.", kvk: "34259528" };

test("a sponsored person only keeps jobs at recognised sponsors", () => {
  assert.equal(cardTriage(job({ sponsor: null }), sponsored()).keep, false);
  assert.match(cardTriage(job({ sponsor: null }), sponsored()).reason, /not on the IND sponsor register/);
  assert.equal(cardTriage(job({ sponsor }), sponsored()).keep, true);
  assert.equal(cardTriage(job({ sponsor: null }), person()).keep, true);
});

test("an ad in Dutch, or requiring Dutch, drops for someone without Dutch", () => {
  const p = sponsored();
  assert.equal(triage(job({ sponsor, language: "nl" }), p).reason, "the ad is in Dutch");
  assert.equal(triage(job({ sponsor, description: "You bring 3 years of experience. Fluent Dutch and English are required." }), p).reason, "the ad requires Dutch");
  assert.equal(triage(job({ sponsor, description: "English is our office language. Dutch is a plus." }), p).keep, true);
  assert.equal(triage(job({ sponsor, language: "nl" }), sponsored({ languages: ["Dutch (B2)"] })).keep, true);
});

test("requiresDutch reads the sentence, not the word", () => {
  assert.equal(requiresDutch("Excellent command of the Dutch language."), true);
  assert.equal(requiresDutch("Je beheerst de Nederlandse taal vloeiend."), true);
  assert.equal(requiresDutch("Speaking Dutch is nice to have."), false);
  assert.equal(requiresDutch("Our Dutch office is in Amsterdam."), false);
});

test("salary: a stated figure below the floor drops; an unstated one never does", () => {
  const p = sponsored();
  assert.match(triage(job({ sponsor, salary: "€3.000 - €3.800 per maand" }), p).reason, /under the 4357\/month floor/);
  assert.equal(triage(job({ sponsor, salary: "€4.000 - €5.000 per month" }), p).keep, true);
  assert.equal(triage(job({ sponsor, salary: "" }), p).keep, true);
  // No period stated: unknown, not low. The lesson from the opdrachten agent's first run.
  assert.equal(triage(job({ sponsor, salary: "3000" }), p).keep, true);
});

test("statedMonthly converts periods and reads both number styles", () => {
  assert.equal(statedMonthly("€60,000 - €72,000 per year"), 6000);
  assert.equal(statedMonthly("€ 4.500,00 per maand"), 4500);
  assert.equal(statedMonthly("€55K/yr - €65K/yr"), 5417);
  assert.equal(statedMonthly("€30 per hour"), 30 * 173);
  assert.equal(statedMonthly("4000-5500 EUR per month"), 5500);
  assert.equal(statedMonthly("competitive"), null);
  assert.equal(statedMonthly("50000"), null);
});

test("survivors rank by title hits first and the batch is capped", () => {
  const p = person();
  const jobs = [
    job({ id: "1", title: "Office Assistant", description: "Help the office. Some customer contact." }),
    job({ id: "2", title: "Customer Success Manager", description: "Customer success for merchants, using Salesforce." }),
    job({ id: "3", title: "Account Manager", description: "Grow accounts." }),
    job({ id: "4", title: "Bookkeeper", description: "" }),
  ];
  const { keep, drop } = rankSurvivors(jobs, p, 2);
  assert.deepEqual(keep.map((j) => j.id), ["2", "3"]);
  assert.deepEqual(drop.map((d) => d.job.id), ["4"]);
  assert.equal(drop[0].reason, "no description");
});

test("phrases keeps only the multi-word target roles, lowercased", () => {
  const p = person({ targetRoles: ["Customer Success Manager", "CSM", "Account Manager"] });
  assert.deepEqual(phrases(p), ["customer success manager", "account manager"]);
});

test("a whole target-role phrase outranks the same words scattered across an unrelated title", () => {
  const p = person({ targetRoles: ["Partnerships Manager"] });
  const jobs = [
    // Same term hits as job 2 (partnerships, salesforce, customer onboarding all present),
    // but never as the actual target phrase — an unrelated ops role, not a partnerships one.
    job({ id: "1", title: "Operations Manager", description: "This role touches partnerships, uses Salesforce, and involves customer onboarding daily." }),
    job({ id: "2", title: "Partnerships Manager", description: "Owns our partner ecosystem." }),
  ];
  const { keep } = rankSurvivors(jobs, p, 2);
  assert.deepEqual(keep.map((j) => j.id), ["2", "1"]);
});

test("an ad that rules out sponsorship drops for someone who needs it, and only then", () => {
  assert.equal(rulesOutSponsorship("Unfortunately we cannot offer visa sponsorship for this role."), true);
  assert.equal(rulesOutSponsorship("We do not provide sponsorship."), true);
  assert.equal(rulesOutSponsorship("You must already have a valid EU work permit."), true);
  assert.equal(rulesOutSponsorship("We only consider candidates based in the Netherlands."), true);
  assert.equal(rulesOutSponsorship("We offer visa sponsorship and relocation support."), false);
  assert.equal(rulesOutSponsorship("We are a recognised sponsor with the IND."), false);
  const refusing = job({ sponsor, description: "Great analyst role. We are not able to sponsor visas." });
  assert.equal(triage(refusing, sponsored()).reason, "the ad rules out visa sponsorship");
  assert.equal(triage(refusing, person()).keep, true);
});

test("basic Dutch is not speaking Dutch", () => {
  assert.equal(speaksDutch(person({ languages: ["English (Native Fluent)", "Dutch (Basic)"] })), false);
  assert.equal(speaksDutch(person({ languages: ["Dutch (A2)"] })), false);
  assert.equal(speaksDutch(person({ languages: ["Dutch (B1)"] })), true);
  assert.equal(speaksDutch(person({ languages: ["Nederlands (moedertaal)"] })), true);
});
