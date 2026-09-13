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

test("classic ZIP filename byte length is bounded before framing", () => {
  const boundary = "a".repeat(65531) + ".txt";
  const boundaryZip = buildStoreZip([{ path: boundary, bytes: new Uint8Array() }]);
  assert.equal(boundaryZip[26] | (boundaryZip[27] << 8), 65535);

  const overlong = "a".repeat(65532) + ".txt";
  assert.throws(
    () => buildStoreZip([{ path: overlong, bytes: new Uint8Array() }]),
    (err) => {
      assert.equal(err.code, "ZIP_CLASSIC_LIMIT");
      assert.equal(err.limit, "filename-bytes");
      assert.equal(err.maximum, 65535);
      assert.equal(err.actual, 65536);
      return true;
    },
  );

  const multibyte = "é".repeat(32766) + ".txt";
  assert.equal(multibyte.length, 32770);
  assert.equal(utf8Bytes(multibyte).length, 65536);
  assert.throws(
    () => buildStoreZip([{ path: multibyte, bytes: new Uint8Array() }]),
    (err) => err.code === "ZIP_CLASSIC_LIMIT" && err.actual === 65536,
  );
});
