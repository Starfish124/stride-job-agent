// Turn a job ad — a page or pasted text — into fields. Cheap tiers first, the
// model only sees what the parsers could not read.

import { parseJsonObject, type Llm } from "./llm.ts";

export interface AdFields {
  title: string;
  company: string;
  location: string;
  description: string;
  language: "nl" | "en";
  salary: string;
  contact: string;
  via: "json-ld" | "linkedin" | "selector" | "llm";
  applicants?: number;
  postedAt?: string;
}

/** "181 applicants" -> 181; "Be among the first 25 applicants" -> 0. */
export function applicantsFrom(html: string): number {
  const cap = html.match(/num-applicants__caption[^>]*>([\s\S]*?)</)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  if (!cap) return -1;
  if (/first \d+/i.test(cap)) return 0;
  const n = cap.match(/([\d.,]+)\s*applicants?/i)?.[1];
  return n ? Number(n.replace(/[.,]/g, "")) : -1;
}

/** "10 hours ago" -> ISO day. Anything it cannot read -> "". */
export function agoToIso(text: string, now = new Date()): string {
  const m = text.match(/(\d+)\s*(minute|hour|day|week|month)s?\s*ago/i);
  if (!m) return "";
  const n = Number(m[1]);
  const ms = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2].toLowerCase()]!;
  return new Date(now.getTime() - n * ms).toISOString().slice(0, 10);
}

export function text(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&(quot|apos|lt|gt|amp);/g, (_, e) =>
      ({ quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" })[e as string] ?? "",
    );
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Counting Dutch vs English function words beats a dependency. */
export function detectLanguage(body: string): "nl" | "en" {
  const words = body.toLowerCase();
  const dutch = (words.match(/\b(de|het|een|voor|met|zijn|wordt|jij|wij|je|ons|bij|werkzaamheden)\b/g) ?? []).length;
  const english = (words.match(/\b(the|a|for|with|are|will|you|we|our|your|and)\b/g) ?? []).length;
  return dutch > english ? "nl" : "en";
}

const UNIT: Record<string, string> = { HOUR: " per hour", MONTH: " per month", YEAR: " per year", WEEK: " per week" };

/** schema.org baseSalary -> "4000-5000 EUR per month". The unit is reported, never assumed. */
function formatSalary(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  const v = o.value && typeof o.value === "object" ? (o.value as Record<string, unknown>) : o;
  const clean = (x: unknown) => {
    const t = String(x ?? "").trim().replace(/\.0+$/, "");
    return /^0+([.,]0+)?$/.test(t) || t.startsWith("-") ? "" : t;
  };
  const min = clean(v.minValue);
  const max = clean(v.maxValue);
  const single = clean(o.value && typeof o.value === "object" ? v.value : o.value);
  const currency = String(o.currency ?? v.currency ?? "").trim();
  const unit = UNIT[String(v.unitText ?? o.unitText ?? "").toUpperCase()] ?? " (unit not stated)";
  const figure = min && max && min !== max ? `${min}-${max}` : single || min || max;
  if (!figure) return "";
  if (/[€$£]|\p{L}/u.test(figure)) return figure;
  return `${figure}${currency ? ` ${currency}` : ""}${unit}`;
}

/** Tier one: schema.org JobPosting. */
export function fromJsonLd(html: string): AdFields | null {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "").replace(/[\x00-\x1f]/g, " "));
    } catch {
      continue;
    }
    const root = parsed as Record<string, unknown>;
    const nodes = (Array.isArray(parsed) ? parsed : Array.isArray(root?.["@graph"]) ? root["@graph"] : [parsed]) as Record<string, unknown>[];
    for (const node of nodes) {
      const type = node?.["@type"];
      if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
      const description = text(String(node.description ?? ""));
      if (!description) continue;
      const address = ((Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation) as Record<string, unknown> | undefined)
        ?.address as Record<string, unknown> | undefined;
      const locality = String(address?.addressLocality ?? "").trim();
      return {
        title: oneLine(text(String(node.title ?? ""))),
        company: oneLine(text(String((node.hiringOrganization as Record<string, unknown> | undefined)?.name ?? ""))),
        location: /\p{L}/u.test(locality) ? locality : String(address?.addressCountry ?? ""),
        description,
        language: detectLanguage(description),
        salary: formatSalary(node.baseSalary),
        contact: "",
        via: "json-ld",
      };
    }
  }
  return null;
}

/** Tier one-and-a-half: LinkedIn's public job page (jobs-guest). */
export function fromLinkedIn(html: string, now = new Date()): AdFields | null {
  const body = html.match(/class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!body) return null;
  const description = text(body);
  const grab = (re: RegExp) => oneLine(decode(html.match(re)?.[1]?.replace(/<[^>]*>/g, " ") ?? ""));
  return {
    title: grab(/class="[^"]*topcard__title[^"]*"[^>]*>([\s\S]*?)<\/h\d>/i),
    company: grab(/class="topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i),
    location: grab(/class="topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/i),
    description,
    language: detectLanguage(description),
    salary: grab(/class="[^"]*salary[^"]*"[^>]*>([\s\S]*?)<\/div>/i),
    contact: "",
    via: "linkedin",
    applicants: applicantsFrom(html),
    postedAt: agoToIso(grab(/posted-time-ago__text[^>]*>([\s\S]*?)<\/span>/i), now),
  };
}

/** Tier two: the description containers real Dutch job sites use. */
export function fromSelectors(html: string): AdFields | null {
  const m = html.match(
    /<(?:div|section)[^>]*class="[^"]*(?:omschrijving|description|vacancy-text|vacature|job-description)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i,
  );
  const description = text(m?.[1] ?? "");
  if (description.length < 200) return null; // a nav blurb is not a job ad
  return {
    title: oneLine(text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")),
    company: "", location: "", description, language: detectLanguage(description),
    salary: "", contact: "", via: "selector",
  };
}

const LLM_PROMPT = `Read this job ad and return only JSON with exactly these string keys:
title, company, location, salary, contact.
- salary: exactly as the ad states it, including the period ("€4.000 - €5.000 per maand"); "" if not stated.
- contact: a named recruiter or hiring manager if the ad names one, else "".
Use "" for anything the ad does not state. Never guess.

AD:
`;

/**
 * Tier three, and the only path for pasted text. The description is the
 * user's own text (or the page's text), never the model's rewrite of it —
 * the model extracts fields and nothing else.
 */
export async function fromLlm(body: string, llm: Llm): Promise<AdFields> {
  const description = body.trim().slice(0, 15_000);
  let o: Record<string, unknown> | null = null;
  try {
    o = parseJsonObject(await llm(LLM_PROMPT + description));
  } catch {
    // A failed call leaves the fields blank; the description still stands.
  }
  const s = (k: string) => oneLine(String(o?.[k] ?? ""));
  return {
    title: s("title"), company: s("company"), location: s("location"), description,
    language: detectLanguage(description), salary: s("salary"), contact: s("contact"), via: "llm",
  };
}

/** The cascade for a fetched page. */
export async function fromPage(html: string, llm: Llm): Promise<AdFields> {
  const cheap = fromJsonLd(html) ?? fromLinkedIn(html) ?? fromSelectors(html);
  if (cheap) return cheap;
  return fromLlm(text(html), llm);
}
