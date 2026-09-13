import { test } from "node:test";
import assert from "node:assert/strict";
import { networkRisks, assertNoRuntimeNetwork } from "../src/core/network.js";

test("image-map area ping remote endpoints are rejected", () => {
  const remote = [
    '<map name="m"><area href="/local" ping="https://example.invalid/audit"></map>',
    '<area href=/local ping=//example.invalid/audit>',
    '<area href=/local ping="h&#116;tps://example.invalid/audit">',
    '<area href=/local ping="/&#9;/example.invalid/audit">',
  ];
  for (const source of remote) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("local image-map area links and ping endpoints remain allowed", () => {
  const local = [
    '<map name="m"><area href="/local" ping="/audit"></map>',
    '<area href="./local.html" ping="./audit /audit-2">',
  ];
  for (const source of local) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
