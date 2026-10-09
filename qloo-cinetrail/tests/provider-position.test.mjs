import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEntities, buildPlan } from "../server.mjs";

test("original Qloo positions survive filtered rows and duplicate entity IDs", () => {
  const entities = normalizeEntities({ results: { entities: [
    { entity_id: "", name: "Malformed upstream entry" },
    { entity_id: "PLACE-A", name: "A" },
    { entity_id: "PLACE-A", name: "A repeated" },
    null,
    { entity_id: "PLACE-B", name: "B" },
  ] } }, "insights");
  const plan = buildPlan({
    movie: "Example movie", locality: "Example city", mood: "curious",
    seed: { name: "Example movie", entity_id: "MOV-1" },
    places: entities, mode: "live",
  });
  assert.deepEqual(plan.stops.map(p => [p.qloo_entity_id, p.qloo_rank]),
    [["PLACE-A", 2], ["PLACE-B", 5]]);
  assert.match(plan.stops[1].reasoning, /source result position #5/);
  assert.match(plan.stops[1].reasoning, /not an affinity score/);
  assert.equal(plan.stops.length, 2);
});
