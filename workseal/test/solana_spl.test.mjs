import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makeSolanaSplSettlementPlan, assertSolanaAddress } from '../src/solana_spl.mjs';

// These are synthetic, correctly encoded 32-byte keys; not spendable wallets.
const mint = 'So11111111111111111111111111111111111111112';
const payer = '11111111111111111111111111111111';
const payee = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const source = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const dest = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const intent = {
  schema:'workseal-settlement-intent/v1',
  currency:`SPL_TOKEN:${mint}`, amountAtomic:'4294967297',
  payer,payee,taskDigest:'a'.repeat(64),resultDigest:'b'.repeat(64),acceptanceDigest:'c'.repeat(64),
  receiptAuthorityFingerprint:'d'.repeat(64),eventHead:'e'.repeat(64),generation:2,
};
const options = { mint, sourceTokenAccount:source, destinationTokenAccount:dest, decimals:6 };

test('SPL Token transferChecked bytes, ownership preflight and fail-closed binding', () => {
  const plan = makeSolanaSplSettlementPlan(intent, options);
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.unsigned, true);
  assert.equal(plan.instructions[0].utf8, `WORKSEAL:v1:${plan.settlementDigest}`);
  assert.equal(plan.instructions[1].dataHex, '0c010000000100000006');
  assert.deepEqual(plan.instructions[1].accounts.map(a=>[a.isSigner,a.isWritable]),
    [[false,true],[false,false],[false,true],[true,false]]);
  assert.equal(makeSolanaSplSettlementPlan(intent, options).settlementDigest,plan.settlementDigest);
  assert.equal(assertSolanaAddress(payer,'payer'),payer);
  assert.throws(()=>assertSolanaAddress('not-base58','payer'),/base58/);
  assert.throws(()=>assertSolanaAddress('111','payer'),/32 bytes/);
  assert.throws(()=>makeSolanaSplSettlementPlan({...intent,currency:'SOL_LAMPORTS'},options),/currency/);
  assert.throws(()=>makeSolanaSplSettlementPlan({...intent,currency:`SPL_TOKEN:${payee}`},options),/currency/);
  assert.throws(()=>makeSolanaSplSettlementPlan({...intent,amountAtomic:'18446744073709551616'},options),/64-bit/);
  assert.throws(()=>makeSolanaSplSettlementPlan({...intent,amountAtomic:'0'},options),/positive/);
  assert.throws(()=>makeSolanaSplSettlementPlan(intent,{...options,decimals:256}),/decimals/);
  assert.throws(()=>makeSolanaSplSettlementPlan(intent,{...options,destinationTokenAccount:source}),/distinct/);
});
