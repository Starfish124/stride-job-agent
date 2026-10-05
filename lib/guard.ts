// There is no login, so the browser is the way in: any page you visit can
// POST a form to 127.0.0.1, or reach this server through a DNS name it
// re-points at 127.0.0.1. Either could switch on auto-apply, or point the AI
// provider at a server that then receives every CV. Only a loopback Host (or
// the PUBLIC_URL host) and same-origin POSTs get through.

import type { IncomingHttpHeaders } from "node:http";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

/** Why this request is refused, or null when it may proceed. */
export function refuse(method: string | undefined, h: IncomingHttpHeaders, publicUrl = process.env.PUBLIC_URL): string | null {
  const host = h.host ?? "";
  const extra = publicUrl ? hostname(new URL(publicUrl).host) : "";
  if (!LOOPBACK.has(hostname(host)) && hostname(host) !== extra) return `host ${host || "(none)"} is not allowed; set PUBLIC_URL to serve under another name`;
  if (method !== "POST") return null;
  if (h["sec-fetch-site"] === "cross-site") return "cross-site request";
  const origin = h.origin;
  // No Origin: not a browser form (curl, a script on this machine).
  if (origin && origin !== "null" && new URL(origin).host !== host) return `origin ${origin} is not this app`;
  if (origin === "null") return "opaque origin";
  return null;
}
