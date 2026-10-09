// SPDX-License-Identifier: MIT
// Focused offline mock-Response check: no network, account, Qloo API or fixture changes.
import assert from 'node:assert/strict';
import { boundedQlooResponseBytes } from './response-bound.mjs';

async function assertOversizedDeclaredBeforeRead() {
  let readCount = 0;
  let canceled = false;
  const body = new ReadableStream({
    pull(controller) { readCount++; controller.enqueue(new Uint8Array([123, 125])); controller.close(); },
    cancel() { canceled = true; }
  });
  const response = new Response(body, { headers: { 'content-length': '250001' } });
  await assert.rejects(() => boundedQlooResponseBytes(response), /exceeded the bounded result limit/);
  assert.equal(readCount, 0, 'declared oversize must reject before pulling response stream');
  assert.equal(canceled, true, 'declared oversize cancels unused response stream');
}
async function assertOversizedStreamCanceled() {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(125000));
      controller.enqueue(new Uint8Array(125001));
    },
    cancel() { canceled = true; }
  });
  const response = new Response(body);
  await assert.rejects(() => boundedQlooResponseBytes(response), /exceeded the bounded result limit/);
  assert.equal(canceled, true, 'excess response stream must be canceled');
}
async function assertValidBoundedJSON() {
  const value = { success: true, results: { entities: [{ name: 'Fixture', id: 'synthetic' }] } };
  const response = new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const bytes = await boundedQlooResponseBytes(response);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), value);
}
await assertOversizedDeclaredBeforeRead();
await assertOversizedStreamCanceled();
await assertValidBoundedJSON();
console.log('PASS 3/3 focused offline stream-bound checks');
