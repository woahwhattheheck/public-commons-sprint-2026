import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SOLANA_MAINNET_GENESIS_HASH,
  WorkSealSolamiError,
  buildSolamiAcceptanceObservation,
} from '../src/solami_receipt.mjs';
import { sha256Hex } from '../src/canonical.mjs';

const verified = {
  verdict: 'PASS', taskDigest: '1'.repeat(64), resultDigest: '2'.repeat(64),
  evidenceDigest: '3'.repeat(64), acceptanceDigest: '4'.repeat(64),
  settlementIntentDigest: '5'.repeat(64), writePerformed: false, externalAuthorityGranted: false,
};
const endpoint = 'https://rpc.solami.dev/mainnet?owner_token=kept-private';
const nowSeconds = 1791470000;
function transport(overrides = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    assert.equal(url, endpoint);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    const request = JSON.parse(init.body);
    calls.push(request.method);
    const values = {
      getGenesisHash: SOLANA_MAINNET_GENESIS_HASH,
      getSlot: 354000012,
      getBlockTime: nowSeconds - 20,
      ...overrides,
    };
    return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: request.id, result: values[request.method] }) };
  };
  return { fetchFn, calls };
}
function failure(code, fn) {
  return assert.rejects(fn, (error) => error instanceof WorkSealSolamiError && error.code === code);
}

test('binds finalized live-mainnet slot to WorkSeal PASS without any write', async () => {
  const { fetchFn, calls } = transport();
  const receipt = await buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn, nowSeconds });
  assert.deepEqual(calls, ['getGenesisHash', 'getSlot', 'getBlockTime']);
  assert.equal(receipt.workSealBinding.acceptanceDigest, verified.acceptanceDigest);
  assert.equal(receipt.observation.finalizedSlot, 354000012);
  assert.equal(receipt.authority.writePerformed, false);
  assert.equal(receipt.authority.chainAnchoringPerformed, false);
  assert.equal(receipt.externalState.award, 'NOT_ASSERTED');
  assert.equal(receipt.receiptDigest, sha256Hex(Object.fromEntries(Object.entries(receipt).filter(([k]) => k !== 'receiptDigest'))));
  assert.doesNotMatch(JSON.stringify(receipt), /owner_token/);
});

test('fails closed on wrong chain, stale time, or missing block time', async () => {
  await failure('WRONG_CLUSTER', () => buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn: transport({getGenesisHash: 'devnet'}).fetchFn, nowSeconds }));
  await failure('STALE_SLOT', () => buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn: transport({getBlockTime: nowSeconds - 301}).fetchFn, nowSeconds }));
  await failure('STALE_SLOT', () => buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn: transport({getBlockTime: null}).fetchFn, nowSeconds }));
});

test('refuses unverified WorkSeal and non-Solami endpoints before network access', async () => {
  let called = false;
  const fetchFn = async () => { called = true; throw new Error('network should not run'); };
  await failure('UNVERIFIED_WORK', () => buildSolamiAcceptanceObservation({ verified: { ...verified, verdict: 'HOLD' }, endpoint, fetchFn, nowSeconds }));
  await failure('BAD_ENDPOINT', () => buildSolamiAcceptanceObservation({ verified, endpoint: 'https://solami.dev.evil.test/key', fetchFn, nowSeconds }));
  await failure('BAD_ENDPOINT', () => buildSolamiAcceptanceObservation({ verified, endpoint: 'http://rpc.solami.dev', fetchFn, nowSeconds }));
  assert.equal(called, false);
});

test('rejects mismatched JSON-RPC ids and unsafe future slot time', async () => {
  await failure('STALE_SLOT', () => buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn: transport({getBlockTime: nowSeconds + 31}).fetchFn, nowSeconds }));
  const badFetch = async () => ({ ok:true, text: async()=> JSON.stringify({jsonrpc:'2.0',id:999,result:123}) });
  await failure('BAD_RPC_RESPONSE', () => buildSolamiAcceptanceObservation({ verified, endpoint, fetchFn: badFetch, nowSeconds }));
});
