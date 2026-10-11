// MIT. Original SF93 packets and SF97/SF98 reconciliation in the SF74 case desk.
// Pure file intake: never opens a seller, journal writer, wallet or network client.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {reconcile} from '../sf97-merchant-revenue-ops/native-reconcile.mjs';
import {parseWorkspace} from './workspace-file.mjs';

export const RUNTIME_SCHEMA = 'stellar-forge.merchant-runtime-case.v1';
export const HANDOFF_SCHEMA = 'stellar-forge.merchant-support-handoff.v1';
export const MAX_RUNTIME_BYTES = 38_000_000;
export const MAX_HANDOFF_BYTES = 60_000_000;
const MAX_FILE = 2_000_000;
const PACKET_FILES = ['bundle.json','operator-brief.md','metrics.prom','manifest.json'];
const NATIVE_FILES = ['report.json','events.ndjson','deliveries.ndjson'];
const FILES = [...PACKET_FILES,...NATIVE_FILES];
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
function source(value,name) {
  fields(value,['encoding','bytes','sha256','data'],name+' source');
  if(value.encoding!=='base64'||typeof value.data!=='string'||value.data.length>4*Math.ceil(MAX_FILE/3)||
    !HASH.test(value.sha256??''))fail('Invalid '+name+' source metadata');
  const bytes=Buffer.from(value.data,'base64');
  const empty=NATIVE_FILES.includes(name)&&name.endsWith('.ndjson');
  if((!empty&&!bytes.length)||bytes.length>MAX_FILE||value.bytes!==bytes.length||
    bytes.toString('base64')!==value.data||sha(bytes)!==value.sha256)
    fail(name+' source bytes or SHA-256 do not match');
  utf8.decode(bytes);
  return bytes;
}
export function encodeRuntimeSource(bytes) {
  const value=Buffer.from(bytes);
  if(value.length>MAX_FILE)fail('Each runtime source is limited to 2,000,000 bytes');
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
function sample(value) {
  fields(value,['scope','files'],'runtime capture');
  fields(value.scope,['inputs','routeId'],'runtime route mapping');
  const inputs=inputScope(value.scope.inputs),routeId=text(value.scope.routeId,80,'selected runtime route',false);
  fields(value.files,FILES,'runtime files');
  const bytes={};
  for(const name of PACKET_FILES)bytes[name]=source(value.files[name],name);
  const nativeCount=NATIVE_FILES.filter(name=>own(value.files,name)).length;
  if(nativeCount&&nativeCount!==NATIVE_FILES.length)fail('Native reconciliation needs the original report.json and both SF98 journal files');
  for(const name of NATIVE_FILES)if(own(value.files,name))bytes[name]=source(value.files[name],name);
  const original=runtimePacket(bytes);
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
  return {scope:{inputs,routeId},files:value.files,original,route,native};
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
    sourceBytes:[before,after].filter(Boolean).reduce((n,s)=>n+Object.values(s.files).reduce((k,f)=>k+f.bytes,0),0)}};
}
export function inspectRuntimeFiles({files,inputs,routeId}) {
  fields(files,FILES,'uploaded runtime files');
  const wrapped={};
  for(const [name,data] of Object.entries(files)) {
    if(typeof data!=='string'||data.length>4*Math.ceil(MAX_FILE/3))fail('Invalid uploaded '+name);
    const bytes=Buffer.from(data,'base64');
    if(bytes.toString('base64')!==data)fail('Invalid source encoding for '+name);
    wrapped[name]=encodeRuntimeSource(bytes);
  }
  // Inspect before a route has been selected, then require a concrete operator
  // mapping for attachment. The packet itself does not claim an external origin.
  const original=runtimePacket(Object.fromEntries(PACKET_FILES.map(name=>[name,source(wrapped[name],name)])));
  if(routeId===undefined)return {routes:original.seller.advertisedRoutes,sessionId:original.observation.sessionId,
    capturedAt:original.observation.capturedAt,mode:original.seller.mode};
  const checked=sample({scope:{inputs,routeId},files:wrapped});
  return {capture:{scope:checked.scope,files:checked.files},view:captureView(checked,inputs)};
}
function captureView(capture,currentInputs) {
  if(!capture)return null;
  const o=capture.original.observation;
  const native=capture.native;
  return {scope:capture.scope,caseMatches:isDeepStrictEqual(capture.scope.inputs,inputScope(currentInputs)),
    capturedAt:o.capturedAt,startedAt:o.startedAt,sessionId:o.sessionId,mode:capture.original.seller.mode,
    observerAttached:o.attached,observerErrors:o.observerErrors,
    route:{id:capture.route.id,method:capture.route.method,...counters(capture.route,'selected route'),
      statuses:capture.route.statuses,latencyP95UpperBoundMs:capture.route.latencyP95UpperBoundMs??null},
    alerts:capture.original.alerts,
    files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256})),
    native};
}
function compareRuntime(before,after) {
  if(!before||!after)return {state:'ONE_CAPTURE',detail:'Attach a second original capture to review the runtime interval.',interval:null};
  if(!isDeepStrictEqual(before.scope,after.scope)||!before.caseMatches||!after.caseMatches)
    return {state:'SCOPE_DIFFERS',detail:'The case inputs or selected runtime route changed. Review each capture under its saved scope.',interval:null};
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
    if(!capture.observerAttached||capture.observerErrors)queue.push({source:side,routeId:capture.scope.routeId,kind:'observer',action:'Inspect the original observer lifecycle and errors before relying on complete traffic counts.'});
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
export function runtimeHtml(report,{name='Merchant case',metadata={}}={}) {
  const sections=['before','after'].filter(side=>report[side]).map(side=>{
    const c=report[side],r=c.route,n=c.native?.routes.find(route=>route.routeId===c.scope.routeId);
    return `<section><h2>${side==='before'?'Before':'After'} · ${escape(r.id)}</h2><p>${escape(c.scope.inputs.resource)} · ${escape(r.method)}</p><p>${escape(c.startedAt)} → ${escape(c.capturedAt)} · ${escape(c.mode)} · Session ${escape(c.sessionId)}</p>
      <table><tr><th>Started</th><th>Completed</th><th>2xx</th><th>402</th><th>5xx</th><th>Disconnected</th></tr><tr>${['started','completed','success','challenge','serverError','disconnected'].map(k=>'<td>'+r[k]+'</td>').join('')}</tr></table>
      <p>${c.caseMatches?'Mapped to the current case inputs.':'Saved mapping differs from the current case.'}</p>
      ${n?`<h3>Original native delivery reconciliation</h3><p>Window ${escape(c.native.observedFrom)} → ${escape(c.native.observedUntil)} · ${escape(c.native.snapshotRelation)}</p><p>${n.nativeSuccessEvents} matched native notices · ${n.acceptedByMerchantInbox} accepted by merchant inbox · ${n.pendingDelivery} pending · ${n.exhaustedDelivery} exhausted.</p>`:'<p>No native journals attached to this capture.</p>'}
      <details><summary>Original runtime alerts</summary><ul>${c.alerts.map(a=>'<li>'+escape(a)+'</li>').join('')}</ul></details>
      <details><summary>Original source files</summary><table><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr>${c.files.map(f=>`<tr><td>${escape(f.name)}</td><td>${f.bytes}</td><td><code>${f.sha256}</code></td></tr>`).join('')}</table></details></section>`;
  }).join('');
  const interval=report.comparison.interval;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(name)} · Runtime support</title><style>body{margin:0;background:#f3f3f3;color:#222;font:14px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:32px 20px}h1{font-size:26px}h2{font-size:19px}h3{font-size:16px}header{border-bottom:2px solid #444}section{background:white;border:1px solid #ccc;padding:20px;margin:18px 0}p,li,td{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:14px 0}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;vertical-align:top}code{font-size:11px;overflow-wrap:anywhere}summary{cursor:pointer}small{color:#555}pre{white-space:pre-wrap}@media(max-width:620px){th,td{padding:5px;font-size:11px}main{padding:16px 10px}section{padding:12px}}@media print{body{background:white}section{break-inside:avoid}main{padding:0}}</style></head><body><main><header><small>Merchant operations · Private support handoff</small><h1>${escape(name)}</h1><p>${escape(metadata.merchant)} · Owner ${escape(metadata.owner||'Unassigned')} · ${escape(metadata.status||'new')}</p><p>Next action: ${escape(metadata.nextAction||'Not recorded')} · Follow-up ${escape(metadata.followUpOn||'Not recorded')}</p></header><section><h2>Runtime review</h2><p>${escape(report.comparison.detail)}</p>${interval?`<p>Interval: ${interval.started} starts · ${interval.completed} completions · ${interval.success} 2xx · ${interval.challenge} 402 · ${interval.serverError} 5xx · ${interval.disconnected} disconnects.</p>`:''}<ul>${report.queue.map(q=>`<li><b>${escape(q.source)} · ${escape(q.routeId)}</b>: ${escape(q.action)}</li>`).join('')||'<li>No additional repair action identified from these attached sources.</li>'}</ul></section>${sections}<section><h2>Case notes</h2><pre>${escape(metadata.notes||'No notes recorded.')}</pre><h2>Interpretation</h2><p>${escape(report.interpretation)}</p><p>Capture sources and unfinished commercial terms remain in the portable support handoff. This document does not send a message or record an agreement.</p></section><small>Generated ${escape(report.generatedAt)}</small></main></body></html>`;
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
