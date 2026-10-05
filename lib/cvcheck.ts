// The soft half of the CV rules (docs/cv-rules.md). checkPack in tailor.ts
// blocks the hard breaches (invented number/skill/title, suppressed term); this
// only *flags* style for the person reading the pack before they send it. A
// warning here never stops a draft — it is a prompt to read, not a gate.

import type { Pack, Person } from "./types.ts";

/** AI/filler tells recruiters flag (cv-rules.md). Word-boundary, case-insensitive. */
const BANNED = [
  "results-driven", "results driven", "passionate", "dynamic", "team player", "detail-oriented",
  "detail oriented", "self-starter", "synergy", "spearheaded", "leveraged", "pivotal", "underscore",
  "testament", "showcasing", "delve", "go-getter", "think outside the box",
];
/** Weak bullet openers — a duty, not an achievement. */
const WEAK_OPENERS = ["responsible for", "worked on", "helped", "assisted", "duties included", "tasked with", "was ", "involved in"];

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

/** `pages` is the rendered page count when the caller has it (one-page rule). */
export function cvChecks(pack: Pack, p: Person, pages?: number): Check[] {
  const bullets = pack.bullets.map((b) => b.text);
  const prose = [pack.title, pack.summary, pack.letter, ...bullets].join("\n").toLowerCase();

  const buzz = BANNED.filter((w) => prose.includes(w));
  const weak = bullets.filter((t) => WEAK_OPENERS.some((w) => t.toLowerCase().startsWith(w)));
  const withNumber = bullets.filter((t) => /\d/.test(t)).length;
  const summaryWords = pack.summary.split(/\s+/).filter(Boolean).length;
  const emDash = /[—]/.test(prose);

  const checks: Check[] = [
    { ok: summaryWords <= 60, label: "Summary is short", detail: `${summaryWords} words` },
    { ok: buzz.length === 0, label: "No buzzwords", detail: buzz.length ? `found: ${buzz.join(", ")}` : "" },
    { ok: !emDash, label: "No em dashes", detail: emDash ? "found —" : "" },
    { ok: weak.length === 0, label: "Bullets are achievements, not duties", detail: weak.length ? `${weak.length} start weakly, e.g. "${weak[0].slice(0, 40)}…"` : "" },
    { ok: bullets.length === 0 || withNumber > 0, label: "Some bullets carry a figure", detail: `${withNumber} of ${bullets.length}` },
  ];
  if (pages !== undefined) checks.push({ ok: pages <= 1, label: "One page", detail: `${pages} page${pages === 1 ? "" : "s"}` });
  return checks;
}
