import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CookieChainRpc,
  MEMO_PROGRAM_ID,
  assertPublicKey,
  buildUnsignedMemoTransaction,
  decodeBase58,
  encodeShortVecLength,
} from '../chain.mjs';

const ZERO_KEY = '11111111111111111111111111111111';
const MEMO_BYTES = decodeBase58(MEMO_PROGRAM_ID);

test('base58 decoding preserves leading zero bytes and public-key length', () => {
  const decoded = decodeBase58(ZERO_KEY);
  assert.equal(decoded.byteLength, 32);
  assert.deepEqual([...decoded], new Array(32).fill(0));
  assert.equal(assertPublicKey(ZERO_KEY), ZERO_KEY);
});

test('public-key validation rejects bad alphabet and wrong decoded length', () => {
  assert.throws(() => assertPublicKey('0OIl'), /Invalid base58/);
  assert.throws(() => assertPublicKey('1'), /exactly 32 bytes/);
});

test('short-vector encoding handles one- and two-byte lengths', () => {
  assert.deepEqual([...encodeShortVecLength(0)], [0]);
  assert.deepEqual([...encodeShortVecLength(127)], [127]);
  assert.deepEqual([...encodeShortVecLength(128)], [0x80, 0x01]);
  assert.deepEqual([...encodeShortVecLength(255)], [0xff, 0x01]);
});

test('builds a deterministic one-signer legacy Memo transaction', () => {
  const memo = 'cookie-crumbs:v1|kind=audit';
  const transaction = buildUnsignedMemoTransaction({
    feePayer: ZERO_KEY,
    recentBlockhash: ZERO_KEY,
    memo,
  });

  let offset = 0;
  assert.equal(transaction[offset++], 1, 'one required transaction signature');
  assert.deepEqual([...transaction.subarray(offset, offset + 64)], new Array(64).fill(0));
  offset += 64;

  assert.deepEqual([...transaction.subarray(offset, offset + 3)], [1, 0, 1]);
  offset += 3;
  assert.equal(transaction[offset++], 2, 'two message account keys');
  assert.deepEqual([...transaction.subarray(offset, offset + 32)], new Array(32).fill(0));
  offset += 32;
  assert.deepEqual([...transaction.subarray(offset, offset + 32)], [...MEMO_BYTES]);
  offset += 32;
  assert.deepEqual([...transaction.subarray(offset, offset + 32)], new Array(32).fill(0));
  offset += 32;

  assert.equal(transaction[offset++], 1, 'one instruction');
  assert.equal(transaction[offset++], 1, 'memo program is account key index 1');
  assert.equal(transaction[offset++], 0, 'Memo instruction has no account inputs');
  assert.equal(transaction[offset++], new TextEncoder().encode(memo).byteLength);
  assert.equal(new TextDecoder().decode(transaction.subarray(offset)), memo);
});

test('RPC client emits exact JSON-RPC method and parameters', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { jsonrpc: '2.0', id: calls.at(-1).body.id, result: 1234 };
      },
    };
  };
  const rpc = new CookieChainRpc('https://rpc.cookiescan.io', { fetchImpl });
  assert.equal(await rpc.getSlot('confirmed'), 1234);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://rpc.cookiescan.io/');
  assert.equal(calls[0].body.method, 'getSlot');
  assert.deepEqual(calls[0].body.params, [{ commitment: 'confirmed' }]);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
});

test('RPC client fails closed on JSON-RPC errors and missing results', async () => {
  const errorRpc = new CookieChainRpc('https://rpc.cookiescan.io', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } };
      },
    }),
  });
  await assert.rejects(errorRpc.getGenesisHash(), /RPC getGenesisHash failed: nope/);

  const malformedRpc = new CookieChainRpc('https://rpc.cookiescan.io', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { jsonrpc: '2.0', id: 1 };
      },
    }),
  });
  await assert.rejects(malformedRpc.getGenesisHash(), /omitted result/);
});
