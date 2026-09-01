import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { networkRisks, assertNoRuntimeNetwork } from "../src/core/network.js";
import { RO_CRATE_CONTEXT } from "../src/core/export.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("core modules do not call fetch or XHR", () => {
  const files = [
    "src/core/hash.js",
    "src/core/escape.js",
    "src/core/paths.js",
    "src/core/zip.js",
    "src/core/wacz.js",
    "src/core/packet.js",
    "src/core/export.js",
    "src/ui/app.js",
    "src/ui/index.html",
    "src/ui/app.css",
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    const hits = networkRisks(src).filter((h) => !h.includes("https?:"));
    assert.deepEqual(hits, [], rel);
  }
});

test("RO-Crate context IRI is a string constant, not a fetch", () => {
  assert.equal(typeof RO_CRATE_CONTEXT, "string");
  assert.equal(networkRisks('const x = "' + RO_CRATE_CONTEXT + '"').length, 0);
});

test("built dist/index.html has no runtime network patterns when present", () => {
  let html;
  try {
    html = readFileSync(join(root, "dist/index.html"), "utf8");
  } catch {
    html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  }
  assertNoRuntimeNetwork(html);
  assert.equal(html.includes("<script src=\"http"), false);
});

test("built dist does not leak inlined script as page text", () => {
  let html;
  try {
    html = readFileSync(join(root, "dist/index.html"), "utf8");
  } catch {
    return;
  }
  const closes = html.match(/<\/script>/gi) || [];
  assert.equal(closes.length, 1);
  assert.equal(html.includes('src="app.js"></script>'), false);
  assert.match(html, /\\\$&/);
});
