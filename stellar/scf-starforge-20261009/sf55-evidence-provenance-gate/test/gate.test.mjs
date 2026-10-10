// One focused source-boundary check; no hosted CI, external HTTP or payment.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditManifest, gitBlobSha1 } from '../gate.mjs';

const root = mkdtempSync(join(tmpdir(), 'scf55-'));
try {
  mkdirSync(join(root, 'original'));
  const source = Buffer.from('export const transferIsLive = false;\n');
  writeFileSync(join(root, 'original/module.mjs'), source);
  const base = {
    schema_version: 1,
    claims: [
      { id: 'source', kind: 'source', file: 'original/module.mjs',
        git_blob_sha1: gitBlobSha1(source) },
      { id: 'live_payment', kind: 'provider_receipt',
        provider_url: 'https://claimed.example/receipt/1', status: 'accepted' },
      { id: 'buyer', kind: 'buyer_traction', asserted_buyers: 10 },
      { id: 'grant', kind: 'grant_status', asserted_award: 150000 }
    ]
  };
  const clean = auditManifest(root, base);
  assert.equal(clean.source_integrity_ok, true);
  assert.equal(clean.source_verified, 1);
  assert.equal(clean.external_outcomes_verified, 0);
  assert.equal(clean.submission_ready, false);
  assert.equal(clean.claims[1].result, 'external_acceptance_not_verified_by_source_gate');
  writeFileSync(join(root, 'original/module.mjs'), 'export const transferIsLive = true;\n');
  const altered = auditManifest(root, base);
  assert.equal(altered.source_integrity_ok, false);
  assert.equal(altered.claims[0].result, 'source_drift');
  writeFileSync(join(root, 'original/module.mjs'), source);
  const traversal = structuredClone(base);
  traversal.claims[0].file = '../outside';
  assert.equal(auditManifest(root, traversal).claims[0].result, 'source_unavailable');
  symlinkSync(join(root, 'original/module.mjs'), join(root, 'original/alias.mjs'));
  const alias = structuredClone(base);
  alias.claims[0].file = 'original/alias.mjs';
  assert.equal(auditManifest(root, alias).claims[0].result, 'source_unavailable');
  assert.throws(() => auditManifest(root, {schema_version:1, claims:[
    base.claims[0], base.claims[0]]}), /DUPLICATE/);
  assert.throws(() => auditManifest(root, {schema_version:1, claims:[
    {id:'x',kind:'guaranteed_revenue'}]}), /UNKNOWN_CLAIM_KIND/);
  console.log('PASS SF55: source parity, mutation, traversal, symlink, forged external claims, schema');
} finally {
  rmSync(root, { recursive: true, force: true });
}
