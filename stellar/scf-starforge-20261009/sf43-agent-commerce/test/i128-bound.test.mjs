// MIT. Actual SF43 verifier-module regression for Stellar signed Soroban i128.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExactTestnetTerms, parseSep41TransferAmount, checkStellarTestnetTransaction} from '../verify.mjs';

const max='170141183460469231731687303715884105727';
const above='170141183460469231731687303715884105728';
const asset='C'+'A'.repeat(55);
const payTo='G'+'A'.repeat(55);
const payer='G'+'B'.repeat(55);
const quote=amount=>({x402Version:2,accepts:[{
  scheme:'exact',network:'stellar:testnet',asset,payTo,amount,maxTimeoutSeconds:60
}]});

test('SF43 quote accepts exact signed-i128 maximum and refuses max+1',()=>{
  assert.equal(parseExactTestnetTerms(quote(max),max).amount,max);
  assert.throws(()=>parseExactTestnetTerms(quote(above),above),/Unexpected Stellar testnet/);
  assert.throws(()=>parseExactTestnetTerms(quote('9'.repeat(10000)),'9'.repeat(10000)),/Unexpected Stellar testnet/);
  // An operator policy bound may be larger; the actual quoted onchain amount cannot be.
  assert.equal(parseExactTestnetTerms(quote('10000'),above).amount,'10000');
});

test('SDK-native scalar and SEP-41/SAC map amounts preserve i128 boundaries',()=>{
  const upper=BigInt(max), too=BigInt(above);
  for(const variant of [max,upper,{amount:max},{amount:upper},
    {amount:upper,to_muxed_id:null},new Map([['amount',upper],['to_muxed_id',null]])]){
    assert.equal(parseSep41TransferAmount(variant),max);
  }
  for(const variant of [above,too,{amount:above},{amount:too},
    {amount:too,to_muxed_id:null},new Map([['amount',too],['to_muxed_id',null]]),
    '9'.repeat(10000),0n,-1n,'0','01']){
    assert.equal(parseSep41TransferAmount(variant),null);
  }
  assert.equal(parseSep41TransferAmount(10000),'10000');
});

test('read-only transaction preflight refuses impossible amount before RPC',async()=>{
  let rpcCalled=false;
  const result=await checkStellarTestnetTransaction({
    receipt:{network:'stellar:testnet',success:true,transaction:'a'.repeat(64),payer},
    expected:{network:'stellar:testnet',asset,payTo,amount:above},
    fetchImpl:async()=>{rpcCalled=true;throw Error('RPC should not be used');}
  });
  assert.equal(result.status,'NOT_VERIFIED');
  assert.equal(result.reason,'TERMS_INVALID');
  assert.equal(rpcCalled,false);
});
