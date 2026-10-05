# CV rules

The one rulebook. Both the job agent (`lib/tailor.ts` prompt, `lib/cvcheck.ts`)
and the `/cv-optimiser` skill read this file, so they never drift apart.

Every rule serves one of two readers: a hiring manager who spends about
**7 seconds** on the first pass (Ladders eye-tracking, 2018), and the ATS that
parses the file before them (Greenhouse's own parse-failure doc).

## The iron rule

**Omission, never invention.** Reword, reorder, emphasise, cut. Never add an
employer, title, client, tool, responsibility, qualification or number that is
not in the person's reviewed facts or the job ad. Upgrading is inventing:
"helped with" never becomes "led". A missing number stays missing — write
`[add figure?]` for the person to fill in; do not estimate one.

## Layout (rendered by `lib/pdf.ts`, not the model)

- One column. No tables, text boxes, icons, photos or coloured blocks — each is
  a Greenhouse-documented parse failure.
- Centred name; a short **target title** under it; one contact line
  (email · phone · city · LinkedIn). No street address, no date of birth, no
  photo — Dutch age-discrimination law (WGBL) and ATS parsing both favour this.
- Section order: Summary, Professional Experience, Education, Skills, Languages,
  Certificates. Standard heading names, each with a rule under it.
- Every role: title in bold (left), dates (right); employer in italic (left),
  city (right); then dash bullets. Reverse chronological. A tailored CV reorders
  bullets, never the timeline.
- **One page** for under 10 years' experience. If it overflows, cut the least
  relevant bullet first, never shrink the font below 10pt.
- Text-based PDF only (selectable text, no scan).

## The target title (under the name)

Aimed at the job, max 6 words. It may only be a title the person actually held,
or the job's own advertised title. The check rejects anything else — a
"Coordinator" is never printed as "Manager".

## Summary (2–3 lines)

Target title + domain + one or two concrete proofs + location or work
authorisation. State work authorisation plainly, because ATS knockout questions
filter on it:
- EU citizen -> "EU citizen, no work permit required".
- Needs sponsorship -> name the route (IND Highly Skilled Migrant).

## Bullets

Bock's formula: **accomplished [X], measured by [Y], by doing [Z]** — action
verb first, then the result, then the method. Where the facts carry no number,
use scope, volume, frequency, stakeholders or the outcome instead of a metric
(Columbia/Princeton career guidance). Phrases, not sentences; no "I"/"we".

## Banned wording (the AI/filler tells recruiters flag)

results-driven, passionate, dynamic, team player, detail-oriented, self-starter,
synergy, spearheaded, leveraged, pivotal, underscore, testament, showcasing,
delve, "not just X but Y", and the em dash in body text. Vary bullet length and
opening verb — identical rhythm on every line reads as machine-written.

## Netherlands specifics

- Max 2 pages. Standard CV, not Europass — EURES
  notes Europass is not well established with Dutch employers.
- Languages with CEFR levels (English C2, Dutch B1).
- UK English spelling is fine; for keywords, copy the ad's exact spelling.
