import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CATEGORIES, buildSchedule, normalizeEntities, validateRequest } from './planner.mjs';
import { fixtureResponses } from './fixtures.mjs';
import { createQlooClient } from './qloo-client.mjs';
import { createHandler, plan } from './server.mjs';

const request = { city: 'Louisville, Kentucky', tastes: ['Nina Simone', 'Moonlight', 'James Baldwin'], mode: 'fixture' };

test('request normalization and explicit bounds guard', () => {
  const actual = validateRequest({ ...request, tastes: [' Moonlight ', 'Moonlight'] });
  assert.deepEqual(actual.tastes, ['Moonlight']);
  assert.throws(() => validateRequest({ ...request, tastes: [] }), /Supply/);
  assert.throws(() => validateRequest({ ...request, excludedIds: ['<script>'] }), /Excluded/);
});

test('fixture emits 4 full planning briefs with distinct category IDs and an unmistakable synthetic label', async () => {
  const output = await plan(request);
  assert.equal(output.mode, 'fixture');
  assert.equal(output.weeks.length, 4);
  assert.equal(output.sourceLabel, 'SYNTHETIC FIXTURE');
  for (const category of CATEGORIES) {
    const ids = output.weeks.map(x => x.program[category]?.id);
    assert.equal(new Set(ids).size, 4, `duplicate ${category}`);
    assert(ids.every(Boolean));
  }
  assert(output.weeks.every(x => x.notice.includes('no venue')));
});

test('exclusion changes the actual selected candidates and preserves unrelated predictions', async () => {
  const baseline = await plan(request);
  const id = baseline.weeks[0].program.artist.id;
  const another = await plan({ ...request, excludedIds: [id] });
  assert.equal(another.excludedIds[0], id);
  assert(another.weeks.every(x => x.program.artist?.id !== id));
  assert.equal(another.weeks[0].program.movie.id, baseline.weeks[0].program.movie.id);
});

test('source normalization never fabricates a Qloo affinity or an entity for a malformed result', () => {
  const values = normalizeEntities({ results: { entities: [
    { id: 'real', name: 'Real Item', query: {} },
    { id: 'phantom', name: '' }, { name: 'No ID' },
    { id: 'real', name: 'Duplicate' },
  ] } }, 'movie');
  assert.deepEqual(values.map(x => x.id), ['real']);
  assert.equal(values[0].affinity, null);
});

test('live client resolves a Qloo seed and makes category-specific first-party Insights requests', async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path === '/search') return { ok: true, text: async () => JSON.stringify({ results: [ { id: 'real-seed', name: 'Nina Simone', type: 'urn:entity:artist' } ] }) };
    return { ok: true, text: async () => JSON.stringify({ results: { entities: [
      { id: `real-${new URL(url).searchParams.get('filter.type')}`, name: 'Returned Qloo Example' }
    ] } }) };
  };
  const client = createQlooClient({ apiKey: 'TEST_KEY_ONLY', fetchImpl: fakeFetch });
  const signal = await client.resolve('Nina Simone');
  assert.equal(signal.id, 'real-seed');
  for (const category of CATEGORIES) await client.recommendations(category, {
    city: 'Louisville', ids: [signal.id], excludedIds: ['old-id']
  });
  assert.equal(requests.length, 5);
  assert(requests.every(r => r.init.headers['x-api-key'] === 'TEST_KEY_ONLY'));
  const ins = requests.slice(1).map(r => new URL(r.url));
  assert(ins.every(u => u.searchParams.get('signal.interests.entities') === 'real-seed'));
  assert(ins.every(u => u.searchParams.get('feature.explainability') === 'true'));
  assert(ins.every(u => u.searchParams.get('filter.exclude.entities') === 'old-id'));
  assert.deepEqual(ins.map(u => u.searchParams.get('filter.location.query')), [null,null,null,'Louisville']);
  assert(requests.every(r => !r.url.includes('TEST_KEY_ONLY')));
  assert.throws(() => createQlooClient({apiKey:'fake',baseUrl:'https://evil.example'}), /Unapproved/);
});

test('unavailable live key fails explicitly without synthetic fallback', async () => {
  await assert.rejects(() => plan({ ...request, mode: 'live' }, { clientFactory: () => { throw Error('QLOO_API_KEY required'); } }), /QLOO_API_KEY/);
});

test('HTTP fixture mode works end-to-end and unconfigured live mode returns an explicit error', async () => {
  const server = http.createServer(createHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = `http://127.0.0.1:${server.address().port}`;
    const health = await (await fetch(`${addr}/api/health`)).json();
    assert.equal(health.fixtureReady, true);
    assert.equal(health.liveReady, Boolean(process.env.QLOO_API_KEY));
    const response = await fetch(`${addr}/api/plan`, { method:'POST', headers: {'content-type':'application/json'}, body:JSON.stringify(request) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).weeks.length, 4);
    if (!process.env.QLOO_API_KEY) {
      const live = await fetch(`${addr}/api/plan`, { method:'POST', headers: {'content-type':'application/json'}, body:JSON.stringify({...request,mode:'live'}) });
      assert.equal(live.status, 503);
    }
    const page = await fetch(`${addr}/`);
    assert.equal(page.status,200);
    assert((await page.text()).includes('NeighborhoodPulse'));
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
