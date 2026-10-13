// MIT. Complete x402api source projection carried by the original SF93 capture store.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {X402_SUMMARY_SCHEMA,validateX402Summary,analyzeX402Summary,x402SummaryConditionSignals} from './x402-summary.mjs';
export const X402_FILES=['x402-observation.json','x402-source.json'];
export const X402_FILE_LIMIT=8*1024*1024;
export const X402_KINDS=['X402_SOURCE_UNAVAILABLE','X402_IDENTITY_CHANGED','X402_PAYMENT_UNRESOLVED',
  'X402_VERIFIED_RECEIPT_OUTPUT_PENDING','X402_FULFILLMENT_INTERRUPTED','X402_RESULT_CONTRADICTION','X402_AUTHORITY_REJECTED'];
const SCHEMA='stellar-forge.sf93.x402-observation.v1',SOURCE='stellar-forge.x402api-merchant-observation.v1';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CODE=/^[A-Za-z0-9_.:-]{1,120}$/,ID=/^[A-Za-z0-9_-]{1,64}$/;
const STATES=new Set(['CREATED','CHARGE_UNCERTAIN','CHARGE_REJECTED','AWAITING_PAYMENT','PAYMENT_PENDING','PAYMENT_UNCERTAIN',
  'PAYMENT_FAILED','SETTLEMENT_CONFIRMED','FULFILLMENT_PENDING','FULFILLMENT_INTERRUPTED','COMPLETE']);
