import { goodPack, person } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cvChecks } from "../lib/cvcheck.ts";

const by = (checks, label) => checks.find((c) => c.label === label);

test("a clean pack passes every soft check", () => {
  const checks = cvChecks(goodPack(), person(), 1);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
});

test("buzzwords, em dashes, weak openers and two pages are flagged", () => {
  const pack = goodPack({
    summary: "A results-driven, passionate team player — dynamic and detail-oriented.",
    bullets: [{ factId: "a1", text: "Responsible for the front desk of a busy hotel." }],
  });
  const checks = cvChecks(pack, person(), 2);
  assert.equal(by(checks, "No buzzwords").ok, false);
  assert.equal(by(checks, "No em dashes").ok, false);
  assert.equal(by(checks, "Bullets are achievements, not duties").ok, false);
  assert.equal(by(checks, "One page").ok, false);
});
