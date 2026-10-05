// Company career boards with an open JSON API: Greenhouse, Lever, Recruitee.
// Structured, free, and they carry the full description, so a board job
// never needs a detail fetch. Which companies to read lives in
// data/boards.json — a list, because the sponsor register gives names but
// not where a company hosts its jobs.

import path from "node:path";
import { decode, text } from "../extract.ts";
import { DATA_DIR, readJson } from "../store.ts";
import type { Card } from "./linkedin.ts";

export type BoardKind = "greenhouse" | "lever" | "recruitee";

export interface Board {
  company: string;
  kind: BoardKind;
  slug: string;
}

export interface BoardJob extends Card {
  description: string;
  salary: string;
}

export const BOARDS_PATH = path.join(DATA_DIR, "boards.json");

export function readBoards(): Board[] {
  return readJson<Board[]>(BOARDS_PATH, []).filter((b) => b.company && b.slug && ["greenhouse", "lever", "recruitee"].includes(b.kind));
}

export function boardUrl(b: Board): string {
  switch (b.kind) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`;
    case "lever":
      return `https://api.lever.co/v0/postings/${b.slug}?mode=json`;
    case "recruitee":
      return `https://${b.slug}.recruitee.com/api/offers/`;
  }
}

const day = (v: unknown) => {
  const d = typeof v === "number" ? new Date(v) : new Date(String(v ?? "").replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

export function parseBoard(b: Board, raw: string): BoardJob[] {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const base = { company: b.company, postedAt: "", salary: "" };
  switch (b.kind) {
    case "greenhouse":
      return ((json.jobs as Record<string, unknown>[]) ?? []).map((j) => ({
        ...base,
        url: String(j.absolute_url ?? ""),
        title: String(j.title ?? "").trim(),
        location: String((j.location as Record<string, unknown> | undefined)?.name ?? "").trim(),
        // Greenhouse ships the HTML entity-escaped, so decode before stripping.
        description: text(decode(String(j.content ?? ""))),
        postedAt: day(j.updated_at),
      }));
    case "lever":
      return ((json as unknown as Record<string, unknown>[]) ?? []).map((j) => {
        const lists = ((j.lists as Record<string, unknown>[]) ?? [])
          .map((l) => `${l.text}\n${text(String(l.content ?? ""))}`)
          .join("\n");
        const s = j.salaryRange as Record<string, unknown> | undefined;
        const interval = String(s?.interval ?? "").includes("month") ? "per month" : String(s?.interval ?? "").includes("year") ? "per year" : "";
        return {
          ...base,
          url: String(j.hostedUrl ?? ""),
          title: String(j.text ?? "").trim(),
          location: String((j.categories as Record<string, unknown> | undefined)?.location ?? "").trim(),
          description: `${String(j.descriptionPlain ?? "")}\n${lists}`.trim(),
          postedAt: day(j.createdAt),
          salary: s?.min && s?.max ? `${s.min}-${s.max} ${s.currency ?? ""} ${interval}`.trim() : "",
        };
      });
    case "recruitee":
      return ((json.offers as Record<string, unknown>[]) ?? []).map((j) => ({
        ...base,
        url: String(j.careers_url ?? ""),
        title: String(j.title ?? "").trim(),
        location: String(j.location ?? "").trim(),
        description: text(String(j.description ?? "")),
        postedAt: day(j.published_at),
      }));
  }
}

export async function boardJobs(b: Board, fetchPage: (url: string) => Promise<string>): Promise<BoardJob[]> {
  return parseBoard(b, await fetchPage(boardUrl(b))).filter((j) => j.url && j.title);
}
