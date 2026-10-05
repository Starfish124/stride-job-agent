// The widget: the agent's transcript on the left, live over SSE; the job,
// the pack and the contacts on the right; Stop / Submit now / Skip.

import type { AgentRun } from "../lib/agent.ts";
import { modeFor } from "../lib/policy.ts";
import type { Job, Person } from "../lib/types.ts";
import { esc, page } from "./layout.ts";
import { scoreCell } from "./table.ts";

const TASK = { search: "Agent search", apply: "Applying", contact: "Finding the contact" };

export function runPage(run: AgentRun, p: Person, job?: Job): string {
  const live = run.status === "running";
  const status = { running: "accent", done: "ok", failed: "bad", stopped: "warn" }[run.status];
  const back = job ? `/job/${job.id}` : `/p/${p.id}/find`;
  const transcript = run.events
    .map((e) => `<div class="ev ${e.kind}"><span class="t">${esc(e.at.slice(11, 19))}</span>${esc(e.text)}</div>`)
    .join("");
  const actions = [`<form class="inline" method="post" action="/run/${run.id}/stop"><button class="quiet" ${live ? "" : "disabled"}>Stop</button></form>`];
  if (run.task === "apply" && job) {
    if (job.status === "waiting" && !live) actions.push(`<form class="inline" method="post" action="/job/${job.id}/apply?resume=1"><button>Submit now</button></form>`);
    if (!["applied", "followed_up", "interview", "offer"].includes(job.status)) {
      actions.push(`<form class="inline" method="post" action="/job/${job.id}/status"><button class="ghost" name="status" value="applied">Mark as applied by hand</button></form>`);
      actions.push(`<form class="inline" method="post" action="/job/${job.id}/status"><button class="ghost" name="status" value="rejected">Skip this job</button></form>`);
    }
  }
  const side = job
    ? `<div class="card"><h3>The job</h3><div class="row">${scoreCell(job)}<div><b><a href="/job/${job.id}">${esc(job.title)}</a></b><div class="small mute">${esc(job.company)}${job.location ? ` · ${esc(job.location)}` : ""}</div></div></div>
<p class="small mute" style="margin-top:8px">Site policy: <b>${esc(modeFor(job.url))}</b> · status: <span class="tag">${esc(job.status.replace("_", " "))}</span></p>
${job.note ? `<div class="notice ${job.status === "waiting" ? "warn" : "info"}" style="margin-top:8px">${esc(job.note)}</div>` : ""}
${job.url ? `<p><a href="${esc(job.url)}" target="_blank" rel="noreferrer">Open the apply page yourself</a></p>` : ""}</div>
${job.pack ? `<div class="card"><h3>The pack</h3><p class="row"><a class="btn ghost" href="/job/${job.id}/CV.pdf" target="_blank">CV.pdf</a><a class="btn ghost" href="/job/${job.id}/Letter.pdf" target="_blank">Letter.pdf</a></p><label>Letter</label><textarea readonly rows="8">${esc(job.pack.letter)}</textarea></div>` : ""}
${job.contacts?.length ? `<div class="card"><h3>Contacts</h3>${job.contacts.map((c) => `<p><a href="${esc(c.url)}" target="_blank" rel="noreferrer"><b>${esc(c.name)}</b></a><br><span class="small mute">${esc(c.title)}</span></p>`).join("")}</div>` : ""}`
    : `<div class="card"><h3>Person</h3><p><b>${esc(p.name)}</b><br><span class="small mute">${esc(p.targetRoles.join(" · "))}</span></p><p class="small mute">New jobs land in <a href="/p/${p.id}/find">Find jobs</a> when the run finishes, scored.</p></div>`;
  return page(
    `${TASK[run.task]} · ${p.name}`,
    `<p class="small mute"><a href="${back}">Back</a></p>
<div class="lead"><div><h1>${TASK[run.task]}</h1><div class="row"><span class="tag ${status}">${esc(run.status)}</span><span class="small mute">started ${esc(run.startedAt.slice(11, 16))}${run.endedAt ? `, ended ${esc(run.endedAt.slice(11, 16))}` : ""} · run ${esc(run.id)}</span></div></div><div class="row">${actions.join("")}</div></div>
<style>.log{height:60vh;overflow:auto;background:var(--soft);border-radius:12px;padding:12px 14px;font-size:13.5px}.ev{padding:4px 0;border-bottom:1px solid var(--line);white-space:pre-wrap}.ev.tool{color:var(--mute);font-family:var(--mono);font-size:12px}.ev.status{color:var(--accent);font-weight:600}.ev.error{color:var(--bad)}.ev.result{color:var(--ok)}.ev .t{color:var(--mute);font-size:11px;margin-right:8px;font-family:var(--mono)}</style>
<div class="two" style="grid-template-columns:3fr 2fr"><div><div class="log" id="log">${transcript}</div>
<p class="hint">The agent works in your Chrome, the one with the Claude extension. If Chrome asks whether a job site may <b>access devices on your local network</b>, click Allow. That lets it attach the CV. It asks once per site.</p></div><div>${side}</div></div>
<script>
(function(){var log=document.getElementById('log');log.scrollTop=log.scrollHeight;${live ? `var n=${run.events.length};var es=new EventSource('/run/${run.id}/events?from='+n);
es.onmessage=function(m){var e=JSON.parse(m.data);var d=document.createElement('div');d.className='ev '+e.kind;var t=document.createElement('span');t.className='t';t.textContent=e.at.slice(11,19);d.appendChild(t);d.appendChild(document.createTextNode(e.text));log.appendChild(d);log.scrollTop=log.scrollHeight;if(e.kind==='status'&&/^(done|failed|stopped|timed out|claude exited|Not logged|\\d+ (new jobs|contacts))/.test(e.text)){es.close();setTimeout(function(){location.reload()},800)}};
es.onerror=function(){es.close();setTimeout(function(){location.reload()},3000)};` : ""}})();
</script>`,
    { nav: [{ href: `/p/${p.id}/find`, label: p.name }, { href: "/settings", label: "Settings" }, { href: "/", label: "People" }] },
  );
}
