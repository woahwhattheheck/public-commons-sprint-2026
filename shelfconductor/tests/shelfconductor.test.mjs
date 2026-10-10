// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,planBooks,InputError} from '../src/core.mjs';
import {inventory,insights} from '../src/demo.mjs';
import {makeQlooClient} from '../src/qloo.mjs';
function plan(fields={}){return validatePlan({mode:'demo',seed_titles:['River of Glass'],inventory,budget_cents:4000,max_books:3,...fields});}
test('synthetic-only inventory constraint, quantity, exact source IDs, budget and out-of-stock exclusion',()=>{
 const result=planBooks(plan(),insights,{synthetic:true});
 assert.equal(result.provenance.mode,'SYNTHETIC_DEMO');assert.ok(result.selected.length<=3);assert.ok(result.total_cents<=4000);
 assert.equal(result.selected.some(x=>x.sku==='DEMO-005'),false);
 assert.ok(result.selected.every(x=>x.qloo_id.startsWith('synthetic:demo:')&&x.stock_available>0));
 assert.equal(result.selected.reduce((s,x)=>s+x.price_cents,0),result.total_cents);
});
test('strict input rejects duplicate SKU, invalid price and false provider-only inventory',()=>{
 assert.throws(()=>plan({inventory:[inventory[0],inventory[0]]}),e=>e instanceof InputError&&e.code==='DUPLICATE_SKU');
 assert.throws(()=>plan({inventory:[{...inventory[0],price_cents:-1}]}),e=>e.code==='INVALID_INVENTORY');
 const onlyUnlinked=plan({inventory:[{...inventory[0],qloo_id:null}]});
 assert.deepEqual(planBooks(onlyUnlinked,insights,{synthetic:true}).selected,[]);
});
test('provider ranked candidates include only exact Qloo-ID retailer stock and support exclusions',()=>{
 const p=plan({budget_cents:10000,exclude_skus:['DEMO-001'],max_books:3});
 const out=planBooks(p,insights,{synthetic:true});assert.ok(!out.selected.some(x=>x.sku==='DEMO-001'));
 const foreign={results:{entities:[{entity_id:'unlinked:provider:book'}]}};
 assert.equal(planBooks(p,foreign).candidate_count,0);
});
test('live adapter uses fixed Qloo host, GET paths, server-only key and correct insights parameters',async()=>{
 const requests=[];const fake=async(u,init)=>{requests.push({url:u.toString(),init});return Response.json(u.pathname==='/search'?{results:{entities:[{entity_id:'real-uuid-1',name:'Real Book'}]}}:{results:{entities:[{entity_id:'real-uuid-2',name:'Other Book'}]}});};
 const client=makeQlooClient({apiKey:'test-key-private',fetchImpl:fake});
 const seed=await client.resolveBook('Real Book');assert.equal(seed.qloo_id,'real-uuid-1');
 const out=await client.recommendBooks([seed.qloo_id]);assert.equal(out.results.entities[0].entity_id,'real-uuid-2');
 assert.equal(requests.length,2);
 for(const request of requests){assert.equal(new URL(request.url).origin,'https://hackathon.api.qloo.com');assert.equal(request.init.method,'GET');assert.equal(request.init.headers['X-Api-Key'],'test-key-private');assert.equal(request.url.includes('test-key-private'),false);}
 assert.match(requests[1].url,/signal.interests.entities=real-uuid-1/);
 assert.match(requests[1].url,/filter.type=urn%3Aentity%3Abook/);
});
test('live provider failure cannot silently masquerade as synthetic and failed calls count toward cap',async()=>{
 const fail=async()=>({ok:false,status:429});const cli=makeQlooClient({apiKey:'fixture',fetchImpl:fail,maxCalls:1});
 await assert.rejects(()=>cli.recommendBooks(['valid']),e=>e.code==='QLOO_RATE_LIMITED');
 await assert.rejects(()=>cli.recommendBooks(['valid']),e=>e.code==='QLOO_LOCAL_BUDGET');
});
test('upstream length and chunked bytes are bounded before JSON parse or caching',async()=>{
 const fixed=makeQlooClient({apiKey:'fixture',fetchImpl:async()=>new Response('{}',{headers:{'content-length':'1500001'}})});
 await assert.rejects(()=>fixed.recommendBooks(['seed']),e=>e.code==='QLOO_RESPONSE_TOO_LARGE');
 const chunked=makeQlooClient({apiKey:'fixture',fetchImpl:async()=>new Response(new ReadableStream({
   start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(1_500_001)));controller.close();}
 }))});
 await assert.rejects(()=>chunked.recommendBooks(['seed']),e=>e.code==='QLOO_RESPONSE_TOO_LARGE');
});
