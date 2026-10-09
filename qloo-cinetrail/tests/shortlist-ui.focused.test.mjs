import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag; this.textContent = ""; this.hidden = false; this.disabled = false;
    this.children = []; this.dataset = {}; this.attrs = {}; this.handlers = {};
    this.value = "";
  }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, callback) { this.handlers[type] = callback; }
  setAttribute(name, value) { this.attrs[name] = value; }
  click() { this.handlers.click?.(); }
}

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
function harness(plans) {
  const ids = ["notice", "result", "cards", "planner", "submit", "movie", "locality", "mood",
    "title", "label", "evidence", "export", "reset-shortlist", "shortlist-summary", "mode"];
  const nodes = new Map(ids.map(id => [id, new FakeElement()]));
  nodes.get("movie").value = "Amélie";
  nodes.get("locality").value = "Louisville";
  nodes.get("mood").value = "curious";
  let index = 0; const exports = [];
  const mockUrl = class extends URL {};
  mockUrl.createObjectURL = blob => { exports.push(blob); return "blob:fake"; };
  mockUrl.revokeObjectURL = () => {};
  runInNewContext(source, {
    document: { getElementById: id => nodes.get(id), createElement: tag => new FakeElement(tag) },
    fetch: async url => url === "/api/status"
      ? { ok: true, json: async () => ({ mode: "live" }) }
      : { ok: true, json: async () => plans[Math.min(index++, plans.length - 1)] },
    URL: mockUrl, Blob, setTimeout: fn => fn(),
  }, { filename: "app.js" });
  return {
    nodes, exports,
    submit: () => nodes.get("planner").handlers.submit({ preventDefault() {} }),
    cards: () => nodes.get("cards").children,
    clickCard: i => nodes.get("cards").children[i].children.find(child => child.tag === "button").click(),
  };
}

const stops = ["A", "B", "C"].map((id, i) => ({
  qloo_entity_id: "QLOO-" + id, name: "Place " + id, qloo_rank: i + 1,
  tags: [], description: "", address: null, reasoning: "Rank " + (i + 1),
}));
const plan = { product: "CineTrail", mode: "live", stops, resolved_movie: "Amélie",
  locality: "Louisville", mood: "curious", evidence: "Live source", limitations: [] };

test("shortlist preserves original IDs/ranks and exports only human-selected suggestions", async () => {
  const h = harness([plan, plan]);
  await h.submit();
  assert.equal(h.cards().length, 3);
  assert.equal(h.nodes.get("shortlist-summary").textContent.includes("3 of 3"), true);
  assert.equal(h.nodes.get("export").disabled, false);
  h.clickCard(1);
  assert.equal(h.cards()[1].dataset.included, "false");
  assert.equal(h.nodes.get("shortlist-summary").textContent.includes("2 of 3"), true);
  h.nodes.get("export").click();
  const exported = JSON.parse(await h.exports.at(-1).text());
  assert.deepEqual(exported.stops.map(stop => stop.qloo_entity_id), ["QLOO-A", "QLOO-C"]);
  assert.deepEqual(exported.stops.map(stop => stop.qloo_rank), [1, 3]);
  assert.deepEqual(exported.selection.excluded_qloo_entity_ids, ["QLOO-B"]);
  assert.equal(exported.selection.source_ranks_preserved, true);
  assert.equal(exported.mode, "live");
  h.clickCard(0); h.clickCard(2);
  assert.equal(h.nodes.get("export").disabled, true);
  assert.equal(h.exports.length, 1);
  h.nodes.get("reset-shortlist").click();
  assert.equal(h.nodes.get("shortlist-summary").textContent.includes("3 of 3"), true);
  h.clickCard(0);
  await h.submit();
  assert.equal(h.nodes.get("shortlist-summary").textContent.includes("3 of 3"), true);
  assert.equal(h.cards()[0].dataset.included, "true");
});

test("empty upstream results disable export without fictional replacement places", async () => {
  const h = harness([{ ...plan, stops: [] }]);
  await h.submit();
  assert.equal(h.nodes.get("export").disabled, true);
  assert.equal(h.nodes.get("reset-shortlist").disabled, true);
  assert.equal(h.nodes.get("shortlist-summary").textContent.startsWith("No source-backed"), true);
  h.nodes.get("export").click();
  assert.equal(h.exports.length, 0);
});
