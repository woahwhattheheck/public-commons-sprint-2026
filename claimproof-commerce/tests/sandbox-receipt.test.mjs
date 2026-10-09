import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSandboxReceipt} from '../src/receipt.mjs';

const reviewId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fp='e'.repeat(64);
function fixture(state='CAPTURED') {
  return {state,cart:{currency:'USD',total:'19.99',fingerprint:fp},order:{order_id:'ORDER123456789'}};
}
test('export requires fresh completed matching sandbox capture',()=>{
  const completed={status:'COMPLETED',order_status:'COMPLETED',id:'CAPTURE123456789'};
  const r=makeSandboxReceipt(fixture(),completed,reviewId,'2026-10-09T08:00:00.000Z');
  assert.equal(r.record_type,'claimproof-sandbox-capture-observation-v1');
  assert.equal(r.payment_authority,false);
  assert.equal(r.live_payment,false);
  assert.equal(r.provider_signed,false);
  assert.equal(r.capture_id,completed.id);
  for(const state of ['PENDING','DECLINED','FAILED','REFUNDED','VOIDED','NOT_CAPTURED']){
    assert.throws(()=>makeSandboxReceipt(fixture(),{...completed,status:state},reviewId));
  }
  assert.throws(()=>makeSandboxReceipt(fixture('CAPTURE_PENDING'),completed,reviewId));
  assert.throws(()=>makeSandboxReceipt(fixture(),{...completed,order_status:'APPROVED'},reviewId));
  assert.throws(()=>makeSandboxReceipt({...fixture(),cart:{...fixture().cart,currency:'EUR'}},completed,reviewId));
});
