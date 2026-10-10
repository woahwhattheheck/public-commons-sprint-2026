import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeX402Header,parseExactTestnetTerms,checkStellarTestnetTransaction,parseSep41TransferAmount} from '../verify.mjs';

const hash='a'.repeat(64);
const asset='C'+'A'.repeat(55), recipient='G'+'A'.repeat(55);
const expected={network:'stellar:testnet',asset,payTo:recipient,amount:'10000'};
const payer='G'+'B'.repeat(55);
const receipt={network:'stellar:testnet',success:true,transaction:hash,payer};
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
    decodeContractEvent:async()=>({name:'transfer',from:payer,to:recipient,amount:'10000'})});
  assert.equal(check.status,'TOKEN_TRANSFER_MATCHED_TESTNET');assert.equal(check.amountAtomic,expected.amount);
});
test('mismatched amount, recipient or asset cannot be approved by event text',async()=>{
  for (const type of ['amount','recipient','asset']) {
    const event={id:'a',txHash:hash,contractId:type==='asset'?'C'+'B'.repeat(55):asset,topic:['signed XDR'],value:'signed XDR'};
    const transfer={name:'transfer',from:payer,to:type==='recipient'?'G'+'B'.repeat(55):recipient,
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


test('official SEP-41/CAP-67 SDK-native scalar and map transfer amounts reconcile, without map stringification',async()=>{
  const nativeVariants=[
    10000n,
    {amount:10000n},
    {amount:10000n,to_muxed_id:null},
    new Map([['amount',10000n],['to_muxed_id',null]])
  ];
  const evt={id:'new-map',txHash:hash,contractId:asset,topic:['XDR'],value:'XDR'};
  for(const native of nativeVariants){
    const amount=parseSep41TransferAmount(native);
    assert.equal(amount,'10000');
    const check=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc('SUCCESS',[evt]),rpcEndpoint:local,
      decodeContractEvent:async()=>({name:'transfer',from:payer,to:recipient,amount})});
    assert.equal(check.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
  }
  for(const invalid of [
    {amount:10000n,to_muxed_id:7n},
    {amount:10000n,to_muxed_id:'memo'},
    {amount:10000n,unknown_field:true},
    {to_muxed_id:null},
    {amount:0n},0n,-1n,'1e4','010000',2**54,[],null
  ]) assert.equal(parseSep41TransferAmount(invalid),null);
  const noProof=await checkStellarTestnetTransaction({receipt,expected,fetchImpl:fakeRpc('SUCCESS',[evt]),rpcEndpoint:local,
    decodeContractEvent:async()=>({name:'transfer',to:recipient,amount:parseSep41TransferAmount({amount:10000n,to_muxed_id:1})})});
  assert.equal(noProof.status,'TX_INCLUDED_TRANSFER_UNVERIFIED');
});


test('real x402 settlement payer is required, and independently decoded SEP41 transfer.from must match',async()=>{
  const event={id:'payer-bound',txHash:hash,contractId:asset,topic:['XDR'],value:'XDR'};
  const rpc=fakeRpc('SUCCESS',[event]);
  const observed=async from=>({name:'transfer',from,to:recipient,amount:'10000'});
  const valid=await checkStellarTestnetTransaction({receipt,expected:{...expected,payer},
    fetchImpl:rpc,rpcEndpoint:local,decodeContractEvent:()=>observed(payer)});
  assert.equal(valid.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
  assert.equal(valid.payer,payer);

  const different='G'+'C'.repeat(55);
  const mismatchedEvent=await checkStellarTestnetTransaction({receipt,expected,
    fetchImpl:rpc,rpcEndpoint:local,decodeContractEvent:()=>observed(different)});
  assert.equal(mismatchedEvent.status,'TX_INCLUDED_TRANSFER_UNVERIFIED');

  // An x402 seller-reported payer is not independent signer proof. Wrong
  // source or missing reported payer must never be upgraded to a paid match.
  for(const bad of [undefined,'invalid','G'+'D'.repeat(55)]){
    const check=await checkStellarTestnetTransaction({receipt:{...receipt,payer:bad},expected,
      fetchImpl:rpc,rpcEndpoint:local,decodeContractEvent:()=>observed(payer)});
    assert.notEqual(check.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
  }
  let touched=false;
  const wrongExpectation=await checkStellarTestnetTransaction({receipt,expected:{...expected,payer:different},
    fetchImpl:async()=>{touched=true;throw Error('preflight must stop');},rpcEndpoint:local,
    decodeContractEvent:()=>observed(payer)});
  assert.equal(wrongExpectation.reason,'EXPECTED_PAYER_MISMATCH');
  assert.equal(touched,false);

  // A C-address can be a signed Soroban auth payer; do not equate the
  // facilitator's transaction source with an authorized payer.
  const contractPayer='C'+'C'.repeat(55);
  const contractMatch=await checkStellarTestnetTransaction({
    receipt:{...receipt,payer:contractPayer},expected:{...expected,payer:contractPayer},
    fetchImpl:rpc,rpcEndpoint:local,decodeContractEvent:()=>observed(contractPayer)});
  assert.equal(contractMatch.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
});
