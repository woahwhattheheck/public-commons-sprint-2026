import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCulturalPlan} from '../src/agent.mjs';

function fakeClient(results) {
  const calls = {search:0,insights:0,ids:[]};
  const client={
    async search(){calls.search++;return results;},
    async insights(category,ids) {
      calls.insights++;
      calls.ids.push([...ids]);
      if(category==='artist')return [{id:'artist-bridge',name:'Arts bridge'}];
      if(category==='place')return [{
        id:ids.length>1?'double-signal-venue':'venue-single',
        name:'Verified venue'
      }];
      return [];
    }
  };
  return {client,calls};
}

test('unrelated, malformed, empty and ambiguous search evidence never acquires seed authority',async()=>{
  const cases=[
    [{id:'b',name:'Another Artist'}],
    [{id:'b',name:'Another Artist'},{id:'c',name:'Other Scene'}],
    [null,{},false,{id:'x',name:123},{id:'y',name:null}],
    [{id:'x',name:'Cafe Scene'},{id:'different',name:'Café-Scene'}],
    [{id:'x',name:'Cafe Scene'},{id:'x',name:' Café Scene '},{id:'z',name:'Cafe Scene'}],
  ];
  for(const hits of cases){
    const {client,calls}=fakeClient(hits);
    const p=await makeCulturalPlan({seed:'Café Scene',city:'New York'},client);
    assert.equal(p.status,'NO_ENTITY_MATCH');
    assert.deepEqual(p.proposals,[]);
    assert.deepEqual(p.panels,[]);
    assert.equal(p.qloo_requests,1);
    assert.deepEqual([calls.search,calls.insights],[1,0]);
    assert.equal(p.trace[0].result,'NO_ENTITY_MATCH');
    assert.equal(p.trace[0].candidates,hits.length);
  }
  const {client,calls}=fakeClient([{id:'x',name:'!??'}]);
  const p=await makeCulturalPlan({seed:'???'},client);
  assert.equal(p.status,'NO_ENTITY_MATCH');
  assert.equal(calls.insights,0);
});

test('unique exact normalized seed preserves full two-signal planning and first-ID fidelity',async()=>{
  const hits=[
    {id:'wrong',name:'Cafe Festival'},
    {id:'trusted',name:'Café Scene'},
    {id:'trusted',name:'Cafe-Scene'},
    {id:'wrong2',name:'Another Scene'}
  ];
  const {client,calls}=fakeClient(hits);
  const p=await makeCulturalPlan({seed:'Cafe Scene',city:'New York'},client);
  assert.equal(p.status,'LIVE_QLOO_EVIDENCE');
  assert.equal(p.resolved_seed.id,'trusted');
  assert.equal(p.proposals[0].evidence[0].id,'trusted');
  assert.equal(p.qloo_requests,7);
  assert.equal(calls.search,1);
  assert.equal(calls.insights,6);
  assert.ok(calls.ids.every(ids=>ids[0]==='trusted'));
  assert.deepEqual(p.bridge_places.map(e=>e.id),['double-signal-venue']);
});

test('4096 deterministic full-agent identity trials never promote an unrelated/ambiguous hit',async()=>{
  let seed=20261009;
  const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  for(let n=0;n<4096;n++){
    const mode=n%4;
    const hits=[{id:'wrong',name:'Other Venue'},
      ...(mode===0?[]:
        mode===1?[{id:'trusted',name:' Café Scene ' }]:
        mode===2?[{id:'trusted',name:'Cafe-Scene'}, {id:'different',name:'Café Scene'}]:
                 [{id:'trusted',name:'Cafe Scene'}, {id:'trusted',name:'Café-Scene'}]),
      {id:'other',name:'Unrelated'}];
    for(let i=hits.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[hits[i],hits[j]]=[hits[j],hits[i]];}
    const {client,calls}=fakeClient(hits);
    const p=await makeCulturalPlan({seed:'Café Scene'},client);
    if(mode===0||mode===2){
      assert.equal(p.status,'NO_ENTITY_MATCH');
      assert.equal(calls.insights,0);
      assert.equal(p.qloo_requests,1);
    }else{
      assert.equal(p.status,'LIVE_QLOO_EVIDENCE');
      assert.equal(p.resolved_seed.id,'trusted');
      assert.equal(p.proposals[0].evidence[0].id,'trusted');
      assert.ok(calls.ids.every(ids=>ids[0]==='trusted'));
    }
  }
});
