// A before/after number for the CV rules. For every drafted pack, it scores
// conformance to docs/cv-rules.md mechanically — no LLM, so it is cheap and
// repeatable. Run it before a prompt/rules change and after.
//
//   node scripts/eval-cv.ts          # every drafted pack
//   node scripts/eval-cv.ts a        # just one person
//
// Score per pack, 0-100: hard rules clean (50) + soft checks passing (35) +
// one page (15). The mean across packs is the number to compare.

import { cvChecks } from "../lib/cvcheck.ts";
import { listJobs, listPeople } from "../lib/jobs.ts";
import { cvPageCount } from "../lib/pdf.ts";
import { checkPack } from "../lib/tailor.ts";

const only = process.argv[2];
const people = new Map(listPeople().map((p) => [p.id, p]));
const jobs = listJobs().filter((j) => j.pack && (!only || j.personId === only));

if (!jobs.length) {
  console.log(only ? `No drafted packs for "${only}".` : "No drafted packs yet. Draft a few, then run this.");
  process.exit(0);
}

let total = 0;
const rows: string[] = [];
for (const j of jobs) {
  const p = people.get(j.personId)!;
  const pack = j.pack!;
  const hard = checkPack(pack, p, j); // null = clean
  const pages = await cvPageCount(p, pack, j.language);
  const soft = cvChecks(pack, p, pages);
  const softPass = soft.filter((c) => c.ok).length;
  const score = (hard === null ? 50 : 0) + Math.round((softPass / soft.length) * 35) + (pages <= 1 ? 15 : 0);
  total += score;
  const flags = [hard ? `HARD: ${hard}` : "", ...soft.filter((c) => !c.ok).map((c) => c.label)].filter(Boolean).join("; ");
  rows.push(`  ${String(score).padStart(3)}  ${p.name.padEnd(16).slice(0, 16)} ${(j.title || "").slice(0, 34).padEnd(34)} ${pages}p  ${flags}`);
}

rows.sort();
console.log(`\nCV conformance to docs/cv-rules.md — ${jobs.length} pack(s)\n`);
console.log("score  person           job                                pages  flags");
console.log(rows.join("\n"));
console.log(`\n  MEAN SCORE: ${(total / jobs.length).toFixed(1)} / 100\n`);
