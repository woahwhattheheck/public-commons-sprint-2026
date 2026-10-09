import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateFixture, derive, makeSnapshot} from '../src/engine.mjs';
const events = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));

test('real event-time fixture: two evidenced 8s Harbor counterpress recoveries, one Metro expiry', () => {
  validateFixture(events);
  const attempts = derive(events);
  assert.deepEqual(attempts.filter(x=>x.status==='success').map(x=>[x.team,x.secondsToRecover,x.pressureCount]), [
    ['Harbor FC',5,2], ['Harbor FC',4,1],
  ]);
  assert.equal(attempts.find(x=>x.team==='Metro Rovers').status, 'expired');
  const s = makeSnapshot(events, {team:'Harbor FC',audience:'analyst',locale:'en'});
  assert.equal(s.stats.successes, 2);
  assert.equal(s.stats.successRatePct, 100);
  assert.deepEqual(s.overlays[0].evidenceIds, ['e002','e003','e004','e005']);
  assert.match(s.overlays[0].text, /5s/);
});

test('early frame never claims not-yet-seen regain; duplicates and invalid audience fail closed', () => {
  const early = makeSnapshot(events.slice(0,4));
  assert.equal(early.stats.successes, 0);
  assert.equal(early.overlays.length, 0);
  assert.throws(()=>validateFixture([...events, {...events[0]}]), /repeated|monotone/);
  assert.throws(()=>makeSnapshot(events,{audience:'unsupported'}),/Unsupported/);
});

test('Spanish casual copy is grounded in identical source IDs and timings', () => {
  const es = makeSnapshot(events,{locale:'es'});
  const en = makeSnapshot(events,{locale:'en'});
  assert.deepEqual(es.overlays.map(x=>x.evidenceIds),en.overlays.map(x=>x.evidenceIds));
  assert.match(es.overlays[0].text,/5 segundos/);
});
