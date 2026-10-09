import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MatchEngine,SYNTHETIC_EVENTS} from '../engine.mjs';
import {draftFoundryExplanation} from '../foundry.mjs';

// Explicit fake credentials and an injected transport: no network/provider use.
const env={FOUNDRY_ENDPOINT:'https://fixture.openai.azure.com',FOUNDRY_DEPLOYMENT:'fixture-model',FOUNDRY_API_KEY:'not-a-real-key'};
const engine=new MatchEngine();
for(const e of SYNTHETIC_EVENTS)engine.ingest(e);
const snapshot=engine.snapshot();
const result=text=>new Response(JSON.stringify({choices:[{message:{content:text}}]}));

test('only a valid configured resource can issue the explicit credential-bearing request',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;
    assert.equal(url,'https://fixture.openai.azure.com/openai/v1/chat/completions');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers['api-key'],'not-a-real-key');
    assert.equal(JSON.parse(options.body).max_completion_tokens,160);
    return result('  Fictional Harbor FC have one goal.  ');
  };
  assert.equal((await draftFoundryExplanation(snapshot,{env:{},fetchImpl})).status,'not-configured');
  for(const endpoint of ['http://fixture.openai.azure.com','https://fixture.openai.azure.com/path','https://fixture.openai.azure.com/?key=value','https://fixture.openai.azure.com/#fragment','https://fixture.openai.azure.com.invalid']){
    await assert.rejects(draftFoundryExplanation(snapshot,{env:{...env,FOUNDRY_ENDPOINT:endpoint},fetchImpl}),/resource origin/);
  }
  await assert.rejects(draftFoundryExplanation({...snapshot,explanation:'x'.repeat(65536)},{env,fetchImpl}),/request exceeds/);
  assert.equal(calls,0);
  const draft=await draftFoundryExplanation(snapshot,{env,fetchImpl});
  assert.equal(calls,1);
  assert.equal(draft.status,'model-draft');
  assert.equal(draft.text,'Fictional Harbor FC have one goal.');
  assert.ok(!JSON.stringify(draft).includes(env.FOUNDRY_API_KEY));
});

test('redirects and oversized declared or streamed responses are rejected and cancelled',async()=>{
  let calls=0;
  await assert.rejects(draftFoundryExplanation(snapshot,{env,fetchImpl:async(_,options)=>{
    calls++;assert.equal(options.redirect,'manual');
    return new Response(null,{status:307,headers:{location:'https://example.invalid/collector'}});
  }}),/redirect refused/);
  assert.equal(calls,1);
  for(const headers of [{'content-length':'65537'},{}]){
    let cancelled=false;
    const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}});
    await assert.rejects(draftFoundryExplanation(snapshot,{env,fetchImpl:async()=>new Response(body,{headers})}),/response exceeds/);
    assert.equal(cancelled,true);
  }
});

test('deadline covers a stalled response body and JSON errors never echo response content',async()=>{
  let cancelled=false,signal;
  const body=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(draftFoundryExplanation(snapshot,{env,timeoutMs:15,fetchImpl:async(_,options)=>{
    signal=options.signal;return new Response(body);
  }}),/timed out/);
  assert.equal(signal.aborted,true);
  assert.equal(cancelled,true);
  await assert.rejects(draftFoundryExplanation(snapshot,{env,fetchImpl:async()=>new Response('private-body-content')}),{message:'Foundry returned invalid JSON'});
});
