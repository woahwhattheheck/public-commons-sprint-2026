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
  bagInfo,
  bagManifest,
  RO_CRATE_CONTEXT,
} from "../src/core/export.js";
import { networkRisks } from "../src/core/network.js";
import { zipHasMagic } from "../src/core/zip.js";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

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

test("Markdown export neutralizes packet-controlled active markup", () => {
  const remote = `<img src=https://example.invalid/pixel>`;
  const p = importPacket({
    id: remote,
    title: remote,
    community: remote,
    collector: remote,
    statement: remote,
    location: remote,
    period: { start: remote, end: remote },
    items: [
      {
        id: "item-1",
        name: remote,
        path: "` ![probe](https://example.invalid/path)",
        role: "other",
        bytes: 1,
        sha256: "` ![probe](https://example.invalid/hash)",
        caption: remote,
        provenance: remote,
      },
    ],
  });
  const md = exportMarkdown(p);
  assert.equal(md.includes("<img"), false);
  assert.equal(md.includes("![probe]("), false);
  assert.match(md, /&lt;img/);
  assert.deepEqual(networkRisks(md), []);
});

test("metadata snapshots do not label imported hashes as session-verified bytes", () => {
  const p = importPacket({
    title: "Imported metadata",
    items: [{ name: "photo.jpg", bytes: 3, sha256: "a".repeat(64) }],
  });
  const html = exportHtml(p);
  const md = exportMarkdown(p);
  assert.match(html, /recorded metadata/i);
  assert.match(md, /recorded metadata/i);
  assert.equal(html.includes("exact bytes loaded in this session"), false);
  assert.equal(md.includes("exact bytes loaded in this session"), false);
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

test("BagIt bag-info rejects CR/LF tag injection from imported metadata", () => {
  for (const id of ["packet\nPayload-Oxum: 1.1", "packet\rPayload-Oxum: 1.1"]) {
    const p = importPacket({ id });
    assert.throws(
      () => bagInfo(p),
      (error) => error?.code === "BAGIT_TAG_VALUE" && error?.field === "External-Identifier",
    );
  }

  const p = importPacket({ id: "packet-safe" });
  p.updated = "2026\n09-12";
  assert.throws(
    () => bagInfo(p),
    (error) => error?.code === "BAGIT_TAG_VALUE" && error?.field === "Bagging-Date",
  );
});

test("BagIt bag-info preserves ordinary packet identifier and date", () => {
  const p = importPacket({ id: "packet-safe" });
  p.updated = "2026-09-12T20:00:00Z";
  const info = bagInfo(p);
  assert.match(info, /^Bagging-Date: 2026-09-12$/m);
  assert.match(info, /^External-Identifier: packet-safe$/m);
  assert.equal(info.includes("Payload-Oxum:"), false);
});

test("BagIt manifest paths remain relative to bag root under data", async () => {
  const manifest = await bagManifest([
    {
      path: "data/notes.txt",
      bytes: new TextEncoder().encode("hello"),
      item: { sha256: "a".repeat(64) },
    },
  ]);
  assert.equal(manifest, `${HELLO_SHA256}  data/notes.txt\n`);
});

test("BagIt manifest hashes actual bytes instead of imported checksum metadata", async () => {
  const manifest = await bagManifest([
    {
      path: "data/notes.txt",
      bytes: new TextEncoder().encode("hello"),
      item: { sha256: "0".repeat(64) },
    },
  ]);
  assert.equal(manifest, `${HELLO_SHA256}  data/notes.txt\n`);
  assert.equal(manifest.includes("0".repeat(64)), false);
});

test("BagIt manifest percent-encodes RFC 8493 special path characters", async () => {
  const manifest = await bagManifest([
    {
      path: "data/percent%/line\r\nbreak.txt",
      bytes: new Uint8Array(),
      item: { sha256: "b".repeat(64) },
    },
  ]);
  assert.equal(
    manifest,
    `${EMPTY_SHA256}  data/percent%25/line%0D%0Abreak.txt\n`,
  );
});

test("BagIt manifest rejects payload entries outside data", async () => {
  await assert.rejects(
    () =>
      bagManifest([
        {
          path: "notes.txt",
          bytes: new Uint8Array(),
          item: { sha256: "c".repeat(64) },
        },
      ]),
    (error) => error?.code === "BAGIT_PAYLOAD_PATH",
  );
});

test("package exports reject imported binary metadata without local payload bytes", async () => {
  const p = importPacket({
    title: "Imported packet",
    items: [
      {
        id: "photo-1",
        name: "photo.jpg",
        path: "photo.jpg",
        mediaType: "image/jpeg",
        bytes: 3,
        sha256: "a".repeat(64),
      },
    ],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(p.items[0], "textContent"), false);
  for (const exporter of [exportFilesZip, exportRoCrateZip, exportBagItZip]) {
    await assert.rejects(
      () => exporter(p),
      (error) => error?.code === "PAYLOAD_BYTES_UNAVAILABLE" && error?.itemId === "photo-1",
    );
  }
});

test("package exports re-hash reconstructible imported text and repair its metadata", async () => {
  const p = importPacket({
    title: "Imported text",
    items: [
      {
        id: "text-1",
        name: "notes.txt",
        path: "notes.txt",
        mediaType: "text/plain",
        bytes: 999,
        sha256: "0".repeat(64),
        textContent: "hello",
      },
    ],
  });

  const bag = decoder(await exportBagItZip(p));
  assert.match(bag, new RegExp(`${HELLO_SHA256}  data/notes\\.txt`));
  assert.equal(bag.includes(`${"0".repeat(64)}  data/notes.txt`), false);

  const filesZip = decoder(await exportFilesZip(p));
  assert.match(filesZip, new RegExp(HELLO_SHA256));
  assert.match(filesZip, /"bytes": 5/);
  assert.equal(filesZip.includes(`"sha256": "${"0".repeat(64)}"`), false);
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
  assert.match(asText, /data\/notes\.txt/);
});

test("ro-crate zip contains metadata filename", async () => {
  const p = emptyPacket();
  p.items = [await makeTextItem("notes.txt", "hello", "testimony")];
  const crate = await exportRoCrateZip(p);
  assert.match(decoder(crate), /ro-crate-metadata\.json/);
});
