import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  zipSlipReason,
  isSafeArchivePath,
  assertSafeArchivePath,
  findCollisions,
} from "../src/core/paths.js";

test("normalizes backslashes and dots", () => {
  assert.equal(normalizePath("a\\b\\c.txt"), "a/b/c.txt");
  assert.equal(normalizePath("./notes/x.md"), "notes/x.md");
  assert.equal(normalizePath("a//b"), "a/b");
});

test("rejects ZIP-slip parent segments", () => {
  assert.equal(zipSlipReason("../secret"), "parent-segment");
  assert.equal(zipSlipReason("ok/../../etc/passwd"), "parent-segment");
  assert.equal(isSafeArchivePath("../secret"), false);
});

test("rejects absolute paths", () => {
  assert.equal(zipSlipReason("/etc/passwd"), "absolute-path");
  assert.equal(zipSlipReason("C:\\Windows\\x"), "absolute-path");
});

test("rejects empty and nul paths", () => {
  assert.equal(zipSlipReason(""), "empty-path");
  assert.equal(zipSlipReason("a\0b"), "nul-byte");
});

test("accepts ordinary relative names", () => {
  assert.equal(zipSlipReason("evidence/photo-1.jpg"), null);
  assert.equal(assertSafeArchivePath("evidence/photo-1.jpg"), "evidence/photo-1.jpg");
});

test("detects case-insensitive collisions", () => {
  const hits = findCollisions(["Data/A.txt", "data/a.txt"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "data/a.txt");
});
