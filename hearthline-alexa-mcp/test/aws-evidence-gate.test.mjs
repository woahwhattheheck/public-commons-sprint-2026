import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAwsEvidence } from '../aws/evidence-gate.mjs';

const good = {
  schemaVersion: 1,
  provider: 'aws',
  service: 'dynamodb',
  region: 'us-east-1',
  endpoint: 'https://dynamodb.us-east-1.amazonaws.com',
  target: 'DynamoDB_20120810.GetItem',
  observedAt: '2026-09-13T12:00:00.000Z',
  httpStatus: 200,
  requestId: '1A2B3C4D-12345678',
  liveAwsObservation: true,
  tableName: 'HearthlineState',
  adapter: 'hearthline-dynamodb-json-store',
  evidenceKind: 'live_read_probe',
};

test('accepts a bounded live DynamoDB read receipt', () => {
  const result = validateAwsEvidence(good, { expectedRegion: 'us-east-1', expectedTable: 'HearthlineState' });
  assert.deepEqual(result, { ok: true, state: 'LIVE_AWS_EVIDENCE_VERIFIED', errors: [] });
});

test('offline/mock receipt cannot certify AWS Builder runtime use', () => {
  const result = validateAwsEvidence({ ...good, endpoint: 'https://example.com', liveAwsObservation: false, requestId: null });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('liveAwsObservation')));
  assert(result.errors.some((error) => error.includes('canonical regional DynamoDB')));
});

test('secret-bearing evidence fields fail closed', () => {
  const result = validateAwsEvidence({ ...good, debug: { AWS_SECRET_ACCESS_KEY: 'do-not-store' } });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('secret-bearing field')));
});
