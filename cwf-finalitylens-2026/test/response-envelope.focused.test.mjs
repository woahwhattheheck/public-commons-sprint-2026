/** Synthetic JSON-RPC response correlation: no Solana network or funds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc } from '../src/finality.mjs';

const provider = { id: 'rpc-test', url: 'https://example.invalid', label: 'synthetic' };
const fake = async (body, status = 200) => rpc(provider, 'getSignatureStatuses', [['fake']], {
  fetchImpl: async (url, request) => {
    assert.equal(url, provider.url);
    assert.equal(request.redirect, 'error');
    const sent = JSON.parse(request.body);
    assert.equal(sent.jsonrpc, '2.0');
    assert.equal(sent.id, 1);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }
});

test('Solana JSON-RPC envelope binds response version, id and result/error', async () => {
  assert.deepEqual(await fake({ jsonrpc: '2.0', id: 1, result: { value: [null] } }), { value: [null] });
  assert.equal(await fake({ jsonrpc: '2.0', id: 1, result: null }), null);
  for (const response of [
    { jsonrpc: '1.0', id: 1, result: 4 },
    { id: 1, result: 4 },
    { jsonrpc: '2.0', id: 999, result: 4 },
    { jsonrpc: '2.0', result: 4 },
    [{ jsonrpc: '2.0', id: 1, result: 4 }],
  ]) await assert.rejects(fake(response), /protocol version or id mismatch/);
  for (const response of [
    { jsonrpc: '2.0', id: 1 },
    { jsonrpc: '2.0', id: 1, error: { code: -123 }, result: null },
  ]) await assert.rejects(fake(response), /exactly one result or error/);
  for (const badError of [null, 3, 'failure', [], true])
    await assert.rejects(fake({ jsonrpc: '2.0', id: 1, error: badError }), /error response malformed/);
  await assert.rejects(fake({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } }), /RPC JSON error code -32601/);
});
