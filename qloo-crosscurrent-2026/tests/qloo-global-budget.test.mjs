// SPDX-License-Identifier: MIT
// Focused offline fake-fetch validation of shared live-provider budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient, QlooError} from '../src/qloo.mjs';
import {makeCulturalPlan} from '../src/agent.mjs';

const denial = e => e?.code === 'QLOO_LOCAL_BUDGET' && e.status === 429;

test('all unique provider requests share a cap; cache hits and expired windows do not', async () => {
  let now = 1000;
  let outbound = 0;
  const client = new QlooClient({key:'fake-key', now:()=>now, maxUpstreamRequestsPerMinute:2,
    fetcher:async () => {outbound += 1; return {ok:true,json:async()=>({results:[]})};}});
  await client.get('/search',{query:'first'});
  await client.get('/search',{query:'first'}); // completed cache
  await client.get('/search',{query:'second'});
  await assert.rejects(client.get('/search',{query:'third'}), denial);
  assert.equal(outbound,2);
  assert.equal(client.calls,2);
  assert.equal(client.inFlight.size,0); // local denial cannot poison cache/singleflight
  now += 60000;
  await client.get('/search',{query:'third'});
  assert.equal(outbound,3);
});

test('concurrent distinct URLs respect one shared cap and identical URLs share one slot', async () => {
  let fetches=0;
  let release;
  const gate=new Promise(resolve => {release=resolve;});
  const client=new QlooClient({key:'fake-key', maxUpstreamRequestsPerMinute:2,
    fetcher:async()=>{fetches += 1; await gate; return {ok:true,json:async()=>({results:[]})};}});
  const all=[
    client.get('/search',{query:'same'}),
    client.get('/search',{query:'same'}),
    client.get('/search',{query:'different'}),
    client.get('/search',{query:'third'})
  ];
  assert.equal(fetches,2);
  release();
  const outcomes=await Promise.allSettled(all);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,3);
  assert.ok(denial(outcomes[3].reason));
  assert.equal(client.calls,2);
});

test('live multi-domain plan surfaces budget denial, not successful partial recommendations', async () => {
  const fake={search:async()=>[{id:'seed:1',name:'Example Seed'}],
    insights:async()=>{throw new QlooError('QLOO_LOCAL_BUDGET',429);}};
  await assert.rejects(makeCulturalPlan({seed:'Example Seed'},fake),denial);
});

test('second-hop bridge denial also propagates instead of yielding partial venue evidence', async () => {
  const fake={search:async()=>[{id:'seed:1',name:'Example Seed'}],
    insights:async(type, ids)=>{
      if(ids.length > 1) throw new QlooError('QLOO_LOCAL_BUDGET',429);
      if(type === 'artist') return [{id:'artist:1',name:'Music'}];
      if(type === 'place') return [{id:'place:1',name:'Venue'}];
      return [];
    }};
  await assert.rejects(makeCulturalPlan({seed:'Example Seed'},fake),denial);
});

test('reject invalid limits before a provider call',()=>{
  for(const invalid of [0,-1,1.5,Infinity,121,'48',null])
    assert.throws(()=>new QlooClient({key:'fixture',maxUpstreamRequestsPerMinute:invalid}),
      e=>e?.code==='INVALID_QLOO_UPSTREAM_BUDGET');
});
