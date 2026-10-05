import { cvChecks } from "../lib/cvcheck.ts";
import { claudeCliPath } from "../lib/llm.ts";
import { agentMode, canApply, isLinkedIn } from "../lib/policy.ts";
import { NOTE_LIMIT } from "../lib/tailor.ts";
import type { Job, Pack, Person } from "../lib/types.ts";
import { esc, page } from "./layout.ts";
import { competition, scoreCell, sponsorTag } from "./table.ts";
import { contactList } from "./workspace.ts";

/** The soft CV checklist: green ticks, amber flags to read before sending. */
function checklist(pack: Pack, p: Person, pages?: number): string {
  const rows = cvChecks(pack, p, pages)
    .map((c) => `<tr><td>${c.ok ? `<span class="tag ok">ok</span>` : `<span class="tag warn">check</span>`}</td><td>${esc(c.label)}${c.detail ? ` <span class="small mute">${esc(c.detail)}</span>` : ""}</td></tr>`)
    .join("");
  return `<div class="card"><h3>CV checklist</h3><p class="small mute">Hard rules (invented numbers, skills, titles, suppressed terms) are already blocked. These are style flags to read before sending.</p><table>${rows}</table></div>`;
}

function applyBlock(j: Job, all: Job[]): string {
  const mode = agentMode(j.url);
  if (mode === "prepare" || !claudeCliPath()) {
    return `<p class="small mute">${mode === "prepare" ? "This site is set to prepare" : "The apply agent needs Claude Code with Claude in Chrome"}: submit by hand.</p>${j.url ? `<a class="btn" href="${esc(j.url)}" target="_blank" rel="noreferrer">Open the apply page</a>` : ""}`;
  }
  if (j.status === "waiting") {
    return `<div class="notice warn">The form is filled and waiting${j.note ? `: ${esc(j.note)}` : ""}.</div><div class="row"><form class="inline" method="post" action="/job/${j.id}/apply?resume=1"><button>Submit now</button></form>${j.runId ? `<a class="btn ghost" href="/run/${j.runId}">Transcript</a>` : ""}</div>`;
  }
  const why = canApply(j, all);
  if (why) return `<p class="small mute">${esc(why)}</p>${j.runId ? `<a class="btn ghost" href="/run/${j.runId}">Last run</a>` : ""}`;
  if (isLinkedIn(j.url)) {
    return `<div class="row"><form class="inline" method="post" action="/job/${j.id}/apply"><button>Fill on the employer's site</button></form><a class="btn ghost" href="${esc(j.url)}" target="_blank" rel="noreferrer">Easy Apply on LinkedIn</a></div><p class="small mute">Found on LinkedIn. The agent finds the same job on the company's own site, fills the form and waits for you. For Easy Apply, apply yourself on LinkedIn.</p>`;
  }
  return `<div class="row"><form class="inline" method="post" action="/job/${j.id}/apply"><button>${mode === "auto" ? "Apply — the agent submits" : "Fill the form with the agent"}</button></form><span class="small mute">site policy: ${mode} · <a href="/settings">change</a></span></div>`;
}

export function jobPage(j: Job, p: Person, busy: string | undefined, err: string | undefined, all: Job[] = [], pages?: number): string {
  const pack = j.pack;
  const status = (
    [["applied", "I applied"], ["followed_up", "I followed up"], ["interview", "Interview"], ["offer", "Offer"], ["rejected", "Rejected"]] as const
  )
    .map(([s, l]) => `<form class="inline" method="post" action="/job/${j.id}/status"><button class="${s === j.status ? "" : "quiet"}" name="status" value="${s}">${l}</button></form>`)
    .join(" ");
  const comp = competition(j);
  return page(
    j.title || "Job",
    `<p class="small mute"><a href="/p/${esc(p.id)}/find">Back to ${esc(p.name)}'s jobs</a></p>
<div class="lead"><div><h1>${esc(j.title || "(untitled)")}</h1><div class="row"><span>${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ""}${j.salary ? ` · ${esc(j.salary)}` : ""}</span>${sponsorTag(j, p)}${comp.map((c) => `<span class="tag ${c.cls}">${esc(c.label)}</span>`).join("")}<span class="tag">${esc(j.status.replace("_", " "))}</span>${j.url ? `<a href="${esc(j.url)}" target="_blank" rel="noreferrer">View the ad</a>` : ""}</div>
${j.sponsor ? `<p class="small mute">IND register: ${esc(j.sponsor.name)} · KvK ${esc(j.sponsor.kvk)}${j.sponsor.match === "prefix" ? " — partial name match, check it is the same company" : ""}</p>` : ""}</div>
<div class="row">${scoreCell(j)}<form class="inline" method="post" action="/job/${j.id}/score"><button class="ghost">${j.score ? "Re-score" : "Score"}</button></form><form class="inline" method="post" action="/job/${j.id}/tailor"><button>${pack ? "Re-draft CV + letter" : "Draft CV + letter"}</button></form></div></div>
${busy ? `<div class="notice info">${esc(busy)}… This page refreshes itself.</div>` : ""}
${err || j.error ? `<div class="notice bad">${esc(err ?? j.error)}</div>` : ""}
${j.status === "filtered" && j.triage ? `<div class="notice warn">Filtered before scoring: ${esc(j.triage)}. Score it anyway with the button above.</div>` : ""}
${j.score ? `<div class="card"><h3>Fit ${j.score.score}/10</h3><p>${esc(j.score.reasoning)}</p>${j.score.fit ? `<p class="small mute">Skills ${j.score.fit.skills}/10 · Seniority ${j.score.fit.seniority}/10 · Language ${j.score.fit.language}/10</p>` : ""}</div>` : ""}
${
  pack
    ? `<div class="two"><div class="card"><h3>The pack</h3><p class="row"><a class="btn" href="/job/${j.id}/CV.pdf" target="_blank">CV.pdf</a><a class="btn ghost" href="/job/${j.id}/Letter.pdf" target="_blank">Letter.pdf</a></p>
<p class="small mute">Title under the name: <b>${esc(pack.title || p.headline)}</b>. Read both PDFs before sending.</p>
${checklist(pack, p, pages)}
<label>Cover letter, to paste into a form</label><textarea readonly rows="12">${esc(pack.letter)}</textarea>
<h3 style="margin-top:14px">Apply</h3>${applyBlock(j, all)}</div>
<div class="card"><h3>Follow up on LinkedIn</h3><label>The person to message</label>${contactList(j)}
<label>Connection note · ${pack.connectNote.length}/${NOTE_LIMIT}</label><textarea readonly rows="3">${esc(pack.connectNote)}</textarea>
<label>After they accept</label><textarea readonly rows="5">${esc(pack.followUp)}</textarea>
<p class="hint">Free LinkedIn accounts get a few personalised notes a month — spend them on the 7+ jobs.</p></div></div>`
    : ""
}
<div class="card"><h3>Where it stands</h3><div class="row">${status}</div>${j.appliedAt ? `<p class="small mute" style="margin-top:8px">Applied ${esc(j.appliedAt)}. ${j.followUps?.length ? `Next nudge ${esc(j.followUps[0])}.` : "No nudges left."}</p>` : ""}</div>
<details><summary>The ad as stored</summary><div class="card"><pre>${esc(j.description)}</pre></div></details>`,
    { refresh: Boolean(busy), nav: [{ href: `/p/${p.id}/find`, label: p.name }, { href: "/", label: "People" }] },
  );
}
