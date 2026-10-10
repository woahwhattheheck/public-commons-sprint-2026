import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createOpsHandler} from './ops.mjs';
const catalog={size:2,version:3,list:()=>({resources:[]}),search:()=>({resources:[]})};
const backend=async(req,res)=>{res.writeHead(req.url.includes('missing')?404:200,{'content-type':'application/json'});res.end(JSON.stringify({resources:[]}));};
async function withServer(handler,run){const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.close();await once(server,'close');}}

test('real node:http handler wraps discovery and exposes loopback-only typed ops',async()=>{
 const readings=[];
 const ops=createOpsHandler({catalog,discoveryHandler:backend,observe:x=>readings.push(x)});
 await withServer(ops.handler,async root=>{
  const a=await fetch(root+'/discovery/resources?network=stellar:testnet');assert.equal(a.status,200);assert.deepEqual((await a.json()).resources,[]);
  const b=await fetch(root+'/readyz');assert.equal(b.status,200);const j=await b.json();assert.equal(j.ready,true);assert.equal(j.rpc,'unchecked');assert.equal(j.catalog.size,2);
  const m=await (await fetch(root+'/metrics')).json();assert.equal(m.routeMetrics['/discovery/resources'].requests,1);assert.equal(typeof m.routeMetrics['/discovery/resources'].p95Ms,'number');
  const health=await (await fetch(root+'/healthz')).json();assert.equal(health.detail,'process-only');
 });
 assert.ok(readings.every(x=>Object.keys(x).sort().join(',')==='durationMs,route,status'));
 assert.ok(readings.every(x=>!('url' in x)&&!('ip' in x)));
});

test('per-IP rate limiter returns real 429 and recovers after window',async()=>{
 let clock=1000;const ops=createOpsHandler({catalog,discoveryHandler:backend,nowMs:()=>clock,requestsPerWindow:2,windowMs:100});
 await withServer(ops.handler,async root=>{
  for(let i=0;i<2;i++)assert.equal((await fetch(root+'/discovery/search?query=rain')).status,200);
  const blocked=await fetch(root+'/discovery/search?query=rain');assert.equal(blocked.status,429);assert.equal((await blocked.json()).error,'RATE_LIMITED');
  clock=1101;assert.equal((await fetch(root+'/discovery/search?query=rain')).status,200);
 });
 assert.equal(ops.snapshot().rateLimited,1);
});

test('overloaded concurrent requests reject with 503 without queue or hidden retries',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 let admitted;const started=new Promise(resolve=>admitted=resolve);
 const slow=async(req,res)=>{admitted();await gate;res.writeHead(200);res.end('{}');};
 const ops=createOpsHandler({catalog,discoveryHandler:slow,maxInFlight:1});
 await withServer(ops.handler,async root=>{
  const first=fetch(root+'/discovery/resources');await started;
  const second=await fetch(root+'/discovery/resources');assert.equal(second.status,503);assert.equal((await second.json()).error,'OVERLOADED');
  release();assert.equal((await first).status,200);
 });
 assert.equal(ops.snapshot().overloaded,1);assert.equal(ops.snapshot().inFlight,0);
});

test('application readiness is not fraudulent ledger / RPC uptime reporting',async()=>{
 const ops=createOpsHandler({catalog,discoveryHandler:backend,readyCheck:()=>false});
 await withServer(ops.handler,async root=>{
  const r=await fetch(root+'/readyz');assert.equal(r.status,503);const j=await r.json();assert.equal(j.ledger,'unchecked');assert.equal(j.settlement,'unchecked');
  assert.equal((await fetch(root+'/healthz')).status,200);
 });
});

test('fixed low-cardinality metric routes, 4xx/5xx distribution, bounded samples, no raw paths',async()=>{
 const ops=createOpsHandler({catalog,discoveryHandler:async(req,res)=>{res.writeHead(req.url.includes('bad')?503:404);res.end('{}');},sampleCap:10});
 await withServer(ops.handler,async root=>{
  for(let n=0;n<20;n++) await fetch(root+'/customer-sensitive-segment-'+n+(n%3===0?'/bad':''));
  const r=await(await fetch(root+'/metrics')).json();const o=r.routeMetrics.other;
  assert.equal(o.requests,20);assert.equal(o.sampleCount,10);assert.equal(o.statusClasses['5xx'],7);assert.equal(o.statusClasses['4xx'],13);
  assert.equal(Object.keys(r.routeMetrics).length,1);assert.equal(JSON.stringify(r).includes('customer-sensitive'),false);
 });
});

test('backend exceptions redact their internals and return 500 without leaking process error',async()=>{
 const ops=createOpsHandler({catalog,discoveryHandler:async()=>{throw new Error('secret ledger data');}});
 await withServer(ops.handler,async root=>{
  const r=await fetch(root+'/discovery/search?query=secret');assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'INTERNAL_ERROR'});
 });
 assert.equal(ops.snapshot().routeMetrics['/discovery/search'].statusClasses['5xx'],1);
});

test('asynchronous readiness checks fail closed on false, rejection and timeout',async()=>{
 let probe=()=>Promise.resolve(false);
 const ops=createOpsHandler({catalog,discoveryHandler:backend,readyCheck:()=>probe(),readyTimeoutMs:25});
 await withServer(ops.handler,async root=>{
   let r=await fetch(root+'/readyz');assert.equal(r.status,503);assert.equal((await r.json()).ready,false);
   probe=()=>Promise.reject(new Error('secret RPC detail'));
   r=await fetch(root+'/readyz');assert.equal(r.status,503);assert.equal((await r.json()).ready,false);
   probe=()=>new Promise(()=>{});
   r=await fetch(root+'/readyz');assert.equal(r.status,503);assert.equal((await r.json()).ready,false);
   probe=()=>Promise.resolve(true);
   r=await fetch(root+'/readyz');assert.equal(r.status,200);assert.equal((await r.json()).ready,true);
   assert.equal((await fetch(root+'/healthz')).status,200);
 });
});
