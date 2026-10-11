// MIT. Original Payouts-v1 snapshot comparison; never initiates a payout.
// Calls the existing DisburseLens reconciler on EACH complete source snapshot.
import {createHash} from 'node:crypto';
import {reconcile} from '../src/reconcile.mjs';

const SCHEMA='disburselens-payout-snapshot/v1';
const SOURCE_TYPES=new Set(['PayPal sandbox read-only API','fictional example']);
const UNPAID=new Set(['FAILED','RETURNED','BLOCKED','DENIED','REFUNDED','REVERSED']);
const REGRESSION=new Set(['REFUNDED','REVERSED']);
const SAFE_HOURS=720;
function sha(value){return createHash('sha256').update(value).digest('hex');}
function fail(message){throw new Error(message);}
function timestamp(value,label){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||
      new Date(value).toISOString()!==value)fail('Invalid '+label+' ISO timestamp');
  return Date.parse(value);
}
function rawIndex(pages){
  const index=new Map();
  for(const page of pages){
    for(const item of page.items){
      const id=item.payout_item_id;
      if(typeof id!=='string'||!id)fail('Original payout_item_id is required for longitudinal tracking');
      if(index.has(id))fail('Duplicate original payout_item_id');
      index.set(id,{
        recipientHash:sha(String(item.payout_item?.receiver??'')),
        noteHash:sha(String(item.payout_item?.note??''))
      });
    }
  }
  return index;
}
export function validateSnapshot(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).sort().join(',')!=='capturedAt,pages,schema,source'||
      input.schema!==SCHEMA||!SOURCE_TYPES.has(input.source)||
      !Array.isArray(input.pages)||input.pages.length<1||input.pages.length>10){
    fail('Invalid DisburseLens source snapshot envelope');
  }
  timestamp(input.capturedAt,'capturedAt');
  const report=reconcile(input.pages,{source:input.source,now:input.capturedAt});
  return {envelope:input,report,raw:rawIndex(input.pages)};
}
function add(flags,code){if(!flags.includes(code))flags.push(code);}
function severity(flags){
  const high=new Set(['ORIGINAL_PAYOUT_REGRESSION','UNEXPECTED_FAILED_TO_SUCCESS',
    'SOURCE_AMOUNT_DRIFT','SOURCE_RECIPIENT_DRIFT','SOURCE_SENDER_ID_DRIFT',
    'POST_PAYOUT_REVERSAL','ORIGINAL_ITEM_REMOVED','FAILED_OR_RETURNED',
    'DUPLICATE_SENDER_ITEM_ID']);
  if(flags.some(flag=>high.has(flag)))return 'high';
  return flags.length?'review':'clear';
}
function compareRow(before,after,beforeRaw,afterRaw,elapsedHours,staleHours){
  const a=before||null,b=after||null;
  const flags=[];
  if(!a)add(flags,'ORIGINAL_ITEM_ADDED');
  if(!b)add(flags,'ORIGINAL_ITEM_REMOVED');
  if(b)for(const flag of b.flags)add(flags,flag);
  if(a&&b){
    if(a.amount!==b.amount||a.currency!==b.currency)add(flags,'SOURCE_AMOUNT_DRIFT');
    if(a.senderItemId!==b.senderItemId)add(flags,'SOURCE_SENDER_ID_DRIFT');
    if(beforeRaw.recipientHash!==afterRaw.recipientHash)add(flags,'SOURCE_RECIPIENT_DRIFT');
    if(beforeRaw.noteHash!==afterRaw.noteHash)add(flags,'SOURCE_NOTE_DRIFT');
    if(a.status==='SUCCESS'&&b.status!=='SUCCESS')add(flags,'ORIGINAL_PAYOUT_REGRESSION');
    if(UNPAID.has(a.status)&&b.status==='SUCCESS')add(flags,'UNEXPECTED_FAILED_TO_SUCCESS');
    if(REGRESSION.has(b.status))add(flags,'POST_PAYOUT_REVERSAL');
    if(a.status===b.status&&!['SUCCESS',...UNPAID].includes(b.status)&&
        elapsedHours>=staleHours)add(flags,'UNRESOLVED_STALLED');
  }
  return {
    caseId:b?.caseId??a.caseId,
    itemId:b?.itemId??a.itemId,
    senderItemId:b?.senderItemId??a.senderItemId,
    receiverMasked:b?.receiver??a.receiver,
    currency:b?.currency??a.currency,
    amount:b?.amount??a.amount,
    beforeStatus:a?.status??null,
    afterStatus:b?.status??null,
    statusChanged:a?.status!==b?.status,
    textReviewScore:b?.signals.reviewProbability??null,
    severity:severity(flags),
    flags,
  };
}
export function analyzeSnapshots({before,after,staleHours=24}){
  if(!Number.isSafeInteger(staleHours)||staleHours<1||staleHours>SAFE_HOURS){
    fail('staleHours must be an integer from 1 to 720');
  }
  const first=validateSnapshot(before),current=validateSnapshot(after);
  if(first.report.id!==current.report.id)fail('Snapshots refer to different original PayPal payout batch IDs');
  if(first.envelope.source!==current.envelope.source)fail('Cannot mix sandbox source and fictional example');
  const start=timestamp(before.capturedAt,'baseline'),end=timestamp(after.capturedAt,'followup');
  if(end<=start)fail('Followup capture must be after baseline capture');
  const baseline=new Map(first.report.items.map(row=>[row.itemId,row]));
  const followup=new Map(current.report.items.map(row=>[row.itemId,row]));
  const ids=[...new Set([...baseline.keys(),...followup.keys()])].sort();
  const deltaHours=(end-start)/3600000;
  const rows=ids.map(id=>compareRow(baseline.get(id),followup.get(id),
    first.raw.get(id),current.raw.get(id),deltaHours,staleHours));
  const counts={total:rows.length,high:0,review:0,clear:0,statusChanged:0,
    added:0,removed:0,stalled:0};
  for(const row of rows){
    counts[row.severity]++;
    if(row.statusChanged)counts.statusChanged++;
    if(row.flags.includes('ORIGINAL_ITEM_ADDED'))counts.added++;
    if(row.flags.includes('ORIGINAL_ITEM_REMOVED'))counts.removed++;
    if(row.flags.includes('UNRESOLVED_STALLED'))counts.stalled++;
  }
  const batchFlags=[];
  if(first.report.totals.currency!==current.report.totals.currency||
      first.report.totals.declaredBatch!==current.report.totals.declaredBatch){
    batchFlags.push('BATCH_AMOUNT_OR_CURRENCY_CHANGED');
  }
  if(first.report.totals.match!==true||current.report.totals.match!==true){
    batchFlags.push('BATCH_AGGREGATE_UNCONFIRMED');
  }
  if(counts.added||counts.removed)batchFlags.push('SOURCE_ITEM_SET_CHANGED');
  return {
    schema:'disburselens-payout-lifecycle/v1',
    source:after.source,
    batchId:first.report.id,
    baselineAt:before.capturedAt,
    followupAt:after.capturedAt,
    elapsedHours:Number(deltaHours.toFixed(3)),
    staleHours,
    originalEvidence:{
      baseline:first.report.evidenceHash,
      followup:current.report.evidenceHash,
    },
    originalBatch:{
      baselineStatus:first.report.status,
      followupStatus:current.report.status,
      baselineCount:first.report.totals.count,
      followupCount:current.report.totals.count,
      baselineAggregate:first.report.totals,
      followupAggregate:current.report.totals
    },
    batchFlags,
    counts,
    rows,
    limitations:[
      'Each original page set is independently reconciled by the unchanged DisburseLens source; the two captures are observations, not one atomic PayPal snapshot.',
      'SUCCESS is an observed PayPal payout status, not independent bank settlement verification.',
      'Machine-learned note scores are advisory and do not establish fraud, payment success or reviewer action.',
      'Capture source labels and hashes do not authenticate PayPal signatures; keep original private captures for audit.',
      ...(after.source==='fictional example'?['All source payout entries are the ORIGINAL fictional DisburseLens example, not live provider transactions.']:[])
    ]
  };
}
