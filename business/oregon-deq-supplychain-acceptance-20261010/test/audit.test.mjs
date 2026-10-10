// MIT. Focused offline acceptance: uses the original local audit module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditTrace, RISK_CATEGORIES, SCHEMA } from '../audit.mjs';
const evidence={source:'document:example',observedAt:'2026-10-09T12:00:00Z'};
function sample(){
  const ids=['mine','mill','market'];
  return {schema:SCHEMA,asOf:'2026-10-10T12:00:00Z',
    products:[{id:'sample',name:'Sample only',destinationNode:'market'}],
    nodes:ids.map((id,i)=>({id,stage:['extraction','manufacturing','oregon-market'][i]})),
    links:[{id:'one',productId:'sample',from:'mine',to:'mill',evidence:[evidence]},
      {id:'two',productId:'sample',from:'mill',to:'market',evidence:[evidence]}],
    risks:ids.flatMap(nodeId=>RISK_CATEGORIES.map(category=>({nodeId,category,
      disposition:'reviewed_clear',evidence:[evidence]})))};
}
test('documented source-to-Oregon path and all recorded risk dimensions',()=>{
  const r=auditTrace(sample());
  assert.equal(r.decision,'PASS_EVIDENCE_SHAPE');
  assert.equal(r.products[0].riskPairsWithRecentRecords,15);
  assert.deepEqual(r.products[0].sourceToMarketNodes,['mine','mill','market']);
});
test('missing provenance and unknown assessments require human review',()=>{
  const d=sample();d.links[0].evidence=[];
  assert.equal(auditTrace(d).products[0].pathStatus,'UNDOCUMENTED_PATH');
  d.links[0].evidence=[evidence];d.risks[0].disposition='unknown';
  assert.equal(auditTrace(d).decision,'REVIEW_REQUIRED');
});
