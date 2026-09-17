import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractError,
  collisionKey,
  normalizeDomain,
  normalizeText,
  validateIdentifier,
} from "../lib/core.mjs";

const base = {
  org: "Northstar Labs",
  domain: "northstar.example",
  purpose: "Initial Outreach",
  opportunity: "Builder Fest",
};

test("route-independent lane identity normalizes text with Unicode casefold", () => {
  const a = collisionKey({ ...base, org: "Straße Labs" });
  const b = collisionKey({ ...base, org: "STRASSE LABS" });
  assert.equal(a, b);
  assert.equal(normalizeText("  STRAẞE   LABS ", "org"), "strasse labs");
});

test("domain normalization strips URL surface and uses IDNA2003-compatible transitional mapping", () => {
  assert.equal(normalizeDomain("HTTPS://WWW.NORTHSTAR.EXAMPLE./ignored?q=1"), "northstar.example");
  assert.equal(normalizeDomain("faß.example"), normalizeDomain("fass.example"));
  assert.throws(() => normalizeDomain("https://user@northstar.example"), /credentials forbidden/);
  assert.throws(() => normalizeDomain("northstar.example:443"), /port forbidden/);
});

test("strict retained identifiers reject category-C and Default_Ignorable seams", () => {
  for (const [value, pattern] of [
    ["\u200b", /non-visible Unicode/],
    ["event-1\u034f", /Default_Ignorable/],
    ["provider-1\ufe0f", /Default_Ignorable/],
    ["human-1\u115f", /Default_Ignorable/],
    ["\u0301", /visible base/],
    [" padded", /trimmed nonempty/],
  ]) {
    assert.throws(() => validateIdentifier(value, "identifier"), pattern);
  }
  assert.equal(validateIdentifier("provider-cafe\u0301-001", "identifier"), "provider-cafe\u0301-001");
});

test("collision identity ignores route but includes opportunity lane", () => {
  const a = collisionKey({ ...base, route: "email:sales@northstar.example" });
  const b = collisionKey({ ...base, route: "email:founder@northstar.example" });
  const c = collisionKey({ ...base, opportunity: "Different Opportunity" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("invalid identifier types fail closed", () => {
  assert.throws(() => validateIdentifier(true, "event id"), ContractError);
  assert.throws(() => validateIdentifier("", "event id"), ContractError);
});
