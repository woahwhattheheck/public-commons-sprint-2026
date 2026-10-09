import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditTraffic, TrafficError } from '../src/traffic.mjs';

const complete = { status: 'complete', segments: { low: { status: 'ok' }, high: { status: 'ok' } } };
const input = { seedType: 'urn:entity:movie', target: 'urn:entity:artist', mode: 'live' };

test('coalescing and cache survive strict direct-peer quota; 429 advertises a Retry-After', async () => {
  let clock = 100_000;
  let calls = 0;
  const traffic = createAuditTraffic({ maxLivePerHour: 12, now: () => clock, cacheTtlMs: 60_000 });
  const run = (seed, remoteAddress = '127.0.0.1', mode = 'live') => traffic.run({
    ...input, mode, seed, remoteAddress, execute: async () => { calls++; return complete; },
  });
  for (const seed of ['Alpha', 'Bravo', 'Charlie', 'Delta']) assert.equal((await run(seed)).delivery, 'fresh');
  assert.equal((await run('Alpha')).delivery, 'cache');
  assert.equal(calls, 4);
  await assert.rejects(run('Echo'), err => err instanceof TrafficError && err.status === 429 && err.retryAfter >= 1);
  assert.equal(calls, 4);
  assert.equal((await run('Echo', '127.0.0.2')).delivery, 'fresh');
  assert.equal(calls, 5);
  assert.equal((await run('Foxtrot', '127.0.0.1', 'demo')).delivery, 'fresh');
  clock += 601_000;
  assert.equal((await run('Golf')).delivery, 'fresh');
  assert.equal(calls, 7);
  assert.equal(traffic.stats().maxLiveAuditsPerHour, 12);
});
