import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Hex } from '../src/canonical.mjs';
import { GitHubEvidenceError, normalizeGitHubActionsEvidence } from '../src/github_evidence_contract.mjs';
import { asWorkSealEvidence, githubActionsEvidenceDigest, verifyGitHubActionsEvidence } from '../src/github_evidence.mjs';

function fixture() {
  const workflowDigest = sha256Hex('workflow bytes');
  const evidence = { schema:'workseal-github-actions-evidence/v1', repository:'Owner/Repo', workflowPath:'.github/workflows/ci.yml', workflowDigest, runId:'123', attempt:'2', headSha:'0123456789abcdef0123456789abcdef01234567', event:'push', status:'completed', conclusion:'success', createdAt:'2026-09-14T22:00:00Z', updatedAt:'2026-09-14T22:02:00Z', observedAt:'2026-09-14T22:03:00Z', sourceApiUrl:'https://api.github.com/repos/owner/repo/actions/runs/123', rawResponseDigest:sha256Hex('raw api bytes'), jobs:[{name:'tests',conclusion:'success',startedAt:'2026-09-14T22:00:10Z',completedAt:'2026-09-14T22:01:50Z',steps:[{number:2,name:'test',conclusion:'success'},{number:1,name:'checkout',conclusion:'success'}]}] };
  const expected = { repository:'owner/repo', workflowPath:'.github/workflows/ci.yml', workflowDigest, headSha:evidence.headSha, event:'push', requiredJobs:['tests'] };
  return { evidence, expected };
}
function code(fn, expected) { assert.throws(fn, e => e instanceof GitHubEvidenceError && e.code === expected); }

test('normalizes repository and deterministic step order', () => { const {evidence}=fixture(); const n=normalizeGitHubActionsEvidence(evidence); assert.equal(n.repository,'owner/repo'); assert.deepEqual(n.jobs[0].steps.map(s=>s.number),[1,2]); });
test('digest is stable under input job/step order', () => { const a=fixture().evidence; const b=structuredClone(a); b.jobs[0].steps.reverse(); assert.equal(githubActionsEvidenceDigest(a), githubActionsEvidenceDigest(b)); });
test('successful evidence verifies pinned expectation', () => { const {evidence,expected}=fixture(); const v=verifyGitHubActionsEvidence(evidence,expected); assert.equal(v.verdict,'PASS'); assert.equal(v.writePerformed,false); assert.equal(v.externalAuthorityGranted,false); });
test('WorkSeal evidence adapter emits protocol-compatible id/digest', () => { const {evidence,expected}=fixture(); assert.deepEqual(asWorkSealEvidence(evidence,expected),{id:'github-actions',digest:githubActionsEvidenceDigest(evidence)}); });
test('unknown top-level fields fail closed', () => { const {evidence}=fixture(); evidence.extra=true; code(()=>normalizeGitHubActionsEvidence(evidence),'FIELD_SET_MISMATCH'); });
test('non-completed run fails closed', () => { const {evidence}=fixture(); evidence.status='in_progress'; code(()=>normalizeGitHubActionsEvidence(evidence),'NOT_COMPLETED'); });
test('non-success workflow fails closed', () => { const {evidence}=fixture(); evidence.conclusion='failure'; code(()=>normalizeGitHubActionsEvidence(evidence),'NOT_SUCCESS'); });
test('skipped or failed job fails closed', () => { const {evidence}=fixture(); evidence.jobs[0].conclusion='skipped'; code(()=>normalizeGitHubActionsEvidence(evidence),'NOT_SUCCESS'); });
test('skipped or failed step fails closed', () => { const {evidence}=fixture(); evidence.jobs[0].steps[0].conclusion='failure'; code(()=>normalizeGitHubActionsEvidence(evidence),'NOT_SUCCESS'); });
test('duplicate job names fail closed', () => { const {evidence}=fixture(); evidence.jobs.push(structuredClone(evidence.jobs[0])); code(()=>normalizeGitHubActionsEvidence(evidence),'DUPLICATE_JOB'); });
test('duplicate step numbers fail closed', () => { const {evidence}=fixture(); evidence.jobs[0].steps[1].number=2; code(()=>normalizeGitHubActionsEvidence(evidence),'DUPLICATE_STEP'); });
test('rewound timestamps fail closed', () => { const {evidence}=fixture(); evidence.observedAt='2026-09-14T22:01:00Z'; code(()=>normalizeGitHubActionsEvidence(evidence),'OBSERVED_TOO_EARLY'); });
test('forged API locator fails closed', () => { const {evidence}=fixture(); evidence.sourceApiUrl='https://example.invalid/123'; code(()=>normalizeGitHubActionsEvidence(evidence),'BAD_SOURCE_URL'); });
test('workflow source drift fails expectation', () => { const {evidence,expected}=fixture(); expected.workflowDigest=sha256Hex('different workflow'); code(()=>verifyGitHubActionsEvidence(evidence,expected),'EXPECTED_MISMATCH'); });
test('commit drift fails expectation', () => { const {evidence,expected}=fixture(); expected.headSha='ffffffffffffffffffffffffffffffffffffffff'; code(()=>verifyGitHubActionsEvidence(evidence,expected),'EXPECTED_MISMATCH'); });
test('event drift fails expectation', () => { const {evidence,expected}=fixture(); expected.event='pull_request'; code(()=>verifyGitHubActionsEvidence(evidence,expected),'EXPECTED_MISMATCH'); });

test('missing pinned required job fails expectation', () => { const {evidence,expected}=fixture(); expected.requiredJobs=['tests','security']; code(()=>verifyGitHubActionsEvidence(evidence,expected),'EXPECTED_JOB_SET_MISMATCH'); });
test('unexpected retained job fails expectation', () => { const {evidence,expected}=fixture(); const extra=structuredClone(evidence.jobs[0]); extra.name='other'; evidence.jobs.push(extra); code(()=>verifyGitHubActionsEvidence(evidence,expected),'EXPECTED_JOB_SET_MISMATCH'); });
test('raw API response digest is part of evidence identity', () => { const {evidence}=fixture(); const a=githubActionsEvidenceDigest(evidence); evidence.rawResponseDigest=sha256Hex('other raw bytes'); assert.notEqual(githubActionsEvidenceDigest(evidence),a); });
