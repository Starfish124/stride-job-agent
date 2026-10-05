// The IND public register of recognised sponsors (regular labour and highly
// skilled migrants). A public HTML table: organisation name + KvK number, no
// address. Location therefore comes from the job ad, never from here.

import fs from "node:fs";
import path from "node:path";
import { decode } from "./extract.ts";
import { DATA_DIR, readJson, writeJson } from "./store.ts";
import type { SponsorMatch } from "./types.ts";

export const REGISTER_URL =
  "https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants";
export const SPONSORS_PATH = path.join(DATA_DIR, "sponsors.json");

export interface Sponsor {
  name: string;
  kvk: string;
}

export function parseRegister(html: string): Sponsor[] {
  const rows = html.matchAll(/<th scope="row">([\s\S]*?)<\/th>\s*<td>\s*([\d\s]*?)\s*<\/td>/g);
  // The register double-quotes quoted names (""Aa-Dee"" ...); collapse that.
  return [...rows].map((m) => ({ name: decode(m[1]).replace(/""/g, '"').trim(), kvk: m[2].trim() }));
}

/**
 * Words that say what kind of legal entity or which branch, never who. LinkedIn
 * says "Adyen", the register says "Adyen N.V."; LinkedIn says "AS Watson
 * Benelux", the register says "A.S. Watson (Health & Beauty ...) B.V.".
 */
const NOISE = new Set([
  "bv", "nv", "b", "v", "n", "vof", "cv", "llp", "ltd", "limited", "inc", "gmbh", "sa", "ag", "plc", "se",
  "holding", "holdings", "group", "groep", "the", "nederland", "netherlands", "benelux", "europe", "international",
]);

/**
 * Brand abbreviations the register spells out in full. Seen live 2026-09-15:
 * "PwC Nederland" on a job ad, "PricewaterhouseCoopers ... N.V." on the
 * register — no substring or prefix relationship links them.
 */
const ALIASES: Record<string, string> = {
  pwc: "pricewaterhousecoopers",
};

export function normaliseCompany(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " ")
    // "A.S." -> "as", "B.V." -> "bv" before punctuation becomes a word break
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .map((w) => ALIASES[w] ?? w)
    .join(" ");
}

/** Same words with the spaces dropped, so "Akzo Nobel" lines up with a job ad's "AkzoNobel". */
function despace(key: string): string {
  return key.replace(/ /g, "");
}

export interface SponsorIndex {
  exact: Map<string, Sponsor>;
  despaced: Map<string, Sponsor>;
  keys: string[];
}

export function buildIndex(sponsors: Sponsor[]): SponsorIndex {
  const exact = new Map<string, Sponsor>();
  const despaced = new Map<string, Sponsor>();
  for (const s of sponsors) {
    const key = normaliseCompany(s.name);
    if (!key) continue;
    if (!exact.has(key)) exact.set(key, s);
    const flat = despace(key);
    if (!despaced.has(flat)) despaced.set(flat, s);
  }
  return { exact, despaced, keys: [...exact.keys()] };
}

/**
 * A run of words is "contained" when the shorter name's words appear,
 * in order and unbroken, anywhere inside the longer name's words — not only
 * at the start. Catches a legal-form prefix the shorter name never had
 * ("Rabobank" vs register "Coöperatieve Rabobank U.A.") as well as the
 * original "booking com" vs "booking com distribution" case.
 */
function wordsContained(shortWords: string[], longWords: string[]): boolean {
  for (let i = 0; i + shortWords.length <= longWords.length; i++) {
    if (shortWords.every((w, j) => longWords[i + j] === w)) return true;
  }
  return false;
}

/**
 * Exact on the normalised name (spaced or despaced), else a contained word
 * run either way. The contained run needs at least 5 characters on the
 * shorter side so "ing" does not claim every company starting "ing ...".
 * Non-exact matches are labelled "prefix" so the board can say "check this one".
 */
export function matchSponsor(company: string, index: SponsorIndex): SponsorMatch | null {
  const key = normaliseCompany(company);
  if (!key) return null;
  const hit = index.exact.get(key) ?? index.despaced.get(despace(key));
  if (hit) return { match: "exact", ...hit };
  const keyWords = key.split(" ");
  for (const k of index.keys) {
    const kWords = k.split(" ");
    const [shortWords, longWords] = kWords.length < keyWords.length ? [kWords, keyWords] : [keyWords, kWords];
    if (shortWords.join(" ").length < 5) continue;
    if (wordsContained(shortWords, longWords)) return { match: "prefix", ...index.exact.get(k)! };
  }
  return null;
}

export function readSponsors(): Sponsor[] {
  return readJson<Sponsor[]>(SPONSORS_PATH, []);
}

let cached: { mtime: number; index: SponsorIndex } | null = null;

/** The index over data/sponsors.json, rebuilt when the file changes. */
export function sponsorIndex(): SponsorIndex {
  const mtime = fs.statSync(SPONSORS_PATH, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  if (!cached || cached.mtime !== mtime) cached = { mtime, index: buildIndex(readSponsors()) };
  return cached.index;
}

export async function refreshSponsors(fetchPage: (url: string) => Promise<string>): Promise<number> {
  const sponsors = parseRegister(await fetchPage(REGISTER_URL));
  // A redesign that parses to a handful of rows must not wipe a good register.
  if (sponsors.length < 1000) throw new Error(`register parsed to only ${sponsors.length} rows — page layout changed?`);
  writeJson(SPONSORS_PATH, sponsors, 0o644);
  return sponsors.length;
}
