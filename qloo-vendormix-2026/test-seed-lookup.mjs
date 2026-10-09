// SPDX-License-Identifier: MIT
// Focused offline contract regression: typed /search results -> EXACT IDs.
import assert from 'node:assert/strict';
import { resolveSeedIds } from './app.mjs';
import { LiveProviderError } from './live-provider.mjs';

const apiBase = 'https://hackathon.api.qloo.com';
const apiKey = 'inert-test-value';
const encode = input => new TextEncoder().encode(JSON.stringify(input));
const providerRecords = {
  'City Brew': { success: true, results: { entities: [
    { entity_id: 'provider:brew:1', name: 'City Brew' },
    { entity_id: 'provider:brew:2', name: 'City Brew South' }
  ] } },
  'North Park Books': { results: { entities: [
    { id: 'provider:books:9', name: 'NORTH PARK BOOKS' }
  ] } },
  'Ambiguous Taste': { results: { entities: [
    { id: 'provider:ambiguous:1', name: 'Ambiguous Taste' },
    { id: 'provider:ambiguous:2', name: 'Ambiguous Taste' }
  ] } },
  'No Match': { results: { entities: [
    { id: 'provider:fuzzy:1', name: 'No Match Downtown' }
  ] } },
};
const calls = [];
async function fetcher(url, init) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, apiBase);
  assert.equal(parsed.pathname, '/search');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers['x-api-key'], apiKey);
  assert.equal(init.body, undefined);
  const query = parsed.searchParams.get('query');
  calls.push(query);
  return { ok: true, status: 200, fixturePayload: providerRecords[query] };
}
const readBytes = async response => encode(response.fixturePayload);

const resolved = await resolveSeedIds(['City Brew', 'North Park Books'], {
  apiBase, apiKey, fetcher, readBytes
});
assert.deepEqual(resolved, ['provider:brew:1', 'provider:books:9']);
assert.deepEqual(calls, ['City Brew', 'North Park Books']);
// Duplicate seed ID is passed once to a single Insights request, not fabricated.
assert.deepEqual(await resolveSeedIds(['City Brew', 'City Brew'], {
  apiBase, apiKey, fetcher, readBytes
}), ['provider:brew:1']);
for (const unsafe of ['Ambiguous Taste', 'No Match']) {
  await assert.rejects(
    () => resolveSeedIds([unsafe], { apiBase, apiKey, fetcher, readBytes }),
    error => error instanceof LiveProviderError && error.status === 422
  );
}
console.log('OK focused provider-shaped exact /search lookup and ambiguity checks');
