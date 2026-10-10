// MIT — focused contract check: these unit fixtures are not buyer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditJsonl, parseManifest } from './audit.mjs';
const H='a'.repeat(64),H2='b'.repeat(64);
const base={sourceId:'project-doc-7',path:'finance/2026/ledger.xlsx',
  contentSha256:H,sizeBytes:921,principals:['finance-read','finance-write'],label:'Confidential',
  expectedTargetPath:'/teams/tax/finance/2026/ledger.xlsx',classifiedAt:'2026-10-01T11:00:00Z'};
const dest={sourceId:base.sourceId,path:base.expectedTargetPath,
  contentSha256:H,sizeBytes:921,principals:['finance-write','finance-read'],label:'Confidential',
  migratedAt:'2026-10-02T11:00:00Z'};
const asLine=o=>JSON.stringify(o)+'\n';
test('preserve byte/content ACL and pre-move classification; flag concrete drifts',()=>{
  const pass=auditJsonl(asLine(base),asLine(dest));
  assert.equal(pass.status,'PASS');assert.equal(pass.matchedObjects,1);
  assert.equal(pass.evidence,'USER_SUPPLIED_MANIFESTS_ONLY_NOT_TENANT_VERIFIED');
  const bad={...dest,contentSha256:H2,sizeBytes:922,principals:['finance-read'],
    label:'Public',path:'/wrong/place',migratedAt:'2026-09-30T11:00:00Z'};
  const fail=auditJsonl(asLine(base),asLine(bad));
  assert.equal(fail.status,'FAIL');
  assert.deepEqual(fail.failures.map(f=>f.code).sort(),[
    'ACL_PRINCIPAL_MISMATCH','CLASSIFIED_AFTER_MIGRATION','CONTENT_HASH_MISMATCH',
    'PURVIEW_LABEL_MISMATCH','SIZE_MISMATCH','UNEXPECTED_TARGET_PATH'].sort());
  assert.deepEqual(auditJsonl(asLine(base),asLine({...dest,sourceId:'different'})).failures.map(f=>f.code).sort(),
    ['MISSING_TARGET_OBJECT','UNEXPECTED_TARGET_OBJECT']);
  assert.throws(()=>parseManifest(asLine(base)+asLine(base)),/DUPLICATE/);
  assert.throws(()=>auditJsonl(asLine(base),asLine({...dest,migratedAt:'no date'})),/MIGRATION_TIME/);
  assert.throws(()=>parseManifest(asLine(base),{maxBytes:10}),/TOO_LARGE/);
});
