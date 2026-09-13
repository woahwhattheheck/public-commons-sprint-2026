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

test("rejects fetch primitive references that can be invoked indirectly", () => {
  const samples = [
    'const fn = fetch; fn("https://example.invalid/a");',
    'const fn = globalThis["fetch"]; fn("https://example.invalid/a");',
    'fetch.call(globalThis, "https://example.invalid/a");',
    'window.fetch.bind(window)("https://example.invalid/a");',
    'const { fetch: request } = globalThis; request("https://example.invalid/a");',
  ];

  for (const source of samples) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("allows inert fetch text inside quoted strings and comments", () => {
  const samples = [
    'const name = "fetch";',
    'const note = "fetch(https://example.invalid/a)";',
    '// fetch is only documentation here\nconst value = 1;',
    '/* fetch.call(...) is discussed here */ const value = 1;',
  ];

  for (const source of samples) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
