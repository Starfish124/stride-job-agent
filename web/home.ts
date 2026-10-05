import type { AgentRun } from "../lib/agent.ts";
import { dueFollowUps } from "../lib/followup.ts";
import { llmProblem } from "../lib/llm.ts";
import type { Job, Person } from "../lib/types.ts";
import { esc, initials, page } from "./layout.ts";

export type Step = "profile" | "find" | "apply" | "followup" | "track";

/** The one thing to do next for this person, and where to do it. */
export function nextStep(p: Person, jobs: Job[]): { label: string; step: Step } {
  if (!p.facts.length) return { label: "Upload the CV", step: "profile" };
  if (!p.reviewed) return { label: "Review the facts from the CV", step: "profile" };
  if (!p.targetRoles.length) return { label: "Set the target roles", step: "profile" };
  if (!p.country) return { label: "Set the country", step: "profile" };
  const due = dueFollowUps(jobs).length;
  if (due) return { label: `${due} follow-up${due > 1 ? "s" : ""} due`, step: "followup" };
  const ready = jobs.filter((j) => j.status === "drafted").length;
  if (ready) return { label: `${ready} ready to apply`, step: "apply" };
  const worth = jobs.filter((j) => j.status === "scored" && (j.score?.score ?? 0) >= 7).length;
  if (worth) return { label: `${worth} worth applying to — draft the CVs`, step: "apply" };
  if (!jobs.length) return { label: "Find jobs", step: "find" };
  return { label: "Find more jobs", step: "find" };
}

export function counters(jobs: Job[]) {
  return {
    found: jobs.filter((j) => j.status !== "filtered").length,
    worth: jobs.filter((j) => (j.score?.score ?? 0) >= 7).length,
    applied: jobs.filter((j) => ["applied", "followed_up", "interview", "offer"].includes(j.status)).length,
    due: dueFollowUps(jobs).length,
  };
}

export function homePage(people: Person[], jobs: Job[], busy: Map<string, string>, runs: AgentRun[] = []): string {
  const cards = people
    .map((p) => {
      const mine = jobs.filter((j) => j.personId === p.id);
      const c = counters(mine);
      const next = nextStep(p, mine);
      const working = [...busy.entries()].filter(([k]) => k === p.id || k === `person:${p.id}`).map(([, v]) => v);
      return `<div class="card person">
<div class="who"><span class="avatar">${esc(initials(p.name || p.id))}</span><div><h2 style="margin:0">${esc(p.name || p.id)}</h2><div class="small mute headline" title="${esc(p.headline)}">${esc(p.headline || "No CV yet")}${p.needsSponsor ? " · needs a sponsor" : ""}</div></div></div>
<div class="stats"><div class="stat"><b>${c.found}</b><span>jobs found</span></div><div class="stat"><b>${c.worth}</b><span>worth applying</span></div><div class="stat"><b>${c.applied}</b><span>applied</span></div><div class="stat"><b>${c.due}</b><span>follow-ups due</span></div></div>
${working.length ? `<div class="notice info" style="margin:0">${esc(working[0])}…</div>` : `<a class="next" href="/p/${esc(p.id)}/${next.step}">Next: ${esc(next.label)}</a>`}
<div class="row"><a class="btn" href="/p/${esc(p.id)}/${next.step}">Open workspace</a></div>
</div>`;
    })
    .join("");
  const problem = llmProblem();
  const add = `<div class="card person" style="justify-content:center;border-style:dashed;background:transparent">
<form method="post" action="/p/new"><h2>Add a person</h2><p class="small mute">Then upload their CV. Everything stays on this machine.</p>
<label>Name</label><input name="name" required placeholder="Anna de Vries">
<label>Short id <span class="mute" style="font-weight:400">(for links: a, b, anna)</span></label><input name="id" required pattern="[a-z0-9-]{1,20}" placeholder="a">
<p style="margin-top:14px"><button>Create</button></p></form></div>`;
  return page(
    "People",
    `<div class="lead"><div><h1>People</h1><p class="mute">Open someone's workspace to find jobs, apply and follow up.</p></div></div>
${problem ? `<div class="notice warn">${esc(problem)} <a href="/settings">Settings</a></div>` : ""}
${runs.length ? `<div class="notice info">Running now: ${runs.map((r) => `<a href="/run/${r.id}">${esc(r.task)} for ${esc(people.find((x) => x.id === r.personId)?.name ?? r.personId)}</a>`).join(" · ")}</div>` : ""}
<div class="grid">${cards}${add}</div>`,
    { refresh: busy.size > 0, nav: [{ href: "/settings", label: "Settings" }] },
  );
}
