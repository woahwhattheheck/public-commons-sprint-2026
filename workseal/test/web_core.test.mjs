import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoBundle, canonicalJson, generateEd25519, sha256Hex, signCanonical, signedAcceptanceDigest, verifyBrowserBundle } from '../web/core.mjs';

test('browser canonical JSON is key-order independent', () => assert.equal(canonicalJson({z:1,a:{y:true,x:'v'}}),canonicalJson({a:{x:'v',y:true},z:1})));
test('browser sha256 is deterministic', async () => assert.equal(await sha256Hex({b:2,a:1}),await sha256Hex({a:1,b:2})));
test('complete demo bundle verifies locally', async () => { const b=await buildDemoBundle(); const v=await verifyBrowserBundle(b); assert.equal(v.verdict,'PASS'); assert.equal(v.writePerformed,false); assert.equal(v.externalAuthorityGranted,false); });
test('acceptance digest binds signature bytes', async () => { const b=await buildDemoBundle(); const a=await signedAcceptanceDigest(b.receipt,b.signatureBase64,b.receiptAuthorityFingerprint); const mutant=b.signatureBase64.slice(0,-2)+'AA'; const c=await signedAcceptanceDigest(b.receipt,mutant,b.receiptAuthorityFingerprint); assert.notEqual(a,c); });
test('receipt tamper fails signature verification', async () => { const b=await buildDemoBundle(); b.receipt.generation=2; await assert.rejects(()=>verifyBrowserBundle(b),/receipt generation mismatch|acceptance signature invalid/); });
test('authority fingerprint tamper fails closed', async () => { const b=await buildDemoBundle(); b.receiptAuthorityFingerprint='0'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/authority fingerprint mismatch/); });
test('workflow evidence tamper fails closed', async () => { const b=await buildDemoBundle(); b.githubEvidence.conclusion='failure'; await assert.rejects(()=>verifyBrowserBundle(b),/workflow run conclusion must be success/); });
test('settlement acceptance digest tamper fails closed', async () => { const b=await buildDemoBundle(); b.settlementIntent.acceptanceDigest='f'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/settlement acceptance digest mismatch/); });
test('settlement task digest cannot diverge from signed receipt', async () => { const b=await buildDemoBundle(); b.settlementIntent.taskDigest='f'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/settlement task\/result digest mismatch/); });
test('settlement result digest cannot diverge from signed receipt', async () => { const b=await buildDemoBundle(); b.settlementIntent.resultDigest='f'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/settlement task\/result digest mismatch/); });
test('settlement generation cannot diverge from accepted generation', async () => { const b=await buildDemoBundle(); b.settlementIntent.generation=2; await assert.rejects(()=>verifyBrowserBundle(b),/settlement generation mismatch/); });
test('result cannot swap GitHub evidence after acceptance', async () => { const b=await buildDemoBundle(); b.result.evidence[0].digest='f'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/receipt task\/result digest mismatch/); });
test('checks digest cannot be swapped', async () => { const b=await buildDemoBundle(); b.receipt.checksDigest='f'.repeat(64); await assert.rejects(()=>verifyBrowserBundle(b),/acceptance signature invalid/); });

test('settlement amount cannot diverge from task', async () => { const b=await buildDemoBundle(); b.settlementIntent.amountAtomic='1'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement amount\/currency mismatch/); });
test('settlement currency cannot diverge from task', async () => { const b=await buildDemoBundle(); b.settlementIntent.currency='OTHER'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement amount\/currency mismatch/); });
test('settlement payer cannot diverge from task buyer', async () => { const b=await buildDemoBundle(); b.settlementIntent.payer='ATTACKER'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement party mismatch/); });
test('settlement payee cannot diverge from task worker', async () => { const b=await buildDemoBundle(); b.settlementIntent.payee='ATTACKER'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement party mismatch/); });
test('settlement funding amount cannot diverge from task', async () => { const b=await buildDemoBundle(); b.settlementIntent.funding.amountAtomic='1'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement funding mismatch/); });
test('unknown settlement fields fail closed', async () => { const b=await buildDemoBundle(); b.settlementIntent.extra='semantic-extension'; await assert.rejects(()=>verifyBrowserBundle(b),/settlement intent field set mismatch/); });

test('browser verifier rejects normalized invalid task and acceptance civil dates', async () => {
  const badTask = await buildDemoBundle();
  badTask.task.deadline = '2026-02-30T12:00:00Z';
  await assert.rejects(
    () => verifyBrowserBundle(badTask),
    /task deadline must be a valid Gregorian RFC3339 timestamp/,
  );

  const badReceipt = await buildDemoBundle();
  badReceipt.receipt.acceptedAt = '2026-10-08T24:00:00Z';
  await assert.rejects(
    () => verifyBrowserBundle(badReceipt),
    /receipt acceptedAt must be a valid Gregorian RFC3339 timestamp/,
  );
});

async function reSignTaskBoundBundle(bundle) {
  // Build a fully self-consistent signed proof after a malicious task-policy change.
  // A stale signature would already fail; this helper isolates policy-verification correctness.
  const key = await generateEd25519();
  bundle.result.taskDigest = await sha256Hex(bundle.task);
  bundle.receipt.taskDigest = bundle.result.taskDigest;
  bundle.receipt.resultDigest = await sha256Hex(bundle.result);
  bundle.publicKeySpkiBase64 = key.publicKeySpkiBase64;
  bundle.receiptAuthorityFingerprint = key.fingerprint;
  bundle.signatureBase64 = await signCanonical(bundle.receipt, key.privateKey);
  bundle.settlementIntent.taskDigest = bundle.result.taskDigest;
  bundle.settlementIntent.resultDigest = bundle.receipt.resultDigest;
  bundle.settlementIntent.acceptanceDigest = await signedAcceptanceDigest(bundle.receipt, bundle.signatureBase64, key.fingerprint);
  bundle.settlementIntent.receiptAuthorityFingerprint = key.fingerprint;
  return bundle;
}

test('browser rejects a fully re-signed task with an unverified policy requirement', async () => {
  const bundle = await buildDemoBundle();
  bundle.task.acceptancePolicy.requirements = [{ id: 'photo-id-check', description: 'Verify independent identity evidence' }];
  await reSignTaskBoundBundle(bundle);
  await assert.rejects(() => verifyBrowserBundle(bundle), /unsupported acceptance policy requirements/);
});

test('browser rejects a fully re-signed task whose verifier version differs from the receipt', async () => {
  const bundle = await buildDemoBundle();
  bundle.task.acceptancePolicy.verifierVersion = 'policy-v2';
  await reSignTaskBoundBundle(bundle);
  await assert.rejects(() => verifyBrowserBundle(bundle), /receipt verifier does not match task acceptance policy/);
});

test('browser rejects a second unverified requirement even with valid GitHub Actions evidence', async () => {
  const bundle = await buildDemoBundle();
  bundle.task.acceptancePolicy.requirements.push({ id: 'manual-review', description: 'Human approval required' });
  await reSignTaskBoundBundle(bundle);
  await assert.rejects(() => verifyBrowserBundle(bundle), /unsupported acceptance policy requirements/);
});
