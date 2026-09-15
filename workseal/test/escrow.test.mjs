import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sha256Hex, WorkSealError } from '../src/canonical.mjs';
import {
  acceptState,
  commitResult,
  createSettlementIntent,
  createState,
  fundState,
  makeAcceptanceReceipt,
  publicKeyFingerprint,
  signAcceptanceReceipt,
  taskDigest,
} from '../src/protocol.mjs';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  WORKSEAL_ESCROW_PROGRAM_ID,
  associatedTokenAddress,
  base58Decode,
  base58Encode,
  createEscrowPlan,
  createEscrowState,
  decodePubkey,
  ed25519SpkiFingerprint,
  findProgramAddress,
  fundEscrow,
  pubkeyFromSeed,
  refundAuthorization,
  refundEscrow,
  settlementAuthorization,
  settleEscrow,
  signCanonicalAuthorization,
  verifyEscrowState,
} from '../src/escrow.mjs';

function authority() {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    solanaPubkey: base58Encode(publicDer.subarray(publicDer.length - 32)),
  };
}


function wallet(seedLabel) {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    label: seedLabel,
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pubkey: base58Encode(publicDer.subarray(publicDer.length - 32)),
  };
}

const BUYER = wallet('buyer');
const WORKER = wallet('worker');

function task(mint = pubkeyFromSeed('usdc-mint-fixture')) {
  return {
    schema: 'workseal-task/v1',
    taskId: 'WS-ESCROW-1',
    buyer: { id: 'buyer', settlementAddress: BUYER.pubkey },
    worker: { id: 'worker', settlementAddress: WORKER.pubkey },
    currency: `SPL:${mint}`,
    amountAtomic: '12500000',
    deadline: '2026-10-12T23:59:59Z',
    acceptancePolicy: {
      verifierId: 'workseal-verifier',
      verifierVersion: '1',
      requirements: [
        { id: 'artifact', description: 'artifact digest matches' },
        { id: 'tests', description: 'tests pass' },
      ],
    },
  };
}

function result(t, generation = 1) {
  return {
    schema: 'workseal-result/v1',
    taskDigest: taskDigest(t),
    workerId: t.worker.id,
    generation,
    artifactDigest: sha256Hex('artifact-v1'),
    evidence: [
      { id: 'artifact', digest: sha256Hex('artifact-v1') },
      { id: 'tests', digest: sha256Hex('23 tests pass') },
    ],
  };
}

function funded(authorityOverride = authority()) {
  const t = task();
  const fingerprint = publicKeyFingerprint(authorityOverride.publicKeyPem);
  const plan = createEscrowPlan(t, fingerprint, { cluster: 'devnet' });
  let escrow = createEscrowState(plan);
  escrow = fundEscrow(escrow, {
    schema: 'workseal-solana-funding-observation/v1',
    signer: plan.binding.payer,
    sourceTokenAccount: plan.binding.buyerAta,
    destinationTokenAccount: plan.binding.vaultAta,
    mint: plan.binding.mint,
    amountAtomic: plan.binding.amountAtomic,
    escrowPda: plan.binding.escrowPda,
  });
  return { t, authority: authorityOverride, plan, escrow };
}

function acceptedWithEscrow() {
  const bundle = funded();
  let ws = createState(bundle.t, publicKeyFingerprint(bundle.authority.publicKeyPem));
  ws = fundState(ws, bundle.plan.fundingRef);
  const r = result(bundle.t);
  ws = commitResult(ws, r);
  const receipt = makeAcceptanceReceipt({
    task: bundle.t,
    result: r,
    acceptedAt: '2026-09-14T23:45:00Z',
    checks: [
      { id: 'artifact', ok: true, evidenceDigest: sha256Hex('artifact-v1') },
      { id: 'tests', ok: true, evidenceDigest: sha256Hex('23 tests pass') },
    ],
  });
  const signatureBase64 = signAcceptanceReceipt(receipt, bundle.authority.privateKeyPem);
  ws = acceptState(ws, { receipt, signatureBase64, publicKeyPem: bundle.authority.publicKeyPem });
  return { ...bundle, ws, intent: createSettlementIntent(ws) };
}

