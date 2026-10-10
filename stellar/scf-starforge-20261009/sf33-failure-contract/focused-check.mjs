import assert from 'node:assert/strict';
import {explainFailure,gateNextAction} from './contract.mjs';

let f = explainFailure({stage:'verify',reason:'invalid_payload',response:{invalidReason:'rate_limited',isValid:false},retryAfterMs:500});
assert.equal(f.code,'rate_limited');
assert.equal(f.safeToAutoRetry,true);
assert.equal(f.retryAfterMs,500);
assert.equal(gateNextAction(f).decision,'retry_read_only_operation');

f = explainFailure({stage:'settle',response:{success:false,errorReason:'timeout'}});
assert.equal(f.safeToAutoRetry,false);
assert.equal(f.recoveryAction,'reconcile_settlement');
assert.equal(gateNextAction(f).decision,'reconcile_before_any_new_payment');

f = explainFailure({stage:'settle',response:{success:false,errorReason:'settlement_pending',transaction:'abc',network:'stellar:testnet'}});
assert.equal(gateNextAction(f,{ledgerReceipt:{confirmed:true,success:true,transaction:'other',network:'stellar:testnet'}}).decision,'reconcile_before_any_new_payment');
assert.equal(gateNextAction(f,{ledgerReceipt:{confirmed:true,success:true,transaction:'abc',network:'stellar:pubnet'}}).decision,'reconcile_before_any_new_payment');
assert.equal(gateNextAction(f,{ledgerReceipt:{confirmed:true,success:true,transaction:'abc',network:'stellar:testnet'}}).decision,'already_settled');

f = explainFailure({stage:'settle',response:{success:false,errorReason:'settlement_pending',transaction:'',network:'stellar:testnet'}});
assert.equal(f.code,'invalid_settlement_pending_response');
assert.equal(gateNextAction(f,{ledgerReceipt:{confirmed:true,success:true,transaction:null,network:'stellar:testnet'}}).decision,'reconcile_before_any_new_payment');

f = explainFailure({stage:'mcp',reason:'discovery_stale_terms'});
assert.equal(gateNextAction(f).decision,'await_user_authorization');
assert.equal(gateNextAction(f,{explicitNewAuthorization:true}).maySubmitPayment,false);

for (const special of ['constructor', 'toString', '__proto__']) {
  const result = explainFailure({stage:'verify',reason:special});
  assert.equal(result.reason,'Unrecognized upstream error');
  assert.equal(result.recoveryAction,'stop');
}

f = explainFailure({stage:'discovery',reason:'invalid field with spaces',traceId:'safe:42'});
assert.equal(f.code,'unknown_upstream_error');
assert.equal(f.traceId,'safe:42');
assert.throws(()=>explainFailure({stage:'verify',response:{isValid:true}}),/successful/);
console.log('SF33 focused check PASS: canonical precedence, read retry, uncertain settle, ledger match, missing hash, approval, inherited-key safety');
