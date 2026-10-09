import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient} from '../src/qloo.mjs';

const payload = {results:[{entity_id:'entity-A',name:'Qloo A',subtype:'urn:entity:movie'}]};
const reply = () => ({ok:true,status:200,headers:{get:()=>null},json:async()=>payload});

test('bounded 48-response LRU holds hot entries under full-cache churn, preserves 5-minute TTL',async()=>{
 let clock=1_000_000, requests=0;
 const client=new QlooClient({
   key:'server-test-only',
   now:()=>clock,
   maxUpstreamRequestsPerMinute:120,
   fetcher:async (url,opts)=>{
     requests++;
     assert.equal(opts.redirect,'error');
     assert.equal(opts.headers['X-Api-Key'],'server-test-only');
     assert.ok(!url.toString().includes('server-test-only'));
     return reply();
   },
 });
 const read=i=>client.get('/search',{query:'seed-'+i});
 for(let i=0;i<48;i++)await read(i);
 assert.equal(client.cache.size,48);
 assert.equal(requests,48);
 await read(0);  // hot initial key goes to MRU
 for(let i=48;i<52;i++)await read(i);
 assert.equal(client.cache.size,48);
 assert.equal(requests,52);
 await read(0);
 assert.equal(requests,52,'hot original entry must survive the 49th through 52nd keys');
 await read(1);
 assert.equal(requests,53,'oldest untouched entry must be evicted');
 assert.equal(client.cache.size,48,'the map must never exceed the original size budget');
 clock+=300_001;
 await read(0);
 assert.equal(requests,54,'a hot entry still expires after original absolute five-minute TTL');
 assert.equal(client.cache.size,48);
});
test('in-flight requests singleflight and upstream errors are never cached as successes',async()=>{
 let calls=0;
 let resolveFetch;
 const client=new QlooClient({key:'server-test-only',now:()=>1_000_000,fetcher:()=>{
  calls++;
  if(calls===1) return new Promise(resolve=>resolveFetch=resolve);
  if(calls===2) return Promise.resolve({ok:false,status:429,headers:{get:()=>null}});
  return Promise.resolve(reply());
 }});
 const first=client.get('/search',{query:'concurrent'});
 const second=client.get('/search',{query:'concurrent'});
 assert.equal(calls,1);
 resolveFetch(reply());
 assert.deepEqual(await first,payload);
 assert.deepEqual(await second,payload);
 assert.equal(calls,1);
 assert.equal(client.cache.size,1);
 await assert.rejects(client.get('/search',{query:'fail'}),error=>error.code==='QLOO_RATE_LIMIT'&&error.status===429);
 assert.equal(client.cache.size,1,'429 must not be cached');
 assert.deepEqual(await client.get('/search',{query:'fail'}),payload);
 assert.equal(calls,3);
 assert.equal(client.cache.size,2);
});