import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { sha256Hex } from './canonical.mjs';
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
} from './protocol.mjs';
import {
  base58Encode,
  createEscrowPlan,
  createEscrowState,
  fundEscrow,
  pubkeyFromSeed,
  settlementAuthorization,
  settleEscrow,
  signCanonicalAuthorization,
  verifyEscrowState,
} from './escrow.mjs';

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function deterministicKey(label) {
  const seed = createHash('sha256').update(`workseal-demo-key:${label}`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    solanaPubkey: base58Encode(publicDer.subarray(publicDer.length - 32)),
  };
}

export function buildSyntheticEscrowDemo() {
  const buyer = deterministicKey('buyer');
  const worker = deterministicKey('worker');
  const verifier = deterministicKey('verifier');
  const mint = pubkeyFromSeed('synthetic-usdc-mint-not-a-real-token');
  const task = {
    schema: 'workseal-task/v1',
    taskId: 'demo-agent-audit-001',
    buyer: { id: 'demo-buyer', settlementAddress: buyer.solanaPubkey },
    worker: { id: 'demo-worker', settlementAddress: worker.solanaPubkey },
    currency: `SPL:${mint}`,
    amountAtomic: '12500000',
    deadline: '2026-10-12T23:59:59Z',
    acceptancePolicy: {
      verifierId: 'demo-independent-verifier',
      verifierVersion: '1',
      requirements: [
        { id: 'artifact', description: 'artifact digest matches committed delivery' },
        { id: 'tests', description: 'required verification suite passes' },
      ],
    },
  };
  const authorityFingerprint = publicKeyFingerprint(verifier.publicKeyPem);
  const plan = createEscrowPlan(task, authorityFingerprint, { cluster: 'localnet' });
  let escrow = createEscrowState(plan);
  const phases = [{ system: 'escrow', phase: escrow.phase, event: 'PLAN_COMPILED' }];
  escrow = fundEscrow(escrow, {
    schema: 'workseal-solana-funding-observation/v1',
    signer: plan.binding.payer,
    sourceTokenAccount: plan.binding.buyerAta,
    destinationTokenAccount: plan.binding.vaultAta,
    mint: plan.binding.mint,
    amountAtomic: plan.binding.amountAtomic,
    escrowPda: plan.binding.escrowPda,
  });
  phases.push({ system: 'escrow', phase: escrow.phase, event: 'SYNTHETIC_FUNDING_OBSERVED' });

  let workseal = createState(task, authorityFingerprint);
  workseal = fundState(workseal, plan.fundingRef);
  const result = {
    schema: 'workseal-result/v1',
    taskDigest: taskDigest(task),
    workerId: task.worker.id,
    generation: 1,
    artifactDigest: sha256Hex('demo-delivery-artifact-v1'),
    evidence: [
      { id: 'artifact', digest: sha256Hex('demo-delivery-artifact-v1') },
      { id: 'tests', digest: sha256Hex('demo-suite:23/23') },
    ],
  };
  workseal = commitResult(workseal, result);
  const receipt = makeAcceptanceReceipt({
    task,
    result,
    acceptedAt: '2026-09-14T23:45:00Z',
    checks: [
      { id: 'artifact', ok: true, evidenceDigest: sha256Hex('demo-delivery-artifact-v1') },
      { id: 'tests', ok: true, evidenceDigest: sha256Hex('demo-suite:23/23') },
    ],
  });
  const receiptSignature = signAcceptanceReceipt(receipt, verifier.privateKeyPem);
  workseal = acceptState(workseal, {
    receipt,
    signatureBase64: receiptSignature,
    publicKeyPem: verifier.publicKeyPem,
  });
  phases.push({ system: 'workseal', phase: workseal.phase, event: 'SIGNED_ACCEPTANCE_VERIFIED' });

  const intent = createSettlementIntent(workseal);
  const authorization = settlementAuthorization(escrow, intent);
  const authorizationSignature = signCanonicalAuthorization(authorization, verifier.privateKeyPem);
  escrow = settleEscrow(escrow, {
    intent,
    verifierPubkey: verifier.solanaPubkey,
    signatureBase64: authorizationSignature,
  });
  phases.push({ system: 'escrow', phase: escrow.phase, event: 'SIGNED_SETTLEMENT_SIMULATED' });

  return {
    schema: 'workseal-solana-demo/v1',
    synthetic: true,
    network: 'OFFLINE_LOCALNET_SIMULATOR',
    writePerformed: false,
    deploymentObserved: false,
    taskDigest: taskDigest(task),
    task: {
      id: task.taskId,
      buyer: task.buyer.settlementAddress,
      worker: task.worker.settlementAddress,
      mint,
      amountAtomic: task.amountAtomic,
    },
    authority: {
      verifierPubkey: verifier.solanaPubkey,
      receiptAuthorityFingerprint: authorityFingerprint,
    },
    escrow: {
      planDigest: escrow.planDigest,
      pda: plan.binding.escrowPda,
      bump: plan.binding.escrowBump,
      buyerAta: plan.binding.buyerAta,
      workerAta: plan.binding.workerAta,
      vaultAta: plan.binding.vaultAta,
      fundingReference: plan.fundingRef.reference,
      finalPhase: escrow.phase,
      terminalDigest: escrow.terminalDigest,
      settlementAuthorizationDigest: sha256Hex(authorization),
      resultDigest: intent.resultDigest,
      acceptanceDigest: intent.acceptanceDigest,
      generation: intent.generation,
    },
    phases,
    verification: verifyEscrowState(escrow),
    truth: {
      rpcCalled: false,
      walletConnected: false,
      tokensMoved: false,
      programDeployed: false,
      competitionSubmitted: false,
      prizeOrRevenueClaimed: false,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(buildSyntheticEscrowDemo(), null, 2)}\n`);
}
