// Focused SF52 reducer test, grounded in the exported SF31 and SF43 result contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBuyerResult,captureBuyerError,analyzeOne,aggregateOutcomes} from '../outcomes.mjs';
const tx='a'.repeat(64), sha='b'.repeat(64), at='2026-10-10T06:00:00.000Z';
const requireTerms={scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),
  payTo:'G'+'B'.repeat(55),amount:'25000',maxTimeoutSeconds:60};
const buyer = id=>({intentId:id,status:'DELIVERED_REPORTED_SETTLED',attempts:2,
  settlement:'REPORTED_SUCCESS',requirement:requireTerms,httpStatus:200,
  receipt:{network:'stellar:testnet',transaction:tx,success:true},
  response:{headers:{'PAYMENT-SIGNATURE':'SECRET-NEVER-SERIALIZE'}}});
const chain={status:'TOKEN_TRANSFER_MATCHED_TESTNET',network:'stellar:testnet',transaction:tx,
  contractId:requireTerms.asset,recipient:requireTerms.payTo,amountAtomic:'25000',ledger:123,
  proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH'};
const delivery={status:'HTTP_BODY_OBSERVED',httpStatus:200,bodySha256:sha};
test('reported payment is not counted as a verified transfer',()=>{
  const r=captureBuyerResult(buyer('i-one'),{observedAt:at});
  assert.equal(JSON.stringify(r).includes('SECRET-NEVER-SERIALIZE'),false);
  const a=aggregateOutcomes([r]);
  assert.equal(a.outcomes[0].status,'SELLER_REPORTED_ONLY');
  assert.equal(a.counts.verifiedTransfers,0);assert.equal(a.counts.sellerReportedSuccess,1);
});
test('SF43 exact transfer evidence and HTTP body are separate gates',()=>{
  const r={...captureBuyerResult(buyer('i-two'),{observedAt:at}),chain,delivery};
  assert.equal(analyzeOne(r).status,'TRANSFER_AND_HTTP_BODY_OBSERVED');
  const secondTx='c'.repeat(64);
  const independent={...r,intentId:'i-three',delivery:null,
    buyer:{...r.buyer,receipt:{...r.buyer.receipt,transaction:secondTx}},
    chain:{...chain,transaction:secondTx}};
  const agg=aggregateOutcomes([r,independent]);
  assert.equal(agg.counts.verifiedTransfers,2);assert.equal(agg.counts.transferAndBodyObserved,1);
  assert.equal(agg.observedTransferAtomicByAsset[0].atomicTotal,'50000');
});
test('reused on-chain proof under distinct intents cannot inflate verified transfers',()=>{
  const first={...captureBuyerResult(buyer('i-proof-a'),{observedAt:at}),chain,delivery};
  const alias={...first,intentId:'i-proof-b'};
  assert.throws(()=>aggregateOutcomes([first,alias]),/DUPLICATE_CHAIN_TRANSFER_PROOF/);
  // A forged conflicting ledger cannot launder the same transaction and event.
  assert.throws(()=>aggregateOutcomes([first,{...alias,chain:{...chain,ledger:124}}]),
    /DUPLICATE_CHAIN_TRANSFER_PROOF/);
  // An unverified seller receipt is not independently counted and is not
  // affected by the duplicate chain-proof fence.
  const sellerOnly={...alias,chain:null,delivery:null};
  assert.equal(aggregateOutcomes([first,sellerOnly]).counts.verifiedTransfers,1);
});
test('network/amount/recipient mismatches cannot claim paid success',()=>{
  const r=captureBuyerResult(buyer('i-four'),{observedAt:at});
  const bad={...chain,amountAtomic:'25001'};
  assert.equal(analyzeOne({...r,chain:bad,delivery}).status,'PROOF_CONFLICT');
  assert.equal(aggregateOutcomes([{...r,chain:bad,delivery}]).counts.verifiedTransfers,0);
});
test('pending, throw after signed send, duplicates and unsafe evidence',()=>{
  const r=captureBuyerResult(buyer('i-five'),{observedAt:at});
  const pending={...r,buyer:{...r.buyer,status:'SETTLEMENT_PENDING',settlement:'PENDING',receipt:{network:'stellar:testnet',transaction:tx,success:false}}};
  assert.equal(analyzeOne(pending).status,'PENDING_RECONCILIATION');
  const e=captureBuyerError({intentId:'i-six',error:{code:'PAYMENT_OUTCOME_UNKNOWN',paymentSent:true,
    cause:{secret:'private'}},observedAt:at});
  assert.equal(analyzeOne(e).status,'SIGNED_RESULT_UNCERTAIN');
  assert.equal(JSON.stringify(e).includes('private'),false);
  assert.throws(()=>aggregateOutcomes([r,r]),/DUPLICATE_INTENT_ID/);
  assert.equal(analyzeOne({...r,chain:{...chain,network:'stellar:pubnet'},delivery}).status,'PROOF_CONFLICT');
});
