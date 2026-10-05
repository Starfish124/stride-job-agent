// LinkedIn's public, logged-out jobs search (the endpoint its own "see more
// jobs" button calls). Read-only, no account, no cookies: nothing here can get
// anyone's LinkedIn restricted. Nothing is ever submitted through LinkedIn.

import { decode } from "../extract.ts";

export interface Card {
  url: string;
  title: string;
  company: string;
  location: string;
  postedAt: string;
}

export const PAGE_SIZE = 10;

/**
 * `window` is LinkedIn's f_TPR: r86400 = a day, r604800 = a week. The guest
 * endpoint answers a bare "Amsterdam" with nothing (measured 2026-09-10) but
 * "Amsterdam, Netherlands" in full, so a bare city gets the country added.
 */
export function searchUrl(keywords: string, location: string, page = 0, window = "r604800", country = ""): string {
  const bare = !location.includes(",") && country && location.trim().toLowerCase() !== country.trim().toLowerCase();
  const place = bare ? `${location}, ${country}` : location;
  const q = new URLSearchParams({ keywords, location: place, f_TPR: window, start: String(page * PAGE_SIZE) });
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${q}`;
}

/** The posting id from any LinkedIn job link: /jobs/view/<slug>-<id>, or ?currentJobId=<id>. */
export function linkedinJobId(url: string): string | null {
  if (!/linkedin\.com/i.test(url)) return null;
  return url.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/)?.[1] ?? url.match(/currentJobId=(\d{6,})/)?.[1] ?? null;
}

export function detailUrl(jobUrl: string): string | null {
  const id = linkedinJobId(jobUrl);
  return id ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}` : null;
}

const clean = (s: string | undefined) => decode((s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export function parseSearch(html: string): Card[] {
  const cards: Card[] = [];
  for (const li of html.split(/<li>/).slice(1)) {
    const id = li.match(/urn:li:jobPosting:(\d+)/)?.[1];
    if (!id) continue;
    cards.push({
      url: `https://www.linkedin.com/jobs/view/${id}`,
      title: clean(li.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/)?.[1]),
      company: clean(li.match(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/)?.[1]),
      location: clean(li.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/)?.[1]),
      postedAt: li.match(/<time[^>]*datetime="([\d-]+)"/)?.[1] ?? "",
    });
  }
  return cards;
}
