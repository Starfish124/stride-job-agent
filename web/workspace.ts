import type { AgentRun } from "../lib/agent.ts";
import { listRuns } from "../lib/agent.ts";
import { dueFollowUps } from "../lib/followup.ts";
import { claudeCliPath } from "../lib/llm.ts";
import { agentMode, canApply, isLinkedIn, modeFor } from "../lib/policy.ts";
import { isNetherlands, validatePerson } from "../lib/profile.ts";
import { peopleSearches } from "../lib/tailor.ts";
import type { Job, Person } from "../lib/types.ts";
import { counters, nextStep, type Step } from "./home.ts";
import { esc, initials, page } from "./layout.ts";
import { jobsTable, scoreCell } from "./table.ts";

const STEPS: { id: Step; n: number; label: string; blurb: string }[] = [
  { id: "profile", n: 1, label: "Profile", blurb: "The CV becomes a list of facts. Every CV and letter is written only from these, so check them once." },
  { id: "find", n: 2, label: "Find jobs", blurb: "Jobs from LinkedIn, career sites and links you add, each scored for fit." },
  { id: "apply", n: 3, label: "Apply", blurb: "Draft a CV and letter for a job, read them, then send." },
  { id: "followup", n: 4, label: "Follow up", blurb: "Five working days after applying, this shows who to message and what to say." },
  { id: "track", n: 5, label: "Track", blurb: "Every job by stage." },
];

function done(step: Step, p: Person, jobs: Job[]): boolean {
  switch (step) {
    case "profile": return validatePerson(p).length === 0;
    case "find": return jobs.some((j) => j.score);
    case "apply": return jobs.some((j) => ["applied", "followed_up", "interview", "offer"].includes(j.status));
    case "followup": return jobs.some((j) => j.status === "followed_up") && dueFollowUps(jobs).length === 0;
    case "track": return false;
  }
}

interface Ctx {
  p: Person;
  jobs: Job[];
  busy: Map<string, string>;
  errors: Map<string, string>;
  flash?: string;
  runs?: AgentRun[];
}

export function workspacePage(step: Step, c: Ctx): string {
  const { p, jobs } = c;
  const cur = STEPS.find((s) => s.id === step)!;
  const next = nextStep(p, jobs);
  const strip = STEPS
    .map((s) => `<a href="/p/${esc(p.id)}/${s.id}" class="${s.id === step ? "on" : ""} ${done(s.id, p, jobs) ? "done" : ""}"><span class="n">0${s.n}</span>${s.label}</a>`)
    .join("");
  const busyKeys = [p.id, `person:${p.id}`];
  const working = busyKeys.map((k) => c.busy.get(k)).find(Boolean);
  const err = busyKeys.map((k) => c.errors.get(k)).find(Boolean);
  const body = {
    profile: profileStep,
    find: findStep,
    apply: applyStep,
    followup: followupStep,
    track: trackStep,
  }[step](c);
  return page(
    `${p.name || p.id} · ${cur.label}`,
    `<div class="lead"><div class="who" style="display:flex;gap:12px;align-items:center"><span class="avatar">${esc(initials(p.name || p.id))}</span><div><h1>${esc(p.name || p.id)}</h1><div class="mute">${esc(p.headline || "No CV yet")}</div></div></div>
<a class="next" href="/p/${esc(p.id)}/${next.step}">Next: ${esc(next.label)}</a></div>
<div class="steps">${strip}</div>
${working ? `<div class="notice info">${esc(working)}… This page refreshes itself.</div>` : ""}
${c.runs?.length ? `<div class="notice info">Agent running: ${c.runs.map((r) => `<a href="/run/${r.id}">watch the ${esc(r.task)}</a>`).join(" · ")}</div>` : ""}
${err ? `<div class="notice bad">${esc(err)}</div>` : ""}
${c.flash ? `<div class="notice ok">${esc(c.flash)}</div>` : ""}
<h2>${cur.n}. ${cur.label}</h2><p class="mute" style="max-width:720px">${cur.blurb}</p>
${body}`,
    { refresh: Boolean(working), nav: [{ href: "/settings", label: "Settings" }, { href: "/", label: "People" }] },
  );
}

