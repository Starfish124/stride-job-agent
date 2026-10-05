// Adds a job pointing at the local /dev/form, for testing the apply agent
// without touching a real employer. Usage: node scripts/dev-job.ts <personId> [title] [baseUrl]
import { jobId, upsertJobs } from "../lib/jobs.ts";

const [personId = "demo", title = "Data Analyst", base = "http://127.0.0.1:7420"] = process.argv.slice(2);
const tag = `acme-${Date.now().toString(36)}`;
const url = `${base}/dev/form?job=${tag}`;
const id = jobId(url);
upsertJobs([{
  id, personId, source: "paste", url, title, company: `Acme ${tag}`, location: "Amsterdam",
  postedAt: new Date().toISOString().slice(0, 10), applicants: -1, addedAt: new Date().toISOString(), status: "new",
  description: `Acme is looking for a ${title} in Amsterdam to join an English-speaking team of 40. You work closely with customers and colleagues, own your results end to end, and help us grow. Hybrid, three days in the office.`,
  language: "en", salary: "", contact: "", sponsor: { match: "exact", name: "Acme B.V.", kvk: "0" },
}]);
console.log(id);
