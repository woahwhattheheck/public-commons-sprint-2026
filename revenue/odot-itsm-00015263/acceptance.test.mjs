// MIT. One focused test entrypoint for the original migration acceptance contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,AcceptanceInputError,SCHEMA} from './acceptance.mjs';
const hash='a'.repeat(64);
const record=(type,id,extra={})=>({type,legacyId:id,canonicalStatus:'active',ownerKey:'OPS',
  assigneeKey:'E0001',assetRefs:[],attachmentSha256:[],...extra});
const originals=[record('asset','CI0001'),record('incident','INC1',{
  assetRefs:['CI0001'],attachmentSha256:[hash]})];
const sample=(system,records)=>({schemaVersion:SCHEMA,system,
  records:records.map((r,i)=>system==='target'?{...r,targetRecordId:'SYS'+(i+1)}:r)});

test('exact original asset->incident migration fields, IDs and digests agree',()=>{
  const r=reconcile(sample('remedy',originals),sample('target',originals));
  assert.equal(r.pass,true);assert.equal(r.totals.source,2);
  assert.equal(r.totals.findings,0);assert.equal(r.breakdown.incident.target,1);
});
test('status, owner, asset and attachment drift are independently detected',()=>{
  const modified=[record('asset','CI0001'),record('incident','INC1',{
    canonicalStatus:'closed',ownerKey:'OTHER',assetRefs:['CI404'],attachmentSha256:['b'.repeat(64)]})];
  const r=reconcile(sample('remedy',originals),sample('target',modified));
  assert.equal(r.pass,false);
  for(const code of ['STATUS_DRIFT','OWNER_KEY_DRIFT','ASSET_LINKS_DRIFT',
    'ATTACHMENT_DIGESTS_DRIFT','DANGLING_ASSET_REFERENCE'])
    assert.equal(r.findingCounts[code],1);
  assert.ok(r.findings.every(x=>x.recordKeyHash && !x.legacyId));
});
test('missing and extra target records never cancel out on equal counts',()=>{
  const changed=[record('asset','CI0001'),record('incident','INC2')];
  const r=reconcile(sample('remedy',originals),sample('target',changed));
  assert.equal(r.totals.source,r.totals.target);
  assert.equal(r.findingCounts.MISSING_TARGET_RECORD,1);
  assert.equal(r.findingCounts.EXTRA_TARGET_RECORD,1);
});
test('duplicate legacy identity and duplicate target system IDs fail closed',()=>{
  assert.throws(()=>reconcile(sample('remedy',[originals[0],originals[0]]),sample('target',originals)),
    e=>e instanceof AcceptanceInputError && e.code==='DUPLICATE_LEGACY_ID');
  const t=sample('target',originals);t.records[1].targetRecordId=t.records[0].targetRecordId;
  assert.throws(()=>reconcile(sample('remedy',originals),t),
    e=>e instanceof AcceptanceInputError && e.code==='DUPLICATE_TARGET_RECORD_ID');
});
test('invalid SHA256 and malformed canonical projection reject before comparison',()=>{
  const invalid=sample('remedy',originals);invalid.records[1].attachmentSha256=['not-a-digest'];
  assert.throws(()=>reconcile(invalid,sample('target',originals)),
    e=>e instanceof AcceptanceInputError && e.code==='INVALID_RECORD_CONTRACT');
});
