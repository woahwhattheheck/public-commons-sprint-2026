import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBatch} from '../src/paypal.mjs';

// Deliberately malformed, offline transport inputs: not sandbox activity or payments.
test('provider decoding never exposes response text and retains valid payout reads',async()=>{
  const originalFetch=globalThis.fetch;
  const oldId=process.env.PAYPAL_CLIENT_ID;
  const oldSecret=process.env.PAYPAL_CLIENT_SECRET;
  process.env.PAYPAL_CLIENT_ID='offline-test-client';
  process.env.PAYPAL_CLIENT_SECRET='offline-test-secret';
  const canary='OFFLINE_CANARY';
  const token=()=>Response.json({access_token:'offline-test-token'});
  function transport(responses){
    let index=0;
    globalThis.fetch=async(url,options)=>{
      assert.equal(new URL(url).origin,'https://api-m.sandbox.paypal.com');
      assert.equal(options.redirect,'error');
      assert.equal(options.method,index===0?'POST':'GET');
      assert.ok(index<responses.length,'unexpected provider request');
      return responses[index++];
    };
    return ()=>assert.equal(index,responses.length,'all expected reads consumed');
  }
  const sanitized=error=>{
    assert.equal(error.message,'PayPal response is not valid UTF-8 JSON');
    assert.ok(!String(error.stack).includes(canary));
    assert.equal(error.cause,undefined,'do not retain the body-bearing parser exception');
    return true;
  };
  try{
    let complete=transport([new Response(canary)]);
    await assert.rejects(fetchBatch('BATCH_TEST'),sanitized);
    complete();
    complete=transport([token(),new Response(canary)]);
    await assert.rejects(fetchBatch('BATCH_TEST'),sanitized);
    complete();
    complete=transport([token(),new Response(new Uint8Array([0xc3,0x28]))]);
    await assert.rejects(fetchBatch('BATCH_TEST'),sanitized);
    complete();
    for(const invalid of [null,[],42]){
      complete=transport([Response.json(invalid)]);
      await assert.rejects(fetchBatch('BATCH_TEST'),{message:'PayPal response is not an object'});
      complete();
    }
    complete=transport([new Response(canary,{status:403})]);
    await assert.rejects(fetchBatch('BATCH_TEST'),{message:'PayPal sandbox HTTP 403 (Payouts scope may be unavailable)'});
    complete();
    const pages=[1,2].map(page=>({
      batch_header:{payout_batch_id:'BATCH_TEST'},total_pages:2,
      items:[{payout_item_id:`ITEM_${page}`}]
    }));
    complete=transport([token(),...pages.map(page=>Response.json(page))]);
    assert.deepEqual(await fetchBatch('BATCH_TEST'),pages);
    complete();
  }finally{
    globalThis.fetch=originalFetch;
    if(oldId===undefined)delete process.env.PAYPAL_CLIENT_ID;else process.env.PAYPAL_CLIENT_ID=oldId;
    if(oldSecret===undefined)delete process.env.PAYPAL_CLIENT_SECRET;else process.env.PAYPAL_CLIENT_SECRET=oldSecret;
  }
});

test('HTTP sync redacts malformed upstream bodies without replacing reviewed evidence',async()=>{
  const {createServer}=await import('../src/server.mjs');
  const originalFetch=globalThis.fetch;
  const oldId=process.env.PAYPAL_CLIENT_ID;
  const oldSecret=process.env.PAYPAL_CLIENT_SECRET;
  process.env.PAYPAL_CLIENT_ID='offline-test-client';
  process.env.PAYPAL_CLIENT_SECRET='offline-test-secret';
  const canary='OFFLINE_HTTP_CANARY';
  const server=await createServer();
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const base=`http://127.0.0.1:${server.address().port}`;
    const initial=await (await originalFetch(`${base}/api/report`)).json();
    for(const failingEndpoint of ['oauth','payout']){
      let requests=0;
      globalThis.fetch=async(url,options)=>{
        assert.equal(new URL(url).origin,'https://api-m.sandbox.paypal.com');
        assert.equal(options.redirect,'error');
        requests++;
        if(failingEndpoint==='payout'&&requests===1){
          return Response.json({access_token:'offline-test-token'});
        }
        return new Response(canary);
      };
      const response=await originalFetch(`${base}/api/sync`,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({batchId:'BATCH_TEST'})
      });
      const body=await response.text();
      assert.equal(response.status,502);
      assert.deepEqual(JSON.parse(body),{error:'PayPal response is not valid UTF-8 JSON'});
      assert.ok(!body.includes(canary));
      assert.equal(requests,failingEndpoint==='oauth'?1:2);
      const after=await (await originalFetch(`${base}/api/report`)).json();
      assert.equal(after.evidenceHash,initial.evidenceHash);
      assert.equal(after.version,initial.version);
      assert.deepEqual(after.totals,initial.totals);
    }
    const decision=await originalFetch(`${base}/api/decision`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({version:initial.version,caseId:initial.items[0].caseId,state:'acknowledged'})
    });
    assert.equal(decision.status,200,'failed provider decoding releases the sync slot');
  }finally{
    globalThis.fetch=originalFetch;
    if(oldId===undefined)delete process.env.PAYPAL_CLIENT_ID;else process.env.PAYPAL_CLIENT_ID=oldId;
    if(oldSecret===undefined)delete process.env.PAYPAL_CLIENT_SECRET;else process.env.PAYPAL_CLIENT_SECRET=oldSecret;
    await new Promise(resolve=>server.close(resolve));
  }
});
