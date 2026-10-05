// The pack: a CV and cover letter tailored to one job, plus the two LinkedIn
// messages for following up. The rule, inherited from the opdrachten spec:
// omission, never invention. Structure (employers, titles, dates, education)
// is rendered from facts by pdf.ts; the model only chooses, orders and
// rewords — and a mechanical check after generation holds it to that.

import { parseJsonObject, type Llm } from "./llm.ts";
import { leaksSuppressed, visibleFacts } from "./profile.ts";
import { factLines } from "./score.ts";
import type { Job, Pack, Person } from "./types.ts";

export const NOTE_LIMIT = 300;
export const TITLE_MAX_WORDS = 6;

/** Connectors a target title may use without being a "held" word. */
const TITLE_STOPWORDS = new Set(["of", "and", "for", "the", "in", "at", "to", "with", "&", "-", "/", "a", "an"]);

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * The target title under the name may only be built from words the person
 * actually held (their role titles) or the job's own advertised title. This is
 * the article's biggest lever — and its biggest risk — so a "Coordinator" is
 * never printed as "Manager". Returns the first offending word, or null.
 */
export function checkTitle(title: string, p: Person, job: Job): string | null {
  const ws = words(title ?? "");
  if (!ws.length) return "the target title is empty";
  if (ws.length > TITLE_MAX_WORDS) return `the target title has ${ws.length} words, over ${TITLE_MAX_WORDS}`;
  const allowed = new Set([
    ...visibleFacts(p).filter((f) => f.kind === "role").flatMap((f) => words(f.title ?? "")),
    ...words(job.title),
  ]);
  const bad = ws.find((w) => !allowed.has(w) && !TITLE_STOPWORDS.has(w));
  return bad ? `the target title word "${bad}" is not in a title they held or the job title` : null;
}

export function buildTailorPrompt(job: Job, p: Person, previousProblem = ""): string {
  const lang = job.language === "nl" ? "Dutch" : "English";
  return `Tailor this candidate's CV and write their cover letter for one job.

HARD RULES — a draft that breaks one is thrown away:
1. Use only the facts below. Do not add an employer, title, client, tool,
   responsibility, qualification or number that is not in them. Rewording is
   fine; upgrading is not ("helped with" never becomes "led").
2. Every number you write must appear in the facts or the job ad.
3. "skills" may only contain skill, language or certificate facts, copied exactly.
4. Bullets cite a fact id of kind achievement or role.
5. The "title" may use only words from a job title they held or from this ad's
   title. Do not promote them (never "Manager" if they were a "Coordinator").
${p.suppress.length ? `6. Never mention: ${p.suppress.join("; ")}.\n` : ""}
Write everything in ${lang}, the language of the ad.

Write plainly. A hiring manager reads for about 7 seconds. Lead each bullet with
a strong verb, then the result, then how. Avoid filler and AI tells: no
"results-driven", "passionate", "dynamic", "team player", "spearheaded",
"leveraged", "pivotal", "showcasing", no "not just X but Y", no em dashes. Where
a fact has no number, use scope, volume, frequency or who was involved — never
invent a figure.

THE CANDIDATE: ${p.name}
Wants: ${p.targetRoles.join("; ")}
Headline: ${p.headline}
${factLines(p)}

THE JOB
${job.title} at ${job.company || "the company"}${job.location ? `, ${job.location}` : ""}
${job.contact ? `Named contact: ${job.contact}\n` : ""}
${job.description.slice(0, 12_000)}

WHAT TO RETURN — only JSON, exactly these keys:
{
  "title": "<the target title under their name, aimed at this job, max ${TITLE_MAX_WORDS} words, built only from a title they held plus words from the ad's title. E.g. held "Software Engineer" + ad "payments" -> "Software Engineer, Payments".>",
  "summary": "<2-3 lines at the top of the CV, aimed at this job: target title, domain, one or two concrete proofs, and work authorisation. If they are changing careers, name the transferable strengths plainly.>",
  "bullets": [{"factId": "<id>", "text": "<the fact, reworded for this job, max 30 words>"}],
  "skills": ["<up to 12, most relevant first>"],
  "letter": "<the cover letter body, 220-320 words, from greeting to sign-off with their name. Specific to this company and role; no clichés like 'I am writing to express my interest'.>",
  "connectNote": "<LinkedIn connection note to the recruiter or hiring manager, under 280 characters, mentions the role and that they applied>",
  "followUp": "<LinkedIn message for after they accept: 3-4 sentences, one concrete reason they fit, one light ask>"
}
Pick the 6-12 bullets that matter most for this job, most relevant first.
${previousProblem ? `\nYOUR PREVIOUS DRAFT WAS REJECTED: ${previousProblem}\nFix exactly that.` : ""}`;
}

