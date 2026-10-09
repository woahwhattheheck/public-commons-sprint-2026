// SPDX-License-Identifier: MIT
// Single focused zero-network test of the exact live-provider helper.
import assert from 'node:assert/strict';
import { LiveProviderError, fetchLiveQlooResponse } from './live-provider.mjs';

const base = 'https://hackathon.api.qloo.com';
const body = { 'filter.type': 'urn:entity:place' };
const json = async () => new TextEncoder().encode('{"success":true,"results":{"entities":[]}}');
const ok = { ok: true, status: 200 };
const params = { apiBase: base, apiKey: 'only-an-inert-test-string', requestBody: body, readBytes: json };
let runs = 0;
const check = async (label, job) => { await job(); console.log(`PASS ${label}`); runs++; };
const failsAs = async (job, status) => {
  await assert.rejects(job, e => e instanceof LiveProviderError && e.status === status);
};

await check('live transport pins original host and refuses redirects', async () => {
  let calls = 0;
  const parsed = await fetchLiveQlooResponse({ ...params, fetcher: async (url, options) => {
    calls++;
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.origin, base);
    assert.equal(parsedUrl.pathname, '/v2/insights');
    assert.deepEqual(Object.fromEntries(parsedUrl.searchParams), body);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['x-api-key'], params.apiKey);
    assert.equal(options.headers.accept, 'application/json');
    assert.equal(options.headers['content-type'], undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return ok;
  }});
  assert.equal(calls, 1);
  assert.deepEqual(parsed, { success: true, results: { entities: [] } });
});
await check('redirect refusal or network failure is provider 502', async () => {
  await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher: async () => { throw Error('redirect rejected'); } }), 502);
});
await check('upstream 429 remains 429, upstream 500 becomes gateway 502', async () => {
  for (const [upstream, expected] of [[429, 429], [500, 502]]) {
    await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher: async () => ({ ok: false, status: upstream }) }), expected);
  }
});
await check('HTTP200 with invalid provider JSON returns gateway 502', async () => {
  await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher: async () => ok, readBytes: async () => new Uint8Array([60,104,116,109,108,62]) }), 502);
});
await check('bounded streaming reader failure returns gateway 502', async () => {
  await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher: async () => ok, readBytes: async () => { throw Error('oversize'); } }), 502);
});
await check('unknown origin fails before fetch or credential transport', async () => {
  let called = false;
  await failsAs(() => fetchLiveQlooResponse({ ...params, apiBase: 'https://redirect.invalid', fetcher: async () => { called = true; return ok; } }), 502);
  assert.equal(called, false);
});
await check('search lookup is GET on the original hackathon host', async () => {
  const search = { query: 'Main Street Coffee', types: 'urn:entity:place,urn:entity:brand', take: 10 };
  await fetchLiveQlooResponse({ ...params, path: '/search', requestBody: search,
    fetcher: async (url, options) => {
      const u = new URL(url);
      assert.equal(u.pathname, '/search');
      assert.deepEqual(Object.fromEntries(u.searchParams), {
        query: 'Main Street Coffee', types: 'urn:entity:place,urn:entity:brand', take: '10'
      });
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return ok;
    },
  });
});
await check('POST-only named seed array or wrong hackathon origin fails before upstream', async () => {
  let called = false;
  const fetcher = async () => { called = true; return ok; };
  await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher, requestBody: {
    'filter.type': 'urn:entity:place', 'signal.interests.entities.query': [{ name: 'unsupported' }]
  } }), 400);
  await failsAs(() => fetchLiveQlooResponse({ ...params, fetcher,
    apiBase: 'https://api.qloo.com' }), 502);
  assert.equal(called, false);
});
console.log(`OK ${runs} focused live-provider checks`);
