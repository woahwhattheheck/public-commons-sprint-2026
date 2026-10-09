import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Hex, WorkSealMeteoraError } from '../src/meteora_dbc.mjs';

test('Meteora canonical plan digests preserve every own JSON field', () => {
  const key = ['__', 'proto__'].join('');
  const source = JSON.parse(JSON.stringify({ note: 'v1' }));
  Object.defineProperty(source, key, { value: { marker: 'distinct' }, enumerable: true });
  assert.equal(canonicalJson(source), '{"__proto__":{"marker":"distinct"},"note":"v1"}');
  assert.notEqual(sha256Hex(source), sha256Hex({ note: 'v1' }));
});

test('Meteora canonical digest refuses sparse arrays rather than equating them to null', () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => sha256Hex(sparse), (error) => error instanceof WorkSealMeteoraError && error.code === 'SPARSE_ARRAY');
  assert.equal(canonicalJson([null]), '[null]');
});
