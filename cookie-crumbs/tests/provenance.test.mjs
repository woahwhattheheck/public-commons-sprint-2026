import test from 'node:test';
import assert from 'node:assert/strict';

import { transactionSignedBy } from '../provenance.mjs';

const wallet = 'CooKieWa11et1111111111111111111111111111111';
const other = 'OtherWa11et11111111111111111111111111111111';

function parsed(accountKeys) {
  return { transaction: { message: { accountKeys } } };
}

test('accepts only the exact connected key when it is an explicit signer', () => {
  assert.equal(transactionSignedBy(parsed([
    { pubkey: { toBase58: () => wallet }, signer: true, writable: true },
  ]), wallet), true);
});

test('rejects address involvement when the connected key is not a signer', () => {
  assert.equal(transactionSignedBy(parsed([
    { pubkey: { toBase58: () => wallet }, signer: false, writable: true },
    { pubkey: { toBase58: () => other }, signer: true, writable: true },
  ]), wallet), false);
});

test('rejects a different signer even when the connected key appears elsewhere', () => {
  assert.equal(transactionSignedBy(parsed([
    { pubkey: wallet, signer: false },
    { pubkey: other, signer: true },
  ]), wallet), false);
});

test('rejects ambiguous string-only account keys because signer authority is absent', () => {
  assert.equal(transactionSignedBy(parsed([wallet]), wallet), false);
});

test('fails closed on malformed or missing parsed transaction structures', () => {
  assert.equal(transactionSignedBy(null, wallet), false);
  assert.equal(transactionSignedBy({}, wallet), false);
  assert.equal(transactionSignedBy(parsed([]), wallet), false);
  assert.equal(transactionSignedBy(parsed([{ pubkey: wallet, signer: true }]), ''), false);
});
