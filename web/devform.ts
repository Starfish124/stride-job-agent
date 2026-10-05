// A stand-in application form, for testing the apply agent without touching
// a real company's portal. Served only when DEV_FORM=1. Submissions land in
// data/dev-submissions.json so a fill-and-wait run can be shown to have
// pressed nothing.

import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "../lib/store.ts";
import { esc } from "./layout.ts";

export const DEV_SUBMISSIONS = path.join(DATA_DIR, "dev-submissions.json");

export function devFormPage(jobId: string, title = "Data Analyst"): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Careers at Acme — Apply</title>
<style>body{font:15px system-ui;max-width:640px;margin:40px auto;padding:0 20px}label{display:block;margin:12px 0 4px;font-weight:600}input,textarea,select{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px}button{margin-top:16px;padding:10px 18px}</style></head>
<body><h1>Apply: ${esc(title)} (${esc(jobId)})</h1><p>Acme B.V. · Amsterdam</p>
<form method="post" action="/dev/form/submit" enctype="multipart/form-data">
<input type="hidden" name="job" value="${esc(jobId)}">
<label>First name</label><input name="first" required><label>Last name</label><input name="last" required>
<label>Email</label><input name="email" type="email" required><label>Phone</label><input name="phone">
<label>LinkedIn profile</label><input name="linkedin">
<label>Do you require visa sponsorship to work in this country?</label><select name="sponsorship"><option value="">Select…</option><option>Yes</option><option>No</option></select>
<label>Salary expectation (gross per month)</label><input name="salary">
<label>Resume / CV</label><input type="file" name="cv">
<label>Cover letter</label><textarea name="letter" rows="8"></textarea>
<label>Why do you want to work at Acme?</label><textarea name="why" rows="4"></textarea>
<label><input type="checkbox" name="consent" required style="width:auto"> I consent to Acme processing my application</label>
<label><input type="checkbox" name="newsletter" style="width:auto"> Send me the Acme careers newsletter</label>
<button type="submit">Submit application</button></form></body></html>`;
}

export function recordDevSubmission(fields: Record<string, string>): void {
  const all = readJson<Record<string, string>[]>(DEV_SUBMISSIONS, []);
  writeJson(DEV_SUBMISSIONS, [...all, { ...fields, at: new Date().toISOString() }], 0o644);
}
