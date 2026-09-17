import assert from "node:assert/strict";
import test from "node:test";
import { collisionKey, normalizeText } from "../lib/core.mjs";

test("identity length is enforced after trim/collapse/casefold like the verifier", () => {
  const noisy = `Northstar${" ".repeat(400)}Labs`;
  assert.equal(normalizeText(noisy, "org"), "northstar labs");
  const a = collisionKey({ org: noisy, domain: "northstar.example", purpose: "Initial Outreach", opportunity: "Builder Fest" });
  const b = collisionKey({ org: "northstar labs", domain: "northstar.example", purpose: "initial outreach", opportunity: "builder fest" });
  assert.equal(a, b);
});

test("collision identity canonicalizes NFC before keying and rejects invisible aliases", () => {
  const composed = {
    org: "Café Labs",
    domain: "northstar.example",
    purpose: "Initial Outreach",
    opportunity: "Builder Fest",
  };
  const decomposed = { ...composed, org: "Cafe\u0301 Labs" };
  assert.equal(normalizeText(composed.org, "org"), "café labs");
  assert.equal(normalizeText(decomposed.org, "org"), "café labs");
  assert.equal(collisionKey(composed), collisionKey(decomposed));

  assert.throws(
    () => collisionKey({ ...composed, org: "North\u200bstar Labs" }),
    /category-C/,
  );
  assert.throws(
    () => collisionKey({ ...composed, org: "North\u034fstar Labs" }),
    /Default_Ignorable/,
  );
});
