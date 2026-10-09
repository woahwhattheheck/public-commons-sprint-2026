import test from 'node:test';
import assert from 'node:assert/strict';
import { createQlooClient } from './qloo-client.mjs';

const encoder = new TextEncoder();
const wrap = (response) => createQlooClient({
  apiKey: 'SYNTHETIC_LOCAL_KEY',
  fetchImpl: async () => response,
});

function streamed(chunks, headers = {}) {
  const state = { cancelled: false };
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() { state.cancelled = true; },
  });
  return { response: new Response(body, { status: 200, headers }), state };
}

test('live Qloo stream decodes valid UTF-8 split between chunks', async () => {
  const payload = encoder.encode(JSON.stringify({ results: [{ id: 'true-id', name: 'Beyoncé' }] }));
  const i = payload.indexOf(0xc3);
  assert(i > 0);
  const { response } = streamed([payload.slice(0, i + 1), payload.slice(i + 1)]);
  const found = await wrap(response).resolve('Beyoncé');
  assert.equal(found.id, 'true-id');
});

test('live Qloo stream aborts upstream as soon as cumulative bytes exceed 1.5MB', async () => {
  const { response, state } = streamed([new Uint8Array(800_000), new Uint8Array(700_001)]);
  await assert.rejects(() => wrap(response).resolve('Beyoncé'), /unexpectedly large response/);
  assert.equal(state.cancelled, true);
});

test('oversized Content-Length rejects before parsing and cancels upstream', async () => {
  const { response, state } = streamed([encoder.encode('{}')], { 'content-length': '1500001' });
  await assert.rejects(() => wrap(response).resolve('Beyoncé'), /unexpectedly large response/);
  assert.equal(state.cancelled, true);
});
