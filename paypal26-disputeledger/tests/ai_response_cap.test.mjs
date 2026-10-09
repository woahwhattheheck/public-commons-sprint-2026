import test from 'node:test';
import assert from 'node:assert/strict';
import {advise} from '../src/ai.mjs';
import {SAMPLE, normalizeCase, preparePacket} from '../src/core.mjs';

const packet=preparePacket(normalizeCase(SAMPLE,true),{buyer_messages:true});
const options={endpoint:'https://example-model.invalid/v1/chat/completions',key:'synthetic',model:'fixture'};
const accepted=()=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({summary:'Review receipts.',questions:['Is the delivery evidence real?']})}}]});

const call=(transport)=>advise(packet,{...options,transport});

test('normal streamed advisory validates and preserves privacy-safe contract',async()=>{
  let sent;
  const result=await call(async(_,req)=>{
    sent=req.body;
    return new Response(accepted(),{status:200});
  });
  assert.equal(result.model_used,true);
  assert.equal(result.questions.length,1);
  assert.ok(!sent.includes('DEMO-PP-D-001'));
});

test('over-limit declared bytes are rejected without touching response stream',async()=>{
  let pulls=0;
  const body=new ReadableStream({pull(c){pulls++; c.enqueue(new TextEncoder().encode('not expected'));c.close();}},{highWaterMark:0});
  await assert.rejects(call(async()=>({ok:true,headers:new Headers({'content-length':'10001'}),body})),/AI response too large/);
  assert.equal(pulls,0);
});

test('chunked streamed data is cancelled at the first byte over cap',async()=>{
  let canceled=false;
  const body=new ReadableStream({
    start(c){c.enqueue(new TextEncoder().encode('A'.repeat(6000)));c.enqueue(new TextEncoder().encode('B'.repeat(6000)));},
    cancel(){canceled=true;}
  });
  await assert.rejects(call(async()=>({ok:true,headers:new Headers(),body})),/AI response too large/);
  assert.equal(canceled,true);
});

test('nonstream mock and invalid content-length cannot trigger unbounded text fallback',async()=>{
  await assert.rejects(call(async()=>({ok:true,headers:new Headers(),text:async()=>{throw Error('must not be called');}})),/stream unavailable/);
  await assert.rejects(call(async()=>new Response('{}',{headers:{'content-length':'invalid'}})),/too large/);
});

test('Unicode byte budget applies before JSON decoding',async()=>{
  await assert.rejects(call(async()=>new Response('€'.repeat(4000),{status:200})),/too large/);
});
