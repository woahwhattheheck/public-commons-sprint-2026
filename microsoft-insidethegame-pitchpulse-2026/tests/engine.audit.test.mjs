import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MatchEngine,SYNTHETIC_EVENTS} from '../engine.mjs';

const shot=(id,second,outcome='saved')=>({id,second,team:'Harbor FC',type:'shot',outcome});

test('narration cites the counted events, respecting same-second order and window boundary',()=>{
  const engine=new MatchEngine();
  engine.ingest(shot('old',0));
  engine.ingest(shot('first',300,'goal'));
  engine.ingest(shot('later',300,'wide'));
  const [old,first,later]=engine.snapshot().overlays;
  assert.deepEqual(old.proof.eventIds,['old']);
  assert.deepEqual(first.proof.metrics.shots,{value:2,eventIds:['old','first']});
  assert.deepEqual(first.proof.metrics.recentShots,{value:1,eventIds:['first']});
  assert.deepEqual(first.proof.eventIds,['old','first']);
  assert.equal(first.proof.throughEventId,'first');
  assert.deepEqual(later.proof.metrics.shotsOnTarget,{value:2,eventIds:['old','first']});
  assert.deepEqual(later.proof.metrics.recentShots,{value:2,eventIds:['first','later']});
  assert.equal(later.proof.metrics.shots.value,3);
});

test('control score is reconstructible from exact component counts and source IDs',()=>{
  const engine=new MatchEngine();
  for(const e of SYNTHETIC_EVENTS)engine.ingest(e);
  const snapshot=engine.snapshot();
  const viewEvents=SYNTHETIC_EVENTS.filter(e=>e.second>snapshot.clockSecond-300);
  for(const team of ['Harbor FC','Valley FC']){
    const control=snapshot.control[team];
    assert.deepEqual(control.eventIds,viewEvents.filter(e=>e.team===team).map(e=>e.id));
    const sum=Object.values(control.components).reduce((total,c)=>total+c.value*c.weight,0);
    assert.equal(control.score,Number(sum.toFixed(1)));
    for(const [name,c] of Object.entries(control.components)){
      assert.ok(c.eventIds.every(id=>control.eventIds.includes(id)));
      assert.equal(c.value,name==='possessionSeconds'?c.eventIds.reduce((sum,id)=>sum+viewEvents.find(e=>e.id===id).duration,0):c.eventIds.length);
    }
  }
  assert.deepEqual(snapshot.control['Harbor FC'].components.possessionSeconds.eventIds,['ev11']);
  assert.equal(snapshot.control['Harbor FC'].components.possessionSeconds.value,28);
});

test('clock projections exclude future facts, expire active overlays and leave live state intact',()=>{
  const engine=new MatchEngine();
  for(const e of SYNTHETIC_EVENTS)engine.ingest(e);
  const live=engine.snapshot();
  const before=engine.snapshot({asOfSecond:237});
  assert.equal(before.clockSecond,237);
  assert.equal(before.scoreboard[0].goals,0);
  assert.equal(before.lastEvent.id,'ev08');
  assert.equal(before.acceptedEvents,8);
  assert.ok(!JSON.stringify(before).includes('ev09'));
  const goal=engine.snapshot({asOfSecond:238});
  assert.equal(goal.scoreboard[0].goals,1);
  assert.equal(goal.activeOverlays.at(-1).eventId,'ev09');
  assert.equal(engine.snapshot({asOfSecond:256}).activeOverlays.length,0);
  const silent=engine.snapshot({asOfSecond:5400});
  assert.equal(silent.control['Harbor FC'].score,0);
  assert.equal(silent.control['Valley FC'].score,0);
  assert.equal(silent.activeOverlays.length,0);
  assert.deepEqual(engine.snapshot(),live);
  for(const invalid of [-1,5401,1.5,NaN,null,'238'])assert.throws(()=>engine.snapshot({asOfSecond:invalid}),/Invalid snapshot clock/);
});

test('exact retries remain idempotent while conflicting IDs and returned-event mutation cannot rewrite history',()=>{
  const engine=new MatchEngine();
  const first=shot('one',5,'goal');
  const accepted=engine.ingest(first);
  first.outcome='wide';
  assert.throws(()=>{accepted.event.outcome='wide';},TypeError);
  const before=engine.snapshot();
  assert.throws(()=>engine.ingest(first),/Event id conflicts/);
  assert.throws(()=>engine.ingest({...first,second:6}),/Event id conflicts/);
  assert.deepEqual(engine.snapshot(),before);
  assert.equal(engine.ingest(shot('one',5,'goal')).duplicate,true);
  assert.equal(engine.snapshot().acceptedEvents,1);
  engine.reset();
  assert.equal(engine.ingest(first).duplicate,false);
  assert.equal(engine.snapshot().scoreboard[0].goals,0);
});
