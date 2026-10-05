import { parseJsonObject } from "./llm.ts";
import type { Fact, Person } from "./types.ts";

const KINDS: Fact["kind"][] = ["role", "education", "achievement", "skill", "language", "certificate"];

/**
 * Everything a person must have before anything is scored or tailored.
 * Returns the problems; empty means usable.
 */
export function validatePerson(p: Person): string[] {
  const problems: string[] = [];
  if (!p.name?.trim()) problems.push("name is empty");
  if (!p.email?.trim()) problems.push("email is empty");
  if (!p.targetRoles?.length) problems.push("targetRoles is empty — say what they are applying FOR");
  if (!p.country?.trim()) problems.push("country is empty — say which country they are job hunting in");
  if (!p.facts?.some((f) => f.kind === "role")) problems.push("needs at least one role fact");
  const ids = new Set(p.facts?.map((f) => f.id));
  for (const f of p.facts ?? []) {
    if (!KINDS.includes(f.kind)) problems.push(`fact ${f.id} has unknown kind "${f.kind}"`);
    if (!f.text?.trim() && f.kind !== "role" && f.kind !== "education") problems.push(`fact ${f.id} has no text`);
    if ((f.kind === "role" || f.kind === "education") && !(f.title?.trim() && f.org?.trim())) {
      problems.push(`${f.kind} ${f.id} needs a title and an org`);
    }
    if (f.under && !ids.has(f.under)) problems.push(`fact ${f.id} hangs under ${f.under}, which does not exist`);
  }
  if (!p.reviewed) problems.push("not reviewed yet — read every fact against the CV, then set reviewed: true");
  return problems;
}

/**
 * The suppression check, run over anything generated before it is shown.
 * Substring and case-insensitive on purpose.
 */
export function leaksSuppressed(p: Person, text: string): string | null {
  const haystack = text.toLowerCase();
  for (const term of p.suppress ?? []) {
    if (term.trim() && haystack.includes(term.toLowerCase())) return term;
  }
  return null;
}

/**
 * The facts anything downstream may see: not matching a suppressed term, and
 * not hanging under a fact that does. Suppression is omission at the source —
 * the prompts, the checks and the PDF all read this, so a suppressed job
 * cannot reach the CV by any route.
 */
export function visibleFacts(p: Person): Fact[] {
  const hidden = new Set(
    p.facts.filter((f) => leaksSuppressed(p, [f.title, f.org, f.text].filter(Boolean).join(" "))).map((f) => f.id),
  );
  return p.facts.filter((f) => !hidden.has(f.id) && !(f.under && hidden.has(f.under)));
}

export const isNetherlands = (country: string) => /^(the )?netherlands$|^nederland$|^nl$/i.test((country ?? "").trim());

/** The Dutch IND sponsor register only means something for a visa job hunt in the Netherlands. */
export const usesIndRegister = (p: Person) => p.needsSponsor && isNetherlands(p.country);

export function blankPerson(id: string): Person {
  return {
    id, name: "", email: "", phone: "", location: "", linkedin: "", headline: "",
    targetRoles: [], country: "", locations: [], languages: [], needsSponsor: false, salaryFloor: 0,
    facts: [], suppress: [], reviewed: false,
  };
}

export function buildIntakePrompt(cv: string, goal: string): string {
  return `Turn this CV into structured facts. Copy, never embellish: every fact must be
directly supported by the CV text. Do not invent numbers, employers, titles,
dates, tools or responsibilities. If the CV is vague, the fact stays vague.

WHAT THEY WANT NEXT (use for targetRoles and headline only, never for facts):
${goal || "not stated — infer targetRoles from the CV"}

Return only JSON with exactly these keys:
{
  "name": "", "email": "", "phone": "", "location": "", "linkedin": "",
  "headline": "<one line, honest about where they are and where they are heading>",
  "targetRoles": ["<2-4 job titles they should search for>"],
  "languages": ["<e.g. English (native)>"],
  "facts": [
    {"id": "r1", "kind": "role", "title": "<exact title held>", "org": "<employer>", "dates": "<as written>", "text": "<what the role covered, only if the CV says more than the title; else empty>"},
    {"id": "a1", "kind": "achievement", "under": "r1", "text": "<one concrete thing they did in that role>"},
    {"id": "e1", "kind": "education", "title": "<degree>", "org": "<institution>", "dates": "", "text": ""},
    {"id": "s1", "kind": "skill", "text": "<one skill or tool>"},
    {"id": "l1", "kind": "language", "text": "<language and level>"},
    {"id": "c1", "kind": "certificate", "text": "<certificate>"}
  ]
}
Roles and education in the order the CV lists them. One achievement per bullet
in the CV. Ids are unique short strings.

CV:
${cv}`;
}

