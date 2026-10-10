import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeX402Header,parseExactTestnetTerms,checkStellarTestnetTransaction} from '../verify.mjs';

const hash='a'.repeat(64);
const asset='C'+'A'.repeat(55), recipient='G'+'A'.repeat(55);
const expected={network:'stellar:testnet',asset,payTo:recipient,amount:'10000'};
const receipt={network:'stellar:testnet',success:true,transaction:hash};
const quote={x402Version:2,resource:{url:'https://stellar.org/x402-demo/api/protected/testnet'},
  accepts:[{scheme:'exact',...expected,maxTimeoutSeconds:60}]};
function fakeRpc(status='SUCCESS',events=[],ledger=123456){
  return async(_url,opts)=>{
    const body=JSON.parse(opts.body);
    const value=body.method==='getTransaction'
      ?{status,txHash:hash,ledger,latestLedger:ledger+1}
      :{events,pagination:{cursor:null}};
    return {ok:true,json:async()=>({jsonrpc:'2.0',id:body.id,result:value})};
  };
}
const local='http://127.0.0.1:4002/';

test('accepts canonical header and rejects malformed/noncanonical JSON',()=>{
  const value={x402Version:2};
  assert.deepEqual(decodeX402Header(Buffer.from(JSON.stringify(value)).toString('base64')),value);
  assert.throws(()=>decodeX402Header('@@@'));assert.throws(()=>decodeX402Header('e30='+'junk'));
});
test('payment bound to actual Stellar testnet v2 recipient, contract and max baseunits',()=>{
  assert.equal(parseExactTestnetTerms(quote,'10000').amount,'10000');
  assert.throws(()=>parseExactTestnetTerms(quote,'9999'),/exceeds/);
  assert.throws(()=>parseExactTestnetTerms({...quote,accepts:[...quote.accepts,...quote.accepts]},'10000'),/unambiguous/);
  assert.throws(()=>parseExactTestnetTerms({...quote,accepts:[{...quote.accepts[0],network:'stellar:pubnet'}]},'10000'),/Unexpected/);
  assert.throws(()=>parseExactTestnetTerms({...quote,accepts:[{...quote.accepts[0],payTo:'UNVERIFIED_PLACEHOLDER'}]},'10000'),/Unexpected/);
});
test('seller-reported success alone never proves onchain paid',async()=>{
  let used=false;
  const check=await checkStellarTestnetTransaction({receipt:{...receipt,transaction:'wrong'},expected,
    fetchImpl:async()=>{used=true;throw Error('should not fetch')}});
  assert.equal(check.status,'NOT_VERIFIED');assert.equal(used,false);
});
test('authoritative RPC NOT_FOUND and FAILED cannot be promoted to success',async()=>{
  for(const status of ['NOT_FOUND','FAILED']){
    const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc(status),rpcEndpoint:local});
    assert.equal(check.status,'NOT_VERIFIED');
  }
});
test('RPC transaction inclusion is NOT sufficient evidence of SEP-41 transfer',async()=>{
  const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc(),rpcEndpoint:local});
  assert.equal(check.status,'TX_INCLUDED_TRANSFER_UNVERIFIED');
  assert.equal(check.transaction,hash);assert.equal(check.ledger,123456);
});
test('matching RPC transfer event uses decoded recipient, token contract and exact atomic amount',async()=>{
  const evt={id:'a',txHash:hash,contractId:asset,topic:['signed XDR'],value:'signed XDR'};
  const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc('SUCCESS',[evt]),rpcEndpoint:local,
    decodeContractEvent:async()=>({name:'transfer',to:recipient,amount:'10000'})});
  assert.equal(check.status,'TOKEN_TRANSFER_MATCHED_TESTNET');assert.equal(check.amountAtomic,expected.amount);
});
test('mismatched amount, recipient or asset cannot be approved by event text',async()=>{
  for (const type of ['amount','recipient','asset']) {
    const event={id:'a',txHash:hash,contractId:type==='asset'?'C'+'B'.repeat(55):asset,topic:['signed XDR'],value:'signed XDR'};
    const transfer={name:'transfer',to:type==='recipient'?'G'+'B'.repeat(55):recipient,
      amount:type==='amount'?'10001':'10000'};
    const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc('SUCCESS',[event]),rpcEndpoint:local,
      decodeContractEvent:async()=>transfer});
    assert.equal(check.status,'TX_INCLUDED_TRANSFER_UNVERIFIED');
  }
});
test('RPC error remains an error, never becomes settlement evidence',async()=>{
  const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:async()=>({ok:false,status:429}),rpcEndpoint:local});
  assert.equal(check.status,'NOT_VERIFIED');assert.equal(check.reason,'RPC_TRANSACTION_LOOKUP_FAILED');
});
