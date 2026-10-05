// The README screenshots: a made-up person with made-up jobs in a throwaway
// data dir, the real server on top of it, headless Chrome on each page.
// No model is ever called: CLAUDE_BIN=/usr/bin/true passes the "is Claude
// Code installed" check (so the agent buttons show) and answers nothing.
//
//   node demo/shoot.ts            → docs/screenshots/*.png
//
// Needs Google Chrome and pdftoppm (poppler, also used for PDF CVs).

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT = path.join(REPO, "docs", "screenshots");
const DEMO = fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-demo-"));
const DATA = path.join(DEMO, "data");
const PORT = 7431;
const URL_ = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

process.env.JOB_AGENT_DATA = DATA; // before any lib module reads it
const { writeJson } = await import("../lib/store.ts");
const { savePerson, saveJobs } = await import("../lib/jobs.ts");
const { runDir } = await import("../lib/engine.ts");
const { renderCv, renderLetter } = await import("../lib/pdf.ts");
const { appliedPatch, addWorkingDays } = await import("../lib/followup.ts");
const { jobId } = await import("../lib/jobs.ts");
const { PROVIDERS_PATH } = await import("../lib/llm.ts");
const { RUNS_DIR } = await import("../lib/agent.ts");
const { BOARDS_PATH } = await import("../lib/sources/boards.ts");

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const at = (d: string, hm = "09:00") => `${d}T${hm}:00.000Z`;

// ---------- people ----------

const anna = {
  id: "anna", name: "Anna de Vries", email: "anna.devries@example.com", phone: "+31 6 1234 5678", location: "Utrecht",
  linkedin: "https://www.linkedin.com/in/example-anna", headline: "Hotel front office manager moving into customer success",
  targetRoles: ["Customer Success Manager", "Onboarding Specialist", "Account Manager"], country: "Netherlands",
  locations: ["Amsterdam", "Utrecht"], languages: ["Dutch (native)", "English (C2)", "German (B1)"],
  needsSponsor: false, salaryFloor: 3800, suppress: ["Hotel Grim"], reviewed: true,
  goal: "Out of hospitality, into customer success at a software company",
  facts: [
    { id: "r1", kind: "role", title: "Front Office Manager", org: "Grand Canal Hotel", dates: "2021 - 2025", text: "Ran the front desk of a 300-room hotel in Amsterdam." },
    { id: "a1", kind: "achievement", under: "r1", text: "Led a team of 12 receptionists across three shifts." },
    { id: "a2", kind: "achievement", under: "r1", text: "Raised guest satisfaction from 8.1 to 8.9 in two years." },
    { id: "a3", kind: "achievement", under: "r1", text: "Moved check-in to the hotel's booking software and trained every shift on it." },
    { id: "r2", kind: "role", title: "Receptionist", org: "Hotel Zuidas", dates: "2018 - 2021", text: "Front desk for business travellers and group bookings." },
    { id: "a4", kind: "achievement", under: "r2", text: "Handled group bookings of up to 80 guests." },
    { id: "e1", kind: "education", title: "BSc Hospitality Management", org: "Amstel School of Hospitality", dates: "2014 - 2018", text: "" },
    { id: "s1", kind: "skill", text: "Salesforce" },
    { id: "s2", kind: "skill", text: "Customer onboarding" },
    { id: "s3", kind: "skill", text: "Opera PMS" },
    { id: "s4", kind: "skill", text: "Shift planning" },
    { id: "l1", kind: "language", text: "Dutch (native)" },
    { id: "l2", kind: "language", text: "English (C2)" },
    { id: "l3", kind: "language", text: "German (B1)" },
  ],
};

const sam = {
  id: "sam", name: "Sam Okafor", email: "sam.okafor@example.com", phone: "", location: "Lagos",
  linkedin: "", headline: "Data analyst moving to Berlin", targetRoles: ["Data Analyst", "BI Analyst"], country: "Germany",
  locations: ["Berlin"], languages: ["English (native)", "German (A2)"], needsSponsor: true, salaryFloor: 0,
  suppress: [], reviewed: true,
  facts: [
    { id: "r1", kind: "role", title: "Data Analyst", org: "Example Telecom", dates: "2022 - 2026", text: "Weekly churn and revenue reporting." },
    { id: "s1", kind: "skill", text: "SQL" },
  ],
};

