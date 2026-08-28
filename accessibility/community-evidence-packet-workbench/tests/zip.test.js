import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStoreZip, zipHasMagic, crc32 } from "../src/core/zip.js";
import { utf8Bytes } from "../src/core/hash.js";

test("STORE zip starts with PK magic", () => {
  const zip = buildStoreZip([{ path: "hello.txt", bytes: utf8Bytes("hello") }]);
  assert.equal(zipHasMagic(zip), true);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
});

test("ZIP-slip paths are refused at write time", () => {
  assert.throws(
    () => buildStoreZip([{ path: "../escape.txt", bytes: utf8Bytes("no") }]),
    /unsafe-archive-path/,
  );
});

test("colliding paths are refused", () => {
  assert.throws(
    () =>
      buildStoreZip([
        { path: "a/x.txt", bytes: utf8Bytes("1") },
        { path: "A/X.txt", bytes: utf8Bytes("2") },
      ]),
    /zip-collision/,
  );
});

test("empty archive is still a valid ZIP container", () => {
  const zip = buildStoreZip([]);
  assert.equal(zipHasMagic(zip), true);
  assert.ok(zip.length >= 22);
});

test("known CRC32 of 123456789", () => {
  assert.equal(crc32(utf8Bytes("123456789")), 0xcbf43926);
});
