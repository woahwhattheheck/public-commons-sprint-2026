#!/usr/bin/env node
/**
 * WorkSeal's actual-byte judge demonstration. Everything here is an offline
 * synthetic fixture; signed acceptance is not payment or external authority.
 * Linux + Node 20+, no third-party dependencies, no network or wallet calls.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256Hex } from './canonical.mjs';
import {
  artifactEvidence, artifactPolicyRequirement, buildArtifactManifest,
  verifyArtifactDelivery,
} from './artifact_manifest.mjs';
import {
  acceptState, commitResult, createSettlementIntent, createState, fundState,
  makeAcceptanceReceipt, publicKeyFingerprint, signAcceptanceReceipt,
} from './protocol.mjs';

const SAMPLE = Object.freeze([
  { path: 'dist/package.bin', bytes: Buffer.from('WorkSeal synthetic delivery version 1\n') },
  { path: 'report.json', bytes: Buffer.from('{"verifiedExample":true,"kind":"synthetic"}\n') },
]);
const TAMPERED = Buffer.from('WorkSeal synthetic delivery version X\n');

async function writeSelected(root, path, bytes) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

const transported = (entries) => entries.map(entry => ({
  path: entry.path, base64: entry.bytes.toString('base64'),
}));

/** Produces actual verifier outputs, never hand-authored PASS or HOLD objects. */
export async function runArtifactJudgeDemo() {
  const scratch = await mkdtemp(join(tmpdir(), 'workseal-artifact-judge-'));
  const referenceRoot = join(scratch, 'buyer-reference');
  const deliveryRoot = join(scratch, 'delivered');
  try {
    for (const entry of SAMPLE) {
      await writeSelected(referenceRoot, entry.path, entry.bytes);
      await writeSelected(deliveryRoot, entry.path, entry.bytes);
    }
    // Reference and delivery are different directories. The buyer's manifest
    // is obtained from reference BYTES and retained across both verification runs.
    const manifest = await buildArtifactManifest(referenceRoot, SAMPLE.map(x => x.path));
    const task = {
      schema: 'workseal-task/v1',
      taskId: 'judge-synthetic-file-delivery-001',
      buyer: { id: 'synthetic-buyer', settlementAddress: 'offline-buyer-address' },
      worker: { id: 'synthetic-worker', settlementAddress: 'offline-worker-address' },
      currency: 'SOL_LAMPORTS',
      amountAtomic: '1',
      deadline: '2026-12-01T00:00:00Z',
      acceptancePolicy: {
        verifierId: 'local-byte-verifier', verifierVersion: '1',
        requirements: [artifactPolicyRequirement(manifest)],
      },
    };
    const { packet, evidence } = artifactEvidence(manifest, task, 1);
    const result = {
      schema: 'workseal-result/v1', taskDigest: packet.taskDigest,
      workerId: packet.workerId, generation: 1,
      artifactDigest: packet.artifactDigest, evidence: [evidence],
    };
    const verification = await verifyArtifactDelivery({
      root: deliveryRoot, manifest, task, result,
    });
    if (!verification.ok || !verification.check.ok) {
      throw new Error('Initial delivered file verification failed');
    }

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeySpkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const receiptAuthorityFingerprint = publicKeyFingerprint(publicKeyPem);
    const receipt = makeAcceptanceReceipt({
      task, result, checks: [verification.check],
      acceptedAt: '2026-10-09T00:00:00Z',
    });
    const signatureBase64 = signAcceptanceReceipt(receipt, privateKeyPem);
    let state = createState(task, receiptAuthorityFingerprint);
    state = fundState(state, {
      chain: 'OFFLINE_FIXTURE', reference: 'SYNTHETIC_NOT_FUNDED',
      currency: task.currency, amountAtomic: task.amountAtomic,
    });
    state = commitResult(state, result);
    state = acceptState(state, { receipt, signatureBase64, publicKeyPem });
    const settlementIntent = createSettlementIntent(state);

    // Now alter *actual delivered bytes*; neither pinned buyer manifest nor
    // result generation, verifier, receipt or signature may be changed.
    await writeSelected(deliveryRoot, SAMPLE[0].path, TAMPERED);
    let rejectionCode = null;
    try {
      await verifyArtifactDelivery({ root: deliveryRoot, manifest, task, result });
    } catch (error) {
      if (error.code !== 'ARTIFACT_CONTENT_MISMATCH') throw error;
      rejectionCode = error.code;
    }
    if (rejectionCode !== 'ARTIFACT_CONTENT_MISMATCH') {
      throw new Error('SECURITY FAILURE: tampered delivery passed the file verifier');
    }

    return {
      schema: 'workseal-artifact-judge-demo/v1',
      synthetic: true,
      environment: 'OFFLINE_LOCAL_FIXTURE',
      buyerPinnedManifest: manifest,
      task, result, receipt, signatureBase64,
      publicKeySpkiBase64, receiptAuthorityFingerprint, settlementIntent,
      pristine: {
        verifier: 'verifyArtifactDelivery',
        verdict: 'PASS', verification,
        files: transported(SAMPLE),
      },
      tampered: {
        verifier: 'verifyArtifactDelivery',
        verdict: 'HOLD',
        code: rejectionCode,
        changedPath: SAMPLE[0].path,
        files: transported([
          { path: SAMPLE[0].path, bytes: TAMPERED },
          SAMPLE[1],
        ]),
      },
      signedReceiptWasNotReissuedForTamperedBytes: true,
      writePerformed: false,
      externalAuthorityGranted: false,
      paymentObserved: false,
      contestSubmitted: false,
      evidence: {
        taskDigest: packet.taskDigest,
        resultDigest: sha256Hex(result),
        acceptanceDigest: state.acceptanceDigest,
        settlementIntentDigest: sha256Hex(settlementIntent),
      },
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArtifactJudgeDemo()
    .then(packet => process.stdout.write(JSON.stringify(packet, null, 2) + '\n'))
    .catch(error => {
      process.stderr.write(JSON.stringify({
        ok: false, code: error.code || 'JUDGE_DEMO_FAILED',
        message: 'Offline judge demonstration failed; no PASS evidence produced',
      }) + '\n');
      process.exitCode = 1;
    });
}