const AUTHORITY=new Set(['EVENT_ORDER_BINDING_MISMATCH','EVENT_PAYMENT_BINDING_MISMATCH',
 'WEBHOOK_ADVERTISED_ALTERNATIVE_MISMATCH','WEBHOOK_FROZEN_RAIL_MISMATCH',
 'X402API_RECEIPT_SIGNATURE_INVALID','X402API_KEY_VERSION_NOT_CONFIGURED','X402API_DIGEST_MISMATCH','X402API_BINDING_MISMATCH']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const bytes=v=>Buffer.from(JSON.stringify(v)+'\n');
const fail=code=>{throw Object.assign(new TypeError(code),{code});};
const need=(v,c='SF93_X402_CAPTURE_INVALID')=>{if(!v)fail(c);};
const fields=(v,n)=>{need(plain(v)&&Object.keys(v).every(k=>n.includes(k)));return v;};
const count=v=>Number.isSafeInteger(v)&&v>=0;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const text=(v,max,p)=>{need(typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=max&&!/[\x00-\x1f\x7f]/.test(v)&&(!p||p.test(v)));return v;};
const integer=(v,min,max)=>{need(Number.isSafeInteger(v)&&v>=min&&v<=max,'SF93_X402_CONFIG_INVALID');return v;};
export function x402Endpoint(value) {
  text(value,256);let u;try{u=new URL(value);}catch{fail('SF93_X402_ENDPOINT_INVALID');}
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^[1-9][0-9]*$/.test(u.port)&&Number(u.port)<=65535&&
    u.pathname==='/api/observation'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.href===value,
    'SF93_X402_FIXED_LOOPBACK_ENDPOINT_REQUIRED');
  return value;
}
export function normalizeX402Source(v) {
  fields(v,['endpoint','tokenEnv','storeId','tenantId','resourceVersionId','configurationSha256','timeoutMs','paymentAfterSeconds','outputAfterSeconds','polling','inputsSha256']);
  const result={endpoint:x402Endpoint(v.endpoint),tokenEnv:text(v.tokenEnv,128,/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    storeId:text(v.storeId,36,UUID),tenantId:text(v.tenantId,36,UUID),resourceVersionId:text(v.resourceVersionId,36,UUID),
    configurationSha256:text(v.configurationSha256,64,HASH),timeoutMs:integer(v.timeoutMs??5000,100,30000),
    paymentAfterSeconds:integer(v.paymentAfterSeconds??300,1,31536000),
    outputAfterSeconds:integer(v.outputAfterSeconds??300,1,31536000)};
  if(v.polling!==undefined){need(v.polling==='summary','SF93_X402_CONFIG_INVALID');result.polling='summary';}
  if(v.inputsSha256!==undefined){need(v.polling==='summary','SF93_X402_CONFIG_INVALID');result.inputsSha256=text(v.inputsSha256,64,HASH);}
  return result;
}
export const x402SourceKey=v=>{const selected=normalizeX402Source(v);return JSON.stringify({
  ...Object.fromEntries(['endpoint','tokenEnv','storeId','tenantId','resourceVersionId','configurationSha256'].map(k=>[k,selected[k]])),
  ...(selected.inputsSha256===undefined?{}:{inputsSha256:selected.inputsSha256})});};
function file(v) {
  if(v===null)return;
  need(plain(v)&&count(v.bytes)&&HASH.test(v.sha256??'')&&typeof v.fileName==='string'&&typeof v.contentType==='string');
}
export function validateX402Source(v) {
  need(plain(v)&&v.schema===SOURCE&&v.authority==='ORIGINAL_MERCHANT_OWNER_READ_ONLY'&&v.coverage==='COMPLETE'&&
    UUID.test(v.storeId??'')&&UUID.test(v.runtimeId??'')&&UUID.test(v.tenantId??'')&&UUID.test(v.resourceVersionId??'')&&
    HASH.test(v.configurationSha256??'')&&instant(v.storeCreatedAt)&&instant(v.runtimeOpenedAt)&&
    instant(v.startedAt)&&instant(v.capturedAt)&&v.startedAt<=v.capturedAt&&plain(v.counts));
  const {snapshotSha256,...original}=v;need(HASH.test(snapshotSha256??'')&&sha(JSON.stringify(original))===snapshotSha256,'SF93_X402_SNAPSHOT_CHANGED');
  const groups=['orders','history','exchanges','events','fulfillments'];
  need(groups.every(k=>Array.isArray(v[k])&&v[k].length===v.counts[k])&&groups.reduce((n,k)=>n+v[k].length,0)<=100000);
  const orders=new Map(),histories=new Map(),exchanges=new Map(),fulfillments=new Map(),events=new Set();
  for(const r of v.orders) {
    need(plain(r)&&UUID.test(r.id??'')&&!orders.has(r.id)&&STATES.has(r.state)&&instant(r.createdAt)&&instant(r.updatedAt)&&
      typeof r.reference==='string'&&typeof r.title==='string'&&UUID.test(r.tenantId??'')&&UUID.test(r.resourceVersionId??'')&&
      typeof r.signatureRetained==='boolean'&&Array.isArray(r.rails)&&r.rails.length>=1&&r.rails.length<=16&&
      plain(r.source)&&['frozenSha256','dataSha256','identitySha256'].every(k=>HASH.test(r.source[k]??''))&&
      plain(r.chargeRequest)&&count(r.chargeRequest.bytes)&&HASH.test(r.chargeRequest.sha256??''));
    need(r.paymentId===null||UUID.test(r.paymentId));
    if(r.receiptVerification!==null)need(plain(r.receiptVerification)&&/^sha256:[a-f0-9]{64}$/.test(r.receiptVerification.receiptDigest??'')&&
      instant(r.receiptVerification.verifiedAt)&&typeof r.receiptVerification.signingKeyVersion==='string'&&
      typeof r.receiptVerification.pinSource==='string'&&typeof r.receiptVerification.deliveryId==='string');
    for(const rail of r.rails)need(plain(rail)&&typeof rail.network==='string'&&typeof rail.asset==='string'&&
      typeof rail.recipient==='string'&&/^[1-9][0-9]{0,77}$/.test(rail.amountAtomic??''));
    orders.set(r.id,r);histories.set(r.id,[]);
  }
  let seq=0;
  for(const r of v.history) {
    need(plain(r)&&count(r.sequence)&&r.sequence>seq&&orders.has(r.orderId)&&typeof r.kind==='string'&&instant(r.at)&&
      (r.state===null||STATES.has(r.state))&&typeof r.receiptVerified==='boolean'&&HASH.test(r.sourceSha256??''));
    seq=r.sequence;histories.get(r.orderId).push(r);
  }
  seq=0;
  for(const r of v.exchanges){
    need(plain(r)&&count(r.sequence)&&r.sequence>seq&&orders.has(r.orderId)&&typeof r.kind==='string'&&
      (r.status===null||Number.isInteger(r.status)&&r.status>=100&&r.status<=599)&&typeof r.responseComplete==='boolean'&&instant(r.at)&&
      (r.bytes===null&&r.sha256===null||count(r.bytes)&&HASH.test(r.sha256??'')));
    exchanges.set(r.sequence,r);seq=r.sequence;
  }
  for(const r of v.history)if(r.exchangeId!==null)need(exchanges.get(r.exchangeId)?.orderId===r.orderId);
  for(const r of v.events){need(plain(r)&&typeof r.deliveryId==='string'&&!events.has(r.deliveryId)&&
    (r.orderId===null||orders.has(r.orderId))&&['PENDING','COMPLETE','REJECTED'].includes(r.state)&&
    instant(r.createdAt)&&instant(r.updatedAt)&&count(r.bytes)&&HASH.test(r.sha256??''));events.add(r.deliveryId);}
  for(const r of v.fulfillments){
    need(plain(r)&&UUID.test(r.paymentId??'')&&orders.has(r.orderId)&&!fulfillments.has(r.orderId)&&
      ['CLAIMED','RUNNING','INTERRUPTED','RETURNED','COMPLETE'].includes(r.state)&&count(r.attempt)&&instant(r.createdAt)&&instant(r.updatedAt));
    file(r.returned);file(r.result);fulfillments.set(r.orderId,r);
  }
  for(const r of v.orders){const h=histories.get(r.id);need(h.length>0&&h[0].kind==='ORDER_CREATED');
    const last=h.filter(e=>e.state!==null).at(-1);need((last?.state??'CREATED')===r.state,'SF93_X402_HISTORY_DISAGREES');}
  return {value:v,orders,histories,fulfillments};
}
function age(date,now){return instant(date)&&Date.parse(date)<=now+5000?Math.max(0,Math.floor((now-Date.parse(date))/1000)):null;}
export function analyzeX402Observation(meta,value) {
  const selection=normalizeX402Source(meta.selection);
  need(instant(meta.startedAt)&&instant(meta.generatedAt)&&meta.startedAt<=meta.generatedAt&&(meta.errorCode===null||CODE.test(meta.errorCode)));
  if(meta.pollSource!==undefined)need(value!==null&&value.schema!==X402_SUMMARY_SCHEMA);
  if(value===null)return {coverage:meta.errorCode==='MERCHANT_OBSERVATION_WORKLOAD_LIMIT'?'WORKLOAD_LIMIT':'UNAVAILABLE',
    identityMatches:null,runtimeId:null,storeCreatedAt:null,sourceCapturedAt:null,counts:null,orders:[],authority:'NO_USABLE_NATIVE_OBSERVATION'};
  if(value.schema===X402_SUMMARY_SCHEMA)return analyzeX402Summary(meta,value);
  const {orders,histories,fulfillments}=validateX402Source(value);
  const poll=meta.pollSource?readPollSource(meta.pollSource):null;
  const pollMatches=!poll||['storeId','runtimeId','tenantId','resourceVersionId','configurationSha256'].every(k=>poll[k]===value[k])&&
    poll.capturedAt<=value.capturedAt&&Date.parse(meta.generatedAt)-Date.parse(poll.capturedAt)<=60000&&
    (!poll.historyBoundary||value.history.some(row=>row.sequence===poll.historyBoundary.sequence&&row.sourceSha256===poll.historyBoundary.sourceSha256))&&
    ['history','exchanges'].every(group=>value[group].length>=poll.immutablePrefixes[group].rows&&
      immutablePrefixHash(value[group].slice(0,poll.immutablePrefixes[group].rows))===poll.immutablePrefixes[group].sha256);
  const bound=['storeId','tenantId','resourceVersionId','configurationSha256'].every(k=>selection[k]===value[k])&&
    (selection.inputsSha256===undefined||selection.inputsSha256===poll?.binding?.inputsSha256);
  const within=Date.parse(value.startedAt)>=Date.parse(meta.startedAt)-5000&&Date.parse(value.capturedAt)<=Date.parse(meta.generatedAt)+5000;
  const rows=[],now=Date.parse(meta.generatedAt);
  const rejectedOrders=new Set(value.events.filter(e=>e.state==='REJECTED'&&AUTHORITY.has(e.code)).map(e=>e.orderId));
  for(const r of orders.values()){
    const h=histories.get(r.id),f=fulfillments.get(r.id)??null;
    const verified=r.receiptVerification!==null;
    const pending=!['CREATED','AWAITING_PAYMENT','CHARGE_REJECTED','PAYMENT_FAILED','COMPLETE'].includes(r.state)||
      r.signatureRetained&&!verified&&!['CHARGE_REJECTED','PAYMENT_FAILED','COMPLETE'].includes(r.state);
    const unresolved=pending&&!verified;
    let episode=null,seenState='CREATED',seenSignature=false,seenReceipt=false;
    for(const e of h) {
      if(e.state!==null)seenState=e.state;
      if(e.kind==='SIGNATURE_RETAINED')seenSignature=true;
      if(e.receiptVerified)seenReceipt=true;
      const active=!seenReceipt&&(!['CREATED','AWAITING_PAYMENT','CHARGE_REJECTED','PAYMENT_FAILED','COMPLETE'].includes(seenState)||
        seenSignature&&!['CHARGE_REJECTED','PAYMENT_FAILED','COMPLETE'].includes(seenState));
      if(!active)episode=null;else if(episode===null)episode=e;
    }
    const first=episode;
    const receipt=h.find(e=>e.receiptVerified);
    const originalReceiptAt=receipt?.at??null;
    const resultComplete=f?.state==='COMPLETE'&&f.result!==null&&f.returned!==null;
    const contradict=(r.state==='COMPLETE'&&!resultComplete)||resultComplete&&
      (!verified||r.paymentId!==f.paymentId||f.result.bytes!==f.returned.bytes||f.result.sha256!==f.returned.sha256);
    rows.push({id:r.id,reference:r.reference,title:r.title,state:r.state,paymentId:r.paymentId,
      receiptVerified:verified,receiptVerifiedAt:originalReceiptAt,unresolved,unresolvedSince:unresolved?first?.at??null:null,
      unresolvedAgeSeconds:unresolved?age(first?.at,now):0,
      recordedResultComplete:resultComplete,resultProjectionPending:resultComplete&&r.state!=='COMPLETE',
      receiptOutputPending:verified&&!resultComplete,receiptOutputAgeSeconds:verified&&!resultComplete?age(originalReceiptAt,now):0,
      fulfillmentState:f?.state??null,fulfillmentInterrupted:f?.state==='INTERRUPTED',
      contradiction:contradict,authorityRejected:AUTHORITY.has(r.lastError)||!verified&&rejectedOrders.has(r.id)});
  }
  const n=predicate=>rows.filter(predicate).length;
  return {coverage:!bound?'IDENTITY_CHANGED':!within?'CLOCK_INVALID':!pollMatches?'POLL_SOURCE_CHANGED':meta.errorCode?'UNAVAILABLE':'COMPLETE',
    identityMatches:bound,runtimeId:value.runtimeId,storeCreatedAt:value.storeCreatedAt,sourceCapturedAt:value.capturedAt,
    snapshotSha256:value.snapshotSha256,historyBoundary:value.history.length?{sequence:value.history.at(-1).sequence,sourceSha256:value.history.at(-1).sourceSha256}:null,counts:{orders:rows.length,receiptVerified:n(r=>r.receiptVerified),
      unresolved:n(r=>r.unresolved),receiptOutputPending:n(r=>r.receiptOutputPending),
      recordedResultComplete:n(r=>r.recordedResultComplete),resultProjectionPending:n(r=>r.resultProjectionPending),
      fulfillmentInterrupted:n(r=>r.fulfillmentInterrupted),contradictions:n(r=>r.contradiction),
      authorityRejected:n(r=>r.authorityRejected),authorityRejectionRecords:value.events.filter(e=>e.state==='REJECTED'&&AUTHORITY.has(e.code)).length,providerExchanges:value.exchanges.length,
      incompleteProviderExchanges:value.exchanges.filter(e=>!e.responseComplete).length,
      pendingWebhooks:value.events.filter(e=>e.state==='PENDING').length},
    orders:rows,authority:'STORED_ORIGINAL_RECEIPT_VERIFICATION; NO_NEW_LEDGER_OR_OUTPUT_BYTE_VERIFICATION',
    ...(poll?{polling:{sourceCapturedAt:poll.capturedAt,snapshotSha256:poll.snapshotSha256,binding:poll.binding??null,
      sourceBytes:meta.pollSource.bytes,sourceSha256:meta.pollSource.sha256}}:{})};
}
function readPollSource(record) {
  fields(record,['bytes','sha256','contentBase64']);
  need(count(record.bytes)&&record.bytes<=2*1024*1024&&HASH.test(record.sha256??'')&&typeof record.contentBase64==='string');
  const raw=Buffer.from(record.contentBase64,'base64');
  need(raw.length===record.bytes&&raw.toString('base64')===record.contentBase64&&sha(raw)===record.sha256,'SF93_X402_POLL_SOURCE_CHANGED');
  return validateX402Summary(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
}
export function createX402Observation({registration,selection,startedAt,generatedAt,sourceBytes=null,errorCode=null,fullCaptureError=null,pollSourceBytes=null}) {
  fields(registration,['id','label']);text(registration.id,64,ID);text(registration.label,120);
  const raw=sourceBytes??bytes(null);need(Buffer.isBuffer(raw)&&raw.length<=X402_FILE_LIMIT);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('SF93_X402_SOURCE_JSON_INVALID');}
  const meta={schema:SCHEMA,registration,selection:normalizeX402Source(selection),startedAt,generatedAt,errorCode,
    source:{bytes:raw.length,sha256:sha(raw)}};
  if(fullCaptureError!==null){need(CODE.test(fullCaptureError));meta.fullCaptureError=fullCaptureError;}
  if(pollSourceBytes!==null){need(Buffer.isBuffer(pollSourceBytes));meta.pollSource={bytes:pollSourceBytes.length,
    sha256:sha(pollSourceBytes),contentBase64:pollSourceBytes.toString('base64')};readPollSource(meta.pollSource);}
  meta.summary=analyzeX402Observation(meta,value);
  const encoded=bytes(meta);need(encoded.length<=X402_FILE_LIMIT,'SF93_X402_CAPTURE_SIZE_LIMIT');
  return {kind:'X402_MERCHANT',x402:meta,files:{'x402-observation.json':encoded,'x402-source.json':raw},
    report:{generatedAt,observation:{sessionId:meta.selection.storeId}}};
}
export function readX402ObservationFiles(files) {
  need(plain(files)&&Object.keys(files).length===2&&X402_FILES.every(n=>Buffer.isBuffer(files[n])&&files[n].length>0&&files[n].length<=X402_FILE_LIMIT));
  const read=n=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files[n]));
  const meta=read(X402_FILES[0]),source=read(X402_FILES[1]);
  fields(meta,['schema','registration','selection','startedAt','generatedAt','errorCode','source','summary','fullCaptureError','pollSource']);
  need(meta.schema===SCHEMA&&meta.source.bytes===files[X402_FILES[1]].length&&meta.source.sha256===sha(files[X402_FILES[1]]));
  fields(meta.registration,['id','label']);text(meta.registration.id,64,ID);text(meta.registration.label,120);
  if(meta.fullCaptureError!==undefined)need(CODE.test(meta.fullCaptureError));
  const summary=analyzeX402Observation(meta,source);need(isDeepStrictEqual(summary,meta.summary),'SF93_X402_SUMMARY_CHANGED');
  return {meta,source,summary};
}
// Stable JSON preserves every immutable descriptor field across a later capture.
export function immutablePrefixHash(value) {
  const canonical=v=>Array.isArray(v)?v.map(canonical):plain(v)?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return sha(JSON.stringify(canonical(value)));
}
export function x402ObservationSignals(merchant,observation,now,previous=null) {
  const packet=observation.packet,meta=packet?.x402;
  if(!meta)return {error:observation.error??'X402_SOURCE_UNAVAILABLE',signals:{X402_SOURCE_UNAVAILABLE:{bad:true,values:{}}}};
  need(isDeepStrictEqual(meta.selection,merchant.x402)&&meta.registration.id===merchant.id&&meta.registration.label===merchant.label);
  const s=meta.summary,at=Date.parse(meta.generatedAt);
  const fresh=at<=now+5000&&now-at<=30000&&(!previous||at>Date.parse(previous.capturedAt))&&
    (s.sourceCapturedAt===null||now-Date.parse(s.sourceCapturedAt)<=30000);
  const boundary=previous?.historyBoundary;
  const original=packet.files?.['x402-source.json'];
  const source=original?JSON.parse(original.toString('utf8')):null;
  const history=source?.history;
  const summarized=s.projection==='COMPLETE_CONDITIONS_WITH_BOUNDED_ORDER_DETAILS';
  // Older checkpoints retain one history row. Keep that original boundary and
  // add complete immutable-prefix witnesses only to the watcher checkpoint:
  // existing capture bytes/summaries and their v1 ABI remain unchanged.
  const legacyContinuity=!boundary||(summarized?s.continuity?.sequence===boundary.sequence&&s.continuity.sourceSha256===boundary.sourceSha256:
    Array.isArray(history)&&history.some(row=>row.sequence===boundary.sequence&&row.sourceSha256===boundary.sourceSha256));
  const prefixes=previous?.immutablePrefixes;
  const prefixContinuity=prefixes===undefined||plain(prefixes)&&
    ['history','exchanges'].every(group=>{
      const pin=prefixes[group],rows=source?.[group];
      if(summarized)return plain(pin)&&count(pin.rows)&&HASH.test(pin.sha256??'')&&
        source.prefixContinuity?.[group]?.rows===pin.rows&&source.prefixContinuity[group].sha256===pin.sha256;
      return plain(pin)&&count(pin.rows)&&HASH.test(pin.sha256??'')&&
        Array.isArray(rows)&&rows.length>=pin.rows&&
        immutablePrefixHash(rows.slice(0,pin.rows))===pin.sha256;
    });
  const continuity=legacyContinuity&&prefixContinuity&&(summarized||['history','exchanges'].every(group=>Array.isArray(source?.[group])));
  const complete=fresh&&continuity&&s.coverage==='COMPLETE',rows=s.orders;
  const aged=(key,ageKey,threshold)=>{const chosen=rows.filter(r=>r[key]),positive=chosen.some(r=>r[ageKey]!==null&&r[ageKey]>=threshold);
    return {bad:!complete?null:positive?true:chosen.some(r=>r[ageKey]===null)?null:false,
      values:{requests:chosen.length,oldestPendingSeconds:chosen.reduce((n,r)=>Math.max(n,r[ageKey]??0),0),thresholdSeconds:threshold}};};
  const condition=key=>({bad:complete?rows.some(r=>r[key]):null,values:{requests:rows.filter(r=>r[key]).length},openAfter:1});
  return {packet,fresh,successful:complete,error:complete?null:!fresh?'X402_SOURCE_CLOCK_OR_AGE_INVALID':!continuity?'X402_ORIGINAL_HISTORY_CHANGED':meta.errorCode??s.coverage,
    previous:{sessionId:meta.selection.storeId,startedAt:s.storeCreatedAt,capturedAt:meta.generatedAt,historyBoundary:s.historyBoundary??null,
      ...(complete?{immutablePrefixes:summarized?structuredClone(source.immutablePrefixes):Object.fromEntries(['history','exchanges'].map(group=>[group,
        {rows:source[group].length,sha256:immutablePrefixHash(source[group])}]))}:{})},
    window:{from:meta.startedAt,through:meta.generatedAt,complete,sessionStartedAt:s.storeCreatedAt},
    signals:{X402_SOURCE_UNAVAILABLE:{bad:s.identityMatches===false?null:!complete,values:{}},
      X402_IDENTITY_CHANGED:{bad:s.identityMatches===false?true:complete?false:null,values:{},openAfter:1},
      X402_PAYMENT_UNRESOLVED:aged('unresolved','unresolvedAgeSeconds',merchant.x402.paymentAfterSeconds),
      X402_VERIFIED_RECEIPT_OUTPUT_PENDING:aged('receiptOutputPending','receiptOutputAgeSeconds',merchant.x402.outputAfterSeconds),
      X402_FULFILLMENT_INTERRUPTED:condition('fulfillmentInterrupted'),
      X402_RESULT_CONTRADICTION:condition('contradiction'),
      X402_AUTHORITY_REJECTED:condition('authorityRejected'),
      ...(summarized?x402SummaryConditionSignals(s,merchant.x402,complete):{})}};
}
