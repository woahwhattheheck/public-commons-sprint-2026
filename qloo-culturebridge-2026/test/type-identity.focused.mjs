import assert from 'node:assert/strict';
import { KINDS, normalizeInsights, bridgeIntersection, buildAgentResponse } from '../src/engine.mjs';

// Source-level input-contract replay: 4 categories x 256 deterministic mixes.
let scenarios=0;
for (const [kind, urn] of Object.entries(KINDS)) {
  const other=KINDS[Object.keys(KINDS).find(k => k!==kind)];
  for (let i=0;i<256;i++) {
    const root=kind+'-'+i;
    const source=[
      {entity:{entity_id:'good-'+root,name:'Valid matching category',type:urn}},
      {entity_id:{bad:root},name:'Bad object ID',type:urn},
      {entity_id:i+1,name:'Bad numeric ID',type:urn},
      {entity_id:'wrong-'+root,name:'Wrong explicitly declared category',type:other},
      {entity_id:'legacy-'+root,name:'Missing type remains compatible'},
      {entity_id:'  trim-'+root+'  ',name:'Trim string ID',type:{id:urn}},
      {entity_id:'multi-'+root,name:'Multiple explicit categories',types:[other,urn]},
      {entity_id:'wrong-other-'+root,name:'Wrong nested category',entity_type:other},
    ];
    const response=buildAgentResponse({
      seedA:'First taste',seedB:'Second taste',kind,mode:'live',trace:[],
      resultsA:{results:{entities:source}},
      resultsB:{results:{entities:[...source].reverse()}},
    });
    const observed=response.bridges.map(x=>x.id).sort();
    const expected=['good-'+root,'legacy-'+root,'trim-'+root,'multi-'+root].sort();
    assert.deepEqual(observed,expected,'case '+root);
    assert.equal(response.counts.shared,4);
    const good=response.bridges.find(x=>x.id==='good-'+root);
    assert.equal(good.rankA,1,'preserve original provider rank before filtering');
    assert.equal(good.rankB,8,'preserve original reversed provider rank');
    assert.ok(response.bridges.every(x=>typeof x.id==='string'));
    scenarios++;
  }
}
assert.deepEqual(bridgeIntersection(
  [{id:{bad:'same'},name:'Left',rank:1}],
  [{id:{bad:'same'},name:'Right',rank:1}]
),[],'direct callers also reject non-string IDs');
assert.deepEqual(
  normalizeInsights({results:{entities:[{entity_id:'x',name:'Unknown metadata',type:'custom-metadata'}]}},{kind:'artist'}).map(x=>x.id),
  ['x'],'unknown metadata remains compatible');
assert.deepEqual(
  normalizeInsights({results:{entities:[{entity_id:'x',name:'Different',type:'urn:entity:place'}]}},{kind:'artist'}),
  [],'recognized conflicting Qloo categories are rejected');
assert.deepEqual(
  normalizeInsights({results:{entities:[{entity_id:'y',name:'Valid top ID',entity:{id:{bad:true},name:'Nested'}}]}},{kind:'artist'}).map(x=>x.id),
  ['y'],'valid top-level ID overrides malformed nested field');
console.log('CultureBridge typed-ID evidence replay: PASS ('+scenarios+' deterministic category mixtures, 4 invariants)');
