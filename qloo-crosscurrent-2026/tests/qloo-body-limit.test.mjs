// SPDX-License-Identifier: MIT
// Focused, offline source contract for bounded real HTTP response bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient, QlooError} from '../src/qloo.mjs';

const limitError = e => e instanceof QlooError && e.code === 'QLOO_RESPONSE_TOO_LARGE' && e.status === 502;

test('a valid chunked HTTP stream with split UTF-8 decodes correctly and caches', async () => {
  const raw = Buffer.from(JSON.stringify({results:[{id:'place:good',name:'Café'}]}));
  let outbound = 0;
  const client = new QlooClient({key:'fixture', fetcher:async()=>{
    outbound++;
    return new Response(new ReadableStream({start(c) {
      for(let n=0;n<raw.length;n+=3) c.enqueue(raw.subarray(n,n+3));
      c.close();
    }}),{status:200});
  }});
  const expected=[{id:'place:good',name:'Café',score:null,type:''}];
  assert.deepEqual(await client.search('Café'),expected);
  assert.deepEqual(await client.search('Café'),expected);
  assert.equal(outbound,1);
  assert.equal(client.cache.size,1);
});

test('a valid HTTP-200 stream larger than 1 MiB is stopped and not cached', async () => {
  let outbound = 0;
  const oversized = JSON.stringify({results:[{id:'large:1',name:'x'.repeat(1024*1024)}]});
  const client = new QlooClient({key:'fixture', fetcher:async()=>{
    outbound++;
    return new Response(oversized,{status:200});
  }});
  await assert.rejects(client.search('Example'),limitError);
  assert.equal(client.cache.size,0);
  assert.equal(client.inFlight.size,0);
  await assert.rejects(client.search('Example'),limitError);
  assert.equal(outbound,2);
});

test('oversized Content-Length rejects before reading, even if body claims to be small', async () => {
  let readAttempted=false;
  const client=new QlooClient({key:'fixture',fetcher:async()=>({
    ok:true,
    headers:{get:()=>String(1024*1024+1)},
    body:{getReader:()=>{readAttempted=true; throw Error('must not read');}},
  })});
  await assert.rejects(client.search('Example'),limitError);
  assert.equal(readAttempted,false);
  assert.equal(client.cache.size,0);
});

test('body-less fixture also rejects oversized JSON before caching', async () => {
  const client=new QlooClient({key:'fixture',fetcher:async()=>({
    ok:true,json:async()=>({results:[{id:'x',name:'x'.repeat(1024*1024)}]})
  })});
  await assert.rejects(client.search('Example'),limitError);
  assert.equal(client.cache.size,0);
});
