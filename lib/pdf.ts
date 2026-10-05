// CV and cover letter as PDFs with pdf-lib (no LaTeX, no browser). Employers,
// titles, dates and education are printed from facts; only the summary, the
// target title, the bullet wording, the skill order and the letter come from
// the pack. Layout follows docs/cv-rules.md: centred masthead, ruled section
// headings, title-bold/dates-right with employer in italic, dash bullets.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { visibleFacts } from "./profile.ts";
import type { Fact, Job, Pack, Person } from "./types.ts";

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const MID = A4[0] / 2;
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.42, 0.42, 0.46);

const LABELS = {
  en: { profile: "Summary", highlights: "Highlights", experience: "Professional Experience", education: "Education", skills: "Skills", languages: "Languages", certificates: "Certificates", re: "Re:" },
  nl: { profile: "Profiel", highlights: "Hoogtepunten", experience: "Werkervaring", education: "Opleiding", skills: "Vaardigheden", languages: "Talen", certificates: "Certificaten", re: "Betreft:" },
};

/** The standard fonts speak WinAnsi only. A name like "Łukasz" or a stray "→" must degrade, not throw. */
function safeFor(font: PDFFont) {
  const ok = new Map<string, boolean>();
  const fits = (c: string) => {
    if (!ok.has(c)) {
      try {
        font.encodeText(c);
        ok.set(c, true);
      } catch {
        ok.set(c, false);
      }
    }
    return ok.get(c)!;
  };
  return (s: string) =>
    [...s.replace(/\r/g, "").replace(/\t/g, " ").replace(/[   ]/g, " ").replace(/[→➔]/g, "->")]
      .map((c) => (c === "\n" || fits(c) ? c : [...c.normalize("NFKD")].filter(fits).join("") || "?"))
      .join("");
}