// ---------- 1. profile ----------

function profileStep({ p }: Ctx): string {
  const problems = validatePerson(p);
  const facts = p.facts
    .map((f) => {
      const head = [f.title, f.org, f.dates].filter(Boolean).join(", ");
      return `<tr><td><input type="checkbox" name="tick"></td><td class="k">${esc(f.kind)}${f.under ? ` <span class="mute">under ${esc(f.under)}</span>` : ""}</td><td>${head ? `<b>${esc(head)}</b>${f.text ? "<br>" : ""}` : ""}${esc(f.text)}</td>
<td><form class="inline" method="post" action="/p/${esc(p.id)}/fact/${esc(f.id)}/remove"><button class="quiet small" title="Not true, or must not appear">remove</button></form></td></tr>`;
    })
    .join("");
  return `<div class="two">
<div class="card"><h3>Upload the CV</h3>
<form method="post" action="/p/${esc(p.id)}/intake" enctype="multipart/form-data">
<label>CV file <span class="mute" style="font-weight:400">(.pdf, .docx or .txt)</span></label><input type="file" name="file" accept=".pdf,.docx,.txt,.md">
<label>…or paste the CV text</label><textarea name="cv" rows="7"></textarea>
<label>What they want next, in their words</label><input name="goal" value="${esc(p.goal ?? "")}" placeholder="Out of hospitality, into customer success at a tech company">
<p style="margin-top:14px"><button>Read the CV into facts</button></p>
<p class="hint">Takes about 30 seconds and replaces the facts below. To keep something out for good, add it under "Never mention".</p></form></div>
<div class="card"><h3>Search filters</h3>
<form method="post" action="/p/${esc(p.id)}/filters">
<label>Target roles <span class="mute" style="font-weight:400">(one per line — these are the LinkedIn searches)</span></label><textarea name="targetRoles" rows="3">${esc(p.targetRoles.join("\n"))}</textarea>
<label>Country they are job hunting in</label><input name="country" required value="${esc(p.country)}" placeholder="Germany">
<label>Cities <span class="mute" style="font-weight:400">(one per line; empty = the whole country)</span></label><textarea name="locations" rows="2">${esc(p.locations.join("\n"))}</textarea>
<label>Languages they speak</label><input name="languages" value="${esc(p.languages.join(", "))}" placeholder="English (native), Dutch (B1)">
<div class="two"><div><label>Salary floor, gross per month</label><input name="salaryFloor" type="number" value="${p.salaryFloor || ""}" placeholder="0 = none"></div>
<div><label>Visa</label><label style="font-weight:400;margin-top:10px"><input type="checkbox" name="needsSponsor" ${p.needsSponsor ? "checked" : ""}> needs visa sponsorship${isNetherlands(p.country) ? " (only IND recognised sponsors)" : ""}</label></div></div>
<p class="hint">${isNetherlands(p.country) ? "IND highly-skilled-migrant thresholds, 2nd half 2026: €5,942 aged 30+, €4,357 under 30, €3,122 recent graduate. " : ""}Only a salary the ad states is ever compared.</p>
<label>Never mention <span class="mute" style="font-weight:400">(one per line — an old employer, a gap; removed from every CV and letter)</span></label><textarea name="suppress" rows="2">${esc(p.suppress.join("\n"))}</textarea>
<label>Contact details on the CV</label><input name="email" value="${esc(p.email)}" placeholder="email"><input name="phone" value="${esc(p.phone)}" placeholder="phone" style="margin-top:6px"><input name="location" value="${esc(p.location)}" placeholder="city" style="margin-top:6px"><input name="linkedin" value="${esc(p.linkedin)}" placeholder="LinkedIn profile URL" style="margin-top:6px">
<p style="margin-top:14px"><button>Save filters</button></p></form></div></div>
<div class="card"><div class="lead"><div><h3>The facts <span class="mute" style="font-weight:400;text-transform:none;letter-spacing:0">· ${p.facts.length}${p.reviewed ? " · reviewed" : ""}</span></h3>
<p class="small mute">Check each fact against the real CV and tick it. Remove anything wrong. Nothing is scored or written until the profile is marked reviewed.</p></div>
${p.facts.length ? `<form method="post" action="/p/${esc(p.id)}/reviewed" class="row"><span class="small mute" id="tickcount"></span><button type="button" class="quiet" id="tickall">Tick all</button><button id="reviewed" ${p.reviewed ? "" : "disabled"}>${p.reviewed ? "Reviewed (save again)" : "Mark reviewed"}</button></form>` : ""}</div>
${problems.length && p.facts.length ? `<div class="notice warn">${esc(problems.join(" · "))}</div>` : ""}
${p.facts.length ? `<div class="wrap"><table class="facts">${facts}</table></div>` : `<div class="empty">No facts yet. Upload the CV.</div>`}
<details style="margin-top:12px"><summary>Edit the record as JSON (headline, fact wording)</summary><form method="post" action="/p/${esc(p.id)}/save"><textarea name="json" rows="24" class="mono" spellcheck="false">${esc(JSON.stringify(p, null, 2))}</textarea><p><button class="ghost">Save JSON</button></p></form></details>
</div>
${questionsCard(p)}`;
}

