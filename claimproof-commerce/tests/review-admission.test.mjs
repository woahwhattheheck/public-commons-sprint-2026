import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewAdmission} from '../src/review_admission.mjs';

test('review admission bounds pending calls and live reviews and frees expired capacity', () => {
  const gate = new ReviewAdmission({liveLimit: 2, pendingLimit: 1, ttlMs: 100});
  const reviews = new Map();

  const first = gate.reserve(reviews, 1000);
  assert.equal(first.accepted, true);
  assert.equal(gate.reserve(reviews, 1000).reason, 'advisory_concurrency');
  reviews.set('old', {created: 1000});
  assert.equal(gate.reserve(reviews, 1000).reason, 'advisory_concurrency');
  first.release();
  first.release();
  assert.equal(gate.pending, 0);

  const second = gate.reserve(reviews, 1000);
  assert.equal(second.accepted, true);
  reviews.set('new', {created: 1000});
  second.release();
  assert.equal(gate.reserve(reviews, 1000).reason, 'review_capacity');

  const fresh = gate.reserve(reviews, 1101);
  assert.equal(fresh.accepted, true);
  assert.equal(reviews.size, 0);
  fresh.release();
  assert.throws(() => new ReviewAdmission({liveLimit: 1, pendingLimit: 2}), RangeError);
});
