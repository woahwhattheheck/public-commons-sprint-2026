import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReleaseEvidence } from '../src/release-gate.mjs';
import { releaseManifest } from './release-helpers.mjs';

test('shape-valid caller-authored manifest can only HOLD', () => {
  const input = releaseManifest();
  const out = evaluateReleaseEvidence(input);
  assert.equal(out.state, 'HOLD');
  assert.ok(out.holds.includes('INDEPENDENT_PROVIDER_READBACK_REQUIRED'));
  assert.equal(out.authorityBindingDigest, null);
  assert.equal(out.submissionAuthority, false);
  assert.equal(out.paymentAuthority, false);
});

test('a second self-authored readback object is rejected rather than promoted', () => {
  const input = releaseManifest();
  assert.throws(
    () => evaluateReleaseEvidence(input, { evaluatedAt: '2026-09-15T21:55:00.000Z' }),
    /self-authored release authority is not accepted/,
  );
});

test('no demonstrated A/B improvement adds an explicit HOLD', () => {
  const input = releaseManifest();
  input.ab.meaningfulImprovement = false;
  const out = evaluateReleaseEvidence(input);
  assert.ok(out.holds.includes('BAZANTIC_AB_IMPROVEMENT_NOT_DEMONSTRATED'));
});

test('non-GitHub repository stays HOLD', () => {
  const input = releaseManifest();
  input.repoUrl = 'https://git.example.test/rail';
  const out = evaluateReleaseEvidence(input);
  assert.ok(out.holds.includes('PUBLIC_GITHUB_REPO_REQUIRED'));
});

test('placeholder evidence stays HOLD', () => {
  const input = releaseManifest();
  input.bazantic.recipeId = 'replace-me';
  const out = evaluateReleaseEvidence(input);
  assert.ok(out.holds.includes('PLACEHOLDER_EVIDENCE_PRESENT'));
});

test('wrong Hedera network or asset is rejected', () => {
  const network = releaseManifest();
  network.hedera.network = 'hedera:mainnet';
  assert.throws(() => evaluateReleaseEvidence(network), /hedera:testnet/);
  const asset = releaseManifest();
  asset.hedera.asset = '0.0.123';
  assert.throws(() => evaluateReleaseEvidence(asset), /0.0.0/);
});

test('secret-shaped evidence and unknown authority fields fail closed', () => {
  const secret = releaseManifest();
  secret.bazantic.accountHandle = ['Bea', 'rer abcdefghijklmnopqrstuvwxyz'].join('');
  assert.throws(() => evaluateReleaseEvidence(secret), /secret-shaped/);
  const unknown = releaseManifest();
  unknown.submissionApproved = true;
  assert.throws(() => evaluateReleaseEvidence(unknown), /unknown/);
});
