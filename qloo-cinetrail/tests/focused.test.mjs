import test from "node:test";
import assert from "node:assert/strict";
import { producePlan, buildPlan, normalizeEntities, cleanInput, qlooGet } from "../server.mjs";

test("synthetic mode is explicitly non-real and handles input", async () => {
  const p = await producePlan({ movie:"Amelie", locality:"Louisville", mood:"cozy" }, { key:"" });
  assert.equal(p.mode, "synthetic");
  assert.equal(p.requested_movie, "Amelie");
  assert.equal(p.locality, "Louisville");
  assert.ok(p.evidence.includes("SYNTHETIC"));
  assert.equal(p.stops.length, 3);
  assert.ok(p.stops.every(s => s.qloo_entity_id.startsWith("SYNTHETIC")));
});

test("mock live Qloo path preserves exact IDs and honors locality", async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url:new URL(url), key:opts.headers["X-Api-Key"] });
    if (url.pathname === "/search") return new Response(JSON.stringify({
      results: { entities: [{name:"Amélie",entity_id:"MOV-1",subtype:"urn:entity:movie"}] }
    }), {status:200});
    return new Response(JSON.stringify({ success:true, results:{ entities: [
      {name:"Example Gallery",entity_id:"PLACE-1",tags:[{name:"Arts"}],properties:{description:"Example metadata"}},
      {name:"Example Gallery",entity_id:"PLACE-1"},
      {name:"Example Café",entity_id:"PLACE-2"},
    ] }}), {status:200});
  };
  const plan = await producePlan({ movie:"Amélie",locality:"New York",mood:"curious" },
    { fetcher, key:"fake-key",base:"https://api.hackathon.qloo.com" });
  assert.equal(plan.mode, "live");
  assert.equal(plan.resolved_movie_qloo_id, "MOV-1");
  assert.deepEqual(plan.stops.map(p => p.qloo_entity_id), ["PLACE-1","PLACE-2"]);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url.pathname,"/search");
  assert.equal(calls[1].url.searchParams.get("filter.location.query"),"New York");
  assert.equal(calls[1].url.searchParams.get("signal.interests.entities"),"MOV-1");
  assert.equal(calls[0].key,"fake-key");
  assert.ok(!JSON.stringify(plan).includes("fake-key"));
});

test("unexpected Qloo structures are rejected instead of pretending live evidence", () => {
  assert.throws(() => normalizeEntities({success:true, data:[]}, "insights"), /missing entity list/);
  assert.throws(() => cleanInput("bad\ninput", "Movie"), /printable/);
  const plan = buildPlan({ movie:"film",locality:"town",seed:null,places:[],mode:"live" });
  assert.deepEqual(plan.stops, []);
});

test("live Qloo requests target canonical hackathon origin without credential-carrying redirects", async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url: new URL(url), redirect: opts.redirect, key: opts.headers["X-Api-Key"] });
    return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
  };
  await qlooGet("/search", { query: "Amelie", types: "urn:entity:movie" },
    { key: "synthetic-test-only", fetcher });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://hackathon.api.qloo.com");
  assert.equal(calls[0].url.pathname, "/search");
  assert.equal(calls[0].redirect, "error");
  assert.equal(calls[0].key, "synthetic-test-only");
  assert.equal(new URL("/v2/insights", calls[0].url.origin).pathname, "/v2/insights");
});

