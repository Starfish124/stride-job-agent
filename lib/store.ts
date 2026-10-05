// File-based JSON store.
// Everything lives under ./data (gitignored). Atomic writes via tmp + rename.

import fs from "node:fs";
import path from "node:path";

/** JOB_AGENT_DATA exists for the tests; everything else uses ./data. */
export const DATA_DIR = process.env.JOB_AGENT_DATA ?? path.join(process.cwd(), "data");

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Default 0600: these files hold CVs, contact details and API keys. */
export function writeJson(file: string, value: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode });
  fs.renameSync(tmp, file);
}
