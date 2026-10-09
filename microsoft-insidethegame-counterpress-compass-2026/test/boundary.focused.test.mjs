import test from 'node:test';
import assert from 'node:assert/strict';
import {derive, makeSnapshot} from '../src/engine.mjs';

const event = (id, second, type) => ({id, second, type, team:'Harbor FC', zone:'middle', player:'Synthetic'});

test('equal-time clock cannot expire an inclusive eight-second recovery window', () => {
  const atBoundary = [event('e301',0,'loss'), event('e302',1,'pressure'), event('e303',8,'clock')];
  const sameTimeRegain = [...atBoundary, event('e304',8,'regain')];
  const pastBoundary = [...atBoundary, event('e305',8.1,'clock')];
  const prefix = makeSnapshot(atBoundary);
  const recovered = derive(sameTimeRegain);
  const expired = derive(pastBoundary);
  console.log(JSON.stringify({fixture:'inclusive-window-timestamp-tie',
    boundaryOverlayStatuses:prefix.overlays.map(x=>x.status),
    sameTimeRegain:recovered.map(x=>({status:x.status,secondsToRecover:x.secondsToRecover,evidenceIds:x.evidenceIds})),
    pastBoundary:expired.map(x=>({status:x.status,toSecond:x.toSecond}))}));
  assert.deepEqual(derive(atBoundary), []);
  assert.equal(prefix.overlays.length, 0);
  assert.equal(prefix.stats.successRatePct, null);
  assert.equal(prefix.stats.resolvedCounterpressAttempts, 0);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'success');
  assert.equal(recovered[0].secondsToRecover, 8);
  assert.deepEqual(recovered[0].evidenceIds, ['e301','e302','e304']);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, 'expired');
  assert.equal(expired[0].toSecond, 8);
  assert.equal(makeSnapshot(pastBoundary).stats.successRatePct, 0);
});
