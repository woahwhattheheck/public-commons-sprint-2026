import test from 'node:test';
import assert from 'node:assert/strict';
import { composeReceipt, parseReceipt, parsedTransactionSignedBy, utf8Bytes, MAX_MEMO_BYTES, RECEIPT_PREFIX, shortAddress } from '../receipt.mjs';

test('round-trips reserved characters without ambiguity', () => {
  const memo = composeReceipt({
    kind: 'release',
    subject: 'api|worker=v2',
    note: '100% shipped | verifier=green',
    createdAt: new Date('2026-09-13T08:00:00.000Z'),
    id: 'abc123',
  });
  const parsed = parseReceipt(memo);
  assert.equal(parsed.kind, 'release');
  assert.equal(parsed.subject, 'api|worker=v2');
  assert.equal(parsed.note, '100% shipped | verifier=green');
  assert.equal(parsed.id, 'abc123');
  assert.equal(parsed.createdAt, '2026-09-13T08:00:00.000Z');
});

test('normalizes control characters and whitespace', () => {
  const memo = composeReceipt({ kind: ' audit\n', subject: ' build\t 42 ', note: 'a\u0000b\n c' });
  const parsed = parseReceipt(memo);
  assert.equal(parsed.kind, 'audit');
  assert.equal(parsed.subject, 'build 42');
  assert.equal(parsed.note, 'a b c');
});

test('rejects missing required fields and invalid timestamps', () => {
  assert.throws(() => composeReceipt({ kind: '', subject: 'x' }), /kind is required/i);
  assert.throws(() => composeReceipt({ kind: 'audit', subject: '' }), /subject is required/i);
  assert.throws(() => parseReceipt(`${RECEIPT_PREFIX}|ts=nope|kind=audit|subject=x`), /timestamp is invalid/i);
});

test('rejects duplicate and unknown parsed fields', () => {
  assert.throws(() => parseReceipt(`${RECEIPT_PREFIX}|ts=2026-09-13T08%3A00%3A00.000Z|kind=audit|kind=release|subject=x`), /Duplicate/);
  assert.throws(() => parseReceipt(`${RECEIPT_PREFIX}|ts=2026-09-13T08%3A00%3A00.000Z|kind=audit|subject=x|admin=true`), /Unknown/);
});

test('foreign memos are ignored', () => {
  assert.equal(parseReceipt('hello from another memo app'), null);
  assert.equal(parseReceipt('cookie-crumbs:v2|kind=audit'), null);
});

test('memo size is bounded in UTF-8 bytes', () => {
  const memo = composeReceipt({ kind: 'audit', subject: 'x'.repeat(96), note: 'y'.repeat(220), id: '1'.repeat(32) });
  assert.ok(utf8Bytes(memo) <= MAX_MEMO_BYTES);
  assert.equal(new TextEncoder().encode(memo).byteLength, utf8Bytes(memo));
});

test('shortAddress is stable for long and short values', () => {
  assert.equal(shortAddress('1234567890', 3, 3), '123…890');
  assert.equal(shortAddress('short', 3, 3), 'short');
});


test('parsedTransactionSignedBy requires exact connected signer metadata', () => {
  const wallet = 'Wallet1111111111111111111111111111111111111';
  const other = 'Other11111111111111111111111111111111111111';
  const tx = (accountKeys) => ({ transaction: { message: { accountKeys } } });

  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: true }]), wallet), true);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: { toBase58: () => wallet }, signer: true }]), wallet), true);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: false }]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([
    { pubkey: other, signer: true },
    { pubkey: wallet, signer: false },
  ]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([{ toBase58: () => wallet }]), wallet), false);
  assert.equal(parsedTransactionSignedBy(tx([{ pubkey: wallet, signer: true }]), ''), false);
  assert.equal(parsedTransactionSignedBy({ transaction: { message: {} } }, wallet), false);
});
