import { test } from "node:test";
import assert from "node:assert/strict";
import { importPacketFile } from "../src/ui/import-file.js";

test("packet JSON file import returns a new parsed packet", async () => {
  const current = { sentinel: true };
  const file = { text: async () => JSON.stringify({ title: "Imported packet" }) };

  const result = await importPacketFile(file, current);

  assert.equal(result.ok, true);
  assert.notEqual(result.packet, current);
  assert.equal(result.packet.title, "Imported packet");
  assert.equal(result.message, "Packet JSON imported locally.");
});

test("malformed JSON fails closed to the existing packet", async () => {
  const current = { sentinel: true };
  const file = { text: async () => '{"title":' };

  const result = await importPacketFile(file, current);

  assert.equal(result.ok, false);
  assert.equal(result.packet, current);
  assert.match(result.message, /INVALID_JSON/);
});

test("non-object JSON fails closed to the existing packet", async () => {
  const current = { sentinel: true };
  const file = { text: async () => "[]" };

  const result = await importPacketFile(file, current);

  assert.equal(result.ok, false);
  assert.equal(result.packet, current);
  assert.match(result.message, /PACKET_MUST_BE_OBJECT/);
});

test("file read failures fail closed to the existing packet", async () => {
  const current = { sentinel: true };
  const file = { text: async () => { throw new Error("read-failed"); } };

  const result = await importPacketFile(file, current);

  assert.equal(result.ok, false);
  assert.equal(result.packet, current);
  assert.match(result.message, /PACKET_IMPORT_FAILED/);
});
