// Scores a job against one person's target: one model call, a strict parse,
// and a leak check on the reasoning.

import { parseJsonObject, type Llm } from "./llm.ts";
import { leaksSuppressed, usesIndRegister, visibleFacts } from "./profile.ts";
import type { Job, Person, Score } from "./types.ts";

export function factLines(p: Person): string {
  return visibleFacts(p)
    .map((f) => {
      const head = [f.title, f.org, f.dates].filter(Boolean).join(", ");
      return `- [${f.id} ${f.kind}${f.under ? ` under ${f.under}` : ""}] ${head}${head && f.text ? ": " : ""}${f.text}`;
    })
    .join("\n");
}

export function buildScorePrompt(job: Job, p: Person): string {
  return `You are rating how good a use of one application this job is for this candidate.

THE CANDIDATE
Wants: ${p.targetRoles.join("; ")}
Headline: ${p.headline}
Languages: ${p.languages.join(", ") || "not stated"}
${p.needsSponsor ? `Needs visa sponsorship${usesIndRegister(p) ? " (the employer is an IND recognised sponsor)" : ""}.\n` : ""}
Judge using only these facts. Do not assume experience that is not here.
${factLines(p)}

THE JOB
Title: ${job.title}
Company: ${job.company || "not stated"}
Location: ${job.location || "not stated"}
Salary: ${job.salary || "not stated"}

${job.description.slice(0, 12_000)}

HOW TO SCORE
9-10  Squarely what they want, and they meet the must-haves.
7-8   What they want, with one real gap (a missing must-have skill, or seniority).
5-6   A credible stretch: transferable experience makes them a real candidate.
3-4   Adjacent field, but they would not get past screening.
1-2   Unrelated to what they want or can show.

The candidate may be changing careers. Transferable experience counts — judge
whether a recruiter would plausibly shortlist them, not whether their job
titles match. An unstated salary is unknown, not low.

Also rate three dimensions on their own 1-10 scale, each judged only against
what the ad actually states (not stated = neutral, not a penalty):
- skills: do their facts cover what the ad's must-haves ask for
- seniority: does the ad's experience/level bar match what their facts show
- language: do they meet the ad's stated language requirements

Return only JSON: {"score": <number>, "reasoning": "<two sentences: the strongest match, and the biggest gap>", "fit": {"skills": <number>, "seniority": <number>, "language": <number>}}`;
}

/**
 * Seen live 2026-09-11: bare quotes inside the reasoning, and the closing `"}`
 * missing. Two fields are simple enough to read without a JSON parser.
 */
function looseScore(raw: string): Record<string, unknown> | null {
  const score = raw.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  const reasoning = raw.match(/"reasoning"\s*:\s*"([\s\S]*)/);
  if (!score || !reasoning) return null;
  const text = reasoning[1].replace(/"\s*,\s*"score"[\s\S]*$/, "").replace(/"?\s*\}?\s*$/, "");
  return { score: Number(score[1]), reasoning: text };
}

/** One 1-10 number, or undefined — a malformed sub-score is dropped, never lets a bad number through. */
function fitNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n) : undefined;
}

/** Present only when all three dimensions parsed — a partial breakdown is worse than none on the board. */
function parseFit(o: unknown): Score["fit"] {
  if (!o || typeof o !== "object") return undefined;
  const skills = fitNumber((o as Record<string, unknown>).skills);
  const seniority = fitNumber((o as Record<string, unknown>).seniority);
  const language = fitNumber((o as Record<string, unknown>).language);
  return skills !== undefined && seniority !== undefined && language !== undefined ? { skills, seniority, language } : undefined;
}

export function parseScore(raw: string): Score | null {
  const o = parseJsonObject(raw) ?? looseScore(raw);
  if (!o) return null;
  const score = Number(o.score);
  // A model that answers 47 or 0 has not understood the scale; a number we
  // cannot trust is worse than none, because the board ranks on it.
  if (!Number.isFinite(score) || score < 1 || score > 10) return null;
  const reasoning = String(o.reasoning ?? "").trim();
  if (!reasoning) return null;
  const fit = parseFit((o as Record<string, unknown>).fit);
  return { score: Math.round(score), reasoning, at: new Date().toISOString(), ...(fit ? { fit } : {}) };
}

/** Throws with the reason when the job cannot be scored, so the caller can record it. */
export async function scoreJob(job: Job, p: Person, llm: Llm): Promise<Score> {
  if (!job.description) throw new Error("job has no description");
  const raw = await llm(buildScorePrompt(job, p));
  const score = parseScore(raw);
  if (!score) throw new Error(`model output could not be parsed as a score: ${raw.slice(0, 200)}`);
  const leaked = leaksSuppressed(p, score.reasoning);
  if (leaked) throw new Error(`reasoning leaked a suppressed term: ${leaked}`);
  return score;
}
