import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDraftGrounding} from '../src/draft_evidence_guard.mjs';

const evidence = {status: 'success', text: 'Harbor FC won the ball back in 5 seconds after pressing.', evidenceIds: ['e001', 'e002', 'e003'], metrics: {pressureCount: 2, windowSeconds: 8, secondsToRecover: 5, observedSeconds: 5, zone: 'middle'}};

test('quantitative and evidence grounding for optional model draft', () => {
  assert.equal(validateDraftGrounding('Harbor FC regained the ball in 5 seconds after 2 pressures, see e003.', evidence).ok, true);
  assert.equal(validateDraftGrounding('Harbor FC regained possession after 6 seconds.', evidence).reason, 'unobserved_quantity');
  assert.equal(validateDraftGrounding('Harbor FC scored 2 goals.', evidence).reason, 'unsupported_statistic');
  assert.equal(validateDraftGrounding('Harbor FC won 8% of possessions.', evidence).reason, 'unsupported_statistic');
  assert.equal(validateDraftGrounding('Harbor FC regained the ball, see e999.', evidence).reason, 'unverified_evidence_id');
  assert.equal(validateDraftGrounding('Harbor FC failed to regain after 5 seconds.', evidence).reason, 'successful_outcome_contradiction');
  assert.equal(validateDraftGrounding('Harbor FC regained it: https://example.com', evidence).reason, 'invalid_draft_shape');
  const interrupted = {...evidence, status: 'interrupted'};
  assert.equal(validateDraftGrounding('Harbor FC observation interrupted after 5 seconds. Outcome unknown.', interrupted).ok, true);
  assert.equal(validateDraftGrounding('Harbor FC never recovered after 5 seconds.', interrupted).reason, 'unknown_outcome_contradiction');
  const expired = {...evidence, status: 'expired'};
  assert.equal(validateDraftGrounding('Harbor FC regained the ball.', expired).reason, 'expired_outcome_contradiction');
});
