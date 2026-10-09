import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, checkSignature, DEMO_SIGNATURE, parseProviders, validateSignature, encode58 } from '../src/finality.mjs';

const good = (id, hash='hashA', slot=15) => ({ id, verdict: 'VERIFIED', slot, blockhash: hash });
test('source quorum does not bless incomplete or discordant responses', () => {
  assert.equal(classify([good('a'), good('b')]).verdict, 'AGREED_FINALIZED');
  assert.equal(classify([good('a'), good('b', 'hashB')]).verdict, 'CONFLICT');
  assert.equal(classify([good('a'), {id:'b', verdict:'UNAVAILABLE'}]).verdict, 'INDETERMINATE');
  assert.equal(classify([{id:'a', verdict:'PENDING'}, {id:'b', verdict:'MISSING'}]).verdict, 'PENDING');
  assert.equal(classify([good('a'), {id:'b', verdict:'EXECUTION_ERROR'}]).verdict, 'CONFLICT');
});
test('full synthetic demo explicitly labels fabricated evidence and runs no network', async () => {
  for (const [scenario, result] of Object.entries({aligned:'AGREED_FINALIZED', pending:'PENDING', divergent:'CONFLICT', outage:'INDETERMINATE'})) {
    const data = await checkSignature(DEMO_SIGNATURE,{demo:true,scenario,observedAt:'2026-10-09T00:00:00.000Z'});
    assert.equal(data.assessment.verdict,result); assert.equal(data.mode,'SYNTHETIC_DEMO');
  }
});
test('signature requires decoded 64 bytes and provider URLs require separate secure hosts', () => {
  assert.equal(validateSignature(DEMO_SIGNATURE),DEMO_SIGNATURE);
  assert.throws(()=>validateSignature(encode58(Buffer.alloc(63,2))),/64 bytes/);
  assert.throws(()=>parseProviders('https://rpc.site/a,https://rpc.site/b'),/distinct hostnames/);
  assert.throws(()=>parseProviders('http://rpc.site,https://other.site'),/HTTPS/);
  assert.equal(parseProviders('https://a.site,https://b.site').length,2);
});
test('actual RPC envelope cross-check rejects conflicting success vs transaction error', async () => {
  let count=0;
  const slot=22; const blockhash=encode58(Buffer.alloc(32, 7));
  const fetchImpl = async (_url, req) => {
    const {method}=JSON.parse(req.body); count++;
    const payload=method==='getSignatureStatuses' ? {value:[{slot, err:null, confirmationStatus:'finalized'}]} : {
      slot, meta:{err:{InstructionError:[0,'Custom']}}, transaction:{signatures:[DEMO_SIGNATURE],message:{recentBlockhash:blockhash}}
    };
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:payload}),{headers:{'content-type':'application/json'}});
  };
  const data=await checkSignature(DEMO_SIGNATURE,{providers:[{id:'a',label:'a',url:'https://a.site'},{id:'b',label:'b',url:'https://b.site'}],fetchImpl});
  assert.equal(data.assessment.verdict,'INDETERMINATE');
  assert.deepEqual(data.providers.map(p=>p.verdict),['INCONSISTENT','INCONSISTENT']);
  assert.equal(count,4);
});