/**
 * The 10-minute win: 5 questions to ask them out loud whose answers are the real
 * numbers the CV writer may never invent. Typed answers become achievement facts.
 */
function questionsCard(p: Person): string {
  const hasRoles = p.facts.some((f) => f.kind === "role");
  if (!hasRoles) return "";
  const qs = p.questions ?? [];
  if (!qs.length) {
    return `<div class="card"><h3>Questions to ask them</h3>
<p class="small mute">Their CV has few numbers, and the CV writer never invents one. Generate 5 questions to ask ${esc(p.name.split(" ")[0] || "them")} out loud — their answers become facts every CV can use.</p>
<form method="post" action="/p/${esc(p.id)}/questions"><button>Suggest 5 questions</button></form></div>`;
  }
  const fields = qs
    .map(
      (q, i) => `<input type="hidden" name="u${i}" value="${esc(q.under)}">
<label>${esc(q.question)}</label><input name="a${i}" placeholder="their answer — a number, scope, or result">`,
    )
    .join("");
  return `<div class="card"><h3>Questions to ask them · ${qs.length}</h3>
<p class="small mute">Ask ${esc(p.name.split(" ")[0] || "them")} these out loud and type the answers. Each answer is added as a fact under the right role, then re-check the facts above.</p>
<form method="post" action="/p/${esc(p.id)}/answers">${fields}
<p style="margin-top:14px" class="row"><button>Add answers as facts</button><button class="quiet" formaction="/p/${esc(p.id)}/questions">Suggest again</button></p></form></div>`;
}

// ---------- 2. find ----------

function findStep({ p, jobs }: Ctx): string {
  const ready = validatePerson(p).length === 0;
  const c = counters(jobs);
  const unscored = jobs.filter((j) => j.status === "new").length;
  const search = `<div class="grid" style="margin-bottom:16px">
<div class="card"><h3>Search jobs</h3><p class="small mute">LinkedIn and career sites, every target role and city, past week${p.needsSponsor && isNetherlands(p.country) ? ", sponsors only" : ""}. The best matches get scored.</p>
<form method="post" action="/p/${esc(p.id)}/discover"><button ${ready ? "" : "disabled"}>Search now</button></form></div>
<div class="card"><h3>Add a link or an ad</h3><form method="post" action="/p/${esc(p.id)}/add"><input name="url" placeholder="https://… (LinkedIn links work)"><textarea name="text" rows="2" placeholder="…or paste the ad text" style="margin-top:6px;min-height:0"></textarea><p style="margin-top:8px"><button ${ready ? "" : "disabled"}>Add and score</button></p></form></div>
<div class="card"><h3>Agent search</h3><p class="small mute">Claude looks through Indeed, Glassdoor and Google Jobs in Chrome and brings back up to 15 jobs. You can watch it work.</p>
${claudeCliPath() ? `<form method="post" action="/p/${esc(p.id)}/agent-search"><button ${ready ? "" : "disabled"}>Run agent search</button></form>` : `<p class="small">Needs Claude Code with the Claude in Chrome extension.</p>`}${pastRuns(p.id, "search")}</div>
</div>`;
  return `${ready ? "" : `<div class="notice warn">Finish step 1 first: ${esc(validatePerson(p)[0])}.</div>`}
${search}
<div class="lead"><div class="row"><span class="tag accent">${c.found} found</span><span class="tag ok">${c.worth} worth applying</span>${unscored ? `<span class="tag">${unscored} not scored yet</span>` : ""}</div>
${unscored ? `<form method="post" action="/p/${esc(p.id)}/score"><button class="ghost" ${ready ? "" : "disabled"}>Score the unscored</button></form>` : ""}</div>
${jobsTable(jobs, p)}`;
}

