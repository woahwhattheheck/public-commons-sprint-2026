import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MatchEngine,SYNTHETIC_EVENTS,normalizeEvent} from '../engine.mjs';

test('synthetic event replay is idempotent, and narrative is ledger-linked',()=>{
 const m=new MatchEngine(); for(const e of SYNTHETIC_EVENTS)m.ingest(e);
 assert.equal(m.ingest(SYNTHETIC_EVENTS[8]).duplicate,true);
 const analyst=m.snapshot();
 assert.equal(analyst.acceptedEvents,15);
 assert.equal(analyst.scoreboard[0].goals,1);
 assert.equal(analyst.scoreboard[1].goals,0);
 assert.equal(analyst.overlays.find(o=>o.kind==='goal').eventId,'ev09');
 assert.equal(analyst.overlays.every(o=>o.proof.eventIds.includes(o.eventId)),true);
 assert.notEqual(m.snapshot({audience:'fan',favorite:'Harbor FC'}).overlays.at(-1).text,analyst.overlays.at(-1).text);
});

test('rejects invalid event data and out-of-order events without mutating the ledger',()=>{
 const m=new MatchEngine();
 m.ingest(SYNTHETIC_EVENTS[1]);
 assert.throws(()=>m.ingest(SYNTHETIC_EVENTS[0]),/ordered/);
 assert.throws(()=>normalizeEvent({...SYNTHETIC_EVENTS[4],duration:60}),/Duration/);
 assert.throws(()=>normalizeEvent({...SYNTHETIC_EVENTS[0],team:'Real Club'}),/fixture/);
 assert.equal(m.snapshot().acceptedEvents,1);
});