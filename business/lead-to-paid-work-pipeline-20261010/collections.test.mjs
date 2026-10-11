import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateAll, renderHtml, renderMarkdown } from './pipeline.mjs';
import { collectionQueueCsv } from './collections.mjs';

const now = new Date('2026-10-11T12:00:00Z');
const stages = ['BUYER_CONFIRMED','PRIME_CONFIRMED','PARTNER_REPLIED','SOW_SIGNED'];
const op = id => ({ owner:'Synthetic operator', buyer:{ name:'Example buyer', opportunityId:id, revision:'v1',
  status:'OPEN', sourceUrl:'https://example.invalid/buyer', deadline:{isoWithOffset:'2026-11-01T17:00:00+00:00',confirmed:true}},
  requirements:[{id:'eligibility',mandatory:true}], partners:[],
  events:stages.map((kind,i)=>({kind,timestamp:`2026-10-01T0${i}:00:00Z`,receiptUrl:`https://example.invalid/${kind}`})) });
const payment = (transactionId, amountMinor, more={}) => ({kind:'PAYMENT',provider:'example-provider',accountId:'example-business',
  transactionId, amountMinor, currency:'USD',timestamp:'2026-10-03T12:00:00Z',receiptUrl:`https://example.invalid/receipt/${transactionId}`,...more});
const invoice = (receipts, more={}) => ({invoiceId:'INV-example',currency:'USD',amountMinor:100000,
  issuedAt:'2026-10-02T12:00:00Z',dueAt:'2026-10-10T12:00:00Z',receiptUrl:'https://example.invalid/invoice',receipts,...more});
const modern = (id, invoices) => ({...op(id),receivables:invoices});

test('installments settle an invoice; a later partial refund reopens the exact balance', () => {
  const first = payment('deposit',40000), final = payment('balance',60000,{timestamp:'2026-10-04T12:00:00Z'});
  const deal = modern('partial',[invoice([first,final])]);
  const settled = evaluateAll([deal],now);
  assert.equal(settled.collections.invoices[0].state,'SETTLED');
  assert.equal(settled.collections.invoices[0].outstandingMinor,0);
  assert.equal(collectionQueueCsv(settled.collections).trim().split('\n').length,1);
  deal.receivables[0].receipts.push(payment('refund-1',15000,{kind:'REFUND',parentTransactionId:'balance',timestamp:'2026-10-05T12:00:00Z'}));
  const reopened = evaluateAll([deal],now);
  const row = reopened.collections.invoices[0];
  assert.deepEqual([row.receivedMinor,row.refundedMinor,row.netMinor,row.outstandingMinor],[100000,15000,85000,15000]);
  assert.equal(row.state,'REOPENED_AFTER_REFUND'); assert.equal(row.overdue,true);
  assert.equal(reopened.decisions[0].recordedNetUsd,850);
  assert.match(collectionQueueCsv(reopened.collections),/REOPENED_AFTER_REFUND/);
});

test('same provider transaction assigned to two opportunities is quarantined everywhere, independent of input order', () => {
  const a=modern('one',[invoice([payment('shared',40000)])]), b=modern('two',[invoice([payment('shared',40000)])]);
  for (const deals of [[a,b],[b,a]]) {
    const result=evaluateAll(deals,now);
    assert.equal(result.collections.currencies[0].netMinor,0);
    assert.ok(result.decisions.every(x=>x.recordedNetUsd===0 && x.collections.reviewRequired));
    assert.ok(result.collections.issues.every(x=>x.code==='TRANSACTION_CONFLICT_QUARANTINED'));
  }
});

test('replayed receipts count once; conflicting amounts count neither version', () => {
  const p=payment('one',25000), deal=modern('replay',[invoice([p,{...p}])]);
  const once=evaluateAll([deal],now).collections;
  assert.equal(once.currencies[0].netMinor,25000); assert.equal(once.invoices[0].duplicateReplays,1);
  deal.receivables[0].receipts[1].amountMinor=26000;
  assert.equal(evaluateAll([deal],now).collections.currencies[0].netMinor,0);
});

