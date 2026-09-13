import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseEvidence } from '../src/release-gate.mjs';

const D = (char) => char.repeat(64);
const base = () => ({
  version:'agent-revenue-rail/release-evidence/v1',
  sourceHead:'a'.repeat(40),
  repoUrl:'https://github.com/woahwhattheheck/agent-revenue-rail',
  deployUrl:'https://agent-revenue-rail.pages.dev',
  offerDigest:D('1'),
  bazantic:{ accountHandle:'tjlabs', recipeId:'recipe-123', recipeEvidenceDigest:D('2'), capturedAt:'2026-09-13T09:30:00.000Z' },
  graph:{ providerAgentId:'8453:123', network:'base', liveQueryEvidenceDigest:D('3'), capturedAt:'2026-09-13T09:31:00.000Z' },
  hedera:{ network:'hedera:testnet', asset:'0.0.0', txHash:'0.0.4242@1789290000.123456789', settlementEvidenceDigest:D('4'), capturedAt:'2026-09-13T09:32:00.000Z' },
  ab:{ baselineCaptureDigest:D('5'), recipeCaptureDigest:D('6'), verificationDigest:D('7'), meaningfulImprovement:true, capturedAt:'2026-09-13T09:33:00.000Z' },
  videoUrl:'https://www.youtube.com/watch?v=abcdefghijk'
});
const asOf = { asOf:'2026-09-13T09:40:00.000Z' };

test('complete evidence becomes human-review ready, never submission authority', () => {
  const out=evaluateReleaseEvidence(base(), asOf);
  assert.equal(out.state,'READY_FOR_HUMAN_SUBMISSION_REVIEW');
  assert.deepEqual(out.holds,[]);
  assert.equal(out.submissionAuthority,false);
  assert.equal(out.prizeEligibilityAuthority,false);
  assert.equal(out.paymentAuthority,false);
  assert.match(out.evidenceDigest,/^[0-9a-f]{64}$/);
});

test('no demonstrated A/B improvement stays HOLD', () => {
  const input=base(); input.ab.meaningfulImprovement=false;
  const out=evaluateReleaseEvidence(input,asOf);
  assert.equal(out.state,'HOLD');
  assert.ok(out.holds.includes('BAZANTIC_AB_IMPROVEMENT_NOT_DEMONSTRATED'));
});

test('Graph evidence on Hedera is rejected as sponsor-fit hold', () => {
  const input=base(); input.graph.network='hedera:testnet';
  const out=evaluateReleaseEvidence(input,asOf);
  assert.equal(out.state,'HOLD');
  assert.ok(out.holds.includes('GRAPH_PROVIDER_NETWORK_MUST_BE_DEPLOYED_SUBGRAPH_NETWORK'));
});

test('non-GitHub repository stays HOLD', () => {
  const input=base(); input.repoUrl='https://git.example.test/rail';
  const out=evaluateReleaseEvidence(input,asOf);
  assert.ok(out.holds.includes('PUBLIC_GITHUB_REPO_REQUIRED'));
});

test('future evidence is rejected', () => {
  const input=base(); input.hedera.capturedAt='2026-09-13T10:00:00.000Z';
  assert.throws(()=>evaluateReleaseEvidence(input,asOf),/future/);
});

test('wrong Hedera network or asset is rejected', () => {
  const n=base(); n.hedera.network='hedera:mainnet';
  assert.throws(()=>evaluateReleaseEvidence(n,asOf),/hedera:testnet/);
  const a=base(); a.hedera.asset='0.0.123';
  assert.throws(()=>evaluateReleaseEvidence(a,asOf),/0.0.0/);
});

test('secret-shaped evidence is rejected before readiness', () => {
  const input=base(); input.bazantic.accountHandle=['Bea','rer abcdefghijklmnopqrstuvwxyz'].join('');
  assert.throws(()=>evaluateReleaseEvidence(input,asOf),/secret-shaped/);
});

test('unknown evidence fields fail closed', () => {
  const input=base(); input.submissionApproved=true;
  assert.throws(()=>evaluateReleaseEvidence(input,asOf),/unknown/);
});

test('known placeholder evidence stays HOLD', () => {
  const input=base(); input.bazantic.recipeId='replace-me';
  const out=evaluateReleaseEvidence(input,asOf);
  assert.equal(out.state,'HOLD');
  assert.ok(out.holds.includes('PLACEHOLDER_EVIDENCE_PRESENT'));
});