function pastRuns(personId: string, task: "search" | "apply" | "contact"): string {
  const runs = listRuns().filter((r) => r.personId === personId && r.task === task).slice(0, 3);
  if (!runs.length) return "";
  return `<p class="small mute" style="margin-top:8px">${runs.map((r) => `<a href="/run/${r.id}">${esc(r.startedAt.slice(5, 16).replace("T", " "))} · ${esc(r.status)}</a>`).join(" · ")}</p>`;
}

// ---------- 3. apply ----------

/** The one button for this job, by the site's policy and the guards. */
function applyButton(j: Job, all: Job[]): string {
  const mode = agentMode(j.url);
  // No Claude Code, no browser agent: the person applies by hand.
  if (mode === "prepare" || !claudeCliPath()) {
    return `<a class="btn ghost" href="/job/${j.id}">Open pack</a>${j.url ? ` <a class="btn" href="${esc(j.url)}" target="_blank" rel="noreferrer">Apply page</a>` : ""}`;
  }
  if (j.status === "waiting") {
    return `<form class="inline" method="post" action="/job/${j.id}/apply?resume=1"><button>Submit now</button></form> ${j.runId ? `<a class="btn ghost" href="/run/${j.runId}">Transcript</a>` : ""}`;
  }
  const why = canApply(j, all);
  return why
    ? `<span class="small mute">${esc(why)}</span>`
    : `<form class="inline" method="post" action="/job/${j.id}/apply"><button>${mode === "auto" ? "Apply — agent submits" : isLinkedIn(j.url) ? "Fill on the employer's site" : "Fill with the agent"}</button></form>`;
}

function applyStep({ p, jobs }: Ctx): string {
  const scored = jobs.filter((j) => j.status === "scored").sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
  const drafted = jobs.filter((j) => j.status === "drafted" || j.status === "waiting");
  const route = (j: Job) => (isLinkedIn(j.url) ? "LinkedIn ad — agent finds the employer's form" : !j.url ? "no link — manual" : modeFor(j.url));
  const row = (j: Job, action: string) =>
    `<tr><td>${scoreCell(j)}</td><td><a href="/job/${j.id}"><b>${esc(j.title)}</b></a><div class="small mute">${esc(j.company)}</div>${j.status === "waiting" && j.note ? `<div class="small" style="color:var(--warn)">waiting: ${esc(j.note)}</div>` : ""}</td><td class="small mute">${esc(route(j))}</td><td>${action}</td></tr>`;
  return `<div class="two">
<div class="card"><h3>Ready to send · ${drafted.length}</h3><p class="small mute">CV and letter are drafted. Read both before sending.</p>
${drafted.length ? `<div class="wrap"><table>${drafted.map((j) => row(j, applyButton(j, jobs))).join("")}</table></div>` : `<div class="empty">Nothing drafted yet.</div>`}</div>
<div class="card"><h3>Scored, not drafted · ${scored.length}</h3><p class="small mute">Draft the ones scoring 7 or higher. Each takes about a minute.</p>
${scored.length ? `<div class="wrap"><table>${scored.map((j) => row(j, `<form class="inline" method="post" action="/job/${j.id}/tailor"><button class="${(j.score?.score ?? 0) >= 7 ? "" : "ghost"}">Draft</button></form>`)).join("")}</table></div>` : `<div class="empty">Nothing scored yet. Find jobs first.</div>`}</div></div>
<div class="card"><h3>How applying works</h3><p class="small mute"><b>LinkedIn:</b> the person submits it themselves, because automating LinkedIn gets accounts blocked.</p>
<p class="small mute"><b>Company sites:</b> the agent fills the form and stops before submitting. Once a site has gone well a few times, set it to <b>auto</b> in <a href="/settings">Settings</a>.</p>${pastRuns(p.id, "apply")}</div>`;
}

