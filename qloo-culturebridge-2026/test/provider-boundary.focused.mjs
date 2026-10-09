import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEntity,buildLiveComparison,QlooError} from '../src/qloo.mjs';

const seed='Artist One', key='inert-server-only-fixture';
const isProviderError=(code)=>(err)=>err instanceof QlooError&&err.code===code;
const search={results:{entities:[{entity_id:'seed-id',name:seed}]}};

test('live Qloo requests retain fixed host and never follow a credentialed redirect',async()=>{
  let calls=0;
  await assert.rejects(resolveEntity(seed,key,async(url,options)=>{
    calls++;
    assert.equal(new URL(url).origin,'https://hackathon.api.qloo.com');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers['X-Api-Key'],key);
    assert.ok(!String(url).includes(key));
    return new Response(null,{status:302,headers:{Location:'https://elsewhere.invalid/collect'}});
  }),isProviderError('REDIRECT'));
  assert.equal(calls,1);
});

test('streamed Qloo body is capped before parsing, even with missing/false content length',async()=>{
  let canceled=false;
  const source=new ReadableStream({start(ctrl){ctrl.enqueue(new Uint8Array(700_000));ctrl.enqueue(new Uint8Array(500_000));},cancel(){canceled=true;}});
  await assert.rejects(resolveEntity(seed,key,async()=>new Response(source,{status:200})),isProviderError('RESPONSE'));
  assert.equal(canceled,true,'upstream reader canceled on byte overflow');
  await assert.rejects(resolveEntity(seed,key,async()=>new Response('{}',{status:200,headers:{'Content-Length':'1100000'}})),isProviderError('RESPONSE'));
  const encoded=JSON.stringify(search);
  await assert.rejects(resolveEntity(seed,key,async()=>new Response(encoded+' '.repeat(1024*1024),
    {status:200,headers:{'Content-Length':'20'}})),isProviderError('RESPONSE'));
  await assert.rejects(resolveEntity(seed,key,async()=>new Response('{bad',{status:200})),isProviderError('RESPONSE'));
});

test('valid small streaming and legacy JSON-only mock providers still preserve live identity evidence',async()=>{
  const resolved=await resolveEntity(seed,key,async()=>new Response(JSON.stringify(search),{status:200}));
  assert.equal(resolved.id,'seed-id');
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push([url.pathname,options.redirect,options.headers['X-Api-Key']]);
    if(url.pathname==='/search')return {ok:true,status:200,json:async()=>({results:[{id:url.searchParams.get('query'),name:url.searchParams.get('query')}]})};
    return {ok:true,status:200,json:async()=>({results:{entities:[{id:'shared',name:'Shared'}]}})};
  };
  const result=await buildLiveComparison({seedA:'Art One',seedB:'Art Two',kind:'artist',key,fetcher});
  assert.equal(result.trace.length,2);
  assert.equal(calls.length,4);
  assert.ok(calls.every(([path,redirect,auth])=>(path==='/search'||path==='/v2/insights')&&redirect==='manual'&&auth===key));
  assert.deepEqual(result.resultsA.results.entities.map(x=>x.id),['shared']);
});
