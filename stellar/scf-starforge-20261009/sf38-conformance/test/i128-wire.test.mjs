// MIT. Focused original SF38 v2 wire-boundary regression; no payment calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRequest,inspectResponse,auditCapture} from '../conformance.mjs';
const network='stellar:testnet';
const max='170141183460469231731687303715884105727';
const over='170141183460469231731687303715884105728';
const envelope=(scheme,offered,actual=offered)=>{
  const terms={scheme,network,asset:'CUSDC',payTo:'GSELLER',maxTimeoutSeconds:60};
  return {x402Version:2,paymentPayload:{x402Version:2,
    accepted:{...terms,amount:offered},payload:{transaction:'XDR'}},
    paymentRequirements:{...terms,amount:actual}};
};
test('accepts the maximum signed-i128 value for exact and upto',()=>{
  assert.equal(inspectRequest('verify',envelope('exact',max),{network,scheme:'exact'}).maximumAtomic,max);
  assert.equal(inspectRequest('settle',envelope('upto',max,'0'),{network,scheme:'upto'}).requestedAtomic,'0');
});
test('rejects over-i128 offered and actual values before BigInt conversion',()=>{
  for (const scheme of ['exact','upto']) {
    assert.throws(()=>inspectRequest('verify',envelope(scheme,over),{network,scheme}),/ACCEPTED_PAYMENT_TERMS_INVALID/);
    assert.throws(()=>inspectRequest('settle',envelope(scheme,max,over),{network,scheme}),/REQUIREMENTS_PAYMENT_TERMS_INVALID/);
  }
  assert.throws(()=>inspectRequest('verify',envelope('exact','9'.repeat(80)),
    {network,scheme:'exact'}),/ACCEPTED_PAYMENT_TERMS_INVALID/);
});
test('invalid recorded and settlement-response amounts never pass wire audit',()=>{
  assert.throws(()=>inspectResponse('settle',
    {success:true,network,transaction:'tx',amount:over},
    {network,scheme:'exact',request:envelope('exact',max)}),/SETTLED_AMOUNT_BAD/);
  const audit=auditCapture({schema:'sf38.v1',observations:[
    {id:'oversized',phase:'verify',network,scheme:'exact',request:envelope('exact',over),response:{isValid:true}}
  ]});
  assert.equal(audit.entries[0].validWire,false);
});
