import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSnapshot} from '../src/engine.mjs';

const event = (id, second, type) => ({id, second, type, team:'Harbor FC', zone:'middle', player:'Synthetic'});
const interrupted = [event('e101',0,'loss'), event('e102',1,'pressure'),
  event('e103',3,'loss'), event('e104',4,'pressure'), event('e105',7,'regain')];
const observedExpiry = [event('e201',0,'loss'), event('e202',1,'pressure'),
  event('e203',9,'clock'), event('e204',10,'loss'), event('e205',11,'pressure'), event('e206',14,'regain')];

test('paired sparse interruption and observed expiry preserve unknown versus resolved outcomes', () => {
  const unknown = makeSnapshot(interrupted);
  const expired = makeSnapshot(observedExpiry);
  console.log(JSON.stringify({fixture:'interruption-vs-observed-expiry',
    interrupted:unknown.stats, interruptedCue:unknown.overlays[0], observedExpiry:expired.stats}));
  assert.equal(unknown.stats.counterpressAttempts, 2);
  assert.equal(unknown.stats.resolvedCounterpressAttempts, 1);
  assert.equal(unknown.stats.interruptedAttempts, 1);
  assert.equal(unknown.stats.successes, 1);
  assert.equal(unknown.stats.successRatePct, 100);
  assert.equal(unknown.stats.successRateBasis, 'resolved_counterpress_attempts');
  assert.equal(unknown.stats.meanRecoverySeconds, 4);
  assert.deepEqual(unknown.overlays[0].evidenceIds, ['e101','e102','e103']);
  assert.equal(unknown.overlays[0].status, 'interrupted');
  assert.equal(unknown.overlays[0].metrics.observedSeconds, 3);
  assert.equal(expired.stats.resolvedCounterpressAttempts, 2);
  assert.equal(expired.stats.interruptedAttempts, 0);
  assert.equal(expired.stats.successRatePct, 50);
  assert.equal(expired.overlays[0].status, 'expired');
  for (const locale of ['en','es']) for (const audience of ['casual','analyst']) {
    const cue = makeSnapshot(interrupted,{locale,audience}).overlays[0];
    assert.match(cue.text, locale==='en' ? /outcome unknown/ : /resultado desconocido/);
    assert.match(cue.text, /3/);
    assert.doesNotMatch(cue.text, /eight|8|ocho/);
  }
  const onlyUnknown = makeSnapshot(interrupted.slice(0,3));
  assert.equal(onlyUnknown.stats.successRatePct, null);
  assert.equal(onlyUnknown.stats.resolvedCounterpressAttempts, 0);
  assert.equal(onlyUnknown.stats.interruptedAttempts, 1);
});
