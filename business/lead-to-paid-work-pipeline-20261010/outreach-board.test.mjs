import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAll, renderHtml, renderMarkdown } from './pipeline.mjs';
const now=new Date('2026-10-11T12:00:00Z');
const deal=()=>({owner:'Example owner',buyer:{name:'Example buyer',opportunityId:'RFP-1',revision:'v1',status:'OPEN',
  sourceUrl:'https://example.invalid/buyer',deadline:{confirmed:true,isoWithOffset:'2026-11-01T17:00:00+00:00'}},
  sourceCheck:{method:'ISSUER_REVIEW',checkedAt:'2026-10-11T11:00:00Z',detail:'Synthetic review'},requirements:[{id:'fit',mandatory:true}],
  partners:[{name:'Example prime',evidence:[{requirementId:'fit',status:'DOCUMENTED',sourceUrl:'https://example.invalid/prime'}]}],
  workshare:{feeUsd:1000,costUsd:500,feeStatus:'OWNER_APPROVED_PROPOSAL',milestones:[{deliverable:'Synthetic example',acceptance:'Example criteria'}]},
  communication:{ownerApproved:true,doNotContact:false,approvalReceipt:'synthetic-approval',intentId:'first',to:['prime@example.invalid']}});
const snapshot=()=>({coverage:{source:'GMAIL_SENT_SEARCH',checkedAt:'2026-10-11T11:59:00Z',coverageFrom:'2026-10-01T00:00:00Z',
  requiredMailboxes:['business@example.invalid','secondary@example.invalid'],checkedMailboxes:['business@example.invalid','secondary@example.invalid']},
  sent:[],intents:[{id:'first',owner:'Example owner',kind:'FIRST_CONTACT',to:['prime@example.invalid'],buyerId:'Example buyer',solicitationId:'RFP-1',primeId:'Example prime'}]});

test('existing eligibility candidate becomes HOLD on an already-sent first contact',()=>{
  const op=deal(),input=snapshot();
  assert.equal(evaluateAll([op],now).decisions[0].readyForOwnerApproach,true);
  input.sent.push({messageId:'synthetic-sent',labels:['SENT'],sentAt:'2026-10-11T11:30:00Z',from:'business@example.invalid',
    to:['different-person@example.invalid'],buyerId:'Example buyer',solicitationId:'RFP-1',primeId:'Example prime'});
  const result=evaluateAll([op],now,{outreachSnapshot:input});
  assert.equal(result.decisions[0].readyForOwnerApproach,false);
  assert.ok(result.decisions[0].blockers.includes('OUTREACH_FIRST_CONTACT_ALREADY_SENT'));
  assert.equal(result.decisions[0].outreachPreflight.matchingSent[0].messageId,'synthetic-sent');
  assert.match(renderHtml(result.decisions,now),/FIRST_CONTACT_ALREADY_SENT/);
  assert.match(renderMarkdown(result.decisions,now),/Outreach snapshot/);
});

test('a fresh noncolliding snapshot never grants missing owner approval',()=>{
  const op=deal(),input=snapshot();op.communication.ownerApproved=false;
  const result=evaluateAll([op],now,{outreachSnapshot:input}).decisions[0];
  assert.equal(result.outreachPreflight.decision,'NO_COLLISION_OBSERVED');
  assert.equal(result.readyForOwnerApproach,false);assert.equal(result.outreachAuthorized,false);
  assert.ok(result.blockers.includes('OWNER_CONTACT_APPROVAL_REQUIRED'));
});

test('stale or incomplete mailbox coverage carries the original preflight HOLD into the board',()=>{
  for(const mutate of [s=>s.coverage.checkedAt='2026-10-11T11:30:00Z',s=>s.coverage.checkedMailboxes.pop()]){
    const input=snapshot();mutate(input);
    const r=evaluateAll([deal()],now,{outreachSnapshot:input}).decisions[0];
    assert.equal(r.readyForOwnerApproach,false);assert.equal(r.outreachPreflight.decision,'HOLD');
  }
});

test('unrelated intent and recipient/owner/prime mismatches cannot clear a different opportunity',()=>{
  for(const mutate of [o=>o.communication.intentId='missing',o=>o.buyer.opportunityId='other',o=>o.owner='other owner',
    o=>o.partners[0].name='different prime',o=>o.communication.to=['other@example.invalid']]){
    const op=deal();mutate(op);
    assert.equal(evaluateAll([op],now,{outreachSnapshot:snapshot()}).decisions[0].outreachPreflight.decision,'HOLD');
  }
  const one=deal(),two=deal();two.buyer.revision='v2';
  const result=evaluateAll([one,two],now,{outreachSnapshot:snapshot()});
  assert.ok(result.decisions.every(x=>x.blockers.includes('OUTREACH_INTENT_SHARED_BY_OPPORTUNITIES')));
  const unsupplied=evaluateAll([deal()],now).decisions[0];
  assert.equal(unsupplied.outreachPreflight.decision,'NOT_EVALUATED');
});
