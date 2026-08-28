import { test } from "node:test";
import assert from "node:assert/strict";
import { isWaczFilename, recognizeAttachment, WACZ_POLICY } from "../src/core/wacz.js";
import { importPacket } from "../src/core/packet.js";

test("WACZ suffix is recognized as opaque, not unpacked", () => {
  assert.equal(isWaczFilename("hearing-2026.wacz"), true);
  const rec = recognizeAttachment("hearing-2026.wacz", "application/zip");
  assert.equal(rec.kind, "wacz-attachment");
  assert.equal(rec.recognizedAs, "wacz-opaque");
  assert.match(rec.note, /does not open, validate, replay/);
});

test("ordinary files are not treated as WACZ", () => {
  const rec = recognizeAttachment("minutes.pdf", "application/pdf");
  assert.equal(rec.kind, "file");
  assert.equal(rec.recognizedAs, "file");
});

test("imported wacz item stays opaque", () => {
  const p = importPacket({
    items: [{ name: "city.wacz", mediaType: "application/x-wacz", sha256: "00" }],
  });
  assert.equal(p.items[0].waczOpaque, true);
  assert.equal(p.items[0].role, "wacz");
  assert.match(WACZ_POLICY, /opaque/);
});
