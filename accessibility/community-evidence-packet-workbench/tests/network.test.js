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

test("passive browser fetch surfaces are rejected", () => {
  const samples = [
    '<img src="https://example.invalid/pixel.png">',
    '<iframe src=//example.invalid/frame></iframe>',
    '<audio src="https://example.invalid/audio.mp3"></audio>',
    '<video poster="//example.invalid/poster.jpg"></video>',
    '<source srcset="local.png 1x, https://example.invalid/remote.png 2x">',
    '<img srcset=https://example.invalid/remote.png>',
    '<object data="https://example.invalid/object.bin"></object>',
    '<form action="//example.invalid/submit"></form>',
    '<button formaction="https://example.invalid/submit">send</button>',
    '<base href="https://example.invalid/assets/">',
    '<meta content="0; url=https://example.invalid/next" http-equiv="refresh">',
    '<meta http-equiv="refresh" content="0; url=\'https://example.invalid/next\'">',
    '<svg><image href="https://example.invalid/image.svg"></image></svg>',
    '<svg><use xlink:href="//example.invalid/sprite.svg#icon"></use></svg>',
    '<body background="//example.invalid/bg.png">',
    '<a href="/local" ping="https://example.invalid/audit">local</a>',
    '<style>@import "https://example.invalid/theme.css";</style>',
    '<div style="background:url(//example.invalid/bg.png)"></div>',
    '<script src="//example.invalid/app.js"></script>',
    '<link rel="stylesheet" href="//example.invalid/app.css">',
  ];
  for (const source of samples) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("inert and local URL text remains allowed", () => {
  const samples = [
    'const evidenceUrl = "https://example.invalid/source";',
    '{"@context":"https://schema.org"}',
    'Source citation: https://example.invalid/report',
    '<img src="./local.png">',
    '<form action="/local-submit"></form>',
    '<a href="https://example.invalid/citation">citation</a>',
  ];
  for (const source of samples) {
    assert.deepEqual(networkRisks(source), [], source);
  }
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
