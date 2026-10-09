/** Synthetic first-party PayPal-status interpretation only; no funds/API/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile} from '../src/reconcile.mjs';

const statuses = ['SUCCESS','REFUNDED','REVERSED','UNCLAIMED',
  'PENDING','ONHOLD','RETURNED','FAILED','BLOCKED','DENIED'];
const records = statuses.map((status,i)=>({
  payout_item_id:`test-item-${i}`,
  transaction_status:status,
  payout_item:{
    sender_item_id:`synthetic-reference-${i}`,
    amount:{currency:'USD',value:'1.00'},
    receiver:`fictional-${i}@example.test`,
    note:'Approved contractor milestone payment under agreement'
  }
}));
const batch = [{
  total_pages:1,
  total_items:records.length,
  batch_header:{payout_batch_id:'SYNTHETIC_PAYPAL_STATUSES',batch_status:'SUCCESS',
    amount:{currency:'USD',value:'10.00'}},
  items:records
}];

test('provider payout status gates cannot report uncredited money as clear',()=>{
  const result=reconcile(batch,{source:'synthetic',now:'2026-10-09T00:00:00.000Z'});
  const byStatus=Object.fromEntries(result.items.map(r=>[r.status,r]));
  assert.equal(result.totals.match,true);
  assert.equal(result.totals.itemSum,'10.00');
  assert.equal(result.totals.count,records.length);
  assert.equal(result.totals.unresolved,3);
  assert.equal(byStatus.SUCCESS.severity,'clear');
  assert.deepEqual(byStatus.SUCCESS.flags,[]);
  for(const status of ['REFUNDED','REVERSED','RETURNED','FAILED','BLOCKED','DENIED']){
    assert.equal(byStatus[status].severity,'high',status);
    assert.ok(byStatus[status].flags.includes('FAILED_OR_RETURNED'),status);
    assert.ok(!byStatus[status].flags.includes('NONFINAL_STATUS'),status);
  }
  for(const status of ['UNCLAIMED','PENDING','ONHOLD']){
    assert.equal(byStatus[status].severity,'review',status);
    assert.ok(byStatus[status].flags.includes('NONFINAL_STATUS'),status);
    assert.ok(!byStatus[status].flags.includes('FAILED_OR_RETURNED'),status);
  }
  // Preserve source status and exact monetary evidence; never infer payment from ML.
  for(const r of result.items){assert.equal(r.amount,'1.00');assert.equal(r.currency,'USD');}
});