test('refunds require matching invoice, currency and bounded original payment', () => {
  const receipts=[payment('paid',30000),payment('too-large',40000,{kind:'REFUND',parentTransactionId:'paid',timestamp:'2026-10-04T00:00:00Z'}),
    payment('wrong-currency',100,{kind:'REFUND',currency:'EUR',parentTransactionId:'paid'}),
    payment('missing-parent',100,{kind:'REFUND',parentTransactionId:'not-present'})];
  const other=invoice([payment('wrong-invoice',100,{kind:'REFUND',parentTransactionId:'paid'})],{invoiceId:'other'});
  const ledger=evaluateAll([modern('refunds',[invoice(receipts),other])],now).collections;
  assert.equal(ledger.currencies[0].netMinor,30000);
  assert.deepEqual(new Set(ledger.issues.map(x=>x.code)),new Set(['REFUND_EXCEEDS_PARENT_PAYMENT','CURRENCY_MISMATCH','REFUND_PARENT_NOT_ACCEPTED','REFUND_PARENT_INVOICE_MISMATCH']));
});

test('currencies and provider accounts stay separate; a shared transaction label is not an FX total', () => {
  const usd=invoice([payment('charge',10000)]);
  const eur=invoice([payment('charge',12000,{accountId:'euro-account',currency:'EUR'})],{invoiceId:'EUR-invoice',currency:'EUR'});
  const ledger=evaluateAll([modern('fx',[usd,eur])],now);
  assert.deepEqual(ledger.collections.currencies.map(x=>[x.currency,x.netMinor]),[['EUR',12000],['USD',10000]]);
  assert.equal(ledger.decisions[0].recordedNetUsd,100);
});

test('future events and invalid calendar dates never create current money', () => {
  for (const timestamp of ['2026-10-12T00:00:00Z','2026-02-30T00:00:00Z','2026-10-03T24:00:00Z']) {
    const ledger=evaluateAll([modern('date',[invoice([payment('not-yet',10000,{timestamp})])])],now).collections;
    assert.equal(ledger.currencies[0].netMinor,0); assert.equal(ledger.issues[0].code,'INVALID_OR_FUTURE_RECEIPT_TIME');
  }
});

test('legacy payment remains supported but has unknown invoice balance; future and sub-cent values fail', () => {
  const deal=op('legacy');
  deal.events.push({kind:'INVOICE_SENT',timestamp:'2026-10-02T12:00:00Z',receiptUrl:'https://example.invalid/invoice'},
    {kind:'PAYMENT_CONFIRMED',timestamp:'2026-10-03T12:00:00Z',receiptUrl:'https://example.invalid/payment',transactionId:'legacy-tx',amountUsd:125.25});
  const single=evaluate(deal,now), batch=evaluateAll([deal],now);
  assert.equal(single.provenPaidUsd,125.25); assert.match(single.cashReconciliation,/NOT_DUPLICATE_CLEARED/);
  assert.equal(batch.decisions[0].recordedNetUsd,125.25); assert.equal(batch.collections.invoices[0].outstandingMinor,null);
  const twin=structuredClone(deal); twin.buyer.opportunityId='legacy-two';
  assert.equal(evaluateAll([deal,twin],now).collections.currencies[0].netMinor,0);
  for (const change of [{timestamp:'2026-10-12T00:00:00Z'},{amountUsd:0.001}]) {
    const altered=structuredClone(deal); Object.assign(altered.events.at(-1),change);
    assert.equal(evaluate(altered,now).provenPaidUsd,0);
  }
});

test('no signed scope, unsafe amounts or malformed invoice means review, and source/owner gates remain held', () => {
  const unsigned=modern('unsigned',[invoice([payment('x',100)])]); unsigned.events=[];
  assert.equal(evaluateAll([unsigned],now).collections.invoices.length,0);
  const bad=modern('unsafe',[invoice([payment('unsafe',Number.MAX_SAFE_INTEGER+1)])]);
  const result=evaluateAll([bad],now);
  assert.equal(result.decisions[0].recordedNetUsd,0); assert.equal(result.decisions[0].readyForOwnerApproach,false);
  assert.ok(result.decisions[0].blockers.includes('OWNER_CONTACT_APPROVAL_REQUIRED'));
  const csvText=collectionQueueCsv(evaluateAll([modern('csv',[invoice([],{invoiceId:'=2+2'})])],now).collections);
  assert.match(csvText,/'=2\+2/);
  assert.match(renderMarkdown(result.decisions,now),/Recorded net USD/);
  assert.ok(renderHtml(result.decisions,now).includes('Offline operator decision board'));
});
