import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile} from '../triage.mjs';

const seller = 'https://seller.example/weather';
const catalogUrl = 'https://facilitator.example/discovery/resources';
const recipient = 'GTESTPUBLICRECIPIENT';
const report = (state, httpStatus) => ({
  schema:'stellar-forge.seller-visibility.v1',mode:'READ_ONLY_UNAUTHENTICATED',
  seller, network:'stellar:testnet',desiredPayTo:recipient,
  verdict:'LISTED',challenge:{state,...(httpStatus === null ? {} : {httpStatus})},
  catalog:{endpoint:catalogUrl,complete:true,matchingResourceCount:1}
});
const record = (network = 'stellar:testnet', payTo = recipient) => ({
  resource:{url:seller},type:'http',accepts:[{network,payTo,scheme:'exact',amount:'100'}],
  extensions:{bazaar:{info:{input:{type:'http',method:'GET',queryParams:{city:'Lahore'}}}}}
});
const capture = rows => ({url:catalogUrl,pages:[{items:rows}],complete:true,observedAt:'2026-10-11T05:00:00Z'});

test('original SF52 GET 400 remains request rejection; query examples never become required params or checkout loss',()=>{
  const r=reconcile(report('NOT_HTTP_402',400),capture([record()]));
  assert.equal(r.observed.classification,'GET_HTTP_400_REQUEST_REJECTED');
  assert.deepEqual(r.sourceCatalog.exampleKeysAbsentFromProbeUrl,['city']);
  assert.equal(r.interpretation.requiredQueryKeysProven,false);
  assert.equal(r.interpretation.missingParameterCauseProven,false);
  assert.equal(r.interpretation.checkoutFailureProven,false);
});

test('402 is a challenge, not a settlement; never combine terms from different offers',()=>{
  const r=reconcile(report('X402_402',402),capture([
    record('stellar:pubnet',recipient), record('stellar:testnet','GOTHERRECIPIENT')
  ]));
  assert.equal(r.observed.classification,'GET_HTTP_402_PAYMENT_CHALLENGE_OBSERVED');
  assert.equal(r.sourceCatalog.rowsWithPairedNetworkAndPayTo,0);
  assert.equal(r.interpretation.paymentOrSettlementVerified,false);
});

test('schema / source attribution rejects a mismatched capture; GET skipped remains unobserved',()=>{
  assert.throws(()=>reconcile(report('NOT_HTTP_402',400), {...capture([]),url:'https://wrong.example/discovery/resources'}), /matching url/);
  const skipped=reconcile(report('CATALOG_NON_GET_ONLY',null),capture([record()]));
  assert.equal(skipped.observed.classification,'GET_NOT_PERFORMED_BY_SF52');
  assert.equal(skipped.observed.sellerOriginGetObserved,false);
});
