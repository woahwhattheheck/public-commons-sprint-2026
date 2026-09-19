import assert from "node:assert/strict";
import test from "node:test";
import { parseLaneRegistry } from "../lib/lane-registry.mjs";

test("server lane registry retains canonical ids and returns defensive copies", () => {
  const registry = parseLaneRegistry(JSON.stringify([
    { lane_id: "lane:northstar-builderfest" },
    { lane_id: "lane:other-opportunity" },
  ]));
  assert.equal(registry.requireKnown("lane:northstar-builderfest"), "lane:northstar-builderfest");
  const first = registry.list();
  first.push("lane:injected");
  assert.deepEqual(registry.list(), [
    "lane:northstar-builderfest",
    "lane:other-opportunity",
  ]);
  assert.throws(
    () => registry.requireKnown("lane:unknown"),
    /unknown lane_id; server registry binding required/,
  );
});

test("server lane registry rejects malformed duplicate or noncanonical configuration", () => {
  for (const raw of [
    "",
    "{}",
    "[]",
    JSON.stringify([{ lane_id: "Lane:Upper" }]),
    JSON.stringify([{ lane_id: "lane:a" }, { lane_id: "lane:a" }]),
    JSON.stringify([{ lane_id: "lane:a", mutable: true }]),
  ]) {
    assert.throws(() => parseLaneRegistry(raw), /server lane registry/);
  }
});
