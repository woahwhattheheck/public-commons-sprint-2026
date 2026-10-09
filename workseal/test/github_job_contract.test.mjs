import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGitHubActionsExpected, normalizeGitHubActionsEvidence } from '../src/github_evidence_contract.mjs';
import { canonicalJson } from '../src/canonical.mjs';

function fixture(names = ['build']) {
  const evidence = {
    schema: 'workseal-github-actions-evidence/v1', repository: 'example/workseal',
    workflowPath: '.github/workflows/test.yml', workflowDigest: 'a'.repeat(64),
    runId: '42', attempt: '1', headSha: 'b'.repeat(40), event: 'push',
    status: 'completed', conclusion: 'success',
    createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:02:00Z',
    observedAt: '2026-10-09T00:05:00Z',
    sourceApiUrl: 'https://api.github.com/repos/example/workseal/actions/runs/42',
    rawResponseDigest: 'c'.repeat(64),
    jobs: names.map(name => ({
      name, conclusion: 'success', startedAt: '2026-10-09T00:00:10Z',
      completedAt: '2026-10-09T00:01:50Z',
      steps: [{ number: 1, name: 'test', conclusion: 'success' }],
    })),
  };
  const expected = {
    repository: evidence.repository, workflowPath: evidence.workflowPath,
    workflowDigest: evidence.workflowDigest, headSha: evidence.headSha,
    event: evidence.event, requiredJobs: [...names],
  };
  return { evidence, expected };
}

test('required jobs use exact names and cardinality, not delimiter-joined equality', () => {
  const { evidence, expected } = fixture(['build\0test']);
  expected.requiredJobs = ['build', 'test'];
  assert.throws(() => assertGitHubActionsExpected(evidence, expected), { code: 'EXPECTED_JOB_SET_MISMATCH' });
  const literal = fixture(['build\0test']);
  assert.equal(assertGitHubActionsExpected(literal.evidence, literal.expected).jobs.length, 1);
  const ordinary = fixture(['test', 'build']);
  ordinary.expected.requiredJobs.reverse();
  assert.deepEqual(assertGitHubActionsExpected(ordinary.evidence, ordinary.expected).jobs.map(j => j.name), ['build', 'test']);
});

test('normalization order is exact and independent of locale-equivalent input order', () => {
  const { evidence } = fixture(['\u00e9', 'e\u0301']);
  const reversed = { ...evidence, jobs: [...evidence.jobs].reverse() };
  const a = normalizeGitHubActionsEvidence(evidence);
  const b = normalizeGitHubActionsEvidence(reversed);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.deepEqual(a.jobs.map(j => j.name), ['e\u0301', '\u00e9']);
});

test('completed job must be inside completed run, not merely before observation', () => {
  const { evidence } = fixture();
  evidence.jobs[0].completedAt = '2026-10-09T00:03:00Z';
  assert.throws(() => normalizeGitHubActionsEvidence(evidence), { code: 'JOB_TIME_OUTSIDE_RUN' });
  evidence.jobs[0].completedAt = evidence.updatedAt;
  assert.equal(normalizeGitHubActionsEvidence(evidence).jobs[0].completedAt, evidence.updatedAt);
});
