// MIT. Validate complete merchant condition totals with bounded original order detail.
import {createHash} from 'node:crypto';
export const X402_SUMMARY_SCHEMA='stellar-forge.x402api-merchant-observation-summary.v1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATES=new Set(['CREATED','CHARGE_UNCERTAIN','CHARGE_REJECTED','AWAITING_PAYMENT','PAYMENT_PENDING','PAYMENT_UNCERTAIN',
  'PAYMENT_FAILED','SETTLEMENT_CONFIRMED','FULFILLMENT_PENDING','FULFILLMENT_INTERRUPTED','COMPLETE']);
const COUNTS=['orders','receiptVerified','unresolved','receiptOutputPending','recordedResultComplete','resultProjectionPending',
  'fulfillmentInterrupted','contradictions','authorityRejected','authorityRejectionRecords','providerExchanges',
  'incompleteProviderExchanges','pendingWebhooks'];
const FLAGS=['receiptVerified','unresolved','recordedResultComplete','resultProjectionPending','receiptOutputPending',
  'fulfillmentInterrupted','contradiction','authorityRejected'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const text=v=>typeof v==='string'&&Buffer.byteLength(v)<=8192&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const need=(v,code='SF93_X402_SUMMARY_INVALID')=>{if(!v)throw Object.assign(new TypeError(code),{code});};
const boundary=(v,nullable=false)=>v===null?nullable:plain(v)&&count(v.sequence)&&v.sequence>0&&
  (HASH.test(v.sourceSha256??'')||(nullable&&v.sourceSha256===null));
function checkAge(v,requests,at) {
  need(plain(v)&&v.requests===requests&&count(v.unknown)&&v.unknown<=requests);
  if(requests===0)need(v.oldestSince===null&&v.oldestPendingSeconds===0);
  else if(v.unknown===requests)need(v.oldestSince===null&&v.oldestPendingSeconds===null);
  else {
    need(instant(v.oldestSince)&&Date.parse(v.oldestSince)<=at+5000&&count(v.oldestPendingSeconds));
    need(v.oldestPendingSeconds===Math.max(0,Math.floor((at-Date.parse(v.oldestSince))/1000)));
  }
}
export function validateX402Summary(v) {
  need(plain(v)&&v.schema===X402_SUMMARY_SCHEMA&&v.authority==='ORIGINAL_MERCHANT_OWNER_READ_ONLY'&&
    v.coverage==='COMPLETE'&&v.projection==='COMPLETE_CONDITIONS_WITH_BOUNDED_ORDER_DETAILS');
  need(['storeId','runtimeId','tenantId','resourceVersionId'].every(k=>UUID.test(v[k]??''))&&
    HASH.test(v.configurationSha256??'')&&['storeCreatedAt','runtimeOpenedAt','startedAt','capturedAt'].every(k=>instant(v[k]))&&
    v.startedAt<=v.capturedAt);
  const {snapshotSha256,...original}=v;
  need(HASH.test(snapshotSha256??'')&&sha(JSON.stringify(original))===snapshotSha256,'SF93_X402_SUMMARY_CHANGED');
  need(plain(v.counts)&&COUNTS.every(k=>count(v.counts[k])));
  for(const key of COUNTS.slice(1,9))need(v.counts[key]<=v.counts.orders);
  need(v.counts.incompleteProviderExchanges<=v.counts.providerExchanges&&
    v.counts.resultProjectionPending<=v.counts.recordedResultComplete&&
    v.counts.receiptOutputPending<=v.counts.receiptVerified);
  need((v.historyBoundary===null||boundary(v.historyBoundary))&&boundary(v.continuity,true));
  const prefixes=value=>plain(value)&&['history','exchanges'].every(group=>plain(value[group])&&count(value[group].rows)&&HASH.test(value[group].sha256??''));
  need(prefixes(v.immutablePrefixes)&&(v.prefixContinuity===null||prefixes(v.prefixContinuity)));
  need(v.immutablePrefixes.history.rows>=v.counts.orders&&v.immutablePrefixes.exchanges.rows===v.counts.providerExchanges);
  need(plain(v.ages));checkAge(v.ages.unresolved,v.counts.unresolved,Date.parse(v.capturedAt));
  checkAge(v.ages.receiptOutputPending,v.counts.receiptOutputPending,Date.parse(v.capturedAt));
  need(plain(v.details)&&v.details.limit===1024&&count(v.details.matchingOrders)&&
    count(v.details.returnedOrders)&&count(v.details.omittedOrders)&&
    v.details.matchingOrders<=v.counts.orders&&v.details.returnedOrders<=v.details.limit&&
    v.details.returnedOrders+v.details.omittedOrders===v.details.matchingOrders&&
    Array.isArray(v.orders)&&v.orders.length===v.details.returnedOrders);
  const ids=new Set();
  for(const r of v.orders) {
    need(plain(r)&&UUID.test(r.id??'')&&!ids.has(r.id)&&STATES.has(r.state)&&text(r.reference)&&text(r.title)&&
      (r.paymentId===null||UUID.test(r.paymentId))&&FLAGS.every(k=>typeof r[k]==='boolean')&&
      plain(r.source)&&UUID.test(r.source.tenantId??'')&&UUID.test(r.source.resourceVersionId??''));
    need([r.receiptVerifiedAt,r.unresolvedSince].every(t=>t===null||instant(t))&&
      [r.unresolvedAgeSeconds,r.receiptOutputAgeSeconds].every(n=>n===null||count(n))&&
      (r.fulfillmentState===null||['CLAIMED','RUNNING','INTERRUPTED','RETURNED','COMPLETE'].includes(r.fulfillmentState)));
    need(r.unresolved||r.receiptOutputPending||r.fulfillmentInterrupted||r.contradiction||r.authorityRejected||r.resultProjectionPending);
    ids.add(r.id);
  }
  need(v.counts.orders===0||v.historyBoundary!==null);
  for(const [flag,key] of [['receiptVerified','receiptVerified'],['unresolved','unresolved'],
    ['recordedResultComplete','recordedResultComplete'],['resultProjectionPending','resultProjectionPending'],
    ['receiptOutputPending','receiptOutputPending'],['fulfillmentInterrupted','fulfillmentInterrupted'],
    ['contradiction','contradictions'],['authorityRejected','authorityRejected']])
    need(v.orders.filter(r=>r[flag]).length<=v.counts[key]);
  for(const [flag,ageKey] of [['unresolved','unresolvedAgeSeconds'],['receiptOutputPending','receiptOutputAgeSeconds']]) {
    const rows=v.orders.filter(r=>r[flag]),group=v.ages[flag];
    need(rows.filter(r=>r[ageKey]===null).length<=group.unknown);
    need(rows.every(r=>r[ageKey]===null||group.oldestPendingSeconds!==null&&r[ageKey]<=group.oldestPendingSeconds));
  }
  if(v.binding!==undefined) {
    const b=v.binding;
    need(plain(b)&&['reviewed-file-inputs','configuration-file','programmatic-config'].includes(b.kind)&&
      (b.inputsSha256===null||HASH.test(b.inputsSha256??''))&&
      (b.configFileSha256===null||HASH.test(b.configFileSha256??''))&&HASH.test(b.bindingSha256??''));
    const selected={storeId:v.storeId,tenantId:v.tenantId,resourceVersionId:v.resourceVersionId,
      configurationSha256:v.configurationSha256,kind:b.kind,inputsSha256:b.inputsSha256,configFileSha256:b.configFileSha256};
    need(Object.entries(selected).every(([key,value])=>b[key]===value)&&sha(JSON.stringify(selected))===b.bindingSha256);
  }
  return v;
}
export function analyzeX402Summary(meta,value) {
  const v=validateX402Summary(value),selection=meta.selection;
  const bound=['storeId','tenantId','resourceVersionId','configurationSha256'].every(k=>selection[k]===v[k])&&
    (selection.inputsSha256===undefined||selection.inputsSha256===v.binding?.inputsSha256);
  const within=Date.parse(v.startedAt)>=Date.parse(meta.startedAt)-5000&&Date.parse(v.capturedAt)<=Date.parse(meta.generatedAt)+5000;
  const age=a=>({...a,oldestPendingSeconds:a.oldestSince===null?a.oldestPendingSeconds:
    Math.max(0,Math.floor((Date.parse(meta.generatedAt)-Date.parse(a.oldestSince))/1000))});
  const rows=v.orders.map(r=>({...r,
    unresolvedAgeSeconds:r.unresolved&&r.unresolvedSince!==null&&r.unresolvedAgeSeconds!==null?
      Math.max(0,Math.floor((Date.parse(meta.generatedAt)-Date.parse(r.unresolvedSince))/1000)):r.unresolvedAgeSeconds,
    receiptOutputAgeSeconds:r.receiptOutputPending&&r.receiptVerifiedAt!==null&&r.receiptOutputAgeSeconds!==null?
      Math.max(0,Math.floor((Date.parse(meta.generatedAt)-Date.parse(r.receiptVerifiedAt))/1000)):r.receiptOutputAgeSeconds}));
  return {coverage:!bound?'IDENTITY_CHANGED':!within?'CLOCK_INVALID':meta.errorCode?'UNAVAILABLE':'COMPLETE',
    identityMatches:bound,runtimeId:v.runtimeId,storeCreatedAt:v.storeCreatedAt,sourceCapturedAt:v.capturedAt,
    snapshotSha256:v.snapshotSha256,historyBoundary:v.historyBoundary,counts:{...v.counts},orders:rows,
    authority:'STORED_ORIGINAL_RECEIPT_VERIFICATION; NO_NEW_LEDGER_OR_OUTPUT_BYTE_VERIFICATION',
    projection:v.projection,details:{...v.details},ages:{unresolved:age(v.ages.unresolved),receiptOutputPending:age(v.ages.receiptOutputPending)},
    continuity:v.continuity,immutablePrefixes:structuredClone(v.immutablePrefixes),prefixContinuity:structuredClone(v.prefixContinuity),binding:v.binding===undefined?null:{...v.binding}};
}
export function x402SummaryConditionSignals(summary,selection,complete) {
  const aged=(key,threshold)=>{
    const row=summary.ages[key],positive=row.oldestPendingSeconds!==null&&row.oldestPendingSeconds>=threshold;
    return {bad:!complete?null:positive?true:row.unknown?null:false,
      values:{requests:row.requests,oldestPendingSeconds:row.oldestPendingSeconds??0,thresholdSeconds:threshold}};
  };
  const condition=key=>({bad:complete?summary.counts[key]>0:null,values:{requests:summary.counts[key]},openAfter:1});
  return {
    X402_PAYMENT_UNRESOLVED:aged('unresolved',selection.paymentAfterSeconds),
    X402_VERIFIED_RECEIPT_OUTPUT_PENDING:aged('receiptOutputPending',selection.outputAfterSeconds),
    X402_FULFILLMENT_INTERRUPTED:condition('fulfillmentInterrupted'),
    X402_RESULT_CONTRADICTION:condition('contradictions'),
    X402_AUTHORITY_REJECTED:condition('authorityRejected')};
}
