// One focused mocked-provider check for the actual 2-hop behavior; no real API/key required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCulturalPlan, makeSyntheticDemo} from '../src/agent.mjs';
import {QlooClient} from '../src/qloo.mjs';

test('live path uses supported Qloo host, two taste IDs for bridge, and bounded trace', async () => {
  const calls=[];
  const fetcher=async(url,req)=>{
    calls.push({url:new URL(url),headers:req.headers});
    if(url.pathname==='/search')return{ok:true,json:async()=>({results:[{id:'qloo-seed-123',name:'The Artist'}]})};
    const type=url.searchParams.get('filter.type');
    const ids=url.searchParams.get('signal.interests.entities');
    const entities = type === 'urn:entity:artist' ? [{id:'qloo-bridge-456',name:'Other Artist'}] :
       type==='urn:entity:place' ? [{id: ids.includes(',') ? 'qloo-twohop-789' : 'qloo-place-321', name:'Venue'}] : [];
    return{ok:true,json:async()=>({entities})};
  };
  const client=new QlooClient({key:'fake-only-for-offline-test',fetcher});
  const plan=await makeCulturalPlan({seed:'The Artist',city:'New York'},client);
  assert.equal(plan.status,'LIVE_QLOO_EVIDENCE');
  assert.equal(plan.bridge_places[0].id,'qloo-twohop-789');
  assert.equal(calls.length,7);
  assert.ok(calls.every(c=>c.url.origin==='https://hackathon.api.qloo.com'));
  assert.ok(calls.every(c=>c.headers['X-Api-Key']==='fake-only-for-offline-test'));
  assert.equal(plan.trace.filter(s=>s.stage==='BRIDGE').length,1);
  assert.equal(makeSyntheticDemo({seed:'The Artist'}).source,'fictional-fixture');
});

// Live search success cannot be mistaken for successful cross-category evidence.
test('failed or absent insight evidence does not produce a live venue concept', async () => {
  const searched = [{id:'qloo-seed-123', name:'The Artist'}];
  const denied = new Error('QLOO_RATE_LIMIT');
  denied.code = 'QLOO_RATE_LIMIT';
  const failedClient = {search:async()=>searched, insights:async()=>{throw denied;}, calls:6};
  const failed = await makeCulturalPlan({seed:'The Artist'}, failedClient);
  assert.equal(failed.status,'UPSTREAM_INSIGHTS_UNAVAILABLE');
  assert.deepEqual(failed.proposals,[]);
  assert.equal(failed.trace.filter(x=>x.result==='QLOO_RATE_LIMIT').length,5);

  const noVenueClient = {search:async()=>searched, calls:7,
    insights:async(type)=> type==='artist' ? [{id:'qloo-music-456',name:'Another Artist'}] : []};
  const noVenue = await makeCulturalPlan({seed:'The Artist'}, noVenueClient);
  assert.equal(noVenue.status,'NO_VERIFIED_PLACE');
  assert.deepEqual(noVenue.proposals,[]);
  assert.ok(noVenue.trace.some(x=>x.stage==='BRIDGE' && x.result==='EMPTY'));
});
