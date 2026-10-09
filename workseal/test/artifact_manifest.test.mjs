import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  artifactEvidence, artifactManifestDigest, artifactPolicyRequirement,
  buildArtifactManifest, normalizeArtifactManifest, verifyArtifactDelivery,
} from '../src/artifact_manifest.mjs';
import {
  makeAcceptanceReceipt, signAcceptanceReceipt, publicKeyFingerprint,
  createState, fundState, commitResult, acceptState, createSettlementIntent,
} from '../src/protocol.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'workseal-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'answer.txt'), 'delivered\n');
  await writeFile(join(root, 'empty.bin'), Buffer.alloc(0));
  const manifest = await buildArtifactManifest(root, ['empty.bin', 'dist/answer.txt']);
  const task = {
    schema: 'workseal-task/v1', taskId: 'artifact-demo',
    buyer: { id: 'buyer', settlementAddress: 'buyer-devnet' },
    worker: { id: 'worker', settlementAddress: 'worker-devnet' },
    currency: 'SOL_LAMPORTS', amountAtomic: '1', deadline: '2026-12-01T00:00:00Z',
    acceptancePolicy: { verifierId: 'local-artifacts', verifierVersion: '1', requirements: [artifactPolicyRequirement(manifest)] },
  };
  const { packet, evidence } = artifactEvidence(manifest, task, 1);
  const result = {
    schema: 'workseal-result/v1', taskDigest: packet.taskDigest, workerId: packet.workerId,
    generation: 1, artifactDigest: packet.artifactDigest, evidence: [evidence],
  };
  return { root, manifest, task, result };
}

test('actual file bytes feed an existing signed WorkSeal acceptance and settlement intent', async t => {
  const f = await fixture(t);
  assert.equal(f.manifest.files[0].path, 'dist/answer.txt');
  assert.equal(f.manifest.files[1].bytes, 0);
  assert.equal(artifactManifestDigest(f.manifest), artifactManifestDigest({ ...f.manifest, files: [...f.manifest.files].reverse() }));
  const verified = await verifyArtifactDelivery(f);
  assert.equal(verified.totalBytes, 10);
  const receipt = makeAcceptanceReceipt({ task: f.task, result: f.result, checks: [verified.check], acceptedAt: '2026-10-09T06:00:00Z' });
  const keys = generateKeyPairSync('ed25519');
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  let state = createState(f.task, publicKeyFingerprint(publicKeyPem));
  state = fundState(state, { chain: 'solana-devnet', reference: 'local-example', currency: 'SOL_LAMPORTS', amountAtomic: '1' });
  state = commitResult(state, f.result);
  state = acceptState(state, { receipt, publicKeyPem, signatureBase64: signAcceptanceReceipt(receipt, privateKeyPem) });
  assert.equal(createSettlementIntent(state).resultDigest, verified.resultDigest);
  assert.equal(verified.writePerformed, false);
  assert.equal(verified.externalAuthorityGranted, false);
});

test('changed bytes, swapped manifest, and stale generation evidence cannot pass', async t => {
  const f = await fixture(t);
  await assert.rejects(verifyArtifactDelivery({ ...f, result: { ...f.result, generation: 2 } }), { code: 'ARTIFACT_EVIDENCE_MISMATCH' });
  const swapped = structuredClone(f.manifest);
  swapped.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(verifyArtifactDelivery({ ...f, manifest: swapped }), { code: 'ARTIFACT_POLICY' });
  await writeFile(join(f.root, 'dist', 'answer.txt'), 'corrupted\n');
  await assert.rejects(verifyArtifactDelivery(f), { code: 'ARTIFACT_CONTENT_MISMATCH' });
  await rm(join(f.root, 'dist', 'answer.txt'));
  await assert.rejects(verifyArtifactDelivery(f), { code: 'ENOENT' });
});

test('selection boundaries and real CLI manifest/prepare/verify work without dependencies', async t => {
  const f = await fixture(t);
  await assert.rejects(buildArtifactManifest(f.root, ['../outside']), { code: 'ARTIFACT_PATH' });
  await assert.rejects(buildArtifactManifest(f.root, ['empty.bin', 'EMPTY.bin']), { code: 'ARTIFACT_DUPLICATE' });
  await symlink(join(f.root, 'dist'), join(f.root, 'alias'));
  await assert.rejects(buildArtifactManifest(f.root, ['alias/answer.txt']), { code: 'ARTIFACT_PATH' });
  await assert.rejects(buildArtifactManifest(f.root, ['dist/answer.txt'], { limits: { maxFileBytes: 1 } }), { code: 'ARTIFACT_LIMIT' });
  await assert.rejects(buildArtifactManifest(f.root, ['empty.bin'], { signal: AbortSignal.abort() }), { code: 'ARTIFACT_CANCELLED' });
  assert.throws(() => normalizeArtifactManifest({ ...f.manifest, extra: true }), { code: 'ARTIFACT_SCHEMA' });
  const cli = fileURLToPath(new URL('../src/artifact_manifest_cli.mjs', import.meta.url));
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
  const manifestPath = join(f.root, 'manifest.json');
  const taskPath = join(f.root, 'task.json');
  const resultPath = join(f.root, 'result.json');
  const generated = run('manifest', f.root, 'dist/answer.txt', 'empty.bin');
  assert.deepEqual(generated, f.manifest);
  await writeFile(manifestPath, JSON.stringify(generated));
  await writeFile(taskPath, JSON.stringify(f.task));
  assert.deepEqual(run('policy', manifestPath).requirement, f.task.acceptancePolicy.requirements[0]);
  const prepared = run('prepare', f.root, manifestPath, taskPath, '1');
  assert.deepEqual(prepared, f.result);
  await writeFile(resultPath, JSON.stringify(prepared));
  assert.equal(run('verify', f.root, manifestPath, taskPath, resultPath).ok, true);
});