export function parsePack(raw: string): Pack | null {
  const o = parseJsonObject(raw);
  if (!o) return null;
  const str = (k: string) => String(o[k] ?? "").trim();
  const bullets = Array.isArray(o.bullets)
    ? (o.bullets as Record<string, unknown>[])
        .filter((b) => b && typeof b === "object")
        .map((b) => ({ factId: String(b.factId ?? ""), text: String(b.text ?? "").trim() }))
    : [];
  const skills = Array.isArray(o.skills) ? (o.skills as unknown[]).map((s) => String(s).trim()).filter(Boolean) : [];
  return {
    title: str("title"), summary: str("summary"), bullets, skills, letter: str("letter"),
    connectNote: str("connectNote"), followUp: str("followUp"), at: new Date().toISOString(),
  };
}

/** "1.000", "1,000" and "1000" are one number; "30%" is "30". */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/[.,]/g, ""));
}

/**
 * The mechanical half of "omission, never invention". Returns the first
 * problem, or null when the pack is clean. It cannot catch every upgrade in
 * wording — that is what reading the PDF before sending it is for — but it
 * catches the invented number, the invented skill and the suppressed term.
 */
export function checkPack(pack: Pack, p: Person, job: Job): string | null {
  if (!pack.summary) return "summary is empty";
  const titleProblem = checkTitle(pack.title, p, job);
  if (titleProblem) return titleProblem;
  if (!pack.letter) return "letter is empty";
  if (!pack.connectNote) return "connectNote is empty";
  if (pack.connectNote.length > NOTE_LIMIT) return `connectNote is ${pack.connectNote.length} characters, over ${NOTE_LIMIT}`;
  if (pack.bullets.length === 0) return "no bullets";

  const facts = visibleFacts(p);
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const b of pack.bullets) {
    const f = byId.get(b.factId);
    if (!f) return `bullet cites fact "${b.factId}", which does not exist or is suppressed`;
    if (f.kind !== "achievement" && f.kind !== "role") return `bullet cites ${f.kind} fact ${f.id}`;
    if (!b.text) return `bullet for ${f.id} is empty`;
  }

  const labels = new Set(
    facts.filter((f) => ["skill", "language", "certificate"].includes(f.kind)).map((f) => f.text.toLowerCase().trim()),
  );
  const invented = pack.skills.find((s) => !labels.has(s.toLowerCase()));
  if (invented) return `skill "${invented}" is not one of their skill facts`;

  const everything = [pack.summary, pack.letter, pack.connectNote, pack.followUp, ...pack.bullets.map((b) => b.text)].join("\n");
  const allowed = new Set(
    numbersIn(
      [
        ...facts.flatMap((f) => [f.text, f.title, f.org, f.dates]),
        p.phone, p.email, p.linkedin, p.location,
        job.title, job.company, job.location, job.description, job.salary,
      ].join("\n"),
    ),
  );
  const number = numbersIn(everything).find((n) => !allowed.has(n));
  if (number) return `the number ${number} is not in their facts or the ad`;

  const leaked = leaksSuppressed(p, everything);
  if (leaked) return `mentions the suppressed "${leaked}"`;
  return null;
}

/** One regeneration with the problem spelled out, then give up loudly. */
export async function tailor(job: Job, p: Person, llm: Llm): Promise<Pack> {
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const pack = parsePack(await llm(buildTailorPrompt(job, p, problem)));
    problem = pack ? (checkPack(pack, p, job) ?? "") : "the answer was not the JSON asked for";
    if (pack && !problem) return pack;
  }
  throw new Error(`tailoring failed twice: ${problem}`);
}

/** One click from the job to the people worth messaging about it: the named contact, a recruiter, the team lead. */
export function peopleSearches(job: Job): { label: string; url: string }[] {
  const url = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q.trim())}`;
  const field = job.title
    .replace(/\(.*?\)|\b[mfvx]\/[mfvx](\/[mfvxd])?\b/gi, " ")
    .replace(/\b(senior|junior|medior|lead)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    ...(job.contact ? [{ label: job.contact, url: url(`${job.contact} ${job.company}`) }] : []),
    { label: `recruiters at ${job.company}`, url: url(`recruiter ${job.company}`) },
    { label: `${field} leads at ${job.company}`, url: url(`${field} manager ${job.company}`) },
  ];
}
