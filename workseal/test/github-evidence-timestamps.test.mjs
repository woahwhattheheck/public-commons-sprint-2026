import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubEvidenceError, normalizeGitHubActionsEvidence } from '../src/github_evidence_contract.mjs';

function evidence(timestamp = '2026-03-02T00:00:00Z') {
  return {
    schema: 'workseal-github-actions-evidence/v1', repository: 'example/project',
    workflowPath: '.github/workflows/check.yml', workflowDigest: 'a'.repeat(64),
    runId: '1', attempt: '1', headSha: 'b'.repeat(40), event: 'push',
    status: 'completed', conclusion: 'success',
    createdAt: timestamp, updatedAt: timestamp, observedAt: timestamp,
    sourceApiUrl: 'https://api.github.com/repos/example/project/actions/runs/1',
    rawResponseDigest: 'c'.repeat(64),
    jobs: [{ name: 'check', conclusion: 'success', startedAt: timestamp,
      completedAt: timestamp, steps: [{ number: 1, name: 'check', conclusion: 'success' }] }],
  };
}

const badTimestamp = error => error instanceof GitHubEvidenceError && error.code === 'BAD_TIMESTAMP';

test('rejects impossible civil dates instead of normalizing them', () => {
  for (const timestamp of ['2026-02-30T00:00:00Z', '2100-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-03-01T24:00:00Z']) {
    assert.throws(() => normalizeGitHubActionsEvidence(evidence(timestamp)), badTimestamp, timestamp);
  }
});

test('all run and job timestamp fields use the shared strict validator', () => {
  const invalid = '2026-02-30T00:00:00Z'; // Date.parse normalizes this to March 2.
  for (const field of ['createdAt', 'updatedAt', 'observedAt']) {
    const input = evidence();
    input[field] = invalid;
    assert.throws(() => normalizeGitHubActionsEvidence(input), badTimestamp, field);
  }
  for (const field of ['startedAt', 'completedAt']) {
    const input = evidence();
    input.jobs[0][field] = invalid;
    assert.throws(() => normalizeGitHubActionsEvidence(input), badTimestamp, field);
  }
});

test('preserves valid leap dates, timezone offsets and fractional timestamp bytes', () => {
  for (const timestamp of ['2000-02-29T23:59:59Z', '2024-02-29T12:30:45.123456789+05:30', '2026-10-09T01:00:00-04:00']) {
    const normalized = normalizeGitHubActionsEvidence(evidence(timestamp));
    assert.equal(normalized.createdAt, timestamp);
    assert.equal(normalized.jobs[0].completedAt, timestamp);
  }
});
