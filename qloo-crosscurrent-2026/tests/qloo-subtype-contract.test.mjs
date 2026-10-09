// Targeted provider-shape regression: categories use subtype while type is generic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {QlooClient} from '../src/qloo.mjs';
import {makeCulturalPlan} from '../src/agent.mjs';

const entity = (id, name, subtype, type = 'urn:entity') => ({entity_id:id,name,type,subtype});

test('Qloo generic urn:entity + subtype keeps only actual requested place entities', async () => {
  const client = new QlooClient({key:'offline-test-key', fetcher: async() => ({ok:true,json:async() => ({
    results: {entities:[
      entity('qloo-place-1','Actual venue','urn:entity:place'),
      entity('qloo-movie-1','Not a venue','urn:entity:movie'),
      entity('qloo-place-2','Another venue','urn:entity:place:restaurant'),
      entity('qloo-contradict','Conflicting types','urn:entity:place','urn:entity:movie')
    ]}
  })})});
  const actual = await client.insights('place',['qloo-seed-1']);
  assert.deepEqual(actual.map(x=>x.id),['qloo-place-1','qloo-place-2']);
  assert.deepEqual(actual.map(x=>x.type),['urn:entity:place','urn:entity:place:restaurant']);
});

test('wrong-type Qloo results never become a LIVE verified venue program', async () => {
  const fetcher = async (url) => {
    const path = new URL(url).pathname;
    const category = new URL(url).searchParams.get('filter.type');
    if (path === '/search') return {ok:true,json:async()=>({results:{entities:[entity('qloo-seed-1','Seed Artist','urn:entity:artist')]}})};
    if (category === 'urn:entity:artist') return {ok:true,json:async()=>({results:{entities:[entity('qloo-artist-2','Cultural Bridge','urn:entity:artist')]}})};
    if (category === 'urn:entity:place') return {ok:true,json:async()=>({results:{entities:[entity('qloo-movie-2','Misreported theater','urn:entity:movie')]}})};
    return {ok:true,json:async()=>({results:{entities:[]}})};
  };
  const client = new QlooClient({key:'offline-test-key',fetcher});
  const actual = await makeCulturalPlan({seed:'Seed Artist',city:'New York'},client);
  assert.equal(actual.status,'NO_VERIFIED_PLACE');
  assert.deepEqual(actual.proposals,[]);
  assert.ok(actual.trace.some(step=>step.stage==='BRIDGE' && step.result==='EMPTY'));
});
