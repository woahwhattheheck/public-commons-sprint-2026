import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from '../src/server.mjs';

const fixture=JSON.parse(await readFile(new URL('../fixtures/payout_batch.json',import.meta.url),'utf8'));

test('in-flight payout sync cannot acknowledge a review that replacement evidence will erase',async()=>{
  const originalFetch=globalThis.fetch;
  const priorId=process.env.PAYPAL_CLIENT_ID;
  const priorSecret=process.env.PAYPAL_CLIENT_SECRET;
  // Synthetic OAuth and Payouts GET responses: no provider DNS or account access.
  process.env.PAYPAL_CLIENT_ID='synthetic-offline-only';
  process.env.PAYPAL_CLIENT_SECRET='synthetic-offline-only';
  const remote=structuredClone(fixture);
  remote.batch_header.payout_batch_id='OFFLINE_NEW_BATCH';
  let entered,release;
  const remoteEntered=new Promise(done=>{entered=done;});
  const remoteGate=new Promise(done=>{release=done;});
  let outbound=0;
  globalThis.fetch=async (input,opts)=>{
    const url=String(input);
    if(url==='https://api-m.sandbox.paypal.com/v1/oauth2/token'){
      outbound++;
      return new Response(JSON.stringify({access_token:'synthetic-only'}),{status:200});
    }
    if(url.startsWith('https://api-m.sandbox.paypal.com/v1/payments/payouts/OFFLINE_NEW_BATCH?')){
      outbound++;entered();await remoteGate;
      return new Response(JSON.stringify(remote),{status:200});
    }
    if(url.startsWith('http://127.0.0.1:'))return originalFetch(input,opts);
    throw new Error('unmocked network call refused');
  };
  const server=await createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  try{
    const before=await (await fetch(base+'/api/report')).json();
    const original=before.items[0].caseId;
    const accepted=await post('/api/decision',{version:before.version,caseId:original,state:'acknowledged'});
    assert.equal(accepted.status,200,'normal pre-sync human review accepted');
    const version=(await accepted.json()).version;
    const pending=post('/api/sync',{batchId:'OFFLINE_NEW_BATCH'});
    await remoteEntered;
    const race=await post('/api/decision',{version,caseId:original,state:'escalated'});
    assert.equal(race.status,409,'do not acknowledge in-flight evidence changes');
    assert.match((await race.json()).error,/sync in progress/);
    const blocked=await post('/api/load-demo',{});
    assert.equal(blocked.status,409);
    const during=await (await fetch(base+'/api/report')).json();
    assert.equal(during.version,version,'rejected decision must not mutate version');
    assert.equal(during.cases[original].state,'acknowledged');
    release();
    const synced=await pending;
    assert.equal(synced.status,200);
    const after=await (await fetch(base+'/api/report')).json();
    assert.equal(after.id,'OFFLINE_NEW_BATCH');
    assert.equal(after.cases[original],undefined,'new evidence invalidates old decision');
    const fresh=await post('/api/decision',{version:after.version,caseId:after.items[0].caseId,state:'escalated'});
    assert.equal(fresh.status,200,'fresh reviewed evidence can be decided after sync');
    assert.equal(outbound,2,'exactly synthetic OAuth and one synthetic payout GET');
  }finally{
    release();
    await new Promise(done=>server.close(done));
    globalThis.fetch=originalFetch;
    if(priorId===undefined)delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID=priorId;
    if(priorSecret===undefined)delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET=priorSecret;
  }
});
