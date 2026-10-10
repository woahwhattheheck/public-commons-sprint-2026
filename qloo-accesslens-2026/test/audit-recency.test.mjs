import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureCatalog, auditUtcDay, validateCatalog} from '../src/catalog.mjs';
import {planAuditedVenues} from '../src/engine.mjs';

const req={artist:'Nina Simone',groupSize:30,budgetUSD:30,required:['step_free','accessible_toilet']};
const rankedPlaceIds=['demo-place-b','demo-place-a'];
const affinity={artist:{id:'synthetic-test'},rankedPlaceIds};
const plan=(catalog,opts={})=>planAuditedVenues(catalog,req,affinity,{mode:'live',auditAsOfUTC:'2026-10-09',maxAuditAgeDays:180,...opts});
const freshVenue={...fixtureCatalog[1],audit_date:'2026-10-09'};

test('rejects normalized invalid calendar days and invalid recency configurations',()=>{
 for(const date of ['2026-02-30','2026-02-29','2026-13-01','2026-00-01','2026-10-32']) {
   assert.throws(()=>auditUtcDay(date),/calendar date/);
   assert.throws(()=>validateCatalog([{...freshVenue,audit_date:date}]),/invalid audit date/);
 }
 assert.throws(()=>plan([freshVenue],{auditAsOfUTC:'2026-02-30'}),/calendar date/);
 assert.throws(()=>plan([freshVenue],{maxAuditAgeDays:999}),/policy window/);
});

test('future-dated and expired venue audits are never recommended despite top Qloo rank',()=>{
 const stale={...freshVenue,audit_date:'2026-04-11'};
 const future={...fixtureCatalog[0],audit_date:'2026-10-10'};
 const result=plan([stale,future]);
 assert.equal(result.status,'ABSTAIN_NO_VERIFIED_FIT');
 assert.equal(result.recommended.length,0);
 assert.ok(result.nearMisses.some(row=>row.name===stale.name&&row.reasons.includes('audit_older_than_policy_window')));
 assert.ok(result.nearMisses.some(row=>row.name===future.name&&row.reasons.includes('audit_dated_in_future')));
 assert.equal(result.providerEvidence,'LIVE_QLOO_RESPONSE');
 assert.deepEqual(result.operatorAuditPolicy,{asOfUTC:'2026-10-09',maxAgeDays:180});
});

test('strict window includes boundary day, excludes one day beyond, and fresh picks retain rank',()=>{
 const start=auditUtcDay('2026-10-09');
 const boundary=new Date((start-180)*86400000).toISOString().slice(0,10);
 const expired=new Date((start-181)*86400000).toISOString().slice(0,10);
 const result=plan([{...freshVenue,audit_date:boundary},{...fixtureCatalog[0],audit_date:expired}]);
 assert.deepEqual(result.recommended.map(x=>x.operatorVenueId),[freshVenue.id]);
 assert.equal(result.recommended[0].affinityRank,1);
 assert.equal(result.nearMisses[0].name,fixtureCatalog[0].name);
 assert.ok(result.nearMisses[0].reasons.includes('audit_older_than_policy_window'));
});
