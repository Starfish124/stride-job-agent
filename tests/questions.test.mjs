import { person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { factsFromAnswers, parseQuestions } from "../lib/profile.ts";

test("parseQuestions keeps only real questions and valid role ids", () => {
  const p = person();
  const raw = JSON.stringify({
    questions: [
      { under: "r1", question: "How many guests a day?" },
      { under: "nope", question: "What tools?" }, // unknown id -> loose
      { under: "r1", question: "" }, // empty -> dropped
    ],
  });
  const qs = parseQuestions(raw, p);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].under, "r1");
  assert.equal(qs[1].under, ""); // unknown id blanked, not dropped
});

test("factsFromAnswers turns answers into unique achievement facts under their role", () => {
  const p = person();
  const facts = factsFromAnswers(p, [
    { under: "r1", text: "Onboarded 42 partners" },
    { under: "gone", text: "Cut costs 15%" }, // missing role -> loose
    { under: "r1", text: "  " }, // blank -> skipped
  ]);
  assert.equal(facts.length, 2);
  assert.ok(facts.every((f) => f.kind === "achievement"));
  assert.equal(facts[0].under, "r1");
  assert.equal(facts[1].under, undefined);
  assert.equal(new Set(facts.map((f) => f.id)).size, 2); // ids unique
});
