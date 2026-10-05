// Free, deterministic, before any model call. The hardest-won rule: a figure
// that is not clearly stated never drops a job. Dropping a good job is
// invisible and permanent; keeping a bad one costs one call.

import { usesIndRegister } from "./profile.ts";
import type { Job, Person } from "./types.ts";

export interface Verdict {
  keep: boolean;
  /** Why, in words. Shown on the board so a drop can be argued with. */
  reason: string;
  hits: number;
}

export function speaksDutch(p: Person): boolean {
  const said = [...p.languages, ...p.facts.filter((f) => f.kind === "language").map((f) => f.text)];
  // "Dutch (Basic)" on a CV is not enough to work in a Dutch-language job (seen on a real CV 2026-09-11).
  return said.some((l) => /dutch|nederlands/i.test(l) && !/\b(basic|beginner|elementary|learning|a1|a2)\b/i.test(l));
}

const NEEDS = /\b(fluent|fluency|native|excellent|proficien\w*|required|must|essential|mandatory|vloeiend|uitstekend\w*|goede? beheersing|moedertaal|c1|c2)\b/i;
const OPTIONAL = /\b(plus|nice to have|advantage|bonus|preferred|pluspunt|welcome)\b|pré/i;

/**
 * Recognised sponsors still post ads that say they will not sponsor this one.
 * Explicit phrasing only: silence about visas is not a refusal.
 */
const NO_SPONSOR =
  /\b(no|not|unable to|cannot|can't|can not|don't|do not|won't|will not)\b[^.\n]{0,25}\b(visa )?sponsor(ship)?\b|\bsponsorship is not\b|\bmust (already )?(have|hold|possess) (a |the )?(valid )?(eu |dutch |european )?(work permit|right to work|residence permit)|\bwithout (the )?need (for|of) (visa )?sponsorship|\b(only|already) (consider )?(candidates )?(based|living|residing) in the netherlands/i;

export function rulesOutSponsorship(description: string): boolean {
  return NO_SPONSOR.test(description);
}

/** A sentence that mentions Dutch as a requirement, and not as a plus. */
export function requiresDutch(description: string): boolean {
  return description
    .split(/(?<=[.!?\n•])\s*/)
    .some((s) => /\b(dutch|nederlands|nederlandse taal)\b/i.test(s) && NEEDS.test(s) && !OPTIONAL.test(s));
}

function parseAmount(token: string): number {
  let t = token.toLowerCase();
  const k = t.endsWith("k");
  t = t.replace(/k$/, "");
  // "4.000" / "60,000" / "4.000,50" / "60,000.00": drop cents, then separators.
  t = t.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, "");
  return Number(t) * (k ? 1000 : 1);
}

/**
 * Gross per month from a salary as the ad states it, top of the range, or
 * null when the ad does not state a period. Yearly is divided by 12 and
 * hourly multiplied by 173 (40h) — both round in the job's favour, which is
 * the direction a floor should err in.
 */
export function statedMonthly(salary: string): number | null {
  const s = salary.toLowerCase();
  const factor = /per (month|maand)|\/ ?(month|maand|mo|mnd)\b|p\/m|monthly|maandelijks|per mnd/.test(s)
    ? 1
    : /per (year|jaar)|\/ ?(yr|year|jaar)\b|annual|yearly|jaarlijks|p\/j|per annum/.test(s)
      ? 1 / 12
      : /per (hour|uur)|\/ ?(hr|hour|uur)\b|hourly|p\/u/.test(s)
        ? 173
        : null;
  if (factor === null) return null;
  const amounts = (s.match(/\d[\d.,]*k?/g) ?? []).map(parseAmount).filter((n) => n > 0);
  return amounts.length ? Math.round(Math.max(...amounts) * factor) : null;
}

