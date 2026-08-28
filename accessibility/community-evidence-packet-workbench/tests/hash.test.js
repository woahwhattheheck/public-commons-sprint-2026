import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, utf8Bytes, BYTE_IDENTITY_NOTICE } from "../src/core/hash.js";

test("SHA-256 of empty bytes is the published empty digest", async () => {
  const hex = await sha256Hex(utf8Bytes(""));
  assert.equal(hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("SHA-256 of abc matches FIPS 180-4 example", async () => {
  const hex = await sha256Hex(utf8Bytes("abc"));
  assert.equal(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("byte-identity language refuses authenticity claims", () => {
  assert.match(BYTE_IDENTITY_NOTICE, /Local byte identity only/);
  assert.match(BYTE_IDENTITY_NOTICE, /not authenticity/i);
  assert.match(BYTE_IDENTITY_NOTICE, /not legal proof/i);
  assert.doesNotMatch(BYTE_IDENTITY_NOTICE, /this (is|proves) authentic/i);
});
