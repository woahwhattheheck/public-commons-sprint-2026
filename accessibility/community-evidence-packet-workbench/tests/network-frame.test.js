import { test } from "node:test";
import assert from "node:assert/strict";
import { networkRisks, assertNoRuntimeNetwork } from "../src/core/network.js";

test("frameset frame src is treated as passive network egress", () => {
  const remote = [
    '<frameset><frame src="https://example.invalid/frame.html"></frameset>',
    '<frame src=//example.invalid/frame.html>',
    '<frame src="h&#116;tps://example.invalid/frame.html">',
    '<frame src="/&#9;/example.invalid/frame.html">',
  ];
  for (const source of remote) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("local frame src remains allowed", () => {
  const local = [
    '<frameset><frame src="./local.html"></frameset>',
    '<frame src="/local/frame.html">',
  ];
  for (const source of local) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
