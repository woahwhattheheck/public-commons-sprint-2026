// MIT. Complete original SF88 observations in the existing SF93 capture format.
// This codec performs no execution, finalization, network request or state write.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {isAbsolute,resolve} from 'node:path';

export const OBJECT_OBSERVATION_SCHEMA='stellar-forge.sf93.object-observation.v1';
export const OBJECT_ACCOUNTING_SCHEMA='stellar-forge.sf93.object-accounting-reads.v1';
export const OBJECT_FILES=['object-observation.json','object-report.json','object-accounting.json'];
export const OBJECT_FILE_LIMIT=2_000_000;
export const OBJECT_KINDS=['OBJECT_SOURCE_UNAVAILABLE','OBJECT_IDENTITY_CHANGED',
  'OBJECT_OUTPUT_INTEGRITY','OBJECT_FINANCIAL_UNRESOLVED','OBJECT_FINALIZED_OUTPUT_INCOMPLETE'];
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9_-]{1,64}$/,CODE=/^[A-Z0-9_]{1,120}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const IDENTITY=new Set(['OBJECT_SESSION_INVALID','OBJECT_CONFIGURATION_BINDING_CHANGED','OBJECT_CONFIG_PLAN_CHANGED',
  'OBJECT_CHUNK_CONFIG_CHANGED','OBJECT_NATIVE_QUEUE_PLAN_CHANGED','OBJECT_NATIVE_JOB_BINDING_CHANGED',
  'OBJECT_SAVED_WORKSPACE_MISMATCH','OBJECT_SYMLINK_DIRECTORY_REFUSED','OBJECT_OBSERVATION_BINDING_CHANGED']);
const INTEGRITY=new Set(['OBJECT_CHUNK_SHA256_MISMATCH','OBJECT_COMPLETE_SHA256_MISMATCH',
  'OBJECT_CONTENT_SHA256_MISMATCH','OBJECT_SNAPSHOT_MISMATCH','OBJECT_CONTENT_RANGE_MISMATCH',
  'OBJECT_TOTAL_BYTES_MISMATCH','OBJECT_NATIVE_EVIDENCE_MISMATCH','OBJECT_NATIVE_TERMS_MISMATCH',
  'OBJECT_NATIVE_RESERVATION_MISMATCH','OBJECT_NATIVE_FREE_RESERVATION_MISMATCH','OBJECT_CHUNK_LENGTH_MISMATCH']);
const UNSTABLE=new Set(['OBJECT_CHUNK_CHANGED_DURING_READ','OBJECT_ACCOUNTING_CHANGED_DURING_READ']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=b=>createHash('sha256').update(b).digest('hex');
const jsonBytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const fail=code=>{throw new TypeError(code);};
const need=(value,code='SF93_OBJECT_CAPTURE_INVALID')=>{if(!value)fail(code);};
const integer=(value,min,max,field)=>{need(Number.isSafeInteger(value)&&value>=min&&value<=max,'SF93_OBJECT_CONFIG_INVALID:'+field);return value;};
const string=(value,max,field,pattern)=>{need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=max&&
  Buffer.from(value).toString('utf8')===value&&!/[\x00-\x1f\x7f]/.test(value)&&(!pattern||pattern.test(value)),
  'SF93_OBJECT_CONFIG_INVALID:'+field);return value;};
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const count=v=>Number.isSafeInteger(v)&&v>=0;
const intent=(session,index)=>'object:'+session+':'+String(index).padStart(6,'0');
const fields=(value,allowed)=>{need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)));return value;};

