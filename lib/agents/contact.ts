// Find the person to follow up with: a recruiter or hiring manager at the
// company, on LinkedIn, in your own logged-in browser. Looking
// only — the candidate sends the note themselves.

import type { Job } from "../types.ts";

export interface Contact {
  name: string;
  title: string;
  url: string;
}

export function buildContactPrompt(job: Job): string {
  const field = job.title.replace(/\(.*?\)|\b(senior|junior|medior|lead|intern)\b/gi, " ").replace(/\s+/g, " ").trim();
  return `Using the browser, on LinkedIn (you are already logged in), find who to contact about this job:

${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}
${job.contact ? `The ad names: ${job.contact}. Find that person first.\n` : ""}
Search people at "${job.company}" with titles like: recruiter, talent acquisition, technical recruiter,
hiring manager, head of ${field}, ${field} manager, ${field} lead. Prefer people near the job's location.
Open at most 5 profiles. Do NOT connect, message, follow, or react to anything. Do not use InMail.

Reply with ONLY a JSON array, best contact first, at most 3:
[{"name":"","title":"","url":"https://www.linkedin.com/in/..."}]
An empty array is a valid answer if nobody fits.`;
}

export function parseContacts(result: string): Contact[] {
  const start = result.indexOf("[");
  const end = result.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(result.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({ name: String(o.name ?? "").trim(), title: String(o.title ?? "").trim(), url: String(o.url ?? "").trim() }))
      .filter((c) => c.name && /linkedin\.com\/in\//i.test(c.url))
      .slice(0, 3);
  } catch {
    return [];
  }
}
