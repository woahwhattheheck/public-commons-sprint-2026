import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOutcomeClaims} from '../audit.mjs';
const policy={vendorSources:['CCI_VENDOR'],independentSources:['VA_CONTROLLED'],repeatWindowHours:168};
const at='2026-10-01T12:00:00Z';
const ev=(eventId,contactId,type,source='CCI_VENDOR',extra={})=>({eventId,contactId,type,source,at,...extra});
const claim=(contactId,billedAs='ai_success',amountMinor='120')=>({contactId,billedAs,amountMinor,currency:'USD'});
test('independently corroborated unmixed automation is a supported claim',()=>{
 const x=auditOutcomeClaims({policy,events:[ev('a','C1','ai_attempt'),ev('b','C1','ai_resolved','VA_CONTROLLED')],claims:[claim('C1')]});
 assert.equal(x.summary.supported,1);assert.equal(x.summary.requiresReviewMinor,'0');
 assert.equal(x.findings[0].status,'SUPPORTED');assert.equal('contactId' in x.findings[0],false);
});
test('escalations, recontacts and vendor-only resolution each flag billing outcome',()=>{
 const events=[ev('a','C1','ai_attempt'),ev('b','C1','ai_resolved','VA_CONTROLLED'),
   ev('c','C1','escalated'),ev('d','C2','repeat_contact','VA_CONTROLLED',{parentContactId:'C1'}),
   ev('e','C3','ai_attempt'),ev('f','C3','ai_resolved')];
 const x=auditOutcomeClaims({policy,events,claims:[claim('C1'),claim('C3')]});
 assert.equal(x.summary.requiresReviewMinor,'240');
 assert.deepEqual(x.findings[0].reasons,['HUMAN_INTERVENTION_OR_ESCALATION','REPEAT_WITHIN_CONFIGURED_WINDOW']);
 assert.deepEqual(x.findings[1].reasons,['INDEPENDENT_AI_RESOLUTION_MISSING']);
});
test('duplicate billable contacts, nonbillable charges and missing human evidence flag review',()=>{
 const x=auditOutcomeClaims({policy,events:[],claims:[
   claim('C1'),claim('C1'),claim('C2','nonbillable','1'),claim('C3','human_success','100')
 ]});
 assert.equal(x.summary.review,4);
 assert.ok(x.findings[0].reasons.includes('DUPLICATE_CONTACT_BILLED'));
 assert.ok(x.findings[2].reasons.includes('NONBILLABLE_AMOUNT_NONZERO'));
 assert.ok(x.findings[3].reasons.includes('INDEPENDENT_HUMAN_RESOLUTION_MISSING'));
});
test('source independence, unknown PII fields and duplicate evidence fail closed',()=>{
 assert.throws(()=>auditOutcomeClaims({events:[],claims:[claim('C1')],policy:{...policy,independentSources:['CCI_VENDOR']}}),/NOT_INDEPENDENT/);
 assert.throws(()=>auditOutcomeClaims({policy,claims:[claim('C1')],events:[{...ev('a','C1','ai_attempt'),transcript:'sensitive'}]}),/UNEXPECTED_FIELD/);
 assert.throws(()=>auditOutcomeClaims({policy,claims:[claim('C1')],events:[ev('a','C1','ai_attempt'),ev('a','C1','ai_resolved','VA_CONTROLLED')]}),/DUPLICATE_ID/);
});
