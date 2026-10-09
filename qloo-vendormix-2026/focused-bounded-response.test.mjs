// SPDX-License-Identifier: MIT
// One focused pure synthetic transport check. No Qloo calls or API credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedQlooBytes, MAX_QLOO_RESPONSE_BYTES } from './bounded-response.mjs';

function response(chunks, declaredLength) {
  const state = { pulls: 0, cancelled: false };
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      state.pulls++;
      if (index >= chunks.length) return controller.close();
      controller.enqueue(chunks[index++]);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = new Headers();
  if (declaredLength !== undefined) headers.set('content-length', String(declaredLength));
  return { payload: { headers, body }, state };
}

const sizeError = /Qloo response exceeded the bounded result limit/;

test('declared oversized response is rejected before first read and cancelled', async () => {
  const { payload, state } = response([new Uint8Array(100)], MAX_QLOO_RESPONSE_BYTES + 1);
  await assert.rejects(readBoundedQlooBytes(payload), sizeError);
  assert.equal(state.pulls, 0);
  assert.equal(state.cancelled, true);
});

test('stream exceeds limit without header: bounded rejection and cancellation', async () => {
  const { payload, state } = response([new Uint8Array(200_000), new Uint8Array(50_001)]);
  await assert.rejects(readBoundedQlooBytes(payload), sizeError);
  assert.equal(state.cancelled, true);
  assert.equal(state.pulls, 2);
});

test('lying small content-length does not bypass the streaming bound', async () => {
  const { payload, state } = response([new Uint8Array(250_001)], '12');
  await assert.rejects(readBoundedQlooBytes(payload), sizeError);
  assert.equal(state.cancelled, true);
});

test('valid bounded JSON is returned byte-for-byte for caller parsing', async () => {
  const body = new TextEncoder().encode(JSON.stringify({ results: { entities: [{ entity_id: 'v1', name: 'Place' }] } }));
  const { payload, state } = response([body.subarray(0, 4), body.subarray(4)], body.byteLength);
  const bytes = await readBoundedQlooBytes(payload);
  assert.deepEqual(bytes, body);
  assert.equal(JSON.parse(new TextDecoder().decode(bytes)).results.entities[0].name, 'Place');
  assert.equal(state.cancelled, false);
});

test('exact byte ceiling remains allowed; absent body fails closed', async () => {
  const { payload } = response([new Uint8Array(MAX_QLOO_RESPONSE_BYTES)]);
  const bytes = await readBoundedQlooBytes(payload);
  assert.equal(bytes.byteLength, MAX_QLOO_RESPONSE_BYTES);
  await assert.rejects(readBoundedQlooBytes({ headers: new Headers() }), /unreadable response stream/);
});
