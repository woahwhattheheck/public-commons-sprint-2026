import { test } from "node:test";
import assert from "node:assert/strict";
import { importPacket } from "../src/core/packet.js";


test("rejects duplicate top-level packet fields", () => {
  assert.throws(
    () => importPacket('{"title":"first","title":"second","items":[]}'),
    /duplicate-json-key:"title"/,
  );
});


test("rejects decoded-equivalent duplicate nested item fields", () => {
  assert.throws(
    () => importPacket('{"items":[{"name":"safe.txt","n\\u0061me":"different.txt"}]}'),
    /duplicate-json-key:"name"/,
  );
});


test("rejects duplicate keys inside unknown metadata objects", () => {
  assert.throws(
    () => importPacket('{"unknown":{"source":"first","source":"second"},"items":[]}'),
    /duplicate-json-key:"source"/,
  );
});


test("duplicate-looking text inside string values remains inert", () => {
  const packet = importPacket('{"title":"{\\"title\\":1,\\"title\\":2}","items":[]}');
  assert.equal(packet.title, '{"title":1,"title":2}');
});


test("valid JSON string imports preserve Unicode and unknown fields", () => {
  const packet = importPacket(JSON.stringify({
    title: "café — 東京",
    extraNested: { source: "community" },
    items: [{ name: "évidence.txt", bytes: 4, sha256: "abc" }],
  }));

  assert.equal(packet.title, "café — 東京");
  assert.deepEqual(packet.unknown.extraNested, { source: "community" });
  assert.equal(packet.items[0].name, "évidence.txt");
  assert.equal(packet.items[0].bytes, 4);
});


test("object imports retain their existing non-string behavior", () => {
  const packet = importPacket({ title: "object input", items: [] });
  assert.equal(packet.title, "object input");
});
