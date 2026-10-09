import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../src/canonical.mjs';
import { SOLANA_MEMO_PROGRAM, SOLANA_SYSTEM_PROGRAM } from '../src/solana.mjs';
import { fetchFinalizedSolanaSettlement, verifyFinalizedSolanaSettlement } from '../src/solana_settlement_readback.mjs';

const S = '3'.repeat(88);
const P = 'F5Yh4mcLwHV8AvXpDiCHY1bkAv3ehyfqN7R1Xf4R1mJq';
const W = 'GBo9MPKxnpXtJZ5KVV34UQvToRxD4YauwxuPSHZtK3Tm';
const intent = {
  schema: 'workseal-settlement-intent/v1', taskDigest: 'a'.repeat(64),
  resultDigest: 'b'.repeat(64), acceptanceDigest: 'c'.repeat(64),
  receiptAuthorityFingerprint: 'd'.repeat(64), eventHead: 'e'.repeat(64),
  generation: 1, currency: 'SOL_LAMPORTS', amountAtomic: '12345',
  payer: P, payee: W, funding: { reference: 'synthetic-only' },
};
const digest = sha256Hex(intent);
const fixture = () => ({
  slot: 12345, meta: { err: null },
  transaction: {
    signatures: [S], message: {
      accountKeys: [{ pubkey: P, signer: true }, { pubkey: W, signer: false }],
      instructions: [
        { programId: SOLANA_MEMO_PROGRAM, parsed: `WORKSEAL:v1:${digest}` },
        { programId: SOLANA_SYSTEM_PROGRAM, parsed: { type: 'transfer', info: { source: P, destination: W, lamports: 12345 } } },
      ],
    },
  },
});

test('finalized successful exact memo + transfer is accepted; RPC method remains read-only', async () => {
  const expected = verifyFinalizedSolanaSettlement({ intent, signature: S, commitment: 'finalized', transaction: fixture() });
  assert.equal(expected.transactionSucceeded, true);
  assert.equal(expected.writePerformed, false);
  const captured = [];
  const remote = await fetchFinalizedSolanaSettlement({ intent, signature: S, rpcUrl: 'https://solana-rpc.example/', fetchImpl: async (...args) => {
    captured.push(args); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: fixture() }) };
  }});
  assert.equal(remote.settlementDigest, digest);
  assert.equal(JSON.parse(captured[0][1].body).method, 'getTransaction');
  assert.equal(JSON.parse(captured[0][1].body).params[1].commitment, 'finalized');
});

test('rejects failed, missing, unfinalized and wrong-amount proof', () => {
  const args = { intent, signature: S, commitment: 'finalized', transaction: fixture() };
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, commitment: 'confirmed' }), /finalized/);
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: null }), /not been returned/);
  const failed = fixture(); failed.meta.err = { InstructionError: [1, 'Custom'] };
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: failed }), /did not succeed/);
  const wrong = fixture(); wrong.transaction.message.instructions[1].parsed.info.lamports = 12346;
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: wrong }), /does not match/);
});

test('rejects wrong memo, duplicated transfers and unsigned payer', () => {
  const args = { intent, signature: S, commitment: 'finalized' };
  const wrong = fixture(); wrong.transaction.message.instructions[0].parsed = 'WORKSEAL:v1:' + '0'.repeat(64);
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: wrong }), /memo payload/);
  const duplicate = fixture(); duplicate.transaction.message.instructions.push(duplicate.transaction.message.instructions[1]);
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: duplicate }), /exactly one/);
  const unsigned = fixture(); unsigned.transaction.message.accountKeys[0].signer = false;
  assert.throws(() => verifyFinalizedSolanaSettlement({ ...args, transaction: unsigned }), /payer must sign/);
});
