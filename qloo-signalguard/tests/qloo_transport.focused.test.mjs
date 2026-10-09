import test from 'node:test';
import assert from 'node:assert/strict';
import { createQlooProvider, QlooError } from '../src/qloo.mjs';

const call = fetcher => createQlooProvider('fixture-server-only-key', fetcher)
  .search('A Film', 'urn:entity:movie');

// Focused transport boundary only, entirely offline. No actual hackathon key or provider call.
test('provider GET refuses redirects with key still server-side', async () => {
  let calls = 0;
  await assert.rejects(call(async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://hackathon.api.qloo.com');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['X-Api-Key'], 'fixture-server-only-key');
    assert.equal(url.href.includes('fixture-server-only-key'), false);
    return new Response('', { status: 302, headers: { Location: 'https://elsewhere.example/collect' } });
  }), e => e instanceof QlooError && e.status === 502 && /redirect refused/.test(e.message));
  assert.equal(calls, 1);
});

test('provider body is bounded even without Content-Length', async () => {
  await assert.rejects(call(async () => new Response(JSON.stringify({ results: 'x'.repeat(1024 * 1024) }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })), e => e instanceof QlooError && e.status === 502 && /size limit/.test(e.message));
});

test('valid small JSON, declared oversized body, and malformed JSON are distinguished', async () => {
  const success = await call(async () => new Response('{"results":{"entities":[]}}', { status: 200 }));
  assert.deepEqual(success, { results: { entities: [] } });
  await assert.rejects(call(async () => new Response('ok', { status: 200, headers: { 'content-length': '2000000' } })),
    e => e instanceof QlooError && e.status === 502 && /size limit/.test(e.message));
  await assert.rejects(call(async () => new Response('{bad', { status: 200 })),
    e => e instanceof QlooError && e.status === 502 && /JSON/.test(e.message));
});
