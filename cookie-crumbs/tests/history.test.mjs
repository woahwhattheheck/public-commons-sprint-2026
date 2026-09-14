import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionHasSigner } from '../history.mjs';

const CONNECTED = 'Connected111111111111111111111111111111111';
const OTHER = 'Other111111111111111111111111111111111111';

function transaction(accountKeys) {
  return {
    transaction: {
      message: {
        accountKeys,
      },
    },
  };
}

test('accepts only the exact connected public key with signer:true', () => {
  assert.equal(transactionHasSigner(transaction([
    { pubkey: CONNECTED, signer: true, writable: true },
    { pubkey: OTHER, signer: false, writable: false },
  ]), CONNECTED), true);
});

test('rejects the connected public key when it is not a signer', () => {
  assert.equal(transactionHasSigner(transaction([
    { pubkey: CONNECTED, signer: false, writable: true },
    { pubkey: OTHER, signer: true, writable: false },
  ]), CONNECTED), false);
});

test('rejects an unrelated signer even when connected key is present', () => {
  assert.equal(transactionHasSigner(transaction([
    { pubkey: OTHER, signer: true, writable: true },
    { pubkey: CONNECTED, signer: false, writable: false },
  ]), CONNECTED), false);
});

test('fails closed on string-only and malformed account-key metadata', () => {
  assert.equal(transactionHasSigner(transaction([CONNECTED]), CONNECTED), false);
  assert.equal(transactionHasSigner(transaction([
    { pubkey: CONNECTED, signer: 1 },
    { signer: true },
    null,
  ]), CONNECTED), false);
  assert.equal(transactionHasSigner({ transaction: { message: {} } }, CONNECTED), false);
  assert.equal(transactionHasSigner(null, CONNECTED), false);
  assert.equal(transactionHasSigner(transaction([{ pubkey: CONNECTED, signer: true }]), ''), false);
});
