// First-party SF43 official Stellar getEvents cursor contract. Offline RPC fixture,
// not a blockchain settlement or a substitute for the existing live testnet owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStellarTestnetTransaction } from '../verify.mjs';

const transaction = 'a'.repeat(64);
const asset = 'C' + 'A'.repeat(55);
const recipient = 'G' + 'A'.repeat(55);
const payer = 'G' + 'B'.repeat(55);
const receipt = {network:'stellar:testnet',success:true,transaction,payer};
const expected = {network:'stellar:testnet',asset,payTo:recipient,amount:'10000'};
const rpcEndpoint = 'http://127.0.0.1:4002/';

function paginatedRpc({validAmount=true}={}) {
  const paramsSeen = [];
  const fetchImpl = async (_endpoint, options) => {
    const {method,params}=JSON.parse(options.body);
    if (method === 'getTransaction') return {
      ok:true,json:async()=>({result:{status:'SUCCESS',txHash:transaction,ledger:123456}})
    };
    assert.equal(method,'getEvents');
    paramsSeen.push(params);
    assert.deepEqual(params.filters,[{type:'contract',contractIds:[asset]}]);
    assert.equal(params.pagination.limit,200);
    if (paramsSeen.length === 1) {
      assert.equal(params.startLedger,123456);
      assert.equal(Object.hasOwn(params.pagination,'cursor'),false);
      return {ok:true,json:async()=>({result:{
        events:[{id:'other-transaction',txHash:'b'.repeat(64),contractId:asset}],
        cursor:'next-page-token'
      }})};
    }
    if (paramsSeen.length === 2) {
      // Stellar getEvents API: pagination.cursor is mutually exclusive with
      // startLedger and endLedger. Reject a malformed second page before decoding.
      assert.equal(Object.hasOwn(params,'startLedger'),false);
      assert.equal(Object.hasOwn(params,'endLedger'),false);
      assert.equal(params.pagination.cursor,'next-page-token');
      return {ok:true,json:async()=>({result:{
        events:[{id:'matching-tx',txHash:transaction,contractId:asset,topic:['xdr'],value:'xdr'}],
        cursor:null
      }})};
    }
    throw new Error('unexpected extra Stellar RPC page');
  };
  const decodeContractEvent=async()=>({
    name:'transfer',from:payer,to:recipient,amount:validAmount?'10000':'10001'
  });
  return {paramsSeen,fetchImpl,decodeContractEvent};
}

test('genuine transaction event beyond page 1 uses cursor without startLedger',async()=>{
  const rpc=paginatedRpc();
  const result=await checkStellarTestnetTransaction({
    receipt,expected,fetchImpl:rpc.fetchImpl,rpcEndpoint,
    decodeContractEvent:rpc.decodeContractEvent
  });
  assert.equal(rpc.paramsSeen.length,2);
  assert.equal(result.status,'TOKEN_TRANSFER_MATCHED_TESTNET');
  assert.equal(result.eventId,'matching-tx');
  assert.equal(result.amountAtomic,'10000');
  assert.equal(result.payer,payer);
});

test('well-formed second-page cursor never upgrades mismatched token transfer',async()=>{
  const rpc=paginatedRpc({validAmount:false});
  const result=await checkStellarTestnetTransaction({
    receipt,expected,fetchImpl:rpc.fetchImpl,rpcEndpoint,
    decodeContractEvent:rpc.decodeContractEvent
  });
  assert.equal(rpc.paramsSeen.length,2);
  assert.equal(result.status,'TX_INCLUDED_TRANSFER_UNVERIFIED');
  assert.equal(result.reason,'NO_MATCHING_SEP41_TRANSFER');
});
