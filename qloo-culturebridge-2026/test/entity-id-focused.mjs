import assert from 'node:assert/strict';
import { normalizeInsights, bridgeIntersection, buildAgentResponse } from '../src/engine.mjs';
import { buildLiveComparison } from '../src/qloo.mjs';

// Single focused follow-on: real-style `entity_id` and the peer's strict
// canonical-ID rule coexist. No network calls or real credentials.
const indexed = normalizeInsights({results:{entities:[
  { entity_id: 'match-1', name: 'Common Ground' },
  { entity: { entity_id: 'nested-2', name: 'Nested Item' } },
]}});
assert.deepEqual(indexed.map(x => x.id), ['match-1', 'nested-2']);
const first = normalizeInsights({results:{entities:[
  { entity_id: 'one', name: 'Identical Name' },
  { entity_id: 'match-1', name: 'Common Ground' },
  { name: 'Both Lack IDs' },
]}});
const second = normalizeInsights({results:{entities:[
  { entity_id: 'two', name: 'Identical Name' },
  { entity_id: 'match-1', name: 'Renamed Common Ground' },
  { name: 'Both Lack IDs' },
]}});
assert.deepEqual(bridgeIntersection(first, second).map(x => x.id), ['match-1'], 'never infer Qloo evidence from title collisions or absent IDs');
let calls = [];
const mockedFetch = async (url, options) => {
  const u = new URL(url);
  calls.push([u.host,u.pathname,options.headers['X-Api-Key']]);
  const data = u.pathname === '/search' ?
    { results: { entities: [{ entity_id: u.searchParams.get('query') === 'Artist A' ? 'seed-a' : 'seed-b', name: u.searchParams.get('query') }] } } :
    { results: { entities: [{ entity_id: 'match-1', name: 'Common Ground' }] } };
  return { ok: true, json: async () => data };
};
const provider = await buildLiveComparison({seedA:'Artist A',seedB:'Artist B',kind:'artist',key:'mock-key',fetcher:mockedFetch});
const answer = buildAgentResponse({seedA:'Artist A',seedB:'Artist B',kind:'artist',mode:'live',...provider});
assert.deepEqual(answer.bridges.map(x => x.id), ['match-1']);
assert.equal(calls.length, 4);
assert.ok(calls.every(([host, , key]) => host === 'hackathon.api.qloo.com' && key === 'mock-key'));
console.log('CultureBridge consolidation: PASS — entity_id in search/insights + canonical-ID-only evidence');