function signedSettlement(bundle, intent = bundle.intent) {
  const authorization = settlementAuthorization(bundle.escrow, intent);
  return {
    intent,
    verifierPubkey: bundle.authority.solanaPubkey,
    signatureBase64: signCanonicalAuthorization(authorization, bundle.authority.privateKeyPem),
  };
}

function signedRefund(escrow, reasonDigest, observedUnix = escrow.plan.binding.refundAfterUnix) {
  const authorization = refundAuthorization(escrow, reasonDigest);
  return {
    signer: BUYER.pubkey,
    reasonDigest,
    signatureBase64: signCanonicalAuthorization(authorization, BUYER.privateKeyPem),
    observedUnix,
  };
}

test('base58 round-trips 32-byte public key material', () => {
  const bytes = Buffer.from(sha256Hex('pubkey'), 'hex');
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  assert.equal(decodePubkey(base58Encode(bytes)).length, 32);
});

test('escrow initialization requires buyer and worker consent to frozen economics', () => {
  const verifier = authority();
  const plan = createEscrowPlan(task(), publicKeyFingerprint(verifier.publicKeyPem));
  assert.deepEqual(plan.instructions[0].signers, [plan.binding.payer, plan.binding.payee]);
  assert.equal(plan.instructions[0].refundAfterUnix, plan.binding.refundAfterUnix);
  assert.equal(plan.instructions[0].amountAtomic, plan.binding.amountAtomic);
  assert.equal(plan.instructions[0].mint, plan.binding.mint);
});

test('program and token program IDs decode to exact 32 bytes', () => {
  for (const key of [WORKSEAL_ESCROW_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID]) {
    assert.equal(decodePubkey(key).length, 32);
  }
});

test('PDA derivation is deterministic, off-curve by construction, and bump-sensitive', () => {
  const seeds = [Buffer.from('workseal-v1'), Buffer.from(sha256Hex('task'), 'hex')];
  const a = findProgramAddress(seeds, WORKSEAL_ESCROW_PROGRAM_ID);
  const b = findProgramAddress(seeds, WORKSEAL_ESCROW_PROGRAM_ID);
  assert.deepEqual(a, b);
  assert.ok(a.bump >= 0 && a.bump <= 255);
  const changed = findProgramAddress([Buffer.from('workseal-v1'), Buffer.from(sha256Hex('task2'), 'hex')], WORKSEAL_ESCROW_PROGRAM_ID);
  assert.notEqual(a.address, changed.address);
});

test('ATA derivation binds owner and mint', () => {
  const owner = pubkeyFromSeed('owner-a');
  const mintA = pubkeyFromSeed('mint-a');
  const mintB = pubkeyFromSeed('mint-b');
  assert.deepEqual(associatedTokenAddress(owner, mintA), associatedTokenAddress(owner, mintA));
  assert.notEqual(associatedTokenAddress(owner, mintA).address, associatedTokenAddress(owner, mintB).address);
});

test('receipt authority fingerprint maps exactly to its raw ed25519 Solana public key', () => {
  const a = authority();
  assert.equal(ed25519SpkiFingerprint(a.solanaPubkey), publicKeyFingerprint(a.publicKeyPem));
});

test('escrow plan binds exact task economics, authority, PDA and canonical ATAs', () => {
  const a = authority();
  const t = task();
  const plan = createEscrowPlan(t, publicKeyFingerprint(a.publicKeyPem));
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.deploymentObserved, false);
  assert.equal(plan.binding.taskDigest, taskDigest(t));
  assert.equal(plan.binding.mint, t.currency.slice(4));
  assert.equal(plan.binding.buyerAta, associatedTokenAddress(t.buyer.settlementAddress, plan.binding.mint).address);
  assert.equal(plan.binding.workerAta, associatedTokenAddress(t.worker.settlementAddress, plan.binding.mint).address);
  assert.equal(plan.binding.vaultAta, associatedTokenAddress(plan.binding.escrowPda, plan.binding.mint).address);
  assert.equal(plan.fundingRef.reference, `workseal-escrow:${plan.binding.escrowPda}`);
});

test('escrow rejects ambiguous or non-SPL currency', () => {
  const a = authority();
  assert.throws(() => createEscrowPlan({ ...task(), currency: 'USDC' }, publicKeyFingerprint(a.publicKeyPem)), (e) => e instanceof WorkSealError && e.code === 'UNSUPPORTED_CURRENCY');
});