class Writer {
  doc: PDFDocument;
  page: PDFPage;
  y = 0;
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  safe: (s: string) => string;

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, italic: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.italic = italic;
    this.safe = safeFor(regular);
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
  }

  room(h: number) {
    if (this.y - h < M) this.newPage();
  }

  lines(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of this.safe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/ +/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  text(s: string, o: { size?: number; font?: PDFFont; color?: typeof INK; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.font ?? this.regular;
    const x = M + (o.indent ?? 0);
    for (const line of this.lines(s, font, size, A4[0] - M - x)) {
      this.room(size * 1.35);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.35;
    }
    this.y -= o.gap ?? 0;
  }

  /** One centred line, wrapped to the full text column. */
  centered(s: string, o: { size?: number; font?: PDFFont; color?: typeof INK; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.font ?? this.regular;
    for (const line of this.lines(s, font, size, A4[0] - 2 * M)) {
      this.room(size * 1.35);
      const w = font.widthOfTextAtSize(line, size);
      this.page.drawText(line, { x: MID - w / 2, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.35;
    }
    this.y -= o.gap ?? 0;
  }

  bullet(s: string) {
    this.room(14);
    this.page.drawText("-", { x: M + 6, y: this.y - 10, size: 10, font: this.regular, color: INK });
    this.text(s, { indent: 18, gap: 1.5 });
  }

  /** Bold left, grey right, on one line: "Title ........ 2021 - 2024". */
  row(left: string, right: string, leftFont = this.bold, leftSize = 10.5) {
    this.room(15);
    const r = this.safe(right);
    const rw = this.regular.widthOfTextAtSize(r, 9);
    const [first] = this.lines(left, leftFont, leftSize, A4[0] - 2 * M - rw - 12);
    this.page.drawText(first, { x: M, y: this.y - leftSize, size: leftSize, font: leftFont, color: INK });
    if (r) this.page.drawText(r, { x: A4[0] - M - rw, y: this.y - 10, size: 9, font: this.regular, color: GREY });
    this.y -= leftSize * 1.35;
  }

  heading(s: string) {
    this.room(40);
    this.y -= 10;
    this.page.drawText(this.safe(s.toUpperCase()), { x: M, y: this.y - 10, size: 10, font: this.bold, color: INK });
    this.y -= 14;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 1, color: INK });
    this.y -= 9;
  }
}

async function start() {
  const doc = await PDFDocument.create();
  return new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    await doc.embedFont(StandardFonts.HelveticaOblique),
  );
}

/** Centred name, short target title, one contact line. `title` defaults to the long headline (letters). */
function masthead(w: Writer, p: Person, title = p.headline, center = true) {
  const contact = [p.email, p.phone, p.location, p.linkedin.replace(/^https?:\/\/(www\.)?/, "")].filter(Boolean).join("   ·   ");
  if (center) {
    w.centered(p.name, { size: 22, font: w.bold, gap: 3 });
    if (title) w.centered(title, { size: 12, color: GREY, gap: 5 });
    w.centered(contact, { size: 9, color: GREY, gap: 6 });
  } else {
    w.text(p.name, { size: 20, font: w.bold, gap: 2 });
    if (title) w.text(title, { size: 11, color: GREY, gap: 2 });
    w.text(contact, { size: 9, color: GREY, gap: 4 });
  }
}

/** Fewest bullets we will trim down to before accepting a second page. */
const BULLET_FLOOR = 3;

/**
 * One page, strict (cv-rules.md). The model orders bullets most-relevant first,
 * so if the CV overflows we drop from the end and re-render until it fits — cut
 * the least relevant bullet, never shrink the font. Falls back to a 2-page CV
 * only once we are down to BULLET_FLOOR bullets.
 */
export async function renderCv(p: Person, pack: Pack, lang: "nl" | "en"): Promise<Uint8Array> {
  let bullets = [...pack.bullets];
  while (true) {
    const bytes = await drawCv(p, { ...pack, bullets }, lang);
    if (bullets.length <= BULLET_FLOOR) return bytes;
    if ((await PDFDocument.load(bytes)).getPageCount() <= 1) return bytes;
    bullets = bullets.slice(0, -1);
  }
}

async function drawCv(p: Person, pack: Pack, lang: "nl" | "en"): Promise<Uint8Array> {
  const L = LABELS[lang];
  const w = await start();
  w.doc.setTitle(`${p.name} - CV`);
  // The short target title under the name (checked, so only a held title or the
  // job title). Falls back to the long headline if a pack predates the field.
  masthead(w, p, pack.title || p.headline);

  w.heading(L.profile);
  w.text(pack.summary, { gap: 2 });

  const facts = visibleFacts(p);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const chosen = pack.bullets.filter((b) => byId.has(b.factId));
  const under = (id: string) => chosen.filter((b) => byId.get(b.factId)!.under === id && b.factId !== id);
  const loose = chosen.filter((b) => {
    const f = byId.get(b.factId)!;
    return f.kind === "achievement" && (!f.under || !byId.has(f.under));
  });

  if (loose.length) {
    w.heading(L.highlights);
    loose.forEach((b) => w.bullet(b.text));
  }

  const block = (f: Fact) => {
    w.row(f.title ?? "", f.dates ?? ""); // title bold left, dates grey right
    if (f.org) w.text(f.org, { font: w.italic, size: 10, color: GREY, gap: 1 }); // employer in italic
    const bullets = under(f.id);
    if (bullets.length) bullets.forEach((b) => w.bullet(b.text));
    else {
      // A role with no bullets keeps its own one line so it is not left blank.
      const self = chosen.find((b) => b.factId === f.id);
      const line = self?.text || f.text;
      if (line) w.text(line, { color: GREY, gap: 1 });
    }
    w.y -= 6;
  };

  // Every role stays on the CV in the CV's own order: a tailored CV reorders
  // bullets, never the timeline. Leaving a job out is what `suppress` is for.
  const roles = facts.filter((f) => f.kind === "role");
  if (roles.length) {
    w.heading(L.experience);
    roles.forEach(block);
  }
  const education = facts.filter((f) => f.kind === "education");
  if (education.length) {
    w.heading(L.education);
    education.forEach(block);
  }

  const languages = facts.filter((f) => f.kind === "language").map((f) => f.text);
  const certificates = facts.filter((f) => f.kind === "certificate").map((f) => f.text);
  const skills = pack.skills.filter((s) => !languages.some((l) => l.toLowerCase() === s.toLowerCase()) && !certificates.includes(s));
  if (skills.length) {
    w.heading(L.skills);
    w.text(skills.join(", "));
  }
  if (languages.length) {
    w.heading(L.languages);
    w.text(languages.join(", "));
  }
  if (certificates.length) {
    w.heading(L.certificates);
    w.text(certificates.join(", "));
  }
  return w.doc.save();
}

/** Pages the tailored CV renders to — for the one-page check on the job page. */
export async function cvPageCount(p: Person, pack: Pack, lang: "nl" | "en"): Promise<number> {
  return (await PDFDocument.load(await renderCv(p, pack, lang))).getPageCount();
}

export async function renderLetter(p: Person, job: Job, pack: Pack): Promise<Uint8Array> {
  const L = LABELS[job.language];
  const w = await start();
  w.doc.setTitle(`${p.name} - ${job.title}`);
  masthead(w, p, pack.title || p.headline, false);
  w.y -= 18;
  const date = new Date().toLocaleDateString(job.language === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  w.text([job.company, job.location].filter(Boolean).join(", "), { gap: 2 });
  w.text(date, { color: GREY, gap: 14 });
  w.text(`${L.re} ${job.title}`, { font: w.bold, gap: 12 });
  for (const para of pack.letter.split(/\n\s*\n|\n/).filter((s) => s.trim())) w.text(para.trim(), { size: 10.5, gap: 8 });
  return w.doc.save();
}
