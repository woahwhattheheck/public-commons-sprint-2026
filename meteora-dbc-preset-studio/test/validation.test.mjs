import test from "node:test";
import assert from "node:assert/strict";
import { validateInput, catalog, hashConfig } from "../core.mjs";
test("three catalog presets meet the editor's economic invariants", () => {
  const presets = catalog();
  assert.equal(presets.length, 3);
  assert.equal(new Set(presets.map((x) => x.id)).size, 3);
  for (const p of presets) {
    const valid = validateInput({presetId:p.id});
    assert.equal(valid.quoteSymbol, "USDC");
    assert.ok(valid.lockedLiquidityPercent >= 10);
  }
});
test("reject unknown fields, unrecognized catalog keys and prototype pollution", () => {
  assert.throws(()=>validateInput({presetId:"nothing"}),/Unknown presetId/);
  assert.throws(()=>validateInput({presetId:"community-launch",wallet:"secret"}),/Unexpected field/);
  assert.throws(()=>validateInput({presetId:"community-launch",overrides:{wallet:"secret"}}),/Unsafe override/);
  assert.throws(()=>validateInput({presetId:"community-launch",overrides:JSON.parse('{"__proto__":{"admin":true}}')}),/Unsafe override/);
});
test("reject unsafe numeric ranges and misleading fee or liquidity allocations", () => {
  for (const overrides of [
    {initialMarketCap:250000},{migrationMarketCap:0},{initialMarketCap:NaN},
    {initialMarketCap:Infinity},{tokenSupply:10000000000},
    {endingFeeBps:1001},{startingFeeBps:10,endingFeeBps:25},
    {lockedLiquidityPercent:85,creatorLiquidityPercent:40},
    {lockedLiquidityPercent:0}
  ]) {
    assert.throws(()=>validateInput({presetId:"community-launch",overrides}));
  }
});
test("SHA256 is stable across object insertion order", () => {
  const a=hashConfig({z:[{b:2,a:1}],a:4});
  const b=hashConfig({a:4,z:[{a:1,b:2}]});
  assert.equal(a,b);assert.equal(a.length,64);
});
