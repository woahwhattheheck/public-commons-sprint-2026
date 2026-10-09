import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, normalizeInsights } from '../src/audit.mjs';
import { createDemoProvider } from '../src/demo.mjs';
import { createQlooProvider } from '../src/qloo.mjs';

test('single focused agent/provider contract: source provenance, filter shape, and failure abstention', async () => {
  const params = { seed: 'A Film', seedType: 'urn:entity:movie', target: 'urn:entity:movie' };
  const result = await audit(params, createDemoProvider());
  assert.equal(result.status, 'complete');
  assert.equal(result.metrics.baselineCount, 15);
  assert.ok(result.segments.low.count > 0 && result.segments.high.count > 0);
  assert.equal(result.trace.length, 4);

  const recorded = [];
  const fakeFetch = async (u, init) => {
    recorded.push({ url: u.href, key: init.headers['X-Api-Key'] });
    return { ok: true, json: async () => ({ results: { entities: [{ entity_id: 'one', name: 'One', popularity: 0.5 }] } }) };
  };
  const qloo = createQlooProvider('server-secret', fakeFetch);
  await qloo.search('A Film', 'urn:entity:movie');
  await qloo.insights({ target: 'urn:entity:movie', entityId: 'one', maxPopularity: 0.7 });
  assert.equal(new URL(recorded[0].url).pathname, '/search');
  assert.equal(new URL(recorded[1].url).pathname, '/v2/insights');
  assert.equal(new URL(recorded[1].url).searchParams.get('filter.popularity.max'), '0.7');
  assert.equal(new URL(recorded[1].url).searchParams.get('signal.interests.entities'), 'one');
  assert.equal(recorded[1].key, 'server-secret');
  assert.ok(recorded.every(entry => !entry.url.includes('server-secret')));

  const noData = { search: async () => ({ results: { entities: [{ entity_id: 'a', name: 'A Film' }] } }), insights: async () => ({ results: { entities: [] } }) };
  assert.equal((await audit(params, noData)).status, 'abstained');
  assert.throws(() => normalizeInsights({}), /entities/);
});