/**
 * Five short questions to ask the person in one sitting, each aimed at a role,
 * whose answer puts a real number or scope onto the CV. This is the honest way
 * to get metrics: the CV writer may never invent one, so we collect the true
 * figure and add it as a fact. Returns JSON {questions:[{under, question}]}.
 */
export function buildQuestionsPrompt(p: Person): string {
  const roles = visibleFacts(p)
    .filter((f) => f.kind === "role")
    .map((f) => {
      const bullets = p.facts.filter((x) => x.kind === "achievement" && x.under === f.id).map((x) => `    - ${x.text}`);
      return [`  ${f.id}: ${[f.title, f.org, f.dates].filter(Boolean).join(", ")}`, ...bullets].join("\n");
    })
    .join("\n");
  return `You are helping ${p.name} strengthen their CV before applying. Their CV
describes what they did but rarely with a number. Write exactly 5 short questions
to ask them out loud, each about ONE role below, whose answer would add a
concrete figure or scope to the CV: how many, how much, how often, team size,
budget, volume, growth, or the result. Plain and specific — "How many partners
did you onboard?" not "Tell me about partnerships". Never assume the answer.

THE ROLES AND WHAT THEY ALREADY SAY:
${roles}

Return only JSON, exactly:
{"questions":[{"under":"<role id from above>","question":"<the question>"}]}
Five questions, spread across the roles, most useful first.`;
}

export function parseQuestions(raw: string, p: Person): { under: string; question: string }[] {
  const o = parseJsonObject(raw);
  const ids = new Set(p.facts.map((f) => f.id));
  if (!o || !Array.isArray(o.questions)) return [];
  return (o.questions as Record<string, unknown>[])
    .filter((q) => q && typeof q === "object" && String(q.question ?? "").trim())
    .map((q) => ({ under: ids.has(String(q.under)) ? String(q.under) : "", question: String(q.question).trim() }))
    .slice(0, 8);
}

/**
 * Turn answered questions into achievement facts. Each non-empty answer becomes
 * one achievement under its role (or a loose highlight if the role is gone).
 * reviewed is flipped off by the caller — new facts must be checked like any.
 */
export function factsFromAnswers(p: Person, answers: { under: string; text: string }[]): Fact[] {
  const ids = new Set(p.facts.map((f) => f.id));
  return answers
    .filter((a) => a.text.trim())
    .map((a, i) => {
      let id = `qa${Date.now().toString(36)}${i}`;
      while (ids.has(id)) id += "x";
      ids.add(id);
      const fact: Fact = { id, kind: "achievement", text: a.text.trim() };
      if (a.under && ids.has(a.under)) fact.under = a.under;
      return fact;
    });
}

/**
 * The model's draft, merged onto a blank person. Always comes back with
 * reviewed: false — a draft that has not been read against the CV is not a
 * source of truth for anything.
 */
export function parseIntake(raw: string, id: string, previous?: Person): Person | null {
  const o = parseJsonObject(raw);
  if (!o || !Array.isArray(o.facts)) return null;
  const str = (k: string) => String(o[k] ?? "").trim();
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).map(String).filter(Boolean) : []);
  const facts: Fact[] = (o.facts as Record<string, unknown>[])
    .filter((f) => f && typeof f === "object" && KINDS.includes(f.kind as Fact["kind"]))
    .map((f) => {
      const fact: Fact = { id: String(f.id ?? ""), kind: f.kind as Fact["kind"], text: String(f.text ?? "").trim() };
      for (const k of ["title", "org", "dates", "under"] as const) if (f[k]) fact[k] = String(f[k]).trim();
      return fact;
    });
  const base = previous ?? blankPerson(id);
  return {
    ...base,
    name: str("name") || base.name,
    email: str("email") || base.email,
    phone: str("phone") || base.phone,
    location: str("location") || base.location,
    linkedin: str("linkedin") || base.linkedin,
    headline: str("headline"),
    targetRoles: list("targetRoles"),
    languages: list("languages"),
    facts,
    reviewed: false,
  };
}