// ---------- 4. follow up ----------

/** Contacts the agent found, the search links, and the button to look. Shared with the job page. */
export function contactList(j: Job): string {
  const found = (j.contacts ?? [])
    .map((ct) => `<div><a href="${esc(ct.url)}" target="_blank" rel="noreferrer"><b>${esc(ct.name)}</b></a> <span class="small mute">${esc(ct.title)}</span></div>`)
    .join("");
  const findMore = !claudeCliPath() ? "" : `<form class="inline" method="post" action="/job/${j.id}/contact"><button class="quiet">${j.contacts?.length ? "Find again" : "Find with the agent"}</button></form>`;
  return `${found}<div class="row" style="margin-top:6px">${peopleSearches(j).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.label)}</a>`).join("")}${findMore}</div>`;
}

function followupStep({ jobs }: Ctx): string {
  const due = dueFollowUps(jobs);
  const upcoming = jobs.filter((j) => j.followUps?.[0] && !due.includes(j)).sort((a, b) => a.followUps![0].localeCompare(b.followUps![0]));
  const card = (j: Job, when: string) => `<div class="card"><div class="lead"><div><b><a href="/job/${j.id}">${esc(j.title)}</a></b> · ${esc(j.company)}<div class="small mute">${when}</div></div>
<form class="inline" method="post" action="/job/${j.id}/status"><button class="ghost" name="status" value="followed_up">I sent it</button></form></div>
${j.pack ? `<div class="two"><div><label>The person to message</label>${contactList(j)}
<label>Connection note</label><textarea readonly rows="3">${esc(j.pack.connectNote)}</textarea></div><div><label>After they accept</label><textarea readonly rows="5">${esc(j.pack.followUp)}</textarea></div></div>` : `<p class="small mute">No pack for this job — draft one on the job page for the messages.</p>`}</div>`;
  return `<h3>Due now · ${due.length}</h3>${due.length ? due.map((j) => card(j, `due ${j.followUps![0]}${j.appliedAt ? `, applied ${j.appliedAt}` : ""}`)).join("") : `<div class="empty" style="margin-bottom:16px">Nothing due. Nudges appear 5 and 10 working days after "I applied".</div>`}
<h3>Coming up · ${upcoming.length}</h3>${upcoming.length ? upcoming.map((j) => card(j, `due ${j.followUps![0]}`)).join("") : `<div class="empty">Nothing scheduled.</div>`}`;
}

// ---------- 5. track ----------

function trackStep({ jobs }: Ctx): string {
  const cols: [string, string[]][] = [
    ["Found", ["new", "scored"]],
    ["Drafted", ["drafted"]],
    ["Applied", ["applied", "followed_up"]],
    ["Interview", ["interview"]],
    ["Offer", ["offer"]],
    ["Closed", ["rejected", "expired"]],
  ];
  return `<div class="cols">${cols
    .map(([label, st]) => {
      const mine = jobs.filter((j) => st.includes(j.status));
      return `<div class="col"><h3>${label} · ${mine.length}</h3>${mine
        .slice(0, 30)
        .map((j) => `<div class="card"><a href="/job/${j.id}"><b>${esc(j.title)}</b></a><div class="small mute">${esc(j.company)}${j.score ? ` · fit ${j.score.score}` : ""}</div></div>`)
        .join("")}</div>`;
    })
    .join("")}</div>
<p class="small mute" style="margin-top:14px">${jobs.filter((j) => j.status === "filtered").length} filtered out before scoring (not a sponsor, in Dutch, salary under the floor). See them in Find jobs with the status filter.</p>`;
}
