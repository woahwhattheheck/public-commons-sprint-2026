import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  METEORA_DBC_PROGRAM_ID,
  WorkSealMeteoraError,
  buildMeteoraDbcLaunchPlan,
  sha256Hex,
} from '../src/meteora_dbc.mjs';
import { buildMeteoraDemoPlan } from '../src/meteora_demo.mjs';

const verified = Object.freeze({
  verdict: 'PASS',
  taskDigest: '1'.repeat(64),
  resultDigest: '2'.repeat(64),
  evidenceDigest: '3'.repeat(64),
  acceptanceDigest: '4'.repeat(64),
  settlementIntentDigest: '5'.repeat(64),
  writePerformed: false,
  externalAuthorityGranted: false,
});

const input = Object.freeze({
  name: 'WorkSeal Proof Launch',
  symbol: 'SEAL',
  description: 'A proof-bound launch whose metadata commits to an accepted WorkSeal result.',
  website: 'https://example.com/workseal',
  creator: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  feeClaimer: '11111111111111111111111111111111',
  leftoverReceiver: 'So11111111111111111111111111111111111111112',
  initialMarketCap: 20,
  migrationMarketCap: 600,
});

function expectCode(code, fn) {
  assert.throws(fn, (error) => error instanceof WorkSealMeteoraError && error.code === code);
}

test('creates a deterministic dry-run-first Meteora Invent packet', () => {
  const first = buildMeteoraDbcLaunchPlan(verified, input);
  const second = buildMeteoraDbcLaunchPlan(verified, input);
  assert.deepEqual(second, first);
  assert.equal(first.planDigest, sha256Hex({
    schema: first.schema,
    provider: first.provider,
    workSealBinding: first.workSealBinding,
    studioConfig: first.studioConfig,
    execution: first.execution,
    externalState: first.externalState,
  }));
  assert.equal(first.provider.programId, METEORA_DBC_PROGRAM_ID);
  assert.equal(first.studioConfig.dryRun, true);
  assert.equal(first.execution.writePerformed, false);
  assert.equal(first.execution.readyForExecution, false);
  assert.equal(first.execution.network, 'devnet');
  assert.match(first.studioConfig.dbcPool.metadata.description, /WorkSeal accepted result 222222222222/);
});

test('uses a valid DAMM v2 graduation split with ten percent permanently locked', () => {
  const plan = buildMeteoraDbcLaunchPlan(verified, input);
  const distribution = plan.studioConfig.dbcConfig.liquidityDistribution;
  assert.equal(Object.values(distribution).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(
    distribution.partnerPermanentLockedLiquidityPercentage + distribution.creatorPermanentLockedLiquidityPercentage,
    10,
  );
  assert.equal(plan.studioConfig.dbcConfig.migration.migrationOption, 1);
});

test('fails closed when WorkSeal acceptance is not verified', () => {
  expectCode('WORKSEAL_NOT_ACCEPTED', () => buildMeteoraDbcLaunchPlan({ ...verified, verdict: 'HOLD' }, input));
  expectCode('UNSAFE_VERIFICATION', () => buildMeteoraDbcLaunchPlan({ ...verified, writePerformed: true }, input));
  expectCode('BAD_DIGEST', () => buildMeteoraDbcLaunchPlan({ ...verified, acceptanceDigest: 'tampered' }, input));
});

test('rejects unsafe or ambiguous launch inputs', () => {
  expectCode('BAD_CURVE', () => buildMeteoraDbcLaunchPlan(verified, { ...input, migrationMarketCap: 20 }));
  expectCode('BAD_SYMBOL', () => buildMeteoraDbcLaunchPlan(verified, { ...input, symbol: 'seal' }));
  expectCode('BAD_URL', () => buildMeteoraDbcLaunchPlan(verified, { ...input, website: 'http://example.com' }));
  expectCode('BAD_PUBKEY', () => buildMeteoraDbcLaunchPlan(verified, { ...input, creator: 'not-a-pubkey' }));
  expectCode('UNKNOWN_FIELD', () => buildMeteoraDbcLaunchPlan(verified, { ...input, privateKey: 'never' }));
});

test('contains no signing material, transaction, or award assertion', () => {
  const serialized = JSON.stringify(buildMeteoraDbcLaunchPlan(verified, input));
  assert.doesNotMatch(serialized, /secretKey|privateKey|signatureBase64/);
  assert.match(serialized, /OWNER_MUST_SET_LOCAL_KEYPAIR_PATH/);
  assert.match(serialized, /"award":"NOT_ASSERTED"/);
  assert.match(serialized, /"payment":"NOT_ASSERTED"/);
});

test('runs the local browser-verification-to-Meteora demo without external writes', async () => {
  const plan = await buildMeteoraDemoPlan();
  assert.equal(plan.schema, 'workseal-meteora-dbc-launch-plan/v1');
  assert.equal(plan.execution.writePerformed, false);
  assert.equal(plan.execution.unsigned, true);
  assert.equal(plan.execution.readyForExecution, false);
  assert.equal(plan.externalState.colosseumSubmission, 'NOT_ASSERTED');
  assert.equal(plan.externalState.superteamSubmission, 'NOT_ASSERTED');
  assert.equal(
    plan.studioConfig.dbcPool.metadata.website,
    'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/workseal',
  );
  assert.doesNotMatch(plan.studioConfig.dbcPool.metadata.website, /example\.com/);
});
