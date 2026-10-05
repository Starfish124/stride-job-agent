import { fixture } from "./helpers.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agoToIso, applicantsFrom, detectLanguage, fromJsonLd, fromLinkedIn, fromLlm } from "../lib/extract.ts";
import { detailUrl, linkedinJobId, parseSearch, searchUrl } from "../lib/sources/linkedin.ts";
import { jobId, normaliseUrl } from "../lib/jobs.ts";

test("parses a LinkedIn guest search page into cards", () => {
  const cards = parseSearch(fixture("linkedin-search.html"));
  assert.equal(cards.length, 10);
  const globex = cards.find((c) => c.company === "Globex");
  assert.equal(globex.title, "Data Analyst");
  assert.equal(globex.url, "https://www.linkedin.com/jobs/view/4000000001");
  assert.match(globex.location, /Amsterdam/);
  assert.ok(cards.every((c) => c.title && c.company), "a card lost its title or company");
});

test("reads a LinkedIn job page", () => {
  const ad = fromLinkedIn(fixture("linkedin-job.html"));
  assert.equal(ad.title, "Data Analyst");
  assert.equal(ad.company, "Globex");
  assert.match(ad.description, /award-winning tech scale-up/);
  assert.equal(ad.language, "en");
  assert.equal(ad.applicants, 181);
  assert.equal(fromLinkedIn(fixture("linkedin-job.html"), new Date("2026-09-10T20:00:00Z")).postedAt, "2026-09-10");
});

test("competition fields degrade to unknown, never to a wrong number", () => {
  assert.equal(applicantsFrom("<span class=\"num-applicants__caption\"> Be among the first 25 applicants </span>"), 0);
  assert.equal(applicantsFrom("<span class=\"num-applicants__caption\"> 1,204 applicants </span>"), 1204);
  assert.equal(applicantsFrom("<p>nothing</p>"), -1);
  assert.equal(agoToIso("3 days ago", new Date("2026-09-10T12:00:00Z")), "2026-09-07");
  assert.equal(agoToIso("just now"), "");
});

test("LinkedIn links of every shape resolve to one job", () => {
  assert.equal(linkedinJobId("https://nl.linkedin.com/jobs/view/data-analyst-at-globex-4000000001?position=2"), "4000000001");
  assert.equal(linkedinJobId("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4000000001"), "4000000001");
  assert.equal(detailUrl("https://www.linkedin.com/jobs/view/4000000001"), "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4000000001");
  assert.equal(
    jobId("https://nl.linkedin.com/jobs/view/data-analyst-at-globex-4000000001?trk=x"),
    jobId("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4000000001"),
  );
  assert.equal(normaliseUrl("https://Example.com/vacature/12/?utm_source=x&trk=y#top"), "https://example.com/vacature/12");
  // Indeed: the query IS the job. Order and tracking noise must not split one ad in two.
  assert.equal(normaliseUrl("https://nl.indeed.com/viewjob?jk=abc&from=serp"), "https://nl.indeed.com/viewjob?jk=abc");
  assert.notEqual(jobId("https://nl.indeed.com/viewjob?jk=1"), jobId("https://nl.indeed.com/viewjob?jk=2"));
  // A bare city gets the person's country: LinkedIn's guest search answers a bare city with nothing.
  assert.match(searchUrl("Data Analyst", "Amsterdam", 1, undefined, "Netherlands"), /keywords=Data\+Analyst&location=Amsterdam%2C\+Netherlands&f_TPR=r604800&start=10/);
  assert.match(searchUrl("Data Analyst", "Berlin", 0, undefined, "Germany"), /location=Berlin%2C\+Germany&/);
  assert.match(searchUrl("Data Analyst", "Netherlands", 0, undefined, "Netherlands"), /location=Netherlands&/);
  assert.match(searchUrl("Data Analyst", "Leeds, UK", 0, undefined, "United Kingdom"), /location=Leeds%2C\+UK&/);
});

test("reads schema.org JobPosting, keeping the salary period as stated", () => {
  const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Analist &amp; adviseur",
    "description":"<p>Wij zoeken een analist voor het team met ervaring.</p>","hiringOrganization":{"name":"Gemeente Amsterdam"},
    "jobLocation":{"address":{"addressLocality":"Amsterdam"}},
    "baseSalary":{"currency":"EUR","value":{"minValue":4000,"maxValue":5500,"unitText":"MONTH"}}}</script>`;
  const ad = fromJsonLd(html);
  assert.equal(ad.title, "Analist & adviseur");
  assert.equal(ad.company, "Gemeente Amsterdam");
  assert.equal(ad.salary, "4000-5500 EUR per month");
  assert.equal(ad.language, "nl");
});

test("pasted text: the model extracts fields, never rewrites the description", async () => {
  const text = "Customer Success Manager at Adyen, Amsterdam. Salary €4.500 per maand. Contact: Sam Jansen.";
  const ad = await fromLlm(text, async () => '{"title":"Customer Success Manager","company":"Adyen","location":"Amsterdam","salary":"€4.500 per maand","contact":"Sam Jansen"}');
  assert.equal(ad.description, text);
  assert.equal(ad.contact, "Sam Jansen");
  const broken = await fromLlm(text, async () => "sorry, no JSON");
  assert.equal(broken.description, text);
  assert.equal(broken.company, "");
});

test("tells Dutch from English", () => {
  assert.equal(detectLanguage("Wij zoeken een collega voor het team die met ons de klant helpt."), "nl");
  assert.equal(detectLanguage("We are looking for a colleague who will help our customers and grow with the team."), "en");
});
