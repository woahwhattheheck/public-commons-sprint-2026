import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSnapshots } from './audit.mjs';

const source = {
  cohort:'cutover-demo-01',
  records:[
    {id:'PERMIT-001',type:'permit',department:'Planning',status:'in_review',
      relatedIds:['INS-001'],reviewStates:{Fire:'approved',PublicWorks:'pending'},attachments:2,paymentMinor:'0'},
    {id:'INS-001',type:'inspection',department:'Fire',status:'scheduled',
      relatedIds:['PERMIT-001'],reviewStates:{},attachments:0},
    {id:'EVENT-001',type:'special_event',department:'CityManager',status:'reviewing',
      relatedIds:[],reviewStates:{Fire:'pending',PublicWorks:'approved'},attachments:4},
  ],
};
const copy = value => structuredClone(value);

test('same-cohort exact normalized cutover retains permit/inspection/event relations', () => {
  const result = auditSnapshots(source,copy(source));
  assert.equal(result.status,'RECONCILED_SNAPSHOT');
  assert.equal(result.totalFindings,0);
  assert.equal(result.sourceRecords,3);
  assert.equal(result.targetRecords,3);
});

test('source-exact anomalies produce bounded, ID-redacted reviewer evidence', () => {
  const target = copy(source);
  target.records[0].status = 'completed';
  target.records[0].relatedIds = ['INS-001','ORPHAN-12'];
  target.records[0].paymentMinor = '7000';
  target.records[2].reviewStates.Fire = 'approved';
  const result = auditSnapshots(source,target,{maxExamples:3});
  assert.equal(result.status,'HUMAN_REVIEW_REQUIRED');
  assert.equal(result.issues.STATUS_CHANGED,1);
  assert.equal(result.issues.LINKS_CHANGED,1);
  assert.equal(result.issues.PAYMENT_MINOR_CHANGED,1);
  assert.equal(result.issues.REVIEWS_CHANGED,1);
  assert.equal(result.issues.ORPHAN_TARGET_LINK,1);
  assert.equal(result.totalFindings,5);
  assert.equal(result.examples.length,3);
  assert.equal(result.examplesTruncated,true);
  assert.ok(result.examples.every(x => /^[a-f0-9]{16}$/.test(x.recordHash)));
  assert.ok(!JSON.stringify(result).includes('PERMIT-001'));
});

test('reject incomplete, duplicate or wrong-cohort evidence instead of certifying', () => {
  const wrong = copy(source);wrong.cohort='other-cutover';
  assert.throws(() => auditSnapshots(source,wrong),/cohort identifiers differ/);
  const dup = copy(source);dup.records.push(copy(dup.records[0]));
  assert.throws(() => auditSnapshots(source,dup),/duplicate record identifier/);
  const invalid=copy(source);delete invalid.records[0].attachments;
  assert.throws(() => auditSnapshots(source,invalid),/attachments must be/);
});
