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

test("malformed ZIP entry byte payloads fail closed instead of coercing", () => {
  for (const bytes of ["abc", { 0: 65, length: 1 }, [65, 66], null, undefined]) {
    assert.throws(
      () => buildStoreZip([{ path: "bad.bin", bytes }]),
      (err) => {
        assert.equal(err.code, "ZIP_ENTRY_BYTES");
        assert.equal(err.path, "bad.bin");
        return true;
      },
    );
  }
});

test("ArrayBuffer entry bytes retain their exact payload", () => {
  const bytes = new Uint8Array([0, 127, 255]).buffer;
  const zip = buildStoreZip([{ path: "bytes.bin", bytes }]);
  const nameLength = zip[26] | (zip[27] << 8);
  const payloadStart = 30 + nameLength;
  assert.deepEqual(Array.from(zip.slice(payloadStart, payloadStart + 3)), [0, 127, 255]);
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

test("classic ZIP entry count is bounded before per-entry processing", () => {
  const tooMany = new Array(65536);
  assert.throws(
    () => buildStoreZip(tooMany),
    (err) => {
      assert.equal(err.code, "ZIP_CLASSIC_LIMIT");
      assert.equal(err.limit, "entry-count");
      assert.equal(err.maximum, 65535);
      assert.equal(err.actual, 65536);
      return true;
    },
  );

  const zip = buildStoreZip([
    { path: "one.txt", bytes: new Uint8Array() },
    { path: "two.txt", bytes: new Uint8Array() },
  ]);
  const eocd = zip.length - 22;
  assert.equal(zip[eocd + 8] | (zip[eocd + 9] << 8), 2);
  assert.equal(zip[eocd + 10] | (zip[eocd + 11] << 8), 2);
});

test("classic ZIP rejects entry sizes that cannot fit unsigned 32-bit fields", () => {
  const bytes = new Uint8Array();
  let exposedOversize = false;
  Object.defineProperty(bytes, "length", {
    configurable: true,
    get() {
      // On the vulnerable implementation crc32() is the first reader. Keep
      // that zero-cost, then expose a 2^32 logical size to the framing path.
      // The repaired implementation rejects that logical size before CRC.
      if ((new Error().stack || "").includes("crc32")) return 0;
      if (!exposedOversize) {
        exposedOversize = true;
        return 0x100000000;
      }
      return 0;
    },
  });

  assert.throws(
    () => buildStoreZip([{ path: "oversize.bin", bytes }]),
    (err) => {
      assert.equal(err.code, "ZIP_CLASSIC_LIMIT");
      assert.equal(err.limit, "entry-size");
      assert.equal(err.maximum, 0xffffffff);
      assert.equal(err.actual, 0x100000000);
      return true;
    },
  );
});
