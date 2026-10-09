import test from 'node:test';
import assert from 'node:assert/strict';
import {createFoundryAdmission} from '../src/foundry_quota.mjs';

test('admitted paid drafts are capped, rejected while busy, and reset only after the rolling hour', () => {
  let time = 1_000_000;
  let providerCalls = 0;
  const gate = createFoundryAdmission({maxPerHour: 2, maxInFlight: 1, now: () => time});
  const first = gate.reserve();
  assert.equal(first.ok, true);
  providerCalls++;
  const busy = gate.reserve();
  assert.deepEqual(busy, {ok: false, retryAfterSeconds: 1});
  assert.equal(providerCalls, 1, 'rejected admission must not call provider');
  first.release(); first.release(); // idempotent cleanup
  const second = gate.reserve();
  assert.equal(second.ok, true);
  providerCalls++;
  second.release();
  const limited = gate.reserve();
  assert.equal(limited.ok, false);
  assert.equal(limited.retryAfterSeconds, 3600);
  assert.equal(providerCalls, 2);
  time += 3_599_001;
  assert.equal(gate.reserve().retryAfterSeconds, 1);
  time += 999;
  const afterHour = gate.reserve();
  assert.equal(afterHour.ok, true, 'the oldest admitted attempt is now outside the window');
  afterHour.release();
  assert.throws(() => createFoundryAdmission({maxPerHour: 0}), /Invalid/);
});