/** Words that name the work, from the target roles and skill facts. */
export function terms(p: Person): string[] {
  const STOP = new Set(["and", "the", "for", "with", "junior", "senior", "medior", "lead", "manager", "specialist", "officer"]);
  const words = p.targetRoles.flatMap((r) => r.toLowerCase().split(/[^a-z0-9+#]+/));
  const skills = p.facts.filter((f) => f.kind === "skill").map((f) => f.text.toLowerCase().trim());
  return [...new Set([...words.filter((w) => w.length >= 3 && !STOP.has(w)), ...skills.filter(Boolean)])];
}

function countHits(body: string, list: string[]): number {
  return list.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(body)).length;
}

/**
 * The full target-role phrases, lowercased, kept only when they are more
 * than one word — a single word is already covered by `terms`. Splitting
 * "Partnerships Manager" into "partnerships" and "manager" lets it score a
 * hit off "Operations Manager"; the whole phrase together is a much sharper
 * signal of a genuine match than the sum of its words.
 */
export function phrases(p: Person): string[] {
  return [...new Set(p.targetRoles.map((r) => r.toLowerCase().trim()).filter((r) => r.split(/\s+/).length > 1))];
}

function countPhraseHits(body: string, list: string[]): number {
  return list.filter((phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body)).length;
}

/**
 * The check that needs only a search card: is the employer a recognised
 * sponsor. Run before a job's detail page is fetched, so a non-sponsor costs
 * no request at all.
 *
 * Location is deliberately not re-checked here. Discovery searches each of
 * the person's locations, and LinkedIn matches the metro area ("Amsterdam"
 * brings Amstelveen and Hoofddorp); a city-name filter on top would drop
 * exactly the jobs a human means by "Amsterdam".
 */
export function cardTriage(job: Job, p: Person): Verdict {
  if (usesIndRegister(p) && !job.sponsor) {
    return { keep: false, reason: `${job.company || "employer"} is not on the IND sponsor register`, hits: 0 };
  }
  return { keep: true, reason: "", hits: 0 };
}

export function triage(job: Job, p: Person): Verdict {
  const card = cardTriage(job, p);
  if (!card.keep) return card;
  if (!job.description) return { keep: false, reason: "no description", hits: 0 };
  if (p.needsSponsor && rulesOutSponsorship(job.description)) {
    return { keep: false, reason: "the ad rules out visa sponsorship", hits: 0 };
  }
  if (!speaksDutch(p)) {
    if (job.language === "nl") return { keep: false, reason: "the ad is in Dutch", hits: 0 };
    if (requiresDutch(job.description)) return { keep: false, reason: "the ad requires Dutch", hits: 0 };
  }
  const monthly = statedMonthly(job.salary);
  if (p.salaryFloor > 0 && monthly !== null && monthly < p.salaryFloor) {
    return {
      keep: false,
      reason: `stated salary ${job.salary} is under the ${p.salaryFloor}/month floor`,
      hits: 0,
    };
  }
  const t = terms(p);
  const ph = phrases(p);
  // A title hit is worth three body hits: "Data Analyst" in the title says more
  // than "data" in a paragraph about the company. A full target-role phrase is
  // worth double its words again: the whole thing matching beats each word
  // matching somewhere unrelated.
  const hits =
    countHits(job.title, t) * 3 +
    countHits(job.description, t) +
    countPhraseHits(job.title, ph) * 6 +
    countPhraseHits(job.description, ph) * 2;
  return { keep: true, reason: "", hits };
}

/** Triage, rank survivors by hits, and cap the batch that reaches a paid score. */
export function rankSurvivors(jobs: Job[], p: Person, max: number): { keep: Job[]; drop: { job: Job; reason: string }[] } {
  const drop: { job: Job; reason: string }[] = [];
  const survivors: { job: Job; hits: number }[] = [];
  for (const job of jobs) {
    const v = triage(job, p);
    if (v.keep) survivors.push({ job, hits: v.hits });
    else drop.push({ job, reason: v.reason });
  }
  survivors.sort((a, b) => b.hits - a.hits);
  // Past the cap is not a verdict on the job: it stays "new" and competes again next run.
  return { keep: survivors.slice(0, max).map((s) => s.job), drop };
}
