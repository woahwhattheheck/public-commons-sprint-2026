import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPacket,
  importPacket,
  packetToJsonObject,
  isEmptyPacket,
  missingFields,
  advisoryNotices,
  makeTextItem,
  ADVISORY_MAX_FILES,
} from "../src/core/packet.js";

test("empty packet is labeled empty and still serializes", () => {
  const p = emptyPacket();
  assert.equal(isEmptyPacket(p), true);
  assert.ok(missingFields(p).includes("title"));
  const obj = packetToJsonObject(p);
  assert.equal(obj.schema, "community-evidence-packet/v1");
  assert.equal(Array.isArray(obj.items), true);
});

test("unknown packet fields are preserved on round-trip", () => {
  const p = importPacket({
    schema: "community-evidence-packet/v1",
    title: "Hearing notes",
    extraCensusTract: "184-02",
    items: [],
  });
  assert.equal(p.unknown.extraCensusTract, "184-02");
  const out = packetToJsonObject(p);
  assert.equal(out.extraCensusTract, "184-02");
  assert.equal(out.title, "Hearing notes");
});

test("unknown item fields are preserved", () => {
  const p = importPacket({
    items: [{ name: "a.txt", role: "document", recorderBadge: "door-4", sha256: "abc" }],
  });
  assert.equal(p.items[0].unknown.recorderBadge, "door-4");
  const out = packetToJsonObject(p);
  assert.equal(out.items[0].recorderBadge, "door-4");
});

test("incomplete packets get INCOMPLETE notice and do not block", () => {
  const p = emptyPacket();
  p.title = "Only a title";
  const notices = advisoryNotices(p);
  assert.ok(notices.some((n) => n.code === "INCOMPLETE"));
  assert.equal(
    notices.every((n) => /still available|intentional/i.test(n.text) || n.code === "INCOMPLETE"),
    true,
  );
});

test("advisory file-count notice does not throw", () => {
  const p = emptyPacket();
  p.items = Array.from({ length: ADVISORY_MAX_FILES + 1 }, (_, i) => ({
    id: "i" + i,
    name: "f" + i,
    path: "f" + i,
    role: "other",
    mediaType: "text/plain",
    bytes: 1,
    sha256: "x",
    caption: "",
    collectedAt: "",
    provenance: "",
    waczOpaque: false,
    recognizedAs: "file",
    note: "",
    unknown: {},
    textContent: "",
  }));
  const notices = advisoryNotices(p);
  assert.ok(notices.some((n) => n.code === "COUNT"));
});

test("session byte buffers are not serialized into JSON", async () => {
  const p = emptyPacket();
  p.items = [await makeTextItem("notes.txt", "hello", "testimony")];
  assert.ok(p.items[0]._bytes instanceof Uint8Array);
  const out = packetToJsonObject(p);
  assert.equal(Object.prototype.hasOwnProperty.call(out.items[0], "_bytes"), false);
});
