import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPacket, importPacket, makeTextItem } from "../src/core/packet.js";
import {
  exportHtml,
  exportMarkdown,
  exportJson,
  exportCsv,
  exportFilesZip,
  exportRoCrateZip,
  exportBagItZip,
  roCrateMetadata,
  bagitText,
  RO_CRATE_CONTEXT,
} from "../src/core/export.js";
import { zipHasMagic } from "../src/core/zip.js";

function decoder(bytes) {
  return new TextDecoder().decode(bytes);
}

test("empty HTML/Markdown/JSON/CSV exports are labeled, not refused", () => {
  const p = emptyPacket();
  const html = exportHtml(p);
  const md = exportMarkdown(p);
  const json = exportJson(p);
  const csv = exportCsv(p);
  assert.match(html, /empty/);
  assert.match(md, /empty/i);
  assert.match(json, /community-evidence-packet\/v1/);
  assert.match(csv, /no items|empty/i);
});

test("HTML export escapes hostile captions", () => {
  const p = importPacket({
    title: "T",
    items: [{ name: "n", caption: `<img src=x onerror=alert(1)>`, sha256: "aa" }],
  });
  const html = exportHtml(p);
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /\u0026lt;img src=x/);
});

test("incomplete markdown still exports", () => {
  const p = emptyPacket();
  p.title = "Half";
  const md = exportMarkdown(p);
  assert.match(md, /incomplete/i);
  assert.match(md, /Half/);
});

test("RO-Crate 1.2 context is a recorded IRI string", () => {
  const p = emptyPacket();
  const crate = roCrateMetadata(p, []);
  assert.equal(crate["@context"], RO_CRATE_CONTEXT);
  assert.equal(RO_CRATE_CONTEXT, "https://w3id.org/ro/crate/1.2/context");
});

test("BagIt text uses RFC 8493 version line", () => {
  assert.match(bagitText(), /BagIt-Version: 1\.0/);
  assert.match(bagitText(), /Tag-File-Character-Encoding: UTF-8/);
});

test("empty zip / crate / bagit still build PK containers", async () => {
  const p = emptyPacket();
  const zip = await exportFilesZip(p);
  const crate = await exportRoCrateZip(p);
  const bag = await exportBagItZip(p);
  assert.equal(zipHasMagic(zip), true);
  assert.equal(zipHasMagic(crate), true);
  assert.equal(zipHasMagic(bag), true);
  assert.ok(decoder(bag).includes("bagit.txt") || bag.length > 30);
});

test("bagit zip contains bagit.txt and manifest-sha256.txt names", async () => {
  const p = emptyPacket();
  p.items = [await makeTextItem("notes.txt", "hello from the table", "testimony")];
  const bag = await exportBagItZip(p);
  const asText = decoder(bag);
  assert.match(asText, /bagit\.txt/);
  assert.match(asText, /manifest-sha256\.txt/);
  assert.match(asText, /notes\.txt/);
});

test("ro-crate zip contains metadata filename", async () => {
  const p = emptyPacket();
  p.items = [await makeTextItem("notes.txt", "hello", "testimony")];
  const crate = await exportRoCrateZip(p);
  assert.match(decoder(crate), /ro-crate-metadata\.json/);
});
