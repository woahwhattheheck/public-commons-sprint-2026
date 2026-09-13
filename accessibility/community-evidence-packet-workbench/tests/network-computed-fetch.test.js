import { test } from "node:test";
import assert from "node:assert/strict";
import {
  networkRisks,
  assertNoRuntimeNetwork,
} from "../src/core/network.js";

test("rejects direct optional and computed global fetch calls", () => {
  const samples = [
    'fetch?.("https://example.invalid/a")',
    'globalThis["fetch"]("https://example.invalid/a")',
    "window['fetch']?.('//example.invalid/a')",
    'self [ "fetch" ] ("https://example.invalid/a")',
  ];

  for (const source of samples) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("allows inert fetch references that do not invoke the API", () => {
  const samples = [
    'const name = "fetch";',
    'const member = globalThis["fetch"];',
    "const fn = fetch;",
  ];

  for (const source of samples) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