test('escrow rejects invalid settlement account and amount beyond u64', () => {
  const a = authority();
  const t1 = task(); t1.buyer = { ...t1.buyer, settlementAddress: 'not-a-pubkey' };
  assert.throws(() => createEscrowPlan(t1, publicKeyFingerprint(a.publicKeyPem)), (e) => e.code === 'BAD_PUBKEY');
  const t2 = { ...task(), amountAtomic: '18446744073709551616' };
  assert.throws(() => createEscrowPlan(t2, publicKeyFingerprint(a.publicKeyPem)), (e) => e.code === 'AMOUNT_U64_OVERFLOW');
});

test('binding tamper is detected before state creation', () => {
  const a = authority();
  const plan = createEscrowPlan(task(), publicKeyFingerprint(a.publicKeyPem));
  const tampered = structuredClone(plan);
  tampered.binding.amountAtomic = '1';
  assert.throws(() => createEscrowState(tampered), (e) => e.code === 'BINDING_TAMPER');
});

test('funding requires exact buyer signer, ATA, mint, amount and escrow PDA', () => {
  const a = authority();
  const plan = createEscrowPlan(task(), publicKeyFingerprint(a.publicKeyPem));
  const base = {
    schema: 'workseal-solana-funding-observation/v1',
    signer: plan.binding.payer,
    sourceTokenAccount: plan.binding.buyerAta,
    destinationTokenAccount: plan.binding.vaultAta,
    mint: plan.binding.mint,
    amountAtomic: plan.binding.amountAtomic,
    escrowPda: plan.binding.escrowPda,
  };
  for (const [field, value] of [
    ['signer', pubkeyFromSeed('attacker')],
    ['sourceTokenAccount', pubkeyFromSeed('wrong-source')],
    ['destinationTokenAccount', pubkeyFromSeed('wrong-vault')],
    ['mint', pubkeyFromSeed('wrong-mint')],
    ['amountAtomic', '1'],
    ['escrowPda', pubkeyFromSeed('wrong-escrow')],
  ]) {
    assert.throws(() => fundEscrow(createEscrowState(plan), { ...base, [field]: value }), (e) => e.code === 'FUNDING_MISMATCH', field);
  }
});

test('accepted WorkSeal state settles exact funded escrow with same verifier authority', () => {
  const { escrow, intent, authority: a } = acceptedWithEscrow();
  const settled = settleEscrow(escrow, signedSettlement({ escrow, intent, authority: a }));
  assert.equal(settled.phase, 'SETTLED');
  assert.equal(settled.resultDigest, intent.resultDigest);
  assert.equal(settled.acceptanceDigest, intent.acceptanceDigest);
  assert.equal(settled.generation, intent.generation);
  assert.equal(settled.terminalInstruction.verifierSigner, a.solanaPubkey);
  assert.equal(settled.terminalInstruction.writePerformed, false);
  assert.equal(verifyEscrowState(settled).valid, true);
});

test('settlement rejects a different verifier key even with exact accepted intent', () => {
  const { escrow, intent } = acceptedWithEscrow();
  const attacker = authority();
  assert.throws(() => settleEscrow(escrow, { intent, verifierPubkey: attacker.solanaPubkey, signatureBase64: signCanonicalAuthorization(settlementAuthorization(escrow, intent), attacker.privateKeyPem) }), (e) => e.code === 'AUTHORITY_MISMATCH');
});

test('settlement authorization signature binds task, result, acceptance, generation and economics', () => {
  const bundle = acceptedWithEscrow();
  const signed = signedSettlement(bundle);
  const cases = [
    { taskDigest: sha256Hex('wrong-task') },
    { resultDigest: sha256Hex('wrong-result') },
    { acceptanceDigest: sha256Hex('wrong-acceptance') },
    { generation: 2 },
    { currency: `SPL:${pubkeyFromSeed('wrong-mint')}` },
    { amountAtomic: '1' },
    { payer: pubkeyFromSeed('wrong-payer') },
    { payee: pubkeyFromSeed('wrong-payee') },
    { funding: { ...bundle.intent.funding, reference: 'workseal-escrow:attacker' } },
  ];
  for (const patch of cases) {
    const mutated = { ...bundle.intent, ...patch };
    assert.throws(
      () => settleEscrow(bundle.escrow, { ...signed, intent: mutated }),
      (e) => ['SETTLEMENT_MISMATCH', 'BAD_SIGNATURE'].includes(e.code),
      JSON.stringify(patch),
    );
  }
});

