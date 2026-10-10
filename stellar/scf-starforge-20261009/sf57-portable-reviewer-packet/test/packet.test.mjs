import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { renderPacket, verifyPacket, writePacket } from '../packet.mjs';

function report() { return {
  schema:'stellar-forge.sf53.local-proof.v1', observedAt:'2026-10-10T20:00:00.000Z',
  commerce:{status:'PASS_LOCAL_SOURCE_SMOKE',signedRequests:0,paidCalls:0,testnetTransactions:0,discovered:1,seller402:1,cancelledReplay:true},
  release:{status:'PASS_SOURCE_CONTRACTS_ONLY',matchingPins:1,changedPins:0,missingOrUnreadable:0,failures:[],warnings:[],sources:[{id:'source',status:'PIN_MATCH',actualGitBlob:'abc'}]},
  wire:{status:'PASS_DENIED_WIRE_POLICY',signedRequests:0,signingCallbacks:0,chainTransactions:0,httpProbes:6,blockedBeforeApproval:5,decisions:[{label:'legit',denial:'PAYMENT_NOT_APPROVED',approvals:1}]},
  restrictions:{browserCanTriggerPayment:false,browserCanTriggerAdditionalRuns:false,testnetSettlementProved:false,mainnetDeploymentProved:false,buyerOrMerchantAdoptionProved:false,scfApplicationSubmitted:false},
};}

test('first-party report contracts render a read-only and internally verifiable offline packet', async () => {
  const temp = await mkdtemp(join(tmpdir(),'sf57-'));
  try {
    const folder = join(temp,'review');
    const result = await writePacket(report(), folder);
    assert.equal(result.classification, 'SOURCE_CONTRACTS_PASS_ONLY');
    const html = await readFile(join(folder,'review.html'),'utf8');
    assert.match(html,/Content-Security-Policy/);
    assert.doesNotMatch(html,/<script|<iframe|<form|<img/i);
    assert.equal((await verifyPacket(folder)).status, 'FILES_MATCH_CHECKSUMS_ONLY');
    await assert.rejects(writePacket(report(), folder), /refuse to overwrite/);
    await writeFile(join(folder,'review.html'), html.replace('Source checkout smoke', 'Changed'));
    await assert.rejects(verifyPacket(folder), /mismatch/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('drift, nonzero signing and source failures never appear as clean source proof; messages are escaped', () => {
  const r = report();
  r.release.changedPins = 1;
  r.commerce.detail = '<img src=x onerror=alert(1)>';
  let p = renderPacket(r);
  assert.equal(p.classification,'REVIEW_REQUIRED');
  assert.match(p.html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(p.html,/<img/i);
  r.release.changedPins = 0; r.wire.signedRequests = 1;
  assert.equal(renderPacket(r).classification,'REVIEW_REQUIRED');
  r.wire.signedRequests = 0; r.release.failures = ['broken source'];
  assert.equal(renderPacket(r).classification,'REVIEW_REQUIRED');
});

test('reject contradictory safety restrictions and malformed evidence', () => {
  const r=report(); r.restrictions.scfApplicationSubmitted=true;
  assert.throws(()=>renderPacket(r), /restriction contract/);
  r.restrictions.scfApplicationSubmitted=false; r.observedAt='not-a-date';
  assert.throws(()=>renderPacket(r), /timestamp/);
  r.observedAt='2026-10-10T20:00:00.000Z'; r.commerce.signedRequests=Infinity;
  assert.throws(()=>renderPacket(r), /Non-JSON/);
});
