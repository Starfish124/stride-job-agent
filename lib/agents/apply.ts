// The apply agent: Claude in Chrome opens the company's own apply page and
// fills it from a candidate sheet built entirely from the reviewed facts.
// `fill-and-wait` stops before the final submit; `auto` presses it.

import { isLinkedIn, type Mode } from "../policy.ts";
import { visibleFacts } from "../profile.ts";
import { factLines } from "../score.ts";
import type { Job, Pack, Person } from "../types.ts";

export type Outcome = "submitted" | "waiting" | "blocked" | "failed";

export function candidateSheet(p: Person, job: Job, pack: Pack): string {
  const languages = visibleFacts(p).filter((f) => f.kind === "language").map((f) => f.text);
  return `Full name: ${p.name}
Email: ${p.email}
Phone: ${p.phone || "not given — leave blank"}
City: ${p.location || "not given"}
LinkedIn: ${p.linkedin || "not given — leave blank"}
Work authorisation: ${p.needsSponsor ? `requires visa sponsorship to work in ${p.country}. Answer honestly: yes, sponsorship is required.` : `authorised to work in ${p.country}, no sponsorship needed`}
Salary expectation: ${p.salaryFloor ? `around €${p.salaryFloor} gross per month, negotiable` : "as advertised / negotiable"}
Earliest start: in consultation, typically within one month
Languages: ${languages.join(", ") || p.languages.join(", ") || "English"}
Applying for: ${job.title} at ${job.company}
Cover letter (paste where a letter or motivation is asked):
"""
${pack.letter}
"""
Facts for any free-text question (use only these, never invent):
${factLines(p)}`;
}

/**
 * Where the browser fetches the PDFs from: this server, as Chrome sees it. Set
 * PUBLIC_URL when Chrome runs on another machine than the server.
 */
export const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 7420}`;

export function buildApplyPrompt(job: Job, p: Person, pack: Pack, mode: Exclude<Mode, "prepare">, resume = false): string {
  const cv = `${PUBLIC_URL}/job/${job.id}/CV.pdf`;
  const letter = `${PUBLIC_URL}/job/${job.id}/Letter.pdf`;
  const stem = p.name.replace(/[^\w.-]+/g, "_");
  const ending =
    mode === "auto"
      ? `Then press the final submit button and wait for the confirmation.
Reply with ONLY: {"outcome":"submitted","note":"<the confirmation text or what the page shows after submitting>"}`
      : `Do NOT press the final submit button. Leave the form filled and open in the tab.
Reply with ONLY: {"outcome":"waiting","note":"<what is filled in, and what could not be filled>"}`;
  return `You are submitting a job application on the candidate's behalf, using the browser.
${resume ? "The form in the open tab is already filled from a previous run. Check it once, attach files if a file field is still empty, then continue below.\n" : ""}
THE JOB: ${job.title} at ${job.company}
Apply page: ${isLinkedIn(job.url)
    ? `not known yet. The ad was found on LinkedIn (${job.url}). Search the web for this exact posting on
${job.company}'s own careers site or its applicant system (Greenhouse, Lever, Workday, Recruitee, Personio,
SmartRecruiters…) and apply there. Do not apply on LinkedIn and do not log in to LinkedIn. If the only way
to apply is LinkedIn Easy Apply, or the posting is gone, reply {"outcome":"blocked","note":"<why>"}.`
    : job.url}

CANDIDATE SHEET — the only source for every field. Never invent an answer; if a required
question is not covered by the sheet or the facts, leave it and report it in the note.
${candidateSheet(p, job, pack)}

FILES
CV: ${cv}  (name it ${stem}-CV.pdf)
Cover letter: ${letter}  (name it ${stem}-Letter.pdf)
The native file picker cannot be driven from here. Attach a file by running this in the page
with the JavaScript tool, with the file input's selector and the right URL and name:
  const input = document.querySelector('<file input selector>');
  const blob = await (await fetch('<url>', { signal: AbortSignal.timeout(60000) })).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], '<name>', { type: 'application/pdf' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
On an employer's site Chrome may first ask the person to allow local-network access; the
fetch waits for that (up to a minute). Try it once more if it times out.
Then check the page shows the file as attached. If the fetch fails or the site ignores it,
fill in everything else, use "enter manually" options where the site offers them, and say
"needs-file" in your note.

RULES
- Open the apply page. If it redirects to LinkedIn Easy Apply, an external login wall, or a
  CAPTCHA you cannot pass, stop and reply {"outcome":"blocked","note":"<why>"}.
- Fill every field you can from the sheet. Tick required consent boxes about processing the
  application; do not tick marketing or newsletter boxes. Answer EEO/diversity questions with
  "prefer not to say" where offered.
- Never create an account with a password. Never pay for anything.
- If something goes wrong, reply {"outcome":"failed","note":"<what happened>"}.

${ending}`;
}

export function parseApplyResult(result: string): { outcome: Outcome; note: string } {
  const start = result.indexOf("{");
  const end = result.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(result.slice(start, end + 1)) as Record<string, unknown>;
      const outcome = String(o.outcome ?? "");
      if (["submitted", "waiting", "blocked", "failed"].includes(outcome)) {
        return { outcome: outcome as Outcome, note: String(o.note ?? "").trim() };
      }
    } catch {
      // fall through
    }
  }
  return { outcome: "failed", note: `the agent did not report an outcome: ${result.slice(0, 300)}` };
}