// ---------- jobs ----------

type J = Record<string, unknown>;
const job = (j: J): J => {
  const url = String(j.url ?? "");
  return {
    id: jobId(url, String(j.title)), personId: "anna", source: "linkedin", url, location: "Amsterdam", postedAt: day(-2),
    applicants: -1, addedAt: at(day(-2)), status: "new", description: "", language: "en", salary: "", contact: "", ...j,
  };
};
const score = (n: number, reasoning: string, skills: number, seniority: number, language = 9) => ({ score: n, reasoning, at: at(day(-1)), fit: { skills, seniority, language } });

const star = job({
  url: "https://www.linkedin.com/jobs/view/4000000101", title: "Customer Success Manager", company: "Globex", applicants: 14, postedAt: day(-1),
  salary: "€4,200 - €5,000 per month", status: "drafted", contact: "Maya Jansen",
  description: "Globex sells booking software to 2,000 hotels and venues across Europe. As Customer Success Manager you own a book of 60 accounts: you onboard them, run quarterly reviews and make sure they renew. You bring 3+ years with customers, ideally in hospitality, and you are at home in a CRM such as Salesforce. Dutch and English required.",
  score: score(9, "A hospitality customer base, onboarding, Salesforce and Dutch+English: her front-office years are the domain knowledge this team lacks. Seniority fits; the CRM ask is met.", 9, 8, 10),
  pack: {
    title: "Customer Success Manager",
    summary: "Front office manager who ran a 300-room hotel's front desk and raised guest satisfaction from 8.1 to 8.9. Moving into customer success, bringing the guest side of hospitality software.",
    bullets: [
      { factId: "a2", text: "Raised guest satisfaction from 8.1 to 8.9 in two years by fixing how arriving guests are received." },
      { factId: "a3", text: "Moved check-in to the hotel's booking software and trained every shift to use it." },
      { factId: "a1", text: "Led a team of 12 receptionists across three shifts." },
      { factId: "a4", text: "Handled group bookings of up to 80 guests, from first request to check-out." },
    ],
    skills: ["Customer onboarding", "Salesforce", "Opera PMS", "Shift planning"],
    letter: "Dear Maya,\n\nGlobex's customers are hotels, and for seven years I have been on the other side of your software: at the front desk, at 7 in the morning, with a queue.\n\nAt the Grand Canal Hotel I moved our check-in onto new booking software and trained every shift to use it. Guest satisfaction went from 8.1 to 8.9 in two years. That is the job of a customer success manager, seen from the customer's side: get people using the tool, then keep them happy with it.\n\nI would like to bring that to your accounts.\n\nKind regards,\nAnna de Vries",
    connectNote: "Hi Maya, I just applied for the Customer Success Manager role at Globex. Seven years at hotel front desks, the last four running one. Would love to connect.",
    followUp: "Thanks for connecting, Maya. I applied for the CSM role last week. I moved a 300-room hotel's check-in onto new software and trained every shift on it; happy to tell you how that went if it helps.",
    at: at(day(-1), "10:12"),
  },
});
const waiting = job({
  url: "https://job-boards.greenhouse.io/piedpiper/jobs/1000101", source: "board", title: "Customer Success Manager", company: "Pied Piper",
  status: "waiting", note: "Every field is filled. The CV upload needs one click in Chrome: attach CV.pdf, then press Submit.",
  score: score(8, "Onboarding-heavy CSM role at a scale-up; hospitality is not required but customer-facing leadership counts.", 8, 8),
  pack: { ...(star.pack as J), letter: "Dear hiring team,\n\nPied Piper's customers need to be up and running in their first week, and getting people up and running is what I have done for seven years.\n\nAt the Grand Canal Hotel I moved our check-in onto new booking software and trained every shift to use it. Guest satisfaction went from 8.1 to 8.9 in two years.\n\nI would like to do the same for your new customers.\n\nKind regards,\nAnna de Vries", at: at(day(-1), "11:40") },
});
const applied = job({
  url: "https://careers.vandelay.example/jobs/customer-success-associate", source: "board", title: "Customer Success Associate", company: "Vandelay Industries",
  location: "Utrecht", score: score(7, "Junior for her, but the shortest path into SaaS customer success.", 8, 5),
  pack: star.pack, ...appliedPatch(addWorkingDays(day(-14), 0)),
});
const jobs = [
  star, waiting, applied,
  job({ url: "https://careers.hooli.example/o/onboarding-specialist", source: "board", title: "Onboarding Specialist", company: "Hooli", status: "scored", applicants: -1, score: score(8, "Onboarding new customers end to end is her strongest transferable skill.", 8, 7) }),
  job({ url: "https://www.linkedin.com/jobs/view/4000000102", title: "Account Manager", company: "Initech", location: "Utrecht", applicants: 63, status: "scored", score: score(7, "Relationship work fits; quota-carrying sales is new to her.", 6, 7) }),
  job({ url: "https://www.linkedin.com/jobs/view/4000000103", title: "Account Executive", company: "Umbrella", applicants: 212, status: "scored", score: score(5, "A closing role with a sales quota; little of her background applies.", 4, 5) }),
  job({ url: "https://www.linkedin.com/jobs/view/4000000104", title: "Customer Support Lead", company: "Soylent", status: "interview", score: score(8, "Leading a support team is close to leading a front desk.", 8, 8), pack: star.pack, appliedAt: day(-20) }),
  job({ url: "https://www.linkedin.com/jobs/view/4000000105", title: "Hotel Manager", company: "Wonka Hotels", applicants: 31, status: "scored", score: score(3, "The job she is leaving, one step up: not where she wants to go.", 9, 6) }),
  job({ url: "https://www.linkedin.com/jobs/view/4000000106", title: "Customer Success Manager", company: "Cyberdyne", status: "filtered", triage: "stated salary €2,900 per month is under the 3800/month floor", salary: "€2,900 per month" }),
  job({ personId: "sam", url: "https://www.linkedin.com/jobs/view/4000000201", title: "Data Analyst", company: "Prestige Worldwide", location: "Berlin, Germany", status: "scored", score: score(8, "SQL reporting on churn is this job.", 8, 8) }),
];

