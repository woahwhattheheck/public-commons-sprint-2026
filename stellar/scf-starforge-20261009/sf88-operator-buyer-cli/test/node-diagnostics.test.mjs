import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect, format } from 'node:util';
import { spawnSync } from 'node:child_process';
import { BuyerError } from '../node/store.mjs';

test('buyer diagnostics retain recovery handles without logging their private state', () => {
  const canary = 'private-runtime-canary-7291';
  const operation = { buyer: { runtime: { environment: { credential: canary } } }, recover: () => 'recovered' };
  const error = new BuyerError('NATIVE_RESULT_UNAVAILABLE', {
    operation, dataset: operation, acquisition: operation, result: { private: canary },
    exitCode: 7, destinationPublished: true,
  });
  assert.equal(error.operation, operation);
  assert.equal(error.operation.recover(), 'recovered');
  assert.equal(error.dataset, operation);
  assert.equal(error.acquisition, operation);
  assert.equal(error.result.private, canary);
  assert.deepEqual(JSON.parse(JSON.stringify(error)), {
    name: 'BuyerError', code: 'NATIVE_RESULT_UNAVAILABLE', exitCode: 7, destinationPublished: true,
  });
  for (const output of [inspect(error), inspect(error, { depth: null, showHidden: true }),
    inspect(error, { customInspect: false }), format('%o', error), JSON.stringify({ error }), JSON.stringify({ ...error })]) {
    assert.ok(output.includes('NATIVE_RESULT_UNAVAILABLE'));
    assert.ok(!output.includes(canary));
  }
  class RecoveryError extends BuyerError { constructor() { super('RECOVERY_REQUIRED', { operation }); this.name = 'RecoveryError'; } }
  assert.equal(new RecoveryError().toJSON().name, 'RecoveryError');
  assert.equal(new BuyerError('NO_DETAILS', null).code, 'NO_DETAILS');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { BuyerError } from ${JSON.stringify(new URL('../node/store.mjs', import.meta.url).href)};
    const operation = { buyer: { runtime: { environment: process.env } } };
    throw new BuyerError('CHILD_RECOVERY_REQUIRED', { operation, exitCode: 7 });
  `], { encoding: 'utf8', env: { BUYER_DIAGNOSTIC_CANARY: canary } });
  assert.equal(child.status, 1);
  assert.ok(child.stderr.includes('CHILD_RECOVERY_REQUIRED'));
  assert.ok(!child.stderr.includes(canary));
  assert.ok(child.stderr.includes('exitCode: 7'));
});
