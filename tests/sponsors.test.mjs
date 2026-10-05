import { fixture } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIndex, matchSponsor, normaliseCompany, parseRegister, refreshSponsors } from "../lib/sponsors.ts";

test("parses the IND register, decoding entities and doubled quotes", () => {
  const rows = parseRegister(fixture("ind-register.html"));
  assert.equal(rows.length, 9);
  assert.deepEqual(rows[0], { name: '"Aa-Dee" Machinefabriek en Staalbouw Nederland B.V.', kvk: "16051874" });
  assert.ok(rows.some((r) => r.name === "Abel & Imray LLP"));
});

test("normalises legal forms, branches and initials away", () => {
  assert.equal(normaliseCompany("Adyen N.V."), "adyen");
  assert.equal(normaliseCompany("A.S. Watson (Health & Beauty Continental Europe) B.V."), "as watson");
  assert.equal(normaliseCompany("AS Watson Benelux"), "as watson");
  assert.equal(normaliseCompany("Booking.com B.V."), "booking com");
});

test("matches LinkedIn company names to the register", () => {
  const index = buildIndex(parseRegister(fixture("ind-register.html")));
  assert.equal(matchSponsor("Adyen", index)?.match, "exact");
  assert.equal(matchSponsor("Adyen", index)?.kvk, "34259528");
  assert.equal(matchSponsor("AS Watson Benelux", index)?.kvk, "31035585");
  assert.equal(matchSponsor("Booking.com", index)?.match, "exact");
  // One name extending the other is a likely match, labelled so a human checks it.
  assert.equal(matchSponsor("Booking Experts Nederland Rotterdam", index)?.match, "prefix");
  assert.equal(matchSponsor("Globex", index), null);
  assert.equal(matchSponsor("", index), null);
});

test("a short name cannot claim everything that starts with it", () => {
  const index = buildIndex([{ name: "ING B.V.", kvk: "1" }]);
  assert.equal(matchSponsor("ING Tech Solutions", index), null);
  assert.equal(matchSponsor("ING", index)?.match, "exact");
});

test("a legal-form word ahead of the brand still matches (seen live: Rabobank)", () => {
  const index = buildIndex([{ name: "Coöperatieve Rabobank U.A.", kvk: "1" }]);
  const m = matchSponsor("Rabobank", index);
  assert.equal(m?.match, "prefix");
  assert.equal(m?.kvk, "1");
});

test("a squashed brand name matches its spaced register entry (seen live: AkzoNobel)", () => {
  const index = buildIndex([{ name: "Akzo Nobel N.V.", kvk: "1" }]);
  assert.equal(matchSponsor("AkzoNobel", index)?.match, "exact");
});

test("a known abbreviation matches the register's spelled-out name (seen live: PwC)", () => {
  const index = buildIndex([{ name: "PricewaterhouseCoopers Advisory N.V.", kvk: "1" }]);
  assert.equal(matchSponsor("PwC Nederland", index)?.kvk, "1");
});

test("a register page that parses to almost nothing never overwrites a good one", async () => {
  await assert.rejects(refreshSponsors(async () => fixture("ind-register.html")), /only 9 rows/);
});
