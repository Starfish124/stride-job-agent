// Text out of an uploaded CV. Shells out to `unzip` and `pdftotext` (poppler)
// rather than adding a dependency; the file is written to a tmp path for the
// tool and deleted straight after.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decode } from "./extract.ts";

const PASTE = "paste the text instead";

export function cvText(filename: string, bytes: Buffer): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".txt" || ext === ".md") return bytes.toString("utf8").trim();
  if (ext !== ".docx" && ext !== ".pdf") throw new Error(`${PASTE}: cannot read ${ext || "that file"}`);

  const tmp = path.join(os.tmpdir(), `cv-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(tmp, bytes, { mode: 0o600 });
  try {
    const run =
      ext === ".docx"
        ? spawnSync("unzip", ["-p", tmp, "word/document.xml"], { encoding: "utf8", maxBuffer: 50e6 })
        : spawnSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8", maxBuffer: 50e6 });
    if (run.error) throw new Error(`${PASTE}: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`${PASTE}: could not open the ${ext.slice(1)}`);
    const text = ext === ".docx" ? docxXmlToText(run.stdout) : run.stdout.replace(/\f/g, "\n").trim();
    if (text.replace(/\s/g, "").length < 40) throw new Error(`${PASTE}: no text found (a scanned PDF?)`);
    return text;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function docxXmlToText(xml: string): string {
  return decode(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
