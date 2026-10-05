// Every test file imports this FIRST: it points DATA_DIR at a throwaway dir
// before lib/store.ts reads the environment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.JOB_AGENT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-test-"));

export const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export function person(over = {}) {
  return {
    id: "a", name: "Anna de Vries", email: "anna@example.com", phone: "+31 6 1234 5678", location: "Amsterdam",
    linkedin: "https://www.linkedin.com/in/anna", headline: "Hospitality manager moving into customer success",
    targetRoles: ["Customer Success Manager", "Account Manager"], country: "Netherlands", locations: ["Amsterdam"], languages: ["English (native)"],
    needsSponsor: false, salaryFloor: 0, suppress: ["Hotel Grim"], reviewed: true,
    facts: [
      { id: "r1", kind: "role", title: "Front Office Manager", org: "Hotel Okura", dates: "2021 - 2025", text: "Ran the front desk of a 300-room hotel." },
      { id: "a1", kind: "achievement", under: "r1", text: "Led a team of 12 receptionists across three shifts." },
      { id: "a2", kind: "achievement", under: "r1", text: "Raised guest satisfaction from 8.1 to 8.9 on Booking.com." },
      { id: "e1", kind: "education", title: "BSc Hospitality Management", org: "Hotelschool The Hague", dates: "2017 - 2021", text: "" },
      { id: "s1", kind: "skill", text: "Salesforce" },
      { id: "s2", kind: "skill", text: "Customer onboarding" },
      { id: "l1", kind: "language", text: "English (native)" },
    ],
    ...over,
  };
}

export function job(over = {}) {
  return {
    id: "abc123abc123", personId: "a", source: "paste", url: "", title: "Customer Success Manager", company: "Adyen",
    location: "Amsterdam", postedAt: "", applicants: -1, addedAt: "2026-09-10T10:00:00Z", status: "new",
    description: "We are looking for a Customer Success Manager with 3+ years of experience to onboard merchants. You will work with Salesforce.",
    language: "en", salary: "", contact: "",
    ...over,
  };
}

export function goodPack(over = {}) {
  return {
    title: "Customer Success Manager",
    summary: "Front office manager with a record of raising guest satisfaction, moving into customer success.",
    bullets: [
      { factId: "a2", text: "Raised guest satisfaction from 8.1 to 8.9 by fixing the onboarding of arriving guests." },
      { factId: "a1", text: "Led a team of 12 across three shifts." },
    ],
    skills: ["Customer onboarding", "Salesforce"],
    letter: "Dear hiring team,\n\nI ran the front desk of a 300-room hotel...\n\nKind regards,\nAnna de Vries",
    connectNote: "Hi! I just applied for the Customer Success Manager role at Adyen and would love to connect.",
    followUp: "Thanks for connecting. I raised guest satisfaction from 8.1 to 8.9 and would love to bring that to your merchants.",
    at: "2026-09-10T10:00:00Z",
    ...over,
  };
}