test('a verifier may intentionally sign a different result generation, but only with a fresh signature', () => {
  const bundle = acceptedWithEscrow();
  const mutated = { ...bundle.intent, resultDigest: sha256Hex('new-result'), acceptanceDigest: sha256Hex('new-acceptance'), generation: 2 };
  assert.throws(() => settleEscrow(bundle.escrow, { ...signedSettlement(bundle), intent: mutated }), (e) => e.code === 'BAD_SIGNATURE');
  const fresh = {
    intent: mutated,
    verifierPubkey: bundle.authority.solanaPubkey,
    signatureBase64: signCanonicalAuthorization(settlementAuthorization(bundle.escrow, mutated), bundle.authority.privateKeyPem),
  };
  assert.equal(settleEscrow(bundle.escrow, fresh).generation, 2);
});

test('settlement cannot replay or follow refund', () => {
  const { escrow, intent, authority: a } = acceptedWithEscrow();
  const settled = settleEscrow(escrow, signedSettlement({ escrow, intent, authority: a }));
  assert.throws(() => settleEscrow(settled, { intent, verifierPubkey: a.solanaPubkey }), (e) => e.code === 'BAD_PHASE');
  assert.throws(() => refundEscrow(settled, { signer: settled.plan.binding.payer, reasonDigest: sha256Hex('cancel'), signatureBase64: 'invalid' }), (e) => e.code === 'BAD_PHASE');
});

test('refund is deadline-gated before buyer authority can become terminal', () => {
  const { escrow } = funded();
  const reason = sha256Hex('early-cancel');
  assert.throws(
    () => refundEscrow(escrow, signedRefund(escrow, reason, escrow.plan.binding.refundAfterUnix - 1)),
    (e) => e.code === 'REFUND_NOT_MATURE',
  );
});

test('refund is buyer-signer-only and exactly terminal', () => {
  const { escrow } = funded();
  assert.throws(() => refundEscrow(escrow, { signer: pubkeyFromSeed('attacker'), reasonDigest: sha256Hex('cancel'), signatureBase64: 'invalid' }), (e) => e.code === 'AUTHORITY_MISMATCH');
  const refunded = refundEscrow(escrow, signedRefund(escrow, sha256Hex('buyer-cancel')));
  assert.equal(refunded.phase, 'REFUNDED');
  assert.equal(refunded.terminalInstruction.destinationTokenAccount, refunded.plan.binding.buyerAta);
  assert.throws(() => refundEscrow(refunded, { signer: refunded.plan.binding.payer, reasonDigest: sha256Hex('again'), signatureBase64: 'invalid' }), (e) => e.code === 'BAD_PHASE');
});

test('funding cannot replay', () => {
  const { escrow } = funded();
  const observation = {
    schema: 'workseal-solana-funding-observation/v1',
    signer: escrow.plan.binding.payer,
    sourceTokenAccount: escrow.plan.binding.buyerAta,
    destinationTokenAccount: escrow.plan.binding.vaultAta,
    mint: escrow.plan.binding.mint,
    amountAtomic: escrow.plan.binding.amountAtomic,
    escrowPda: escrow.plan.binding.escrowPda,
  };
  assert.throws(() => fundEscrow(escrow, observation), (e) => e.code === 'BAD_PHASE');
});


const rustSource = readFileSync(new URL('../solana-program/src/lib.rs', import.meta.url), 'utf8');
const sourceContract = JSON.parse(readFileSync(new URL('../solana-program/idl/workseal_escrow.source.json', import.meta.url), 'utf8'));
const cargoSource = readFileSync(new URL('../solana-program/Cargo.toml', import.meta.url), 'utf8');

test('source contract and JS plan bind the same undeployed program id', () => {
  assert.equal(sourceContract.generated, false);
  assert.equal(sourceContract.deploymentObserved, false);
  assert.equal(sourceContract.programId, WORKSEAL_ESCROW_PROGRAM_ID);
  assert.match(rustSource, new RegExp(`declare_id!\\(\\"${WORKSEAL_ESCROW_PROGRAM_ID}\\"\\)`));
});

