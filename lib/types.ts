/**
 * One usable claim about a person, drafted from their CV and reviewed by hand.
 * Tailoring may reorder, emphasise and reword facts; it may never add one.
 *
 * - role / education carry `title`, `org` and `dates`, and are rendered onto
 *   the CV verbatim — the model cannot retitle a job it did not hold.
 * - achievement hangs off a role or education via `under` (that fact's id).
 * - skill / language / certificate are short labels in `text`.
 */
export interface Fact {
  id: string;
  kind: "role" | "education" | "achievement" | "skill" | "language" | "certificate";
  text: string;
  title?: string;
  org?: string;
  dates?: string;
  under?: string;
}

export interface Person {
  /** Short slug: "a", "b", "anna". Used in URLs and file names. */
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Where they live, printed on the CV. */
  location: string;
  linkedin: string;
  /** One line under the name on the CV, e.g. "Marketing coordinator moving into UX research". */
  headline: string;
  /** What they are applying FOR. Drives search keywords, triage ranking and scoring. */
  targetRoles: string[];
  /** The country they are job hunting in, e.g. "Germany". LinkedIn and the job sites need it. */
  country: string;
  /** Cities they will work in. Empty = the whole country. Discovery searches each. */
  locations: string[];
  languages: string[];
  /**
   * They need visa sponsorship: the apply agent says so, and ads that rule it
   * out are dropped. In the Netherlands, also only jobs at an IND recognised
   * sponsor survive triage (`usesIndRegister`).
   */
  needsSponsor: boolean;
  /**
   * Gross monthly salary floor, excl. holiday allowance. For a sponsored
   * person this is the IND highly-skilled-migrant threshold for their band
   * (2nd half 2026: 5942 aged 30+, 4357 under 30, 3122 reduced criterion —
   * re-check ind.nl every 1 January). 0 = no floor. Only a STATED salary is
   * ever compared against it.
   */
  salaryFloor: number;
  facts: Fact[];
  /** True material that must never appear in output. Case-insensitive substrings. */
  suppress: string[];
  /** Nothing is scored or tailored until a human has read the facts and set this. */
  reviewed: boolean;
  /** The CV text as uploaded, kept so the facts can be re-drafted. */
  cv?: string;
  /** What they want next, in their words. Feeds the intake prompt. */
  goal?: string;
  /** Draft questions to ask them, each tied to a role; answers become facts. */
  questions?: { under: string; question: string }[];
}

export type JobStatus =
  | "new"
  /** Triaged out before any model call. `triage` says why. */
  | "filtered"
  | "scored"
  /** CV + letter pack exists. */
  | "drafted"
  /** The agent filled the form and stopped before submit. `note` says what is left. */
  | "waiting"
  | "applied"
  | "followed_up"
  | "interview"
  | "offer"
  | "rejected"
  | "expired";

export interface SponsorMatch {
  /** exact = same normalised name; prefix = one name extends the other. Check prefix matches by eye. */
  match: "exact" | "prefix";
  name: string;
  kvk: string;
}

export interface Score {
  score: number;
  reasoning: string;
  at: string;
  /** 1-10 each, judged only against what the ad states. Absent on scores from before this existed. */
  fit?: { skills: number; seniority: number; language: number };
}

export interface Pack {
  /** The short target title printed under the name, aimed at this job. */
  title: string;
  summary: string;
  /** Chosen facts in the order the CV should show them, each reworded for this job. */
  bullets: { factId: string; text: string }[];
  skills: string[];
  letter: string;
  /** LinkedIn connection note, <= 300 chars. */
  connectNote: string;
  /** The message for after the invite is accepted. */
  followUp: string;
  at: string;
}

export interface Job {
  id: string;
  personId: string;
  source: "paste" | "linkedin" | "board" | "agent";
  /** Empty for a job pasted without a link. */
  url: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
  /** From LinkedIn's public page. -1 = unknown. A low number is a real edge. */
  applicants: number;
  addedAt: string;
  status: JobStatus;
  description: string;
  language: "nl" | "en";
  /** As the ad states it, "" when it does not. Never inferred. */
  salary: string;
  /** A named recruiter or hiring manager, when the ad gives one. */
  contact: string;
  sponsor?: SponsorMatch | null;
  /** Why a job was filtered. */
  triage?: string;
  score?: Score;
  pack?: Pack;
  /** People found by the contact agent, best first. */
  contacts?: { name: string; title: string; url: string }[];
  /** What the last apply run reported. */
  note?: string;
  /** The last agent run on this job. */
  runId?: string;
  appliedAt?: string;
  /** Pending follow-up dates (ISO day), soonest first. */
  followUps?: string[];
  /** Set when a stage fails, so a bad job is visible not silent. */
  error?: string;
}
