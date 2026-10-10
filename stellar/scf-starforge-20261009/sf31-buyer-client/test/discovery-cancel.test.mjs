// MIT. SF31 post-release cancellation and declared response-length regression.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {X402BuyerClient,BuyerError} from '../buyer.mjs';

const url='https://catalog.example';
const MAX=256*1024;
const withResponse=response=>new X402BuyerClient({fetchImpl:async()=>response});

test('oversized discovery rejects even if stream cancellation never settles',async()=>{
  let cancelCalls=0;
  const stream=new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(MAX+1));},
    cancel(){cancelCalls++;return new Promise(()=>{});}
  });
  const request=withResponse(new Response(stream)).discover({origin:url});
  const result=await Promise.race([
    request.then(()=> 'WRONGLY_SUCCEEDED', e=>e instanceof BuyerError?e.code:'WRONG_ERROR'),
    new Promise(resolve=>setTimeout(()=>resolve('HUNG_ON_CANCEL'),180))
  ]);
  assert.equal(result,'DISCOVERY_RESPONSE_TOO_LARGE');
  assert.equal(cancelCalls,1);
});

test('declared >256 KiB response is rejected without consuming any bytes',async()=>{
  let reads=0, cancelCalls=0;
  const stream=new ReadableStream({
    pull(controller){reads++;controller.enqueue(new Uint8Array([42]));},
    cancel(){cancelCalls++;}
  },{highWaterMark:0});
  const response={
    status:200,ok:true,headers:new Headers({'content-length':String(MAX+1)}),body:stream
  };
  await assert.rejects(withResponse(response).discover({origin:url}),
    e=>e instanceof BuyerError && e.code==='DISCOVERY_RESPONSE_TOO_LARGE');
  assert.equal(reads,0);
  assert.equal(cancelCalls,1);
});