test('program uses task-bound PDA and canonical token/ATA programs', () => {
  assert.match(rustSource, /const ESCROW_SEED: &\[u8\] = b"workseal-v1";/);
  assert.match(rustSource, /seeds = \[ESCROW_SEED, args\.task_digest\.as_ref\(\)\]/);
  assert.match(rustSource, /associated_token::authority = escrow/);
  assert.equal(sourceContract.tokenProgram, SPL_TOKEN_PROGRAM_ID);
  assert.equal(sourceContract.associatedTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  assert.match(cargoSource, /anchor-spl/);
});

test('funding is buyer-signed and exact transfer_checked into escrow vault', () => {
  assert.match(rustSource, /pub buyer: Signer<'info>/);
  assert.match(rustSource, /pub struct Initialize<'info>[\s\S]*pub worker: Signer<'info>/);
  assert.deepEqual(sourceContract.instructions.initialize.signers, ['buyer', 'worker']);
  assert.match(rustSource, /pub fn fund\(ctx: Context<Fund>\)/);
  assert.match(rustSource, /EscrowPhase::Unfunded as u8/);
  assert.match(rustSource, /token::transfer_checked/);
  assert.match(rustSource, /ctx\.accounts\.escrow\.phase = EscrowPhase::Funded as u8/);
});

test('settlement requires verifier signer whose Ed25519 SPKI fingerprint is pinned', () => {
  assert.match(rustSource, /pub verifier: Signer<'info>/);
  assert.match(rustSource, /ED25519_SPKI_PREFIX/);
  assert.match(rustSource, /hashv\(&\[ED25519_SPKI_PREFIX, verifier_raw\.as_ref\(\)\]\)/);
  assert.match(rustSource, /AuthorityMismatch/);
  assert.match(rustSource, /args\.result_digest/);
  assert.match(rustSource, /args\.acceptance_digest/);
  assert.match(rustSource, /args\.event_head/);
  assert.match(rustSource, /args\.generation/);
  assert.match(rustSource, /EscrowPhase::Settled as u8/);
});

test('refund is buyer-only and settlement/refund share Funded as exclusive source phase', () => {
  const fundChecks = rustSource.match(/EscrowPhase::Funded as u8/g) ?? [];
  assert.ok(fundChecks.length >= 3);
  assert.match(rustSource, /args\.refund_after_unix > Clock::get\(\)\?\.unix_timestamp/);
  assert.match(rustSource, /pub fn refund\(ctx: Context<Refund>, reason_digest: \[u8; 32\]\)/);
  assert.match(rustSource, /pub struct Refund<'info>[\s\S]*pub buyer: Signer<'info>/);
  assert.match(rustSource, /EscrowPhase::Refunded as u8/);
  assert.match(rustSource, /Clock::get\(\)\?\.unix_timestamp/);
  assert.match(rustSource, /now >= ctx\.accounts\.escrow\.refund_after_unix/);
  assert.equal(sourceContract.instructions.refund.requires, 'clock.unix_timestamp >= refund_after_unix');
  assert.equal(sourceContract.instructions.settle.fromPhase, 'FUNDED');
  assert.equal(sourceContract.instructions.refund.fromPhase, 'FUNDED');
});

test('source contract cannot claim deployment or repository-side wallet/RPC writes', () => {
  assert.deepEqual(sourceContract.authorityCeiling, {
    walletWritePerformedByRepository: false,
    rpcWritePerformedByRepository: false,
    deploymentObserved: false,
  });
});

function runDemo() {
  return execFileSync(process.execPath, ['src/escrow_demo.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
}

test('synthetic escrow demo is byte-deterministic', () => {
  assert.equal(runDemo(), runDemo());
});

test('demo reaches SETTLED while preserving every external-action non-claim', () => {
  const data = JSON.parse(runDemo());
  assert.equal(data.synthetic, true);
  assert.equal(data.network, 'OFFLINE_LOCALNET_SIMULATOR');
  assert.equal(data.writePerformed, false);
  assert.equal(data.deploymentObserved, false);
  assert.equal(data.escrow.finalPhase, 'SETTLED');
  assert.equal(data.verification.valid, true);
  assert.deepEqual(data.truth, {
    rpcCalled: false,
    walletConnected: false,
    tokensMoved: false,
    programDeployed: false,
    competitionSubmitted: false,
    prizeOrRevenueClaimed: false,
  });
});
