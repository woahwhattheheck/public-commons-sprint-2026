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
    assert.equal(url, `${base}/v2/insights`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-api-key'], params.apiKey);
    assert.equal(options.headers.accept, 'application/json');
    assert.deepEqual(JSON.parse(options.body), body);
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
console.log(`OK ${runs} focused live-provider checks`);
