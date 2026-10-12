// MIT. Original SF93 packets and SF97/SF98 reconciliation in the SF74 case desk.
// Pure file intake: never opens a seller, journal writer, wallet or network client.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {reconcile} from '../sf97-merchant-revenue-ops/native-reconcile.mjs';
import {normalizeTrafficHistoryReport} from '../sf30-seller-sdk/operations/history.mjs';
import {parseWorkspace} from './workspace-file.mjs';

export const RUNTIME_SCHEMA = 'stellar-forge.merchant-runtime-case.v1';
export const HANDOFF_SCHEMA = 'stellar-forge.merchant-support-handoff.v1';
export const MAX_RUNTIME_BYTES = 192 * 1024 * 1024;
export const MAX_HANDOFF_BYTES = 224 * 1024 * 1024;
export const MAX_PERIOD_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_FILE = 2_000_000;
const PACKET_FILES = ['bundle.json','operator-brief.md','metrics.prom','manifest.json'];
const NATIVE_FILES = ['report.json','events.ndjson','deliveries.ndjson'];
const PERIOD_FILES = ['history.json',...NATIVE_FILES];
const FILES = [...PACKET_FILES,...PERIOD_FILES];
const INPUTS = ['resource','catalog','origin','network','payTo','method','credentialed'];
const COUNTERS = ['started','completed','responses','inFlight','success','challenge','clientError','serverError','other','disconnected'];
const CUMULATIVE = COUNTERS.filter(key=>key!=='inFlight');
const HASH = /^[a-f0-9]{64}$/;
const METHODS = ['GET','HEAD','POST','PUT','PATCH','DELETE'];
const sha = value=>createHash('sha256').update(value).digest('hex');
const utf8 = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const own = (object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const plain = value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail = message=>{throw new TypeError(message);};
const count = value=>Number.isSafeInteger(value)&&value>=0;
const instant = value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;

function fields(value,allowed,label) {
  if(!plain(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Invalid '+label);
  return value;
}
function text(value,max,label,empty=true) {
  if(typeof value!=='string'||(!empty&&!value.length)||Buffer.byteLength(value)>max||
    utf8.decode(Buffer.from(value))!==value)fail('Invalid '+label);
  return value;
}
function json(bytes,label) {
  try{return JSON.parse(utf8.decode(bytes));}catch{fail(label+' must be original UTF-8 JSON');}
}
function source(value,name,maximum=MAX_FILE) {
  fields(value,['encoding','bytes','sha256','data'],name+' source');
  if(value.encoding!=='base64'||typeof value.data!=='string'||value.data.length>4*Math.ceil(maximum/3)||
    !HASH.test(value.sha256??''))fail('Invalid '+name+' source metadata');
  const bytes=Buffer.from(value.data,'base64');
  const empty=NATIVE_FILES.includes(name)&&name.endsWith('.ndjson');
  if((!empty&&!bytes.length)||bytes.length>maximum||value.bytes!==bytes.length||
    bytes.toString('base64')!==value.data||sha(bytes)!==value.sha256)
    fail(name+' source bytes or SHA-256 do not match');
  utf8.decode(bytes);
  return bytes;
}
export function encodeRuntimeSource(bytes,maximum=MAX_FILE) {
  const value=Buffer.from(bytes);
  if(value.length>maximum)fail('Runtime source exceeds its '+maximum+' byte limit');
  return {encoding:'base64',bytes:value.length,sha256:sha(value),data:value.toString('base64')};
}
function inputScope(value) {
  fields(value,INPUTS,'captured case inputs');
  const result={};
  for(const key of INPUTS) {
    if(key==='credentialed') {
      if(typeof value[key]!=='boolean')fail('Invalid captured credential mode');
      result[key]=value[key];
    } else result[key]=text(value[key],2048,'captured '+key);
  }
  return result;
}
function counters(value,label) {
  if(!plain(value)||COUNTERS.some(key=>!count(value[key]))||!plain(value.statuses)||
    Object.entries(value.statuses).some(([key,n])=>!/^[1-5]\d\d$/.test(key)||!count(n)))
    fail('Invalid original '+label+' counters');
  if(value.completed>value.started||value.inFlight!==value.started-value.completed||
    value.responses+value.disconnected!==value.completed||
    value.success+value.challenge+value.clientError+value.serverError+value.other!==value.responses||
    Object.values(value.statuses).reduce((sum,n)=>sum+n,0)!==value.responses)
    fail('Original '+label+' counters do not conserve');
  return Object.fromEntries(COUNTERS.map(key=>[key,value[key]]));
}
function digestRecord(value,label) {
  fields(value,['sha256','bytes','readAt'],label);
  if(!HASH.test(value.sha256??'')||!count(value.bytes)||value.bytes>MAX_FILE||!instant(value.readAt))
    fail('Invalid original '+label+' digest');
}
function runtimePacket(bytes) {
  const report=json(bytes['bundle.json'],'bundle.json'), manifest=json(bytes['manifest.json'],'manifest.json');
  if(report.schema!=='stellar-forge.seller-support.v1'||manifest.schema!=='stellar-forge.seller-support-manifest.v1'||
    !instant(report.generatedAt)||manifest.generatedAt!==report.generatedAt||!plain(report.observation)||
    !/^[a-f0-9-]{36}$/i.test(report.observation.sessionId??'')||manifest.sessionId!==report.observation.sessionId)
    fail('Original SF93 bundle and manifest must describe the same capture');
  fields(manifest.files,PACKET_FILES.filter(name=>name!=='manifest.json'),'SF93 manifest files');
  for(const name of PACKET_FILES.filter(name=>name!=='manifest.json')) {
    if(!plain(manifest.files[name])||manifest.files[name].bytes!==bytes[name].length||
      manifest.files[name].sha256!==sha(bytes[name]))fail('SF93 manifest does not match '+name);
  }
  const origins=['sellerHealth','sellerOffers','opsSnapshot','metrics'];
  fields(report.sourceDigests,origins,'SF93 source digests');
  for(const name of origins)digestRecord(report.sourceDigests[name],name);
  if(!isDeepStrictEqual(report.sourceDigests,manifest.sourceDigests)||
    report.sourceDigests.metrics.sha256!==sha(bytes['metrics.prom']))fail('SF93 original source digests disagree');
  const o=report.observation,s=report.seller;
  if(!plain(s)||!['CHALLENGE_ONLY','NATIVE_X402'].includes(s.mode)||
    !Array.isArray(s.advertisedRoutes)||!s.advertisedRoutes.length||s.advertisedRoutes.length>64||
    s.offerCount!==s.advertisedRoutes.length||!instant(o.startedAt)||!instant(o.capturedAt)||
    o.startedAt>o.capturedAt||!Array.isArray(o.routes)||o.routes.length!==s.advertisedRoutes.length+3||
    !Array.isArray(report.alerts)||report.alerts.some(a=>typeof a!=='string'||a.length>4000)||
    !count(o.observerErrors)||typeof o.attached!=='boolean')fail('Invalid original SF93 runtime view');
  counters(o.totals,'total');
  const routeKeys=new Set();
  for(const row of o.routes) {
    if(typeof row.id!=='string'||row.id.length>80||typeof row.method!=='string'||
      routeKeys.has(row.id+'\0'+row.method))fail('Invalid original runtime route');
    routeKeys.add(row.id+'\0'+row.method);counters(row,'route');
  }
  const advertised=new Set();
  for(const row of s.advertisedRoutes) {
    const key=row.id+'\0'+row.method;
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(row.id??'')||!METHODS.includes(row.method)||
      advertised.has(key)||!routeKeys.has(key))fail('Original SF93 advertised routes disagree');
    advertised.add(key);
  }
  if(!isDeepStrictEqual(o.routes.filter(r=>r.id.startsWith('@')).map(r=>r.id).sort(),['@invalid','@method','@unmatched']))
    fail('Original SF93 special route buckets disagree');
  for(const key of COUNTERS)if(o.routes.reduce((sum,r)=>sum+r[key],0)!==o.totals[key])
    fail('Original SF93 route totals disagree');
  return report;
}
function journal(bytes,name) {
  const value=utf8.decode(bytes);
  if(value&&!value.endsWith('\n'))fail(name+' has an incomplete original journal record');
  return value.split('\n').filter(Boolean).map((line,index)=>{
    const row=json(Buffer.from(line),name+' line '+(index+1));
    if(!plain(row))fail('Invalid '+name+' row');
    return row;
  });
}
function periodPacket(bytes) {
  const history=normalizeTrafficHistoryReport(json(bytes['history.json'],'history.json'));
  const report=json(bytes['report.json'],'report.json'), historySha=sha(bytes['history.json']);
  if(report.observationKind!=='DURABLE_HISTORY'||report.sourceSha256?.history!==historySha||
    report.sourceSha256?.snapshot!==historySha||!HASH.test(report.sourceSha256?.seller??'')||
    !HASH.test(report.sourceSha256?.terms??'')||
    !isDeepStrictEqual(history,normalizeTrafficHistoryReport(report.usageHistory)))
    fail('SF97 period report must retain this exact original history and its original source hashes');
  const hasNative=own(bytes,'events.ndjson');
  // The original reconciler validates the report, complete payment choices and
  // retained counters even when no outbox is attached. An absent journal is not
  // presented as an observed empty outbox.
  const validated=reconcile(report,hasNative?journal(bytes['events.ndjson'],'events.ndjson'):[],
    hasNative?journal(bytes['deliveries.ndjson'],'deliveries.ndjson'):[]);
  const routes=new Map(), identity=row=>JSON.stringify([row.id,row.method,row.path]);
  for(const row of report.routes) {
    const retained=history.routes.find(r=>r.id===row.routeId&&r.method===row.method&&r.path===row.path);
    const route={id:row.routeId,method:row.method,path:row.path,routeKey:retained?.routeKey??null,binding:'CURRENT_ROUTE'};
    routes.set(identity(route),route);
  }
  for(const row of history.routes)if(!row.id.startsWith('@')&&!routes.has(identity(row))) {
    routes.set(identity(row),{id:row.id,method:row.method,path:row.path,routeKey:row.routeKey,
      binding:report.routes.some(r=>r.routeId===row.id)?'HISTORICAL_ROUTE_VARIANT':'REMOVED_ROUTE'});
  }
  if(hasNative) {
    validated.sourceSha256=Object.fromEntries(PERIOD_FILES.map(name=>[name,sha(bytes[name])]));
    validated.snapshotRelation='EXACT_RETAINED_HISTORY';
  }
  return {history,report,routes:[...routes.values()],options:validated.options,
    native:hasNative?validated:null};
}
function readCaptureFiles(files) {
  fields(files,FILES,'runtime files');
  const period=own(files,'history.json'),bytes={};
  if(period) {
    if(Object.keys(files).some(name=>!PERIOD_FILES.includes(name))||!own(files,'report.json'))
      fail('A retained period needs original history.json and report.json, without SF93 packet files');
    if(own(files,'events.ndjson')!==own(files,'deliveries.ndjson'))
      fail('Attach both original SF98 journals together');
    let total=0;
    for(const name of Object.keys(files)) {
      bytes[name]=source(files[name],name,MAX_PERIOD_SOURCE_BYTES);total+=bytes[name].length;
      if(total>MAX_PERIOD_SOURCE_BYTES)
        fail('A period capture exceeds 64 MiB of original sources; export fewer retained days or one route');
    }
    return {kind:'DURABLE_PERIOD',bytes,original:periodPacket(bytes)};
  }
  for(const name of PACKET_FILES)bytes[name]=source(files[name],name);
  const nativeCount=NATIVE_FILES.filter(name=>own(files,name)).length;
  if(nativeCount&&nativeCount!==NATIVE_FILES.length)
    fail('Native reconciliation needs the original report.json and both SF98 journal files');
  for(const name of NATIVE_FILES)if(own(files,name))bytes[name]=source(files[name],name);
  return {kind:'SESSION_PACKET',bytes,original:runtimePacket(bytes),nativeCount};
}
function sample(value) {
  fields(value,['scope','files'],'runtime capture');
  fields(value.scope,['inputs','routeId','path'],'runtime route mapping');
  const inputs=inputScope(value.scope.inputs),routeId=text(value.scope.routeId,80,'selected runtime route',false);
  const {kind,bytes,original,nativeCount}=readCaptureFiles(value.files);
  if(kind==='DURABLE_PERIOD') {
    const path=text(value.scope.path,2048,'selected retained route path',false);
    const route=original.routes.find(row=>row.id===routeId&&row.method===inputs.method&&row.path===path);
    if(!route)fail('Select an original retained or configured route and path matching this case method');
    return {kind,scope:{inputs,routeId,path},files:value.files,original,route,native:original.native};
  }
  if(own(value.scope,'path'))fail('A session packet retains its original route mapping without a period path');
  const route=original.observation.routes.find(r=>r.id===routeId&&r.method===inputs.method);
  if(!route||route.id.startsWith('@'))fail('Select an advertised runtime route matching this case method');
  let native=null;
  if(nativeCount) {
    const report=json(bytes['report.json'],'report.json');
    if(report.sessionId!==original.observation.sessionId||report.originalSellerMode!==original.seller.mode)
      fail('SF97 report must belong to the same original runtime session and seller mode');
    // Preserve the original report's own window and payment-option matcher. A
    // separately fetched SF97 window is not silently replaced with the SF93 one.
    native=reconcile(report,journal(bytes['events.ndjson'],'events.ndjson'),journal(bytes['deliveries.ndjson'],'deliveries.ndjson'));
    const advertised=new Set(original.seller.advertisedRoutes.map(r=>r.id+'\0'+r.method));
    if(native.routes.length!==advertised.size||native.routes.some(r=>!advertised.has(r.routeId+'\0'+r.method)))
      fail('SF97 report and original runtime advertised routes disagree');
    native.sourceSha256=Object.fromEntries(NATIVE_FILES.map(name=>[name,sha(bytes[name])]));
    native.snapshotRelation=report.sourceSha256?.snapshot===original.sourceDigests.opsSnapshot.sha256?
      'SAME_SOURCE_SNAPSHOT':'SAME_SESSION_SEPARATE_CAPTURE';
  }
  return {kind,scope:{inputs,routeId},files:value.files,original,route,native};
}
/** Fully validate bytes before case storage or replacement. */
export function parseRuntime(textValue) {
  text(textValue,MAX_RUNTIME_BYTES,'runtime case file',false);
  const file=json(Buffer.from(textValue),'runtime case');
  fields(file,['schema','before','after'],'runtime case');
  if(file.schema!==RUNTIME_SCHEMA||!own(file,'before')||!own(file,'after'))fail('Unsupported runtime case version');
  const before=file.before===null?null:sample(file.before),after=file.after===null?null:sample(file.after);
  if(!before&&!after)fail('Attach at least one original runtime capture');
  return {before,after,summary:{captures:Number(Boolean(before))+Number(Boolean(after)),
    nativeCaptures:Number(Boolean(before?.native))+Number(Boolean(after?.native)),
    files:[before,after].filter(Boolean).reduce((n,s)=>n+Object.keys(s.files).length,0),
    sourceBytes:[before,after].filter(Boolean).reduce((n,s)=>n+Object.values(s.files).reduce((k,f)=>k+f.bytes,0),0),
    ...([before,after].some(c=>c?.kind==='DURABLE_PERIOD')?
      {periodCaptures:[before,after].filter(c=>c?.kind==='DURABLE_PERIOD').length}: {})}};
}
export function inspectRuntimeFiles({files,inputs,routeId,path}) {
  fields(files,FILES,'uploaded runtime files');
  const wrapped={},maximum=own(files,'history.json')?MAX_PERIOD_SOURCE_BYTES:MAX_FILE;
  for(const [name,data] of Object.entries(files)) {
    if(typeof data!=='string'||data.length>4*Math.ceil(maximum/3))fail('Invalid uploaded '+name);
    const bytes=Buffer.from(data,'base64');
    if(bytes.toString('base64')!==data)fail('Invalid source encoding for '+name);
    wrapped[name]=encodeRuntimeSource(bytes,maximum);
  }
  // Inspect before a route has been selected, then require a concrete operator
  // mapping for attachment. The packet itself does not claim an external origin.
  if(routeId===undefined) {
    const {kind,original}=readCaptureFiles(wrapped);
    if(kind==='DURABLE_PERIOD')return {kind,routes:original.routes,sessionId:null,
      sessionIds:original.report.sessionIds,capturedAt:original.history.generatedAt,
      mode:original.report.originalSellerMode,range:original.history.range,days:original.history.days.length};
    return {kind,routes:original.seller.advertisedRoutes,sessionId:original.observation.sessionId,
      capturedAt:original.observation.capturedAt,mode:original.seller.mode};
  }
  const checked=sample({scope:{inputs,routeId,...(path===undefined?{}:{path})},files:wrapped});
  return {capture:{scope:checked.scope,files:checked.files},view:captureView(checked,inputs)};
}
function captureView(capture,currentInputs) {
  if(!capture)return null;
  if(capture.kind==='DURABLE_PERIOD')return periodCaptureView(capture,currentInputs);
  const o=capture.original.observation;
  const native=capture.native;
  return {kind:'SESSION_PACKET',scope:capture.scope,caseMatches:isDeepStrictEqual(capture.scope.inputs,inputScope(currentInputs)),
    capturedAt:o.capturedAt,startedAt:o.startedAt,sessionId:o.sessionId,mode:capture.original.seller.mode,
    observerAttached:o.attached,observerErrors:o.observerErrors,
    route:{id:capture.route.id,method:capture.route.method,...counters(capture.route,'selected route'),
      statuses:capture.route.statuses,latencyP95UpperBoundMs:capture.route.latencyP95UpperBoundMs??null},
    alerts:capture.original.alerts,
    files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256})),
    native};
}
function retainedCounters(row) {
  return {...Object.fromEntries(CUMULATIVE.map(key=>[key,row?.[key]??0])),
    statuses:row?.statuses??{},latencyP95UpperBoundMs:row?.latencyP95UpperBoundMs??null};
}
function periodCaptureView(capture,currentInputs) {
  const {history,report,routes,options}=capture.original, selected=capture.route;
  const retained=history.routes.find(row=>row.routeKey===selected.routeKey),alerts=[];
  if(history.range.truncatedByRetention)alerts.push('The original export was truncated by its configured retention period.');
  if(history.range.outsideRetention)alerts.push('The selected dates have no retained source coverage.');
  if(!retained)alerts.push('No observations were retained for this selected configured method/path.');
  if(history.coverageFormat===null)alerts.push('This earlier original export has session intervals and daily variants but no per-session route membership.');
  if(selected.binding!=='CURRENT_ROUTE')alerts.push('This retained method/path is not the current saved report route. Current payment terms are reference data, not attributed historical terms.');
  const observerErrors=history.sessions.reduce((sum,session)=>sum+session.observerErrors,0);
  const sessions=history.sessions.map(({retainedDays,...session})=>({...session,
    selectedRouteCoverage:retainedDays===null?'LEGACY_UNKNOWN':
      retainedDays.some(day=>day.routeKeys.includes(selected.routeKey))?'RECORDED':'NOT_RECORDED',
    selectedRouteDays:retainedDays===null?null:retainedDays.filter(day=>day.routeKeys.includes(selected.routeKey)).map(day=>day.day)}));
  const days=history.days.map(day=>{
    const row=day.routes.find(route=>route.routeKey===selected.routeKey);
    return {day:day.day,originalSessions:day.sessions,hasSavedRoute:!!row,
      route:row?retainedCounters(row):null};
  });
  return {kind:'DURABLE_PERIOD',scope:capture.scope,
    caseMatches:isDeepStrictEqual(capture.scope.inputs,inputScope(currentInputs)),
    capturedAt:report.observedUntil,startedAt:report.observedFrom,sessionId:null,
    sessionIds:report.sessionIds,mode:report.originalSellerMode,
    observerAttached:null,observerErrors,
    route:{id:selected.id,method:selected.method,path:selected.path,routeKey:selected.routeKey,
      binding:selected.binding,hasSavedCoverage:!!retained,...retainedCounters(retained)},
    period:{range:history.range,exportedAt:history.generatedAt,coverageFormat:history.coverageFormat,
      days,sessions,variants:routes.filter(row=>row.id===selected.id).map(row=>{
        const original=history.routes.find(r=>r.routeKey===row.routeKey);
        return {...row,hasSavedCoverage:!!original,...retainedCounters(original)};
      }),
      sourceSha256:report.sourceSha256,
      paymentOptions:options.filter(option=>option.routeId===selected.id&&option.method===selected.method),
      currentReportPath:report.routes.find(row=>row.routeId===selected.id)?.path??null},
    alerts,files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256})),
    native:capture.native};
}
function percent(n,d) {return d?Number(BigInt(n)*10000n/BigInt(d))/100:null;}
function periodMeasures(capture) {
  const r=capture.route;
  return {from:capture.period.range.effectiveFrom,to:capture.period.range.effectiveTo,
    selectedDays:capture.period.days.filter(day=>day.hasSavedRoute).length,
    ...Object.fromEntries(CUMULATIVE.map(key=>[key,r[key]])),
    httpSuccessPercent:percent(r.success,r.responses),httpChallengePercent:percent(r.challenge,r.responses),
    httpServerErrorPercent:percent(r.serverError,r.responses),disconnectPercent:percent(r.disconnected,r.completed)};
}
function comparePeriods(before,after) {
  const left=periodMeasures(before),right=periodMeasures(after);
  const independent=left.to!==null&&right.from!==null&&left.to<right.from;
  const usable=independent&&before.route.hasSavedCoverage&&after.route.hasSavedCoverage;
  const rates=['httpSuccessPercent','httpChallengePercent','httpServerErrorPercent','disconnectPercent'];
  return {state:usable?'SEPARATE_RETAINED_PERIODS':independent?'PERIOD_COVERAGE_MISSING':'OVERLAPPING_OR_REVERSED_PERIODS',
    detail:usable?'These are independent retained UTC periods for the same method/path. Compare response shares alongside their actual counts and coverage; counts are not subtracted and a change does not establish a repair caused it.':
      independent?'One selected route has no retained observations. Both source windows remain visible; missing coverage is not zero service activity.':
      'These retained selections overlap or are not chronological. They may contain the same requests or native events; the case shows each source separately without an incremental total or rate-change claim.',
    interval:null,periods:{before:left,after:right,independent,
      percentagePointChange:usable?Object.fromEntries(rates.map(key=>[key,left[key]===null||right[key]===null?null:
        Math.round((right[key]-left[key])*100)/100])):null}};
}
function compareRuntime(before,after) {
  if(!before||!after)return {state:'ONE_CAPTURE',detail:'Attach a second original capture to review the runtime interval.',interval:null};
  if(!isDeepStrictEqual(before.scope.inputs,after.scope.inputs)||before.scope.routeId!==after.scope.routeId||
    !before.caseMatches||!after.caseMatches)
    return {state:'SCOPE_DIFFERS',detail:'The case inputs or selected runtime route changed. Review each capture under its saved scope.',interval:null};
  if(before.kind==='DURABLE_PERIOD'||after.kind==='DURABLE_PERIOD') {
    if(before.kind!==after.kind)return {state:'DIFFERENT_OBSERVATION_KINDS',
      detail:'A process packet and a retained period have different aggregation scopes. Review the original captures separately.',interval:null};
    if(before.scope.path!==after.scope.path)return {state:'ROUTE_VARIANT_CHANGED',
      detail:'The retained route path changed. Each method/path keeps its own observations and native assignment; the case does not subtract them.',interval:null};
    return comparePeriods(before,after);
  }
  if(before.sessionId!==after.sessionId||before.startedAt!==after.startedAt||before.mode!==after.mode)
    return {state:'SEPARATE_SESSIONS',detail:'The captures have separate runtime sessions. Their totals describe separate windows and are not subtracted.',interval:null};
  if(after.capturedAt<=before.capturedAt)return {state:'CAPTURE_ORDER',detail:'The after capture must be later than the before capture.',interval:null};
  const a=before.route,b=after.route;
  if(CUMULATIVE.some(key=>b[key]<a[key])||Object.keys(a.statuses).some(key=>(b.statuses[key]??0)<a.statuses[key]))
    return {state:'COUNTERS_CHANGED',detail:'Cumulative counters decreased inside one session. Inspect the original packet and observer continuity.',interval:null};
  const interval=Object.fromEntries(CUMULATIVE.map(key=>[key,b[key]-a[key]]));
  interval.statuses=Object.fromEntries([...new Set([...Object.keys(a.statuses),...Object.keys(b.statuses)])].sort().map(key=>[key,(b.statuses[key]??0)-(a.statuses[key]??0)]));
  interval.inFlightBefore=a.inFlight;interval.inFlightAfter=b.inFlight;
  interval.from=before.capturedAt;interval.until=after.capturedAt;
  const complete=before.observerAttached&&after.observerAttached&&!before.observerErrors&&!after.observerErrors;
  return {state:!complete?'OBSERVER_INCOMPLETE':interval.completed?'INTERVAL_OBSERVED':'NO_COMPLETIONS',
    detail:!complete?'The interval is retained, but an observer error or detachment limits coverage.':
      interval.completed?'Counts below are events between the two original snapshots. Starts and finishes may belong to different requests.':
      'No completed request was observed in the selected interval.',interval};
}
export function reviewRuntime(supportText,inputs) {
  const parsed=parseRuntime(supportText),before=captureView(parsed.before,inputs),after=captureView(parsed.after,inputs);
  const comparison=compareRuntime(before,after),queue=[];
  for(const [side,capture] of [['before',before],['after',after]])if(capture) {
    if(!capture.caseMatches)queue.push({source:side,routeId:capture.scope.routeId,kind:'scope',action:'Review the saved case mapping before using this capture for the current route.'});
    if(capture.observerAttached===false||capture.observerErrors)queue.push({source:side,routeId:capture.scope.routeId,kind:'observer',action:'Inspect the original observer lifecycle and errors before relying on complete traffic counts.'});
    if(capture.period) {
      const interrupted=capture.period.sessions.filter(session=>session.state==='INTERRUPTED');
      if(interrupted.length)queue.push({source:side,routeId:capture.scope.routeId,kind:'observer',
        action:`This original period contains ${interrupted.length} unfinished checkpoint(s). Review their route coverage; each retained interval ends at its saved capture.`});
      for(const alert of capture.alerts)queue.push({source:side,routeId:capture.scope.routeId,kind:'history',action:alert});
      const excluded=capture.native?.excludedEvents.filter(event=>event.routeId===capture.scope.routeId&&event.method===capture.route.method)??[];
      if(excluded.length)queue.push({source:side,routeId:capture.scope.routeId,kind:'native',
        action:`Inspect ${excluded.length} original event(s) outside the selected retained coverage. Their source IDs and exclusion reasons remain attached.`});
    }
    for(const issue of capture.native?.issues??[])if(issue.routeId==='*'||issue.routeId===capture.scope.routeId)
      queue.push({source:side,routeId:issue.routeId,kind:'native',action:issue.flag,eventId:issue.eventId??null});
  }
  const latest=after??before,observed=comparison.interval??latest.route;
  if(observed.serverError)queue.push({source:comparison.interval?'interval':after?'after':'before',routeId:latest.scope.routeId,kind:'http',action:`Review ${observed.serverError} observed HTTP 5xx response(s) in the original backend and seller operation log.`});
  if(observed.disconnected)queue.push({source:comparison.interval?'interval':after?'after':'before',routeId:latest.scope.routeId,kind:'http',action:`Review ${observed.disconnected} disconnected request(s), backend deadlines and caller cancellation.`});
  return {schema:'stellar-forge.merchant-runtime-review.v1',generatedAt:new Date().toISOString(),
    before,after,comparison,queue,summary:parsed.summary,
    interpretation:'HTTP outcomes, native settlement notices, merchant inbox delivery and customer fulfillment are separate observations. Original packet hashes identify retained bytes; they do not authenticate a seller.'};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bindingLabel=value=>({CURRENT_ROUTE:'Current saved route',HISTORICAL_ROUTE_VARIANT:'Earlier method or path',REMOVED_ROUTE:'Removed from current report'}[value]??value);
const coverageLabel=value=>({RECORDED:'Recorded',NOT_RECORDED:'Not recorded for this route',LEGACY_UNKNOWN:'Earlier export: route membership unavailable'}[value]??value);
const htmlTable=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(h=>'<th>'+escape(h)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+escape(value??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function periodHtml(c) {
  if(!c.period)return '';
  const p=c.period;
  return `<h3>Retained UTC selection</h3><p>${escape(p.range.from)} → ${escape(p.range.to)} · Effective ${escape(p.range.effectiveFrom??'none')} → ${escape(p.range.effectiveTo??'none')} · Exported ${escape(p.exportedAt)}</p>
    <p>Selected method/path: ${escape(c.route.method)} ${escape(c.route.path)} · ${escape(bindingLabel(c.route.binding))}. Saved days without this route are shown as unavailable. Daily starts and completions can belong to different requests.</p>`+
    htmlTable(['UTC day','Started','Completed','Responses','2xx','402','5xx','Disconnected','P95 upper ms'],p.days.map(day=>[day.day,
      ...['started','completed','responses','success','challenge','serverError','disconnected','latencyP95UpperBoundMs'].map(key=>day.route?.[key]??null)]))+
    '<details><summary>Original saved sessions and coverage</summary>'+htmlTable(['Session','Mode / state','Saved interval','Selected-route coverage','Outstanding / errors'],p.sessions.map(session=>[
      session.sessionId,session.mode+' / '+session.state,session.startedAt+' → '+session.capturedAt,
      coverageLabel(session.selectedRouteCoverage)+(session.selectedRouteDays?.length?' · '+session.selectedRouteDays.join(', '):''),
      session.outstandingAtCheckpoint+' / '+session.observerErrors]))+'</details>'+
    '<details><summary>Retained route variants</summary>'+htmlTable(['Method / path','Binding','Started','Completed','2xx','402','5xx'],p.variants.map(row=>[
      row.method+' '+row.path,bindingLabel(row.binding)+(row.hasSavedCoverage?'':' / no saved observations'),row.started,row.completed,row.success,row.challenge,row.serverError]))+'</details>'+
    '<p>Session gaps remain uncovered. Interrupted sessions stop at their actual saved checkpoint. '+
      (p.coverageFormat?'The original export supplies exact session/day route membership.':'This original export supplies the earlier, coarser session/day coverage.')+'</p>';
}
function nativeHtml(c) {
  const n=c.native,selected=option=>option.routeId===c.scope.routeId&&option.method===c.route.method;
  const options=n?n.options.filter(selected):c.period?.paymentOptions??[];
  let output='';
  if(options.length)output='<details><summary>Current saved report payment options</summary><p>These are the exact original option identities for '+
    escape(c.period?.currentReportPath??c.scope.routeId)+'. HTTP counts are not allocated to payment alternatives.</p>'+
    htmlTable(['Option','Network','Atomic amount / timeout','Asset SHA-256','Recipient SHA-256','Extra'],options.map(option=>[
      option.optionIndex,option.network,option.amountAtomic+' / '+(option.maxTimeoutSeconds??'unknown')+'s',
      option.assetDigest,option.recipientDigest,option.hasExtra?'Present in original report':'None']))+'</details>';
  if(!n)return output+'<p>No original native journals attached to this capture.</p>';
  const route=n.routes.find(selected),current=!c.period||c.route.binding==='CURRENT_ROUTE';
  output+='<h3>Original native delivery reconciliation</h3><p>'+escape(n.observedFrom)+' → '+escape(n.observedUntil)+' · '+escape(n.snapshotRelation)+'</p>';
  if(route&&current)output+=htmlTable(['Matched notices','Inbox accepted','Pending','Exhausted'],[[route.nativeSuccessEvents,route.acceptedByMerchantInbox,route.pendingDelivery,route.exhaustedDelivery]]);
  if(!current)output+='<p>The selected historical method/path has no current payment-option attribution. Original event decisions below retain their recorded route coverage.</p>';
  output+='<details><summary>Original native option outcomes and event decisions</summary>'+
    htmlTable(['Current option','Matched notices','Inbox accepted','Pending','Exhausted'],options.map(option=>[
      option.optionIndex,option.nativeSuccessEvents,option.acceptedByMerchantInbox,option.pendingDelivery,option.exhaustedDelivery]))+
    htmlTable(['Event / time','Terms decision','Option / delivery','Observed coverage'],n.events.filter(selected).map(event=>[
      event.eventId+' / '+event.at,event.termsMatch,(event.optionId??'Unassigned')+' / '+event.deliveryState,
      (event.coverageBasis??event.observationMatch)+' · '+(event.observedSessionIds??[]).join(', ')]))+'</details>';
  if(n.excludedEvents)output+='<details><summary>Original events outside this period coverage</summary>'+
    htmlTable(['Event','Time','Reason'],n.excludedEvents.filter(selected).map(event=>[event.eventId,event.at,event.reason]))+'</details>';
  return output+'<p>Inbox acceptance is callback delivery. Customer fulfillment and independent chain reconciliation remain separate.</p>';
}
function periodComparisonHtml(comparison) {
  if(!comparison.periods)return '';
  const p=comparison.periods,measures=[['started','Started'],['completed','Completed'],['responses','HTTP responses'],
    ['httpSuccessPercent','2xx share %'],['httpChallengePercent','402 share %'],['httpServerErrorPercent','5xx share %'],['disconnectPercent','Disconnected share %']];
  return htmlTable(['Observed measure','Before','After','Change in percentage points'],measures.map(([key,label])=>[
    label,p.before[key],p.after[key],p.percentagePointChange?.[key]??null]));
}
export function runtimeHtml(report,{name='Merchant case',metadata={}}={}) {
  const sections=['before','after'].filter(side=>report[side]).map(side=>{
    const c=report[side],r=c.route;
    return `<section><h2>${side==='before'?'Before':'After'} · ${escape(r.id)}</h2><p>${escape(c.scope.inputs.resource)} · ${escape(r.method)}</p><p>${escape(c.startedAt)} → ${escape(c.capturedAt)} · ${escape(c.mode)} · ${c.period?c.sessionIds.length+' original sessions':'Session '+escape(c.sessionId)}</p>
      <table><tr><th>Started</th><th>Completed</th><th>2xx</th><th>402</th><th>5xx</th><th>Disconnected</th></tr><tr>${['started','completed','success','challenge','serverError','disconnected'].map(k=>'<td>'+r[k]+'</td>').join('')}</tr></table>
      <p>${c.caseMatches?'Mapped to the current case inputs.':'Saved mapping differs from the current case.'}</p>
      ${periodHtml(c)}${nativeHtml(c)}
      <details><summary>Original runtime alerts</summary><ul>${c.alerts.map(a=>'<li>'+escape(a)+'</li>').join('')}</ul></details>
      <details><summary>Original source files</summary><table><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr>${c.files.map(f=>`<tr><td>${escape(f.name)}</td><td>${f.bytes}</td><td><code>${f.sha256}</code></td></tr>`).join('')}</table></details></section>`;
  }).join('');
  const interval=report.comparison.interval;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(name)} · Runtime support</title><style>body{margin:0;background:#f3f3f3;color:#222;font:14px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:32px 20px}h1{font-size:26px}h2{font-size:19px}h3{font-size:16px}header{border-bottom:2px solid #444}section{background:white;border:1px solid #ccc;padding:20px;margin:18px 0}p,li,td{overflow-wrap:anywhere}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;vertical-align:top}code{font-size:11px;overflow-wrap:anywhere}summary{cursor:pointer}small{color:#555}pre{white-space:pre-wrap}@media(max-width:620px){th,td{padding:5px;font-size:11px}main{padding:16px 10px}section{padding:12px}}@media print{body{background:white}section{break-inside:avoid}main{padding:0}}</style></head><body><main><header><small>Merchant operations · Private support handoff</small><h1>${escape(name)}</h1><p>${escape(metadata.merchant)} · Owner ${escape(metadata.owner||'Unassigned')} · ${escape(metadata.status||'new')}</p><p>Next action: ${escape(metadata.nextAction||'Not recorded')} · Follow-up ${escape(metadata.followUpOn||'Not recorded')}</p></header><section><h2>Runtime review</h2><p>${escape(report.comparison.detail)}</p>${periodComparisonHtml(report.comparison)}${interval?`<p>Interval: ${interval.started} starts · ${interval.completed} completions · ${interval.success} 2xx · ${interval.challenge} 402 · ${interval.serverError} 5xx · ${interval.disconnected} disconnects.</p>`:''}<ul>${report.queue.map(q=>`<li><b>${escape(q.source)} · ${escape(q.routeId)}</b>: ${escape(q.action)}</li>`).join('')||'<li>No additional repair action identified from these attached sources.</li>'}</ul></section>${sections}<section><h2>Case notes</h2><pre>${escape(metadata.notes||'No notes recorded.')}</pre><h2>Interpretation</h2><p>${escape(report.interpretation)}</p><p>Capture sources and unfinished commercial terms remain in the portable support handoff. This document does not send a message or record an agreement.</p></section><small>Generated ${escape(report.generatedAt)}</small></main></body></html>`;
}
export async function exportRuntimeHandoff({workspaceText,supportText,metadata}) {
  const workspace=await parseWorkspace(workspaceText),report=reviewRuntime(supportText,workspace.inputs);
  const file=JSON.stringify({schema:HANDOFF_SCHEMA,generatedAt:report.generatedAt,workspaceText,supportText,metadata,
    sha256:{workspace:sha(workspaceText),support:sha(supportText)}},null,2)+'\n';
  if(Buffer.byteLength(file)>MAX_HANDOFF_BYTES)fail('Support handoff exceeds the portable file limit');
  return {handoff:file,html:runtimeHtml(report,{name:workspace.name,metadata}),report};
}
export async function importRuntimeHandoff(handoffText) {
  text(handoffText,MAX_HANDOFF_BYTES,'support handoff',false);
  const file=json(Buffer.from(handoffText),'support handoff');
  fields(file,['schema','generatedAt','workspaceText','supportText','metadata','sha256'],'support handoff');
  if(file.schema!==HANDOFF_SCHEMA||!instant(file.generatedAt)||!plain(file.sha256)||
    typeof file.workspaceText!=='string'||typeof file.supportText!=='string'||
    file.sha256.workspace!==sha(file.workspaceText)||file.sha256.support!==sha(file.supportText))
    fail('Support handoff original source hashes disagree');
  await parseWorkspace(file.workspaceText);parseRuntime(file.supportText);
  return {workspaceText:file.workspaceText,supportText:file.supportText,metadata:file.metadata};
}
