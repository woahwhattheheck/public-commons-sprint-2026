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