// ---------- write the data dir ----------

savePerson(anna as never);
savePerson(sam as never);
saveJobs(jobs as never);
for (const j of [star, waiting]) {
  const dir = runDir(String(j.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "CV.pdf"), await renderCv(anna as never, j.pack as never, "en"));
  fs.writeFileSync(path.join(dir, "Letter.pdf"), await renderLetter(anna as never, j as never, j.pack as never));
}
writeJson(PROVIDERS_PATH, { provider: "anthropic", anthropic: { key: "sk-ant-demo-not-a-real-key", fast: "", best: "" } });
writeJson(BOARDS_PATH, [
  { company: "Globex", kind: "greenhouse", slug: "globex" },
  { company: "Pied Piper", kind: "greenhouse", slug: "piedpiper" },
  { company: "Hooli", kind: "recruitee", slug: "hooli" },
  { company: "Vandelay Industries", kind: "lever", slug: "vandelay" },
]);
writeJson(path.join(DATA, "apply-policy.json"), { "greenhouse.io": "fill-and-wait", "careers.vandelay.example": "auto" });

// One finished apply run, so the run page has a transcript to show.
const runId = "d3m0a991e5f0";
const ev = (hm: string, kind: string, text: string) => ({ at: at(day(-1), hm), kind, text });
fs.mkdirSync(path.join(RUNS_DIR, runId), { recursive: true });
fs.writeFileSync(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify({ id: runId, task: "apply", personId: "anna", jobId: waiting.id, status: "done", startedAt: at(day(-1), "11:41"), endedAt: at(day(-1), "11:46") }));
waiting.runId = runId;
saveJobs(jobs as never);
fs.writeFileSync(path.join(RUNS_DIR, `${runId}.jsonl`), [
  ev("11:41", "status", "started apply"),
  ev("11:41", "text", "Opening the apply page for Customer Success Manager at Pied Piper."),
  ev("11:41", "tool", `⚙ navigate {"url":"${waiting.url}"}`),
  ev("11:42", "tool", '⚙ find {"query":"application form fields"}'),
  ev("11:42", "text", "Greenhouse form: name, email, phone, LinkedIn, CV, cover letter, and five questions."),
  ev("11:43", "tool", '⚙ form_input {"ref":"first_name","value":"Anna"}'),
  ev("11:43", "tool", '⚙ form_input {"ref":"email","value":"anna.devries@example.com"}'),
  ev("11:43", "tool", '⚙ form_input {"ref":"cover_letter_text","value":"Dear hiring team, …"}'),
  ev("11:44", "text", "Work authorisation: authorised to work in the Netherlands, no sponsorship needed. Answered from the sheet."),
  ev("11:45", "tool", `⚙ javascript_tool {"text":"fetch('${URL_}/job/${waiting.id}/CV.pdf') → DataTransfer → #resume"}`),
  ev("11:45", "text", "The CV upload was not accepted: the site needs a real click on its file picker."),
  ev("11:46", "result", '{"outcome":"waiting","note":"Every field is filled. The CV upload needs one click in Chrome: attach CV.pdf, then press Submit."}'),
  ev("11:46", "status", "done"),
].map((e) => JSON.stringify(e)).join("\n") + "\n");

