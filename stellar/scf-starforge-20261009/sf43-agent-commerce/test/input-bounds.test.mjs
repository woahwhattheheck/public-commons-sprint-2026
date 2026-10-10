import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExactTestnetTerms, checkStellarTestnetTransaction } from '../verify.mjs';
const asset='C'+'A'.repeat(55), payTo='G'+'A'.repeat(55), payer='G'+'B'.repeat(55);
const quote={x402Version:2,accepts:[{scheme:'exact',network:'stellar:testnet',
 asset,payTo,amount:'10000'}]};
test('operator cap bounds reject oversized values and preserve normal caps',()=>{
  assert.throws(()=>parseExactTestnetTerms(quote,'9'.repeat(1000)),/Explicit positive maximum/);
  assert.equal(parseExactTestnetTerms(quote,'10000').accepts,undefined);
  assert.equal(parseExactTestnetTerms(quote,10000n).amount,'10000');
});
test('invalid event budgets fail before the RPC request',async()=>{
  let requested=false;
  const outcome=await checkStellarTestnetTransaction({
    receipt:{network:'stellar:testnet',success:true,transaction:'a'.repeat(64),payer},
    expected:{network:'stellar:testnet',asset,payTo,amount:'10000'},
    maxEventPages:Infinity,
    fetchImpl:async()=>{requested=true;throw Error('unexpected request');}
  });
  assert.equal(outcome.reason,'EVENT_PAGE_BUDGET_INVALID');
  assert.equal(requested,false);
});
