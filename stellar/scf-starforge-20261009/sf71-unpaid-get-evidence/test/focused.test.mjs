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

test('SF56 native raw-page envelope is accepted only for a complete original-source snapshot',()=>{
  const provider='https://vellar-facilitator-testnet-production.up.railway.app';
  const payTo='G'+'A'.repeat(55),asset='C'+'A'.repeat(55);
  const native={x402Version:2,type:'http',resource:seller,
    accepts:[{network:'stellar:testnet',scheme:'exact',asset,amount:'100',payTo}],
    extensions:{bazaar:{info:{input:{type:'http',method:'GET'}}}}};
  const sf52={...report('NOT_HTTP_402',400),desiredPayTo:payTo,
    catalog:{endpoint:provider+'/discovery/resources',complete:true}};
  const raw=(total)=>({source:provider,capturedAt:'2026-10-11T06:00:00Z',
    pages:[{offset:0,body:JSON.stringify({items:[native],pagination:{offset:0,limit:100,total}})}]});
  const ready=reconcile(sf52,raw(1));
  assert.equal(ready.original.captureFormat,'SF56_NATIVE_RAW_PAGE_BODIES');
  assert.equal(ready.sourceCatalog.rowsWithPairedNetworkAndPayTo,1);
  assert.equal(ready.interpretation.checkoutFailureProven,false);
  assert.throws(()=>reconcile(sf52,raw(2)),/Incomplete original provider snapshot/);
});

test('SF56 native HTTP method does not require redundant input.type',()=>{
  const provider='https://vellar-facilitator-testnet-production.up.railway.app';
  const payTo='G'+'A'.repeat(55),asset='C'+'A'.repeat(55);
  const native={x402Version:2,type:'http',resource:seller,
    accepts:[{network:'stellar:testnet',scheme:'exact',asset,amount:'100',payTo}],
    extensions:{bazaar:{info:{input:{method:'GET'}}}}};
  const sf52={...report('NOT_HTTP_402',400),desiredPayTo:payTo,
    catalog:{endpoint:provider+'/discovery/resources',complete:true}};
  const raw={source:provider,capturedAt:'2026-10-11T06:00:00Z',pages:[{offset:0,
    body:JSON.stringify({items:[native],pagination:{offset:0,limit:100,total:1}})}]};
  const result=reconcile(sf52,raw);
  assert.deepEqual(result.sourceCatalog.methods,['GET']);
  assert.equal(result.sourceCatalog.getOperationRows,1);
});

test('saved SF56 capture rejects a premature short page before a later offset',()=>{
  const provider='https://vellar-facilitator-testnet-production.up.railway.app';
  const payTo='G'+'A'.repeat(55),asset='C'+'A'.repeat(55);
  const listing=(path)=>({x402Version:2,type:'http',resource:`https://seller.example/${path}`,
    accepts:[{network:'stellar:testnet',scheme:'exact',asset,amount:'100',payTo}],
    extensions:{bazaar:{info:{input:{method:'GET'}}}}});
  const sf52={...report('NOT_HTTP_402',400),desiredPayTo:payTo,
    catalog:{endpoint:provider+'/discovery/resources',complete:true}};
  const raw={source:provider,capturedAt:'2026-10-11T06:00:00Z',pages:[
    {offset:0,body:JSON.stringify({items:[listing('weather')],pagination:{offset:0,limit:100,total:2}})},
    {offset:100,body:JSON.stringify({items:[listing('other')],pagination:{offset:100,limit:100,total:2}})}
  ]};
  assert.throws(()=>reconcile(sf52,raw),/Premature short page/);
});

