// Agent search: Claude in Chrome browses the job sites that block plain
// fetches and comes back with a JSON list. Read-only by instruction: it
// never applies, never logs in, never fills a form.

import { isNetherlands } from "../profile.ts";
import type { Person } from "../types.ts";

export interface Found {
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salary: string;
  postedAt: string;
}

/** Indeed and Glassdoor run a site per country; the Dutch ones are known, elsewhere the agent is told to switch. */
export function sites(country: string) {
  const nl = isNetherlands(country);
  return {
    indeed: (q: string, l: string) => `https://${nl ? "nl" : "www"}.indeed.com/jobs?q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}&fromage=7&sort=date`,
    glassdoor: (q: string, l: string) => `https://www.glassdoor.${nl ? "nl" : "com"}/Job/jobs.htm?sc.keyword=${encodeURIComponent(q)}&locKeyword=${encodeURIComponent(l)}&fromAge=7`,
    google: (q: string, l: string) => `https://www.google.com/search?q=${encodeURIComponent(`${q} jobs ${l}`)}&ibp=htl;jobs`,
  };
}
export type Site = keyof ReturnType<typeof sites>;

export function buildSearchPrompt(p: Person, cfg: { maxJobs: number; knownUrls: string[]; sites?: Site[] }): string {
  const places = p.locations.length ? p.locations.map((l) => (l.includes(",") ? l : `${l}, ${p.country}`)) : [p.country];
  const urls = sites(p.country);
  const use = cfg.sites ?? (Object.keys(urls) as Site[]);
  const searches = p.targetRoles.flatMap((r) => places.flatMap((l) => use.map((s) => `- ${s}: ${urls[s](r, l)}`)));
  return `You are finding job openings in ${p.country} for a candidate, using the browser.

THE CANDIDATE wants: ${p.targetRoles.join("; ")}. Places: ${places.join("; ")}.
${p.needsSponsor ? "They need visa sponsorship, so prefer larger employers and skip ads that say no sponsorship.\n" : ""}${!isNetherlands(p.country) || p.languages.some((l) => /dutch|nederlands/i.test(l)) ? "" : "They do not speak Dutch: skip ads written in Dutch or requiring Dutch.\n"}
RULES
- Read only. Never apply, never log in, never fill in a form, never click "Easy Apply" or any apply button.
- Open each search below, look at the results posted in the last 7 days, and open the ones that fit
  the roles above. Prefer postings that are new or have few applicants when the site shows that.
- Skip any URL in the KNOWN list — those are already on file.
- Stop after ${cfg.maxJobs} good jobs, or when the searches are exhausted.
- If a site blocks you or asks you to log in, skip that site and say so.
- If a link lands on a job site for the wrong country, use that site's version for ${p.country} instead.
- Save as you go: after each good job, write the whole list so far to found.json in the current
  directory, in the same format as the final answer. If the run is cut short, that file is kept.

SEARCHES
${searches.join("\n")}

KNOWN (skip these)
${cfg.knownUrls.slice(0, 300).join("\n") || "(none)"}

WHEN DONE, reply with ONLY a JSON array, one object per job, exactly these keys:
[{"url":"<the job's own page, not the search page>","title":"","company":"","location":"","description":"<the first ~1500 characters of the ad, plain text>","salary":"<as stated, or empty>","postedAt":"<YYYY-MM-DD if shown, else empty>"}]
An empty array is a valid answer.`;
}

export function parseFound(result: string): Found[] {
  const start = result.indexOf("[");
  const end = result.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(result.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const s = (o: Record<string, unknown>, k: string) => String(o[k] ?? "").trim();
  return arr
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({
      url: s(o, "url"), title: s(o, "title"), company: s(o, "company"), location: s(o, "location"),
      description: s(o, "description"), salary: s(o, "salary"), postedAt: s(o, "postedAt").slice(0, 10),
    }))
    .filter((f) => /^https?:\/\//.test(f.url) && f.title);
}
