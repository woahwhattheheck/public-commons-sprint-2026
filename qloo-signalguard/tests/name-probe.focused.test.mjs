import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/audit.mjs';
import { createQlooProvider, QlooError } from '../src/qloo.mjs';

const kind = 'urn:entity:movie';
const seed = { seed: 'Alpha', seedType: kind, target: kind };
const entities = xs => ({ results: { entities: xs } });
const row = (id, popularity = 0.5, subtype = kind) =>
  ({ entity_id: id, name: 'Name ' + id, subtype, popularity });

test('single exact-name path only after valid but empty ID baseline; all recovered slices use the SAME name signal', async () => {
  const calls = [];
  const provider = {
    search: async () => entities([{ entity_id: 'source-id', name: 'Alpha', subtype: kind }]),
    insights: async q => {
      calls.push(q);
      if (q.entityId) return entities([]);
      if (q.maxPopularity !== undefined) return entities([row('lower'), row('wrong-kind', 0.2, 'urn:entity:artist')]);
      if (q.minPopularity !== undefined) return entities([row('higher', 0.9)]);
      return entities([row('baseline', 0.4)]);
    },
  };
  const out = await audit(seed, provider);
  assert.equal(out.status, 'complete');
  assert.equal(out.baselineSignal, 'exact-name');
  assert.equal(out.lookup, 'exact name');
  assert.equal(out.metrics.baselineCount, 1);
  assert.equal(out.segments.low.count, 1);
  assert.equal(out.segments.high.count, 1);
  assert.deepEqual(calls.map(c => c.entityName || c.entityId), ['source-id', 'Alpha', 'Alpha', 'Alpha']);
  assert.equal(out.trace.find(x => x.step === 'resolve-name')?.detail.includes('exact selected name'), true);

  const regular = [];
  const neverFallback = {
    search: provider.search,
    insights: async q => { regular.push(q); return entities([row('baseline')]); },
  };
  const old = await audit(seed, neverFallback);
  assert.equal(old.status, 'complete');
  assert.equal(old.baselineSignal, 'entity-id');
  assert.equal(old.trace.length, 4);
  assert.equal(regular.length, 3);
  assert.ok(regular.every(q => q.entityId === 'source-id' && q.entityName === undefined));
});

test('empty or malformed name response does not become completed evidence', async () => {
  const search = async () => entities([{ entity_id: 'source-id', name: 'Alpha', subtype: kind }]);
  assert.equal((await audit(seed,{search,insights:async()=>entities([])})).status,'abstained');
  await assert.rejects(audit(seed,{
    search,
    insights:async q => q.entityId ? entities([]) : { results: { invalid: [] } },
  }),/entities\[\] is missing/);
  const conflicting = await audit(seed,{
    search,
    insights:async q => q.entityId ? entities([]) : entities([row('wrong',0.5,'urn:entity:artist')]),
  });
  assert.equal(conflicting.status,'abstained');
});

test('real-provider transport contract uses server-only POST /v2/insights for name, GET only for IDs; redirect refuses key handoff', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({url:new URL(url), init});
    return new Response(JSON.stringify(entities([row('result')])),{status:200,headers:{'content-type':'application/json'}});
  };
  const provider = createQlooProvider('server-only-test-key',fetcher);
  await provider.insights({target:kind,entityId:'id-123',take:15});
  await provider.insights({target:kind,entityName:'Alpha',take:15,maxPopularity:0.5});
  assert.equal(requests.length,2);
  assert.equal(requests[0].url.searchParams.get('signal.interests.entities'),'id-123');
  assert.equal(requests[0].init.method ?? 'GET','GET');
  assert.equal(requests[1].url.pathname,'/v2/insights');
  assert.equal(requests[1].init.method,'POST');
  assert.equal(requests[1].init.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(requests[1].init.body)['signal.interests.entities.query'],[{name:'Alpha'}]);
  assert.equal(JSON.parse(requests[1].init.body)['filter.popularity.max'],0.5);
  assert.ok(requests.every(c=>c.init.headers['X-Api-Key']==='server-only-test-key'&&!c.url.href.includes('server-only-test-key')&&!String(c.init.body??'').includes('server-only-test-key')));
  assert.ok(requests.every(c=>c.init.redirect==='manual'));
  await assert.rejects(createQlooProvider('key',async()=>new Response('',{status:307,headers:{location:'https://untrusted.example'}}))
    .insights({target:kind,entityName:'Alpha'}),e=>e instanceof QlooError&&/redirect refused/.test(e.message));
});