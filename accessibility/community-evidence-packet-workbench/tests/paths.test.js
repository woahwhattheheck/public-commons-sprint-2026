import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePath,
  zipSlipReason,
  isSafeArchivePath,
  assertSafeArchivePath,
  collisionKey,
  findCollisions,
  uniqueArchivePath,
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

test("detects canonically equivalent Unicode collisions", () => {
  const hits = findCollisions(["data/é.txt", "data/e\u0301.txt"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, "data/é.txt");
});

test("dedupes canonically equivalent Unicode paths without rewriting names", () => {
  const used = new Set([collisionKey("data/é.txt")]);
  assert.equal(uniqueArchivePath("data/e\u0301.txt", used), "data/e\u0301-2.txt");
});

test("rejects Windows trailing dot and space aliases", () => {
  assert.equal(zipSlipReason("evidence/report.txt."), "windows-trailing-dot-space");
  assert.equal(zipSlipReason("evidence/report.txt "), "windows-trailing-dot-space");
  assert.equal(zipSlipReason("evidence /report.txt"), "windows-trailing-dot-space");
});

test("rejects Windows reserved device names and characters", () => {
  for (const path of ["NUL", "evidence/nul.txt", "COM1.json", "dir/LPT³.log"]) {
    assert.equal(zipSlipReason(path), "windows-device-name", path);
  }
  for (const path of ["evidence/a?.txt", "evidence/a:b.txt", "evidence/a*.txt", "evidence/a\u0001b.txt"]) {
    assert.equal(zipSlipReason(path), "windows-reserved-character", path);
  }
});

test("preserves ordinary dotfiles and similar non-device names", () => {
  assert.equal(zipSlipReason("evidence/.env"), null);
  assert.equal(zipSlipReason("evidence/COM10.txt"), null);
  assert.equal(zipSlipReason("evidence/com1x.txt"), null);
});
