import { generateKeyPairSync } from 'node:crypto';
import { sha256Hex } from './canonical.mjs';
import {
  acceptState,
  commitResult,
  createSettlementIntent,
  createState,
  fundState,
  makeAcceptanceReceipt,
  publicKeyFingerprint,
  settleState,
  signAcceptanceReceipt,
} from './protocol.mjs';
import { makeSolanaSettlementPlan } from './solana.mjs';

function demo() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const task = {
    schema: 'workseal-task/v1',
    taskId: 'demo-agent-contract-001',
    buyer: { id: 'buyer:demo', settlementAddress: 'Buyer1111111111111111111111111111111111111' },
    worker: { id: 'agent:demo', settlementAddress: 'Worker111111111111111111111111111111111111' },
    currency: 'SOL_LAMPORTS',
    amountAtomic: '25000000',
    deadline: '2026-10-12T23:59:59Z',
    acceptancePolicy: {
      verifierId: 'workseal-demo-verifier',
      verifierVersion: '1.0.0',
      requirements: [
        { id: 'tests', description: 'Pinned test suite passes' },
        { id: 'artifact', description: 'Delivered artifact matches committed digest' },
      ],
    },
  };
  let state = createState(task, publicKeyFingerprint(publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'demo-funding-signature', currency: 'SOL_LAMPORTS', amountAtomic: task.amountAtomic });
  const result = {
    schema: 'workseal-result/v1',
    taskDigest: state.taskDigest,
    workerId: task.worker.id,
    generation: 1,
    artifactDigest: sha256Hex('artifact bytes for demo'),
    evidence: [
      { id: 'tests', digest: sha256Hex('node --test: PASS') },
      { id: 'artifact', digest: sha256Hex('artifact bytes for demo') },
    ],
  };
  state = commitResult(state, result);
  const receipt = makeAcceptanceReceipt({
    task,
    result,
    acceptedAt: '2026-09-14T23:30:00Z',
    checks: [
      { id: 'tests', ok: true, evidenceDigest: result.evidence[0].digest },
      { id: 'artifact', ok: true, evidenceDigest: result.evidence[1].digest },
    ],
  });
  const signatureBase64 = signAcceptanceReceipt(receipt, privateKeyPem);
  state = acceptState(state, { receipt, signatureBase64, publicKeyPem });
  const intent = createSettlementIntent(state);
  const plan = makeSolanaSettlementPlan(intent, { cluster: 'devnet' });
  const settled = settleState(state, 'demo-settlement-signature');
  console.log(JSON.stringify({ taskDigest: state.taskDigest, acceptanceDigest: state.acceptanceDigest, settlementPlan: plan, finalPhase: settled.phase }, null, 2));
}

if (process.argv[2] === 'demo') demo();
else {
  console.error('usage: node src/cli.mjs demo');
  process.exitCode = 2;
}
