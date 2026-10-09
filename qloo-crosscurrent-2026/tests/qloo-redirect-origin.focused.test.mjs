// SPDX-License-Identifier: MIT
// Focused offline contract: Qloo's server-side key is never forwarded on redirects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient, QlooError} from '../src/qloo.mjs';

const unexpectedOrigin = e => e instanceof QlooError &&
  e.code === 'QLOO_UNEXPECTED_RESPONSE_ORIGIN' && e.status === 502;

test('native fetch must reject redirects while sending the key only to Qloo', async () => {
  const requests = [];
  const client = new QlooClient({key: 'fixture-only-key', fetcher: async (url, init) => {
    requests.push({url: String(url), init});
    return {ok: true, json: async () => ({results: []})};
  }});
  assert.deepEqual(await client.search('Movie name'), []);
  assert.deepEqual(await client.search('Movie name'), []);
  assert.equal(requests.length, 1, 'cache hit must not re-send key');
  assert.equal(new URL(requests[0].url).origin, 'https://hackathon.api.qloo.com');
  assert.equal(requests[0].init.headers['X-Api-Key'], 'fixture-only-key');
  assert.equal(requests[0].init.redirect, 'error');
});

test('injected fetcher cross-origin success cannot be cached as Qloo evidence', async () => {
  let attempts = 0;
  const client = new QlooClient({key: 'fixture-only-key', fetcher: async () => {
    attempts++;
    return {ok: true, redirected: false, url: 'https://other.example/search',
      json: async () => {throw Error('untrusted response must not be read');}};
  }});
  await assert.rejects(client.search('Movie name'), unexpectedOrigin);
  await assert.rejects(client.search('Movie name'), unexpectedOrigin);
  assert.equal(attempts, 2, 'bad response must not poison retry');
  assert.equal(client.cache.size, 0);
  assert.equal(client.inFlight.size, 0);
});

test('even same-origin followed redirects are not accepted as direct evidence', async () => {
  const client = new QlooClient({key: 'fixture-only-key',
    fetcher: async () => ({ok: true, redirected: true,
      url: 'https://hackathon.api.qloo.com/v2/insights', json: async () => ({results: []})})});
  await assert.rejects(client.search('Movie name'), unexpectedOrigin);
  assert.equal(client.cache.size, 0);
});

test('native redirect rejection propagates as provider error, never a live plan', async () => {
  const client = new QlooClient({key: 'fixture-only-key', fetcher: async (_, init) => {
    assert.equal(init.redirect, 'error');
    throw new TypeError('fetch failed due to redirect');
  }});
  await assert.rejects(client.search('Movie name'),
    e => e instanceof QlooError && e.code === 'QLOO_UNAVAILABLE' && e.status === 502);
  assert.equal(client.cache.size, 0);
  assert.equal(client.inFlight.size, 0);
});
