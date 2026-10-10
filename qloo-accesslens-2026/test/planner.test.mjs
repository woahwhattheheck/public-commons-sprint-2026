import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureCatalog,fixtureInsights} from '../src/catalog.mjs';
import {normalizeRequest,planAuditedVenues,fixturePlan} from '../src/engine.mjs';
import {readArtistSearch,readPlaceRanks,ProviderError} from '../src/qloo.mjs';

const payload={artist:'Nina Simone',groupSize:45,budgetUSD:25,required:['step_free','low_sensory','accessible_toilet']};
test('fixture enforces all hard constraints before cultural ranking, visibly labels source',()=>{
 const r=fixturePlan(payload,fixtureCatalog);
 assert.equal(r.status,'RECOMMENDATIONS');
 assert.deepEqual(r.recommended.map(v=>v.operatorVenueId),['venue-b']);
 assert.equal(r.providerEvidence,'SYNTHETIC_OFFLINE_FIXTURE');
 assert.ok(r.nearMisses.some(x=>x.name.includes('Hilltop')&&x.reasons.includes('fails_step_free')));
 assert.ok(r.nearMisses.some(x=>x.name.includes('Canal')&&x.reasons.includes('insufficient_audited_capacity')));
});
test('no verified fit abstains rather than recommending appealing inaccessible venue',()=>{
 const r=fixturePlan({...payload,groupSize:900},fixtureCatalog);
 assert.equal(r.status,'ABSTAIN_NO_VERIFIED_FIT');assert.equal(r.recommended.length,0);
});
test('unknown Qloo place ID cannot match even if venue name looks similar',()=>{
 const r=planAuditedVenues(fixtureCatalog,payload,{artist:{id:'anything'},rankedPlaceIds:['not-a-real-id']},{mode:'live'});
 assert.equal(r.status,'ABSTAIN_NO_VERIFIED_FIT');
});
test('provider parser rejects unknown envelopes, wrong subtypes and ambiguous artist identities',()=>{
 assert.throws(()=>readPlaceRanks({results:{foo:[]}}),ProviderError);
 assert.throws(()=>readPlaceRanks({results:{entities:[{entity_id:'a',subtype:'urn:entity:movie'}]}}),ProviderError);
 assert.throws(()=>readArtistSearch({results:{entities:[{entity_id:'a',subtype:'urn:entity:artist',name:'Nina Simone'},{entity_id:'b',subtype:'urn:entity:artist',name:'Nina Simone'}]}},'Nina Simone'),ProviderError);
 assert.deepEqual(readPlaceRanks({results:{entities:[{entity_id:'a',subtype:'urn:entity:place'},{entity_id:'a',subtype:'urn:entity:place'}]}}),['a']);
});
test('bad request shapes and incomplete audit metadata fail closed',()=>{
 assert.throws(()=>normalizeRequest({...payload,groupSize:0}));
 assert.throws(()=>normalizeRequest({...payload,required:['step_free','step_free']}));
 assert.throws(()=>planAuditedVenues([{...fixtureCatalog[0],accessible_toilet:undefined}],payload,{rankedPlaceIds:fixtureInsights}));
});
