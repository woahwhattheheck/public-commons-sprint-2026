import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, csvCell, csvRow, escapeMarkdown } from "../src/core/escape.js";

test("HTML escaping stops markup injection", () => {
  const s = escapeHtml(`<script>alert("x")</script> & 'y'`);
  assert.equal(s.includes("<script>"), false);
  assert.equal(s.includes("<"), false);
  assert.equal(s.includes(">"), false);
  assert.match(s, /amp;/);
  assert.match(s, /lt;/);
  assert.match(s, /gt;/);
  assert.match(s, /quot;/);
});

test("CSV formula cells are neutralized", () => {
  assert.equal(csvCell("=cmd|'/c calc'!A0").startsWith("'"), true);
  assert.equal(csvCell("+1+1").startsWith("'"), true);
  assert.equal(csvCell("-1+1").startsWith("'"), true);
  assert.equal(csvCell("@SUM(A1)").startsWith("'"), true);
});

test("CSV quotes commas", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvRow(["a", "b,c"]), 'a,"b,c"');
});

test("markdown specials are escaped", () => {
  assert.equal(escapeMarkdown("a*b").includes("\\*"), true);
});
