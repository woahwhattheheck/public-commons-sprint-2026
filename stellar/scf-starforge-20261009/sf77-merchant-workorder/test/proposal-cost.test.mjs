// MIT. Proposal-price authority is independent of recorded delivery economics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildPacket,renderHtml,renderChecklist} from '../workorder.mjs';
import {termsDocumentFromDraft,termsDraftFromDocument} from '../../sf74-merchant-support-console/terms-editor.mjs';

const raw=await readFile(new URL('../sample-intake.json',import.meta.url),'utf8');
const intake=JSON.parse(raw),sha=createHash('sha256').update(raw).digest('hex');
const at='2026-10-12T00:00:00.000Z';
const terms=cost=>({
  workOrderRef:'ILLUSTRATIVE-COST-SEMANTICS',
  sellerDisplayName:'Illustrative merchant',
  relationshipOwner:'Illustrative owner',
  merchantConsent:{status:'NOT_RECORDED',receiptUrl:null},
  commercial:{priceApproval:'OWNER_APPROVED_PROPOSAL',feeUsd:9800,costUsd:cost,
    approvalReceiptUrl:'https://owner.example/recorded-proposal'},
  proposedWindow:'Illustrative test; no customer agreement'
});

test('approved fee survives unknown cost and saved form roundtrip',()=>{
  const original=terms(null);
  const draft=termsDraftFromDocument(original);
  assert.equal(draft.costUsd,'');
  const returned=termsDocumentFromDraft(draft);
  assert.equal(returned.commercial.feeUsd,9800);
  assert.equal(returned.commercial.costUsd,null);
  const packet=buildPacket(intake,returned,sha,at);
  assert.equal(packet.commercial.approvedFeeUsd,9800);
  assert.equal(packet.commercial.approvedCostUsd,null);
  assert.equal(packet.commercial.marginPercent,null);
  assert.equal(packet.commercial.ownerReceipt,original.commercial.approvalReceiptUrl);
  assert.equal(packet.baseline.sourceSha256,sha);
  assert.match(renderHtml(packet),/Delivery cost: not recorded/);
  assert.match(renderChecklist(packet),/Margin: unknown/);
  assert.equal(packet.limits.sellerHasAcceptedWork,false);
  assert.equal(packet.limits.invoiceIssued,false);
});

test('recorded zero is distinct from missing cost',()=>{
  const returned=termsDocumentFromDraft(termsDraftFromDocument(terms(0)));
  assert.equal(returned.commercial.costUsd,0);
  const packet=buildPacket(intake,returned,sha,at);
  assert.equal(packet.commercial.approvedCostUsd,0);
  assert.equal(packet.commercial.marginPercent,100);
  assert.match(renderHtml(packet),/Recorded delivery cost: \$0\.00/);
});

test('adverse recorded economics remain visible without changing approved price',()=>{
  const original=terms(11000);
  const returned=termsDocumentFromDraft(termsDraftFromDocument(original));
  const packet=buildPacket(intake,returned,sha,at);
  assert.equal(packet.commercial.approvedFeeUsd,9800);
  assert.equal(packet.commercial.approvedCostUsd,11000);
  assert.equal(packet.commercial.marginPercent,-12.24);
  assert.match(renderHtml(packet),/cost exceeds the approved fee by \$1,200\.00/);
  assert.match(renderChecklist(packet),/-12\.24%/);
  assert.equal(packet.commercial.ownerReceipt,original.commercial.approvalReceiptUrl);
  assert.equal(packet.baseline.sourceSha256,sha);
  assert.equal(packet.limits.cashReceived,false);
});

test('commissioning delivery fields use the original packet without replacing its source',async()=>{
  const fragment=JSON.parse(await readFile(new URL('../../../scf_2026/sf49_data_commissioning/source-edition-delivery-fields.example.json',import.meta.url),'utf8'));
  const owner={...terms(null),delivery:fragment.delivery};
  const restored=termsDocumentFromDraft(termsDraftFromDocument(owner));
  const packet=buildPacket(intake,restored,sha,at);
  assert.deepEqual(packet.delivery,fragment.delivery);
  assert.equal(packet.baseline.sourceSha256,sha);
  assert.equal(packet.scope.resource,intake.scope.resource);
  assert.equal(packet.commercial.approvedFeeUsd,owner.commercial.feeUsd);
  assert.equal(packet.commercial.approvedCostUsd,null);
  assert.equal(packet.commercial.ownerReceipt,owner.commercial.approvalReceiptUrl);
  assert.match(renderChecklist(packet),/Owner-entered delivery and acceptance/);
});
