import { test } from "node:test";
import assert from "node:assert/strict";
import { networkRisks, assertNoRuntimeNetwork } from "../src/core/network.js";

test("quoted angle brackets do not hide later passive remote URLs", () => {
  const samples = [
    '<img title="> quoted angle" src="https://example.invalid/after-angle.png">',
    "<a title='> quoted angle' href=/local ping=https://example.invalid/after-angle>local</a>",
    '<meta title="> quoted angle" http-equiv=refresh content=0;url=https://example.invalid/after-angle>',
  ];
  for (const source of samples) {
    assert.throws(
      () => assertNoRuntimeNetwork(source),
      /runtime-network-pattern/,
      source,
    );
  }
});

test("quoted angle brackets preserve local passive URL controls", () => {
  const samples = [
    '<img title="> quoted angle" src="./local.png">',
    '<a title="> quoted angle" href=/local ping=/local-audit>local</a>',
    '<meta title="> quoted angle" http-equiv=refresh content=0;url=/local-next>',
  ];
  for (const source of samples) {
    assert.deepEqual(networkRisks(source), [], source);
  }
});
