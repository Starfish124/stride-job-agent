import "./helpers.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { cvText, docxXmlToText } from "../lib/cvtext.ts";

test("reads a .docx into text, paragraphs on their own lines", () => {
  const bytes = fs.readFileSync(new URL("./fixtures/cv.docx", import.meta.url));
  const text = cvText("Anna CV.docx", bytes);
  assert.match(text, /^Anna de Vries\tAmsterdam\nFront Office Manager, Hotel Okura & Spa$/);
});

test("plain text passes through; anything unreadable says to paste", () => {
  assert.equal(cvText("cv.txt", Buffer.from("  hello\n")), "hello");
  assert.throws(() => cvText("cv.pages", Buffer.from("x")), /paste the text instead/);
  assert.throws(() => cvText("cv.docx", Buffer.from("not a zip")), /paste the text instead/);
});

test("docx xml: tabs, breaks and entities", () => {
  assert.equal(docxXmlToText("<w:p><w:t>a</w:t><w:tab/><w:t>b&amp;c</w:t><w:br/><w:t>d</w:t></w:p>"), "a\tb&c\nd");
});
