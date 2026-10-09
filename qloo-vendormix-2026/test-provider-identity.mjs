// SPDX-License-Identifier: MIT
// Source-bound, offline Qloo live-candidate identity regression; no API key needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerEntityId } from './provider-identity.mjs';
import { providerCandidates } from './app.mjs';
import { rankLineup } from './lineup.mjs';

test('Qloo IDs are accepted only as nonempty provider-supplied strings', () => {
  assert.equal(providerEntityId({entity_id:'urn:entity:place:alpha'}), 'urn:entity:place:alpha');
  assert.equal(providerEntityId({id:'QLOO-BETA'}), 'QLOO-BETA');
  for (const bad of [
    {}, null, [], 23, {entity_id:null}, {entity_id:0}, {id:42},
    {entity_id:' '}, {entity_id:' padded'}, {entity_id:'trailing '},
    {entity_id:'bad\nnext'}, {id:'bad\x00nul'}, {id:{value:'made-up'}},
  ]) {
    assert.equal(providerEntityId(bad), null);
  }
});

test('live result parser retains only real identities and source ordinals', () => {
  const payload = { success:true, results:{ entities:[
    { name:'Gallery', entity_id:'urn:entity:place:alpha', properties:{tags:[{name:'Culture'}]} },
    { name:'No real ID' },
    { name:'Numeric ID', id:27 },
    { name:'Whitespace ID', entity_id:' suspicious' },
    { name:'Cafe', id:'QLOO-BETA', query:{affinity:80}, properties:{tags:[{name:'Coffee'}]} },
    { name:'Another No ID' },
  ] } };
  const parsed=providerCandidates(payload);
  assert.deepEqual(parsed.map(c=>c.id), ['urn:entity:place:alpha','QLOO-BETA']);
  assert.deepEqual(parsed.map(c=>c.ordinal), [1,5]);
  assert.ok(parsed.every(c=>!c.id.startsWith('position-')));
  assert.equal(parsed[1].signal,0.8);
  const plan=rankLineup(parsed,{mode:'balanced',exclusions:[],slots:3,categoryCap:null});
  assert.equal(plan.selected.length,2);
  assert.equal(plan.summary.filled,2);
  assert.ok(plan.summary.shortfallNote);
  assert.ok(plan.selected.every(c=>['urn:entity:place:alpha','QLOO-BETA'].includes(c.id)));
});

test('provider names without IDs do not become fictional live entities', () => {
  assert.throws(
    () => providerCandidates({success:true,results:{entities:[
      {name:'No ID'}, {name:'Zero',id:0}, {name:'Blank',entity_id:' '},
    ]}}),
    /no named places with provider IDs/
  );
  assert.throws(() => providerCandidates({success:false,results:{entities:[]}}), /usable list/);
});
