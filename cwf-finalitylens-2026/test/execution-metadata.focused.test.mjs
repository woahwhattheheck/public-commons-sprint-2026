import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSignature, DEMO_SIGNATURE, encode58 } from '../src/finality.mjs';

// Contract references: https://solana.com/docs/rpc/http/getsignaturestatuses
// https://solana.com/docs/rpc/json-structures#transaction-status-metadata
// Mock boundary regression only; no real RPC or competition-score evidence.
const providers = [
  {id:'a', label:'a', url:'https://a.example'},
  {id:'b', label:'b', url:'https://b.example'}
];
const status = () => ({slot:22, err:null, confirmationStatus:'finalized'});
const tx = () => ({
  slot:22, meta:{err:null},
  transaction:{signatures:[DEMO_SIGNATURE], message:{recentBlockhash:encode58(Buffer.alloc(32,7))}}
});
const missing = Symbol('missing');

async function inspect(statusResult, transactionResult) {
  const fetchImpl = async (_url, request) => {
    const {method} = JSON.parse(request.body);
    const result = method === 'getSignatureStatuses' ? statusResult : transactionResult;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}), {headers:{'content-type':'application/json'}});
  };
  return checkSignature(DEMO_SIGNATURE, {providers, fetchImpl, observedAt:'2026-10-09T00:00:00Z'});
}

test('unavailable metadata cannot become a cross-provider finalized agreement', async () => {
  for (const metadata of [missing, null, {}, [], false]) {
    const transaction = tx();
    if (metadata === missing) delete transaction.meta;
    else transaction.meta = metadata;
    const data = await inspect({value:[status()]}, transaction);
    assert.equal(data.assessment.verdict, 'INDETERMINATE');
    assert.deepEqual(data.providers.map(p => p.verdict), ['INCOMPLETE','INCOMPLETE']);
  }
  const noError = status(); delete noError.err;
  for (const statusResult of [{value:[noError]}, {value:[]}, {value:[false]}, {value:{0:status()}}, {value:[status(), status()]}]) {
    const data = await inspect(statusResult, tx());
    assert.equal(data.assessment.verdict, 'INDETERMINATE');
    assert.deepEqual(data.providers.map(p => p.verdict), ['UNAVAILABLE','UNAVAILABLE']);
  }
  const valid = await inspect({value:[status()]}, tx());
  assert.equal(valid.assessment.verdict, 'AGREED_FINALIZED');
  const missingStatus = await inspect({value:[null]}, null);
  assert.equal(missingStatus.assessment.verdict, 'PENDING');
  const failedStatus = status(); failedStatus.err = {InstructionError:[0,'Custom']};
  const failed = await inspect({value:[failedStatus]}, null);
  assert.equal(failed.assessment.verdict, 'AGREED_EXECUTION_ERROR');
  const failedTx = tx(); failedTx.meta.err = {InstructionError:[0,'Custom']};
  const inconsistent = await inspect({value:[status()]}, failedTx);
  assert.equal(inconsistent.assessment.verdict, 'INDETERMINATE');
  assert.deepEqual(inconsistent.providers.map(p => p.verdict), ['INCONSISTENT','INCONSISTENT']);
});
