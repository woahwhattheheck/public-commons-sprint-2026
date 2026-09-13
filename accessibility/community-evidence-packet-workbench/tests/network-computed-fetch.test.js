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
    'globalThis["fe" + "tch"]("https://example.invalid/a")',
    'window["f" + "etch"].call(window, "https://example.invalid/a")',
    'self[getNetworkPrimitive()]?.("https://example.invalid/a")',
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
    'f\\u0065tch("https://example.invalid/a")',
    '\\u0066etch("https://example.invalid/a")',
    'f\\u{65}tch("https://example.invalid/a")',
    '<script>const fn = fetch; fn("https://example.invalid/a")</script>',
    '<button onclick="const fn=fetch;fn(\'https://example.invalid/a\')">go</button>',
    '<a href="javascript:const fn=globalThis[\'fetch\'];fn(\'https://example.invalid/a\')">go</a>',
  ];

  for (const source of samples) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("allows inert fetch text inside quoted strings, comments, and page copy", () => {
  const samples = [
    'const name = "fetch";',
    'const note = "fetch(https://example.invalid/a)";',
    'const note = \'globalThis["fetch"]\';',
    'const note = "f\\u0065tch";',
    '// fetch is only documentation here\nconst value = 1;',
    '/* fetch.call(...) is discussed here */ const value = 1;',
    '<p>fetch is a browser API name, not an invocation.</p>',
    '<script>const note = "fetch(https://example.invalid/a)";</script>',
    '<script>const note = \'globalThis["fetch"]\';</script>',
  ];

  for (const source of samples) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