export function normalizeObjectSource(value) {
  fields(value,['directory','sessionId','sessionSha256','configurationSha256','sourceIntentId','maxBytes','maxChunks',
    'timeoutMs','financialAfterSeconds','outputAfterSeconds']);
  const directory=string(value.directory,4096,'directory');
  need(isAbsolute(directory)&&resolve(directory)===directory,'SF93_OBJECT_CANONICAL_DIRECTORY_REQUIRED');
  return {directory,sessionId:string(value.sessionId,36,'sessionId',UUID),
    sessionSha256:string(value.sessionSha256,64,'sessionSha256',HASH),
    configurationSha256:string(value.configurationSha256,64,'configurationSha256',HASH),
    sourceIntentId:string(value.sourceIntentId,256,'sourceIntentId'),
    maxBytes:integer(value.maxBytes??1_073_741_824,0,Number.MAX_SAFE_INTEGER,'maxBytes'),
    maxChunks:integer(value.maxChunks??1000,1,100000,'maxChunks'),
    timeoutMs:integer(value.timeoutMs??30000,100,300000,'timeoutMs'),
    financialAfterSeconds:integer(value.financialAfterSeconds??300,1,31_536_000,'financialAfterSeconds'),
    outputAfterSeconds:integer(value.outputAfterSeconds??300,1,31_536_000,'outputAfterSeconds')};
}
function registration(value) {
  fields(value,['id','label']);
  return {id:string(value.id,64,'registration.id',ID),label:string(value.label,120,'registration.label')};
}
function readAccount(read) {
  if(read===null)return null;
  fields(read,['pages']);need(Array.isArray(read.pages)&&read.pages.length>0&&read.pages.length<=400);
  let position=0,first=null;const entries=[],stable=[];
  for(const page of read.pages) {
    need(plain(page)&&page.schema==='stellar-forge.sf88.session-accounting.v1'&&page.kind==='object'&&
      page.mode==='VIEW'&&page.interrupted===false&&instant(page.observedAt)&&plain(page.range)&&Array.isArray(page.entries));
    need(UUID.test(page.sessionId??'')&&HASH.test(page.sessionSha256??'')&&HASH.test(page.configurationSha256??'')&&typeof page.directory==='string');
    need(count(page.range.total)&&page.range.total>=1&&page.range.total<=100000&&page.range.offset===position&&
      Number.isSafeInteger(page.range.limit)&&page.range.limit>=1&&page.range.limit<=250&&
      page.entries.length===Math.min(page.range.limit,page.range.total-position));
    const binding={directory:page.directory,sessionId:page.sessionId,sessionSha256:page.sessionSha256,configurationSha256:page.configurationSha256,
      deliveryMode:page.deliveryMode,workspace:page.workspace,terms:page.terms,total:page.range.total,
      recordAuthority:page.recordAuthority};
    first??=binding;need(isDeepStrictEqual(first,binding));
    for(const entry of page.entries) {
      need(plain(entry)&&entry.index===position&&entry.intentId===intent(page.sessionId,position)&&
        typeof entry.outcome==='string'&&CODE.test(entry.outcome));
      entries.push(entry);position++;
    }
    need(page.range.nextOffset===(position<page.range.total?position:null));
    const {observedAt,...retained}=page;stable.push(retained);
  }
  need(position===first.total);
  return {binding:first,entries,stableSha256:sha(jsonBytes(stable)),pages:read.pages.length};
}
function readReport(value) {
  if(value===null)return null;
  need(plain(value)&&value.schema==='stellar-forge.sf88.object-acquisition.v1'&&UUID.test(value.sessionId??'')&&
    HASH.test(value.sessionSha256??'')&&HASH.test(value.configurationSha256??'')&&instant(value.createdAt)&&
    instant(value.inspectedAt)&&typeof value.directory==='string'&&typeof value.sourceIntentId==='string'&&
    typeof value.sourceUrl==='string'&&['whole','chunks'].includes(value.deliveryMode)&&
    count(value.bytes)&&count(value.downloadedBytes)&&count(value.chunkCount)&&value.chunkCount>=1&&value.chunkCount<=100000&&
    count(value.chunkBytes)&&value.chunkBytes>=1&&Array.isArray(value.chunks)&&value.chunks.length===value.chunkCount&&
    ['READY','COMPLETE','RECONCILIATION_REQUIRED','RUNNING'].includes(value.status));
  let bytes=0,verified=0,attempted=0;
  for(let index=0;index<value.chunks.length;index++) {
    const row=value.chunks[index];
    need(plain(row)&&row.index===index&&row.intentId===intent(value.sessionId,index)&&count(row.offset)&&count(row.length)&&
      row.offset===index*value.chunkBytes&&row.length===Math.min(value.chunkBytes,value.bytes-row.offset));
    if(row.attemptKind==='EXECUTE')attempted++;
    if(row.state==='VERIFIED'){need(HASH.test(row.sha256??''));verified++;bytes+=row.length;}
    if(row.attemptStartedAt!=null)need(instant(row.attemptStartedAt));
  }
  need(bytes===value.downloadedBytes&&verified===value.completeChunks&&verified===value.completedChunks&&
    attempted===value.attemptedChunks&&bytes<=value.bytes);
  const status=value.status==='RUNNING'?value.progressStatus:value.status;
  need(['READY','COMPLETE','RECONCILIATION_REQUIRED'].includes(status));
  if(status==='COMPLETE')need(verified===value.chunkCount&&bytes===value.bytes&&HASH.test(value.objectSha256??'')&&
    (value.expectedSha256===null||value.expectedSha256===value.objectSha256));
  return value;
}
function matches(selection,report,account) {
  return (!report||['directory','sessionId','sessionSha256','configurationSha256','sourceIntentId']
    .every(key=>report[key]===selection[key]))&&(!account||['directory','sessionId','sessionSha256','configurationSha256']
      .every(key=>account.binding[key]===selection[key]));
}
function age(now,dates) {
  if(!dates.length)return {seconds:0,unknown:0};
  const valid=dates.filter(value=>instant(value)&&Date.parse(value)<=now+5000);
  return {seconds:valid.length?Math.max(0,Math.floor((now-valid.reduce((oldest,value)=>Math.min(oldest,Date.parse(value)),Infinity))/1000)):null,
    unknown:dates.length-valid.length};
}
export function analyzeObjectObservation(meta,reportValue,accountingValue) {
  const selection=normalizeObjectSource(meta.selection),selected=registration(meta.registration);
  need(instant(meta.startedAt)&&instant(meta.generatedAt)&&meta.startedAt<=meta.generatedAt&&
    (meta.errorCode===null||CODE.test(meta.errorCode)));
  fields(accountingValue,['schema','before','after']);need(accountingValue.schema===OBJECT_ACCOUNTING_SCHEMA);
  const report=readReport(reportValue),before=readAccount(accountingValue.before),after=readAccount(accountingValue.after);
  if(report)need(report.bytes<=selection.maxBytes&&report.chunkCount<=selection.maxChunks&&
    Date.parse(report.inspectedAt)>=Date.parse(meta.startedAt)-5000&&Date.parse(report.inspectedAt)<=Date.parse(meta.generatedAt)+5000);
  const bound=matches(selection,report,before)&&matches(selection,report,after);
  const stable=before!==null&&after!==null&&before.stableSha256===after.stableSha256;
  const nativeCodes=[meta.errorCode,...(report?.chunks??[]).map(row=>row.code),report?.stoppedChunk?.code].filter(Boolean);
  const identity=!bound||nativeCodes.some(code=>IDENTITY.has(code));
  const integrity=bound?nativeCodes.filter(code=>INTEGRITY.has(code)):[];
  const changing=nativeCodes.some(code=>UNSTABLE.has(code))||before!==null&&after!==null&&!stable;
  const limited=meta.errorCode==='OBJECT_INSPECTION_WORKLOAD_LIMIT'||meta.errorCode==='OBJECT_OBSERVATION_SIZE_LIMIT';
  const complete=bound&&stable&&report!==null&&meta.errorCode===null&&!changing&&!identity;
  const coverage=identity?'IDENTITY_CHANGED':limited?'WORKLOAD_LIMIT':changing?'CHANGED_DURING_READ':
    complete?'COMPLETE':meta.errorCode==='OBJECT_INSPECTION_ABORTED'?'INTERRUPTED':'UNAVAILABLE';
  const account=after??before,entries=account?.entries??[];
  const financial={authority:'RETAINED_ORIGINAL_SF36_VIEWS',available:account!==null,coherent:complete,
    finalizedRequests:0,unresolvedRequests:0,notAttemptedRequests:0,noPaymentRequests:0,historicalFinalizedRequests:0,
    unresolvedAgeSeconds:null,unresolvedAgeUnknown:0,finalizedAgeSeconds:null,finalizedAgeUnknown:0};
  const unresolvedDates=[],finalizedDates=[];
  for(const entry of entries) {
    if(FINALIZED.has(entry.outcome)){financial.finalizedRequests++;finalizedDates.push(entry.completedAt);}
    else if(entry.outcome==='NOT_ATTEMPTED')financial.notAttemptedRequests++;
    else if(entry.outcome==='NO_PAYMENT_REQUIRED')financial.noPaymentRequests++;
    else {financial.unresolvedRequests++;unresolvedDates.push(report?.chunks[entry.index]?.attemptStartedAt);}
    if(entry.lastFinalized)financial.historicalFinalizedRequests++;
  }
  const unresolvedAge=age(Date.parse(meta.generatedAt),unresolvedDates),finalizedAge=age(Date.parse(meta.generatedAt),finalizedDates);
  Object.assign(financial,{unresolvedAgeSeconds:unresolvedAge.seconds,unresolvedAgeUnknown:unresolvedAge.unknown,
    finalizedAgeSeconds:finalizedAge.seconds,finalizedAgeUnknown:finalizedAge.unknown});
  const nativeStatus=report?(report.status==='RUNNING'?report.progressStatus:report.status):null;
  const output={state:integrity.length?'INTEGRITY_ERROR':complete?nativeStatus==='COMPLETE'?'VERIFIED_COMPLETE':'INCOMPLETE':'UNVERIFIED',
    nativeStatus:report?.status??null,progressStatus:nativeStatus,expectedBytes:report?.bytes??null,
    verifiedBytes:report?.downloadedBytes??null,verifiedChunks:report?.completeChunks??null,
    chunks:report?.chunkCount??null,sha256:report?.objectSha256??null,assembly:'RECEIPT_ONLY'};
  return {registration:selected,selection,coverage,bindingMatches:bound,financial,output,
    process:report?.lock??null,nativeCodes:[...new Set(nativeCodes)],
    identityContradiction:identity,integrityCodes:[...new Set(integrity)],
    accountingPages:{before:before?.pages??0,after:after?.pages??0},
    sourceUrl:report?.sourceUrl??null,terms:report?.terms??null,
    sessionCreatedAt:report?.createdAt??null};
}
export function createObjectObservation({registration:selected,selection,startedAt,generatedAt,
  report=null,before=null,after=null,errorCode=null}) {
  const accounting={schema:OBJECT_ACCOUNTING_SCHEMA,before,after};
  const reportBytes=jsonBytes(report),accountingBytes=jsonBytes(accounting);
  need(reportBytes.length<=OBJECT_FILE_LIMIT&&accountingBytes.length<=OBJECT_FILE_LIMIT,'OBJECT_OBSERVATION_SIZE_LIMIT');
  const meta={schema:OBJECT_OBSERVATION_SCHEMA,registration:registration(selected),
    selection:normalizeObjectSource(selection),startedAt,generatedAt,errorCode,
    sources:{'object-report.json':{bytes:reportBytes.length,sha256:sha(reportBytes)},
      'object-accounting.json':{bytes:accountingBytes.length,sha256:sha(accountingBytes)}}};
  meta.summary=analyzeObjectObservation(meta,report,accounting);
  const metaBytes=jsonBytes(meta);need(metaBytes.length<=OBJECT_FILE_LIMIT,'OBJECT_OBSERVATION_SIZE_LIMIT');
  return {kind:'OBJECT_SESSION',files:{'object-observation.json':metaBytes,'object-report.json':reportBytes,
    'object-accounting.json':accountingBytes},object:meta,
    report:{generatedAt,observation:{sessionId:meta.selection.sessionId}}};
}
export function readObjectObservationFiles(files) {
  need(plain(files)&&Object.keys(files).length===OBJECT_FILES.length&&OBJECT_FILES.every(name=>Buffer.isBuffer(files[name])&&
    files[name].length>0&&files[name].length<=OBJECT_FILE_LIMIT));
  const decode=bytes=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('SF93_OBJECT_CAPTURE_JSON_INVALID');}};
  const meta=decode(files['object-observation.json']),report=decode(files['object-report.json']),
    accounting=decode(files['object-accounting.json']);
  fields(meta,['schema','registration','selection','startedAt','generatedAt','errorCode','sources','summary']);
  need(meta.schema===OBJECT_OBSERVATION_SCHEMA);
  fields(meta.sources,['object-report.json','object-accounting.json']);
  for(const name of ['object-report.json','object-accounting.json']){
    fields(meta.sources[name],['bytes','sha256']);need(meta.sources[name].bytes===files[name].length&&
      meta.sources[name].sha256===sha(files[name]));
  }
  const summary=analyzeObjectObservation(meta,report,accounting);
  need(isDeepStrictEqual(meta.summary,summary),'SF93_OBJECT_CAPTURE_SUMMARY_CHANGED');
  return {meta,report,accounting,summary};
}
export function objectObservationSignals(merchant,observation,now,previous=null) {
  const packet=observation.packet,meta=packet?.object;
  if(!meta)return {signals:{OBJECT_SOURCE_UNAVAILABLE:{bad:true,values:{}}},error:observation.error??'OBJECT_SOURCE_READ_FAILED'};
  need(isDeepStrictEqual(meta.selection,merchant.object)&&meta.registration.id===merchant.id&&meta.registration.label===merchant.label);
  const s=meta.summary,captured=Date.parse(meta.generatedAt),same=previous?.sessionId===meta.selection.sessionId;
  const fresh=Number.isFinite(now)&&captured<=now+5000&&now-captured<=30000&&
    (!same||captured>Date.parse(previous.capturedAt));
  if(!fresh)return {packet,successful:false,fresh:false,
    signals:{OBJECT_SOURCE_UNAVAILABLE:{bad:true,values:{}}},error:'OBJECT_SOURCE_CLOCK_OR_AGE_INVALID'};
  const complete=s.coverage==='COMPLETE';
  const aged=(number,seconds,unknown,threshold)=>({bad:!complete?null:number===0?false:
    seconds!==null&&seconds>=threshold?true:unknown?null:false,
    values:{requests:number,oldestPendingSeconds:seconds??0,thresholdSeconds:threshold}});
  return {packet,successful:complete,fresh:true,previous:{sessionId:meta.selection.sessionId,startedAt:s.sessionCreatedAt,capturedAt:meta.generatedAt},
    window:{from:meta.startedAt,through:meta.generatedAt,complete,sessionStartedAt:s.sessionCreatedAt},
    error:meta.errorCode??(complete?null:s.coverage),signals:{
      OBJECT_SOURCE_UNAVAILABLE:{bad:s.identityContradiction?null:!complete,values:{}},
      OBJECT_IDENTITY_CHANGED:{bad:s.identityContradiction?true:complete?false:null,values:{},openAfter:1},
      OBJECT_OUTPUT_INTEGRITY:{bad:s.integrityCodes.length>0?true:complete?false:null,values:{},openAfter:1},
      OBJECT_FINANCIAL_UNRESOLVED:aged(s.financial.unresolvedRequests,s.financial.unresolvedAgeSeconds,
        s.financial.unresolvedAgeUnknown,merchant.object.financialAfterSeconds),
      OBJECT_FINALIZED_OUTPUT_INCOMPLETE:s.output.state==='VERIFIED_COMPLETE'?{bad:complete?false:null,values:{}}:
        aged(s.financial.finalizedRequests,s.financial.finalizedAgeSeconds,s.financial.finalizedAgeUnknown,merchant.object.outputAfterSeconds)
    }};
}
