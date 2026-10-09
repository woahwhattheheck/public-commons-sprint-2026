// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { QlooClient, QlooError } from '../src/qloo.mjs';

const valid = (payload, onCall = () => {}) => async () => {
  onCall();
  return { ok: true, status: 200, json: async () => payload };
};

test('explicit empty results is a legitimate no-match, and may be cached', async () => {
  let calls = 0;
  const client = new QlooClient({key:'fixture-no-real-key', fetcher:valid({results:[]}, () => calls++)});
  assert.deepEqual(await client.search('Longhouse'), []);
  assert.deepEqual(await client.search('Longhouse'), []);
  assert.equal(calls, 1);
});

test('unknown HTTP-200 entity envelope is rejected, not turned into a no-match or cached', async () => {
  let calls = 0;
  const client = new QlooClient({key:'fixture-no-real-key', fetcher:valid({items:[{id:'item-1',name:'Unknown'}]}, () => calls++)});
  for(let i=0;i<2;i++) {
    await assert.rejects(client.search('Longhouse'), error =>
      error instanceof QlooError && error.code === 'QLOO_RESPONSE_SHAPE_UNRECOGNIZED' && error.status === 502);
  }
  assert.equal(calls, 2);
  assert.equal(client.cache.size, 0);
  assert.equal(client.inFlight.size, 0);
});

test('null results is invalid but a recognized nested Qloo insights envelope remains supported', async () => {
  const invalid = new QlooClient({key:'fixture-no-real-key', fetcher:valid({results:null})});
  await assert.rejects(invalid.search('Longhouse'), {code:'QLOO_RESPONSE_SHAPE_UNRECOGNIZED'});
  const nested = new QlooClient({key:'fixture-no-real-key', fetcher:valid({results:{entities:[
    {id:'valid-place-1',name:'Verified Place',type:'urn:entity',subtype:'urn:entity:place'},
  ]}})});
  const places = await nested.insights('place',['seed-1']);
  assert.deepEqual(places.map(item=>({name:item.name,id:item.id})),[{name:'Verified Place',id:'valid-place-1'}]);
});
