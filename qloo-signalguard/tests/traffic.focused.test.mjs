import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditTraffic, TrafficError } from '../src/traffic.mjs';

const complete = { status: 'complete', segments: { low: { status: 'ok' }, high: { status: 'ok' } } };
const input = { seed: 'Alien', seedType: 'urn:entity:movie', target: 'urn:entity:book', mode: 'live' };

test('one live call for simultaneous identical audits, cached reuse, and finite hourly admission', async () => {
  let clock = 100_000;
  let calls = 0;
  let resolve;
  const traffic = createAuditTraffic({ now: () => clock, maxLivePerHour: 2 });
  const first = traffic.run({ ...input, execute: () => { calls++; return new Promise(r => { resolve = r; }); } });
  const second = traffic.run({ ...input, seed: ' alien ', execute: () => { calls++; return complete; } });
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(complete);
  assert.equal((await first).delivery, 'fresh');
  assert.equal((await second).delivery, 'coalesced');
  assert.equal((await traffic.run({ ...input, execute: () => { calls++; return complete; } })).delivery, 'cache');
  assert.equal(calls, 1);
  const other = await traffic.run({ ...input, seed: 'Dune', execute: () => { calls++; return complete; } });
  assert.equal(other.delivery, 'fresh');
  await assert.rejects(traffic.run({ ...input, seed: 'Arrival', execute: () => complete }), TrafficError);
  assert.equal(traffic.stats().liveAuditsRemaining, 0);
  clock += 3_600_001;
  assert.equal(traffic.stats().liveAuditsRemaining, 2);
  assert.equal((await traffic.run({ ...input, execute: () => complete })).delivery, 'fresh');
});

test('failed and partial provider runs are never cached', async () => {
  const traffic = createAuditTraffic();
  let calls = 0;
  const failed = async () => { calls++; throw Error('upstream rejected'); };
  await assert.rejects(traffic.run({ ...input, execute: failed }), /upstream/);
  await assert.rejects(traffic.run({ ...input, execute: failed }), /upstream/);
  await traffic.run({ ...input, execute: async () => { calls++; return { status: 'complete', segments: { low: { status: 'unavailable' }, high: { status: 'ok' } } }; } });
  await traffic.run({ ...input, execute: async () => { calls++; return complete; } });
  assert.equal(calls, 4);
});