// ---------- serve and shoot ----------

const server = spawn(process.execPath, [path.join(REPO, "server.ts")], {
  cwd: DEMO, env: { ...process.env, JOB_AGENT_DATA: DATA, PORT: String(PORT), CLAUDE_BIN: "/usr/bin/true" }, stdio: "ignore",
});
for (let i = 0; ; i++) {
  if (await fetch(URL_).then((r) => r.ok, () => false)) break;
  if (i > 50) throw new Error("the demo server did not start");
  await new Promise((r) => setTimeout(r, 200));
}

/** Chrome 154 writes the file and then does not always exit: wait for the file, not the process. */
async function shoot(name: string, urlPath: string, height: number): Promise<void> {
  const out = path.join(OUT, `${name}.png`);
  fs.rmSync(out, { force: true });
  const chrome = spawn(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${path.join(DEMO, "chrome")}`,
    "--force-device-scale-factor=2", `--window-size=1280,${height}`, "--virtual-time-budget=5000", `--screenshot=${out}`, URL_ + urlPath,
  ], { stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    if (chrome.exitCode !== null || (fs.existsSync(out) && Date.now() - fs.statSync(out).mtimeMs > 1000)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  chrome.kill("SIGKILL");
  if (!fs.existsSync(out)) throw new Error(`Chrome made no screenshot of ${urlPath}`);
  console.log(out);
}

fs.mkdirSync(OUT, { recursive: true });
try {
  await shoot("people", "/", 760);
  await shoot("profile", "/p/anna/profile", 2350);
  await shoot("find", "/p/anna/find", 1250);
  await shoot("job", `/job/${star.id}`, 1560);
  await shoot("agent-run", `/run/${runId}`, 980);
  await shoot("settings", "/settings", 1250);
  // The tailored CV, page one, as the employer sees it.
  const r = spawnSync("pdftoppm", ["-png", "-r", "140", "-f", "1", "-l", "1", "-singlefile", path.join(runDir(String(star.id)), "CV.pdf"), path.join(OUT, "cv")]);
  if (r.status !== 0) throw new Error(`pdftoppm failed: ${r.stderr}`);
  console.log(path.join(OUT, "cv.png"));
} finally {
  server.kill();
}
console.log(`demo data left in ${DEMO}`);
