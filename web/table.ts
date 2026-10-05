import { isNetherlands } from "../lib/profile.ts";
import { esc } from "./layout.ts";
import type { Job, Person } from "../lib/types.ts";

const DAY = 864e5;

/** Fit first; among equals the emptier field; then freshest. Unknown applicants sort after known. */
export function order(jobs: Job[], today = new Date()): Job[] {
  const app = (j: Job) => (j.applicants >= 0 ? j.applicants : Number.POSITIVE_INFINITY);
  return [...jobs].sort(
    (a, b) =>
      (b.score?.score ?? 0) - (a.score?.score ?? 0) ||
      app(a) - app(b) ||
      (b.postedAt || "").localeCompare(a.postedAt || "") ||
      b.addedAt.localeCompare(a.addedAt),
  );
}

export function competition(j: Job, today = new Date()): { label: string; cls: string }[] {
  const out: { label: string; cls: string }[] = [];
  if (j.postedAt && today.getTime() - Date.parse(j.postedAt) < 1.5 * DAY) out.push({ label: "just posted", cls: "ok" });
  if (j.applicants >= 0 && j.applicants < 25) out.push({ label: j.applicants === 0 ? "first applicants" : `${j.applicants} applicants`, cls: "ok" });
  else if (j.applicants >= 200) out.push({ label: `${j.applicants} applicants`, cls: "warn" });
  else if (j.applicants >= 0) out.push({ label: `${j.applicants} applicants`, cls: "" });
  return out;
}

export function scoreCell(j: Job): string {
  const s = j.score?.score;
  if (s === undefined) return `<span class="score" title="not scored yet">–</span>`;
  const fit = j.score!.fit;
  const title = fit ? `${j.score!.reasoning} (skills ${fit.skills}, seniority ${fit.seniority}, language ${fit.language})` : j.score!.reasoning;
  return `<span class="score ${s >= 7 ? "hi" : s >= 5 ? "mid" : ""}" title="${esc(title)}">${s}</span>`;
}

export function sponsorTag(j: Job, p: Person): string {
  if (!isNetherlands(p.country) || (!p.needsSponsor && !j.sponsor)) return "";
  if (!j.sponsor) return `<span class="tag bad">not a sponsor</span>`;
  const title = `${j.sponsor.name} · KvK ${j.sponsor.kvk}`;
  return j.sponsor.match === "exact"
    ? `<span class="tag ok" title="${esc(title)}">sponsor</span>`
    : `<span class="tag warn" title="${esc(title)} — partial name match, check it">sponsor?</span>`;
}

export function applyRoute(j: Job): string {
  if (/linkedin\.com/i.test(j.url)) return "you submit";
  if (!j.url) return "manual";
  return "agent";
}

const SOURCE = { linkedin: "LinkedIn", board: "career site", paste: "added by hand", agent: "agent search" };

export function jobsTable(jobs: Job[], p: Person): string {
  if (!jobs.length) return `<div class="empty">No jobs yet. Search, or paste a link above.</div>`;
  const rows = order(jobs)
    .map((j) => {
      const comp = competition(j);
      const posted = j.postedAt ? j.postedAt.slice(5).replace("-", "/") : "";
      return `<tr data-score="${j.score?.score ?? ""}" data-applicants="${j.applicants >= 0 ? j.applicants : ""}" data-posted="${esc(j.postedAt)}" data-status="${esc(j.status)}" data-source="${esc(j.source)}" data-sponsor="${j.sponsor ? 1 : 0}" data-title="${esc(j.title)}" data-company="${esc(j.company)}" data-location="${esc(j.location)}">
<td>${scoreCell(j)}</td>
<td><a href="/job/${j.id}"><b>${esc(j.title || "(untitled)")}</b></a><div class="small mute">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ""}</div>${j.error ? `<div class="small" style="color:var(--bad)">${esc(j.error)}</div>` : ""}${j.status === "filtered" && j.triage ? `<div class="small mute">filtered: ${esc(j.triage)}</div>` : ""}</td>
<td>${comp.map((c) => `<span class="tag ${c.cls}">${esc(c.label)}</span>`).join(" ") || `<span class="mute small">–</span>`}</td>
<td>${sponsorTag(j, p)}</td>
<td class="small mute">${posted}</td>
<td><span class="tag">${esc(j.status.replace("_", " "))}</span></td>
<td class="small mute">${esc(SOURCE[j.source])}</td>
</tr>`;
    })
    .join("");
  return `<div class="filters">
<input name="q" placeholder="Search title, company, city">
<select name="status"><option value="">Any status</option>${["new", "scored", "drafted", "waiting", "applied", "followed_up", "interview", "offer", "rejected", "filtered"].map((s) => `<option value="${s}">${s.replace("_", " ")}</option>`).join("")}</select>
<select name="source"><option value="">Any source</option><option value="linkedin">LinkedIn</option><option value="board">Career sites</option><option value="agent">Agent search</option><option value="paste">Added by hand</option></select>
<select name="min"><option value="">Any fit</option><option value="7">Fit 7+</option><option value="5">Fit 5+</option></select>
${p.needsSponsor || !isNetherlands(p.country) ? "" : `<label style="margin:0;font-weight:500"><input type="checkbox" name="sponsor"> sponsors only</label>`}
<span class="small mute" id="count"></span></div>
<div class="wrap"><table data-jobs><thead><tr><th data-sort="score">Fit</th><th data-sort="title">Job</th><th data-sort="applicants">Competition</th><th>Sponsor</th><th data-sort="posted">Posted</th><th data-sort="status">Status</th><th data-sort="source">Source</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
