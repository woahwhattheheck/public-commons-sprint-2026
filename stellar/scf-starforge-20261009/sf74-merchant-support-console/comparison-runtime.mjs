// SPDX-License-Identifier: MIT
// Pure SF101 comparison observations in the original SF74 Support case.
// Reopens retained bytes only; no native verification, decryption or restore.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateObjectRecoveryComparison,renderObjectRecoveryComparison} from '../sf88-operator-buyer-cli/object-comparison-core.mjs';

export const COMPARISON_SCHEMA='stellar-forge.sf101.comparison-observation.v1';
export const COMPARISON_FILES=['comparison-observation.json','comparison-request.json','comparison-artifacts.ndjson'];
export const COMPARISON_FILE_LIMIT=64*1024*1024;
const REQUEST_SCHEMA='stellar-forge.recovery-workspace-request.v1';
const NATIVE_SCHEMA='stellar-forge.sf88.object-session-comparison.v1';
const MAX_REQUEST=2*1024*1024,MAX_REFS=4096;
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const MEDIA={result:'application/json',html:'text/html',markdown:'text/markdown'};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const need=(condition,message)=>{if(!condition)throw new TypeError('Comparison observation: '+message);};
function fields(value,allowed,label,required=allowed){
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>own(value,key)),'invalid '+label);
  return value;
}
function text(value,label,max=8192){
  need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=max&&decoder.decode(Buffer.from(value))===value,'invalid '+label);
  return value;
}
function hash(value,label){need(typeof value==='string'&&HASH.test(value),'invalid '+label);return value;}
function count(value,label){need(Number.isSafeInteger(value)&&value>=0,'invalid '+label);return value;}
function instant(value,label){need(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'invalid '+label);return value;}
function id(value,label){need(typeof value==='string'&&ID.test(value),'invalid '+label);return value;}
function parse(raw,label,maximum){
  const bytes=Buffer.from(raw??[]);
  need(bytes.length>0&&bytes.length<=maximum,label+' exceeds its complete source limit');
  let value;try{value=JSON.parse(decoder.decode(bytes));}catch{need(false,label+' must contain original UTF-8 JSON');}
  return {bytes,value};
}
function identity(value,label){
  fields(value,['sha256','bytes','mediaType'],label);
  hash(value.sha256,label+' hash');count(value.bytes,label+' bytes');
  need(value.bytes>0&&value.bytes<=COMPARISON_FILE_LIMIT&&Object.values(MEDIA).includes(value.mediaType),'invalid '+label);
  return value;
}
function artifactMaps(request){
  const rows=[];
  const add=(value,label)=>{if(value===undefined||value===null)return;
    need(plain(value),'invalid '+label);fields(value,Object.keys(MEDIA),label,[]);
    for(const [kind,ref] of Object.entries(value)){identity(ref,label+' '+kind);need(ref.mediaType===MEDIA[kind],'artifact kind and media type differ');}
    rows.push(value);
  };
  add(request?.result?.artifacts,'saved result artifacts');
  add(request?.local?.objectComparisonLastResult?.artifacts,'last result artifacts');
  const history=request?.local?.objectComparisonEvidence??[];
  need(Array.isArray(history)&&history.length<=MAX_REFS,'invalid original comparison history');
  for(const row of history){
    fields(row,['observedAt','artifacts','status','completionReported'],'original comparison history entry');
    instant(row.observedAt,'evidence observation');need(['COMPLETE','INTERRUPTED'].includes(row.status)&&typeof row.completionReported==='boolean','invalid original history outcome');
    add(row.artifacts,'history artifacts');
  }
  return rows;
}
/** Unique complete inventory; ordered repeated history remains in the original request. */
export function comparisonArtifactReferences(request){
  need(plain(request),'supply the original request');
  const found=new Map();
  for(const map of artifactMaps(request))for(const ref of Object.values(map)){
    const previous=found.get(ref.sha256);
    need(!previous||isDeepStrictEqual(previous,ref),'one artifact hash has conflicting metadata');
    found.set(ref.sha256,clone(ref));need(found.size<=MAX_REFS,'artifact inventory exceeds its limit');
  }
  return [...found.values()].sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0);
}
function declaration(value,label){
  need(plain(value),'invalid '+label+' declaration');id(value.id,label+' declaration ID');
  for(const name of ['bundle','directory','stateRoot']){text(value[name],label+' '+name);need(value[name].startsWith('/'),'original native path must be absolute');}
  text(value.sessionId,'native session',160);
  need(Array.isArray(value.kinds)&&value.kinds.includes('verify'),'original declaration must permit verification');
}
function requested(raw){
  const {bytes,value:r}=parse(raw,'comparison-request.json',MAX_REQUEST);
  fields(r,['schema','review','phase','attempts','createdAt','updatedAt','local','result','error'],'original request',
    ['schema','review','phase','attempts','createdAt','updatedAt']);
  need(r.schema===REQUEST_SCHEMA&&['PREPARED','RUNNING','COMPLETE','INTERRUPTED','FAILED'].includes(r.phase),'invalid original request schema or phase');
  count(r.attempts,'request attempts');instant(r.createdAt,'request creation');instant(r.updatedAt,'request update');
  need(r.updatedAt>=r.createdAt,'request update precedes creation');
  const v=r.review;need(plain(v)&&v.command==='object-compare'&&plain(v.options)&&plain(v.objectComparison),'expected original comparison review');
  id(v.profileId,'profile');id(v.operationId,'request');hash(v.reviewHash,'review hash');
  need(v.store===null&&v.snapshotId===null,'comparison cannot select a managed store');
  const selection={profileId:v.profileId,command:v.command,operationId:v.operationId,store:v.store,snapshotId:v.snapshotId,options:v.options};
  need(sha(JSON.stringify(selection))===v.reviewHash,'original reviewed selection hash differs');
  const q=v.objectComparison;
  fields(q,['profileId','before','after','beforeExpectedRecordSha256','afterExpectedRecordSha256','passEnv'],'original comparison selection');
  need(q.profileId===v.profileId&&isDeepStrictEqual(v.options.objectComparison,q)&&
    v.options.command===v.command&&v.options.id===v.operationId&&
    (v.options.passEnv??null)===q.passEnv&&v.source===q.before?.bundle&&v.destination===null,'reviewed options differ');
  need(q.passEnv===null||typeof q.passEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(q.passEnv),'invalid original environment name');
  for(const side of ['before','after']){
    declaration(q[side],side);hash(q[side+'ExpectedRecordSha256'],side+' record');
    need(q[side].expectedRecordSha256==null||q[side].expectedRecordSha256===q[side+'ExpectedRecordSha256'],'record differs from trusted declaration');
  }
  need(['sessionId','directory','stateRoot'].every(key=>q.before[key]===q.after[key]),'selected backups belong to different original sources');
  if(r.local!==undefined)need(plain(r.local),'invalid original local state');
  if(r.result!==undefined)need(r.result===null||plain(r.result),'invalid original result');
  if(r.local?.objectComparisonLastResult!==undefined)need(plain(r.local.objectComparisonLastResult),'invalid original last result');
  const refs=comparisonArtifactReferences(r);
  // Calculate the minimum encoded cohort before allocating any decoded artifact.
  need(refs.reduce((n,ref)=>n+4*Math.ceil(ref.bytes/3)+JSON.stringify({...ref,data:''}).length+1,bytes.length+1)<=COMPARISON_FILE_LIMIT,
    'complete request and encoded artifact inventory exceed 64 MiB; no source can be truncated');
  return {bytes,request:r,review:q,references:refs};
}
function sourceMatches(report,selected){
  const q=selected.review,partial=report?.status==='OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE';
  if(!plain(report)||report.schema!==NATIVE_SCHEMA)return false;
  if(!partial&&['sessionId','directory','stateRoot'].some(key=>report[key]!==q.before[key]))return false;
  for(const side of ['before','after']){
    const d=q[side],expected=q[side+'ExpectedRecordSha256'],n=report[side];
    if(partial&&(report.selection?.[side]?.bundle!==d.bundle||report.selection?.[side]?.expected!==expected))return false;
    if(!n){if(partial)continue;return false;}
    if(n.bundle!==d.bundle||n.recordSha256!==expected||n.verification?.recordSha256!==expected||
      n.verification?.directory!==d.directory||n.verification?.stateRoot!==d.stateRoot||
      n.verification?.objectSession?.sessionId!==d.sessionId||n.record?.plan?.directory!==d.directory||
      n.record?.plan?.stateRoot!==d.stateRoot||n.record?.plan?.objectSession?.sessionId!==d.sessionId)return false;
  }
  return true;
}
function cleanSdk(value){
  return value?.operation==='compare'&&value.ok===true&&value.completionReported===true&&
    value.process?.exitCode===0&&!value.process.exitSignal&&!value.process.errorCode&&!value.process.cleanupErrorCode;
}
function sdkObservation(value,selected){
  need(plain(value)&&value.operation==='compare'&&typeof value.ok==='boolean'&&typeof value.completionReported==='boolean'&&
    (value.native===null||plain(value.native))&&(value.process===null||plain(value.process)),'invalid complete comparison SDK result');
  const report=value.native?.status==='OBJECT_SESSION_BACKUPS_COMPARED'?value.native:
    value.native?.partialComparison??value.partialComparison??
    (value.native?.status==='OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE'?value.native:null);
  let valid=false,validationError=null;
  if(report){
    try{validateObjectRecoveryComparison(report);valid=true;}catch(error){validationError=String(error.code??error.message);}
  }
  const matches=valid&&sourceMatches(report,selected),complete=valid&&matches&&report.authenticated===true&&
    report.status==='OBJECT_SESSION_BACKUPS_COMPARED'&&cleanSdk(value);
  return {report,valid,matches,complete,summary:{
    validation:report?(valid?'RETAINED_CONTENT_VALID':'RETAINED_CONTENT_INVALID'):'NO_NATIVE_REPORT',
    validationError,selectionMatches:matches,cleanNativeCompleted:complete,
    completionReported:value.completionReported,ok:value.ok,process:clone(value.process),status:report?.status??value.native?.status??null,
    authenticatedRecorded:valid&&report.authenticated===true,comparisonSha256:valid?report.comparisonSha256??report.partialComparisonSha256:null,
    failedSide:report?.failedSide??null,error:clone(value.native?.error??value.adapterFailure??null),
    partialErrorCode:report?.errorCode??null,
    completedSides:valid?['before','after'].filter(side=>!!report[side]):[],
    chronology:valid&&report.authenticated===true?clone(report.comparison.chronology):null,
    changes:valid&&report.authenticated===true?clone(report.comparison.summary):null}};
}
function readArtifacts(raw,selected){
  const bytes=Buffer.from(raw??[]);need(bytes.length>0&&bytes.length<=COMPARISON_FILE_LIMIT,'artifact source exceeds its limit');
  let body;try{body=decoder.decode(bytes);}catch{need(false,'artifact source must be original UTF-8 NDJSON');}
  need(body.endsWith('\n'),'artifact source needs a final newline');
  const lines=body==='\n'?[]:body.slice(0,-1).split('\n');
  need(lines.length===selected.references.length,'complete artifact inventory differs');
  const rows=[],byHash=new Map();
  for(let i=0;i<lines.length;i++){
    let row;try{row=JSON.parse(lines[i]);}catch{need(false,'invalid artifact source row');}
    fields(row,['sha256','bytes','mediaType','data'],'artifact row');const ref={sha256:row.sha256,bytes:row.bytes,mediaType:row.mediaType};
    need(isDeepStrictEqual(ref,selected.references[i]),'artifact rows must be unique, complete and sorted by original hash');
    need(typeof row.data==='string'&&row.data.length===4*Math.ceil(row.bytes/3),'artifact encoding exceeds original length');
    const source=Buffer.from(row.data,'base64');
    need(source.length===row.bytes&&source.toString('base64')===row.data&&sha(source)===row.sha256,'complete artifact bytes or hash differ');
    let textValue;try{textValue=decoder.decode(source);}catch{need(false,'original artifact must be UTF-8');}
    const entry={...ref,source};
    if(row.mediaType==='application/json'){
      const {value}=parse(source,'original comparison SDK result',COMPARISON_FILE_LIMIT);
      entry.result=value;entry.observation=sdkObservation(value,selected);
    }
    rows.push(entry);byHash.set(row.sha256,entry);
  }
  const maps=artifactMaps(selected.request),groups=[],renderedIdentities=new Map();
  for(const map of maps){
    const result=map.result?byHash.get(map.result.sha256):null,observation=result?.observation;
    const reports={};
    for(const kind of ['html','markdown']){
      const ref=map[kind];if(!ref)continue;
      const entry=byHash.get(ref.sha256);let matches=false;
      if(observation?.valid&&observation.matches){
        const key=result.sha256+':'+kind;
        let rendered=renderedIdentities.get(key);
        if(!rendered){const body=Buffer.from(renderObjectRecoveryComparison(observation.report,{format:kind}),'utf8');
          rendered={bytes:body.length,sha256:sha(body)};renderedIdentities.set(key,rendered);}
        matches=rendered.bytes===entry.bytes&&rendered.sha256===entry.sha256;
      }
      reports[kind]={...clone(ref),matchesOriginalRenderer:matches};
    }
    groups.push({artifacts:clone(map),resultSha256:map.result?.sha256??null,
      cleanNativeCompleted:observation?.complete===true,reports});
  }
  return {bytes,rows,byHash,groups};
}
function outcomeMatches(value,selected,artifacts){
  if(!plain(value)||value.status!=='COMPLETE'||value.ok!==true||value.command!=='object-compare'||
    value.completionReported!==true||value.error||value.bindingError||value.statePublicationError||
    !Array.isArray(value.publicationErrors)||value.publicationErrors.length)return false;
  const q=selected.review;
  if(value.sessionId!==q.before.sessionId||['before','after'].some(side=>
    value[side+'ObjectSessionId']!==q[side].id||value[side+'ExpectedRecordSha256']!==q[side+'ExpectedRecordSha256']))return false;
  const group=artifacts.groups.find(row=>isDeepStrictEqual(row.artifacts,value.artifacts));
  return group?.cleanNativeCompleted===true&&group.reports.html?.matchesOriginalRenderer===true&&group.reports.markdown?.matchesOriginalRenderer===true&&
    isDeepStrictEqual(value.process,artifacts.byHash.get(value.artifacts.result.sha256).result.process);
}
/** Validate the complete original cohort; never opens a path or invokes the SDK. */
export function readComparisonObservationFiles(files){
  fields(files,COMPARISON_FILES,'comparison files');
  const selected=requested(files['comparison-request.json']);
  const parsed=parse(files['comparison-observation.json'],'comparison-observation.json',MAX_REQUEST);
  const m=parsed.value;
  fields(m,['schema','capturedAt','workspaceId','profileId','requestId','reviewHash','command','sessionId',
    'beforeObjectSessionId','afterObjectSessionId','request','artifacts','bundles'],'comparison observation');
  need(m.schema===COMPARISON_SCHEMA,'unsupported observation schema');instant(m.capturedAt,'capture time');text(m.workspaceId,'workspace identity',160);
  const v=selected.request.review,q=selected.review;
  need(m.profileId===v.profileId&&m.requestId===v.operationId&&m.reviewHash===v.reviewHash&&m.command===v.command&&
    m.sessionId===q.before.sessionId&&m.beforeObjectSessionId===q.before.id&&m.afterObjectSessionId===q.after.id,
    'observation and original reviewed selection differ');
  fields(m.request,['sha256','bytes'],'request identity');hash(m.request.sha256,'request hash');
  need(m.request.bytes===selected.bytes.length&&m.request.sha256===sha(selected.bytes),'original request bytes differ');
  need(isDeepStrictEqual(m.artifacts,selected.references),'complete original artifact references differ');
  fields(m.bundles,['before','after'],'external bundles');
  for(const side of ['before','after']){
    const b=m.bundles[side];fields(b,['path','recordSha256','availability'],side+' external bundle');
    need(b.path===q[side].bundle&&b.recordSha256===q[side+'ExpectedRecordSha256']&&b.availability==='EXTERNAL_NATIVE_BUNDLE','external bundle binding differs');
  }
  need(m.capturedAt>=selected.request.updatedAt,'capture precedes the retained request');
  const raw=Buffer.from(files['comparison-artifacts.ndjson']??[]);
  need(parsed.bytes.length+selected.bytes.length+raw.length<=COMPARISON_FILE_LIMIT,'complete comparison capture exceeds 64 MiB; no artifact is truncated');
  const artifacts=readArtifacts(raw,selected),final=selected.request.result??selected.request.local?.objectComparisonLastResult??null;
  const completed=outcomeMatches(final,selected,artifacts);
  if(selected.request.phase==='COMPLETE')need(completed,'completed request requires its exact clean SDK result and both original rendered reports');
  const nativeResults=artifacts.rows.filter(row=>row.observation).map(row=>({sha256:row.sha256,bytes:row.bytes,...row.observation.summary}));
  return {meta:m,request:selected.request,artifacts:artifacts.rows,
    summary:{workspaceId:m.workspaceId,profileId:m.profileId,requestId:m.requestId,reviewHash:m.reviewHash,command:m.command,
      sessionId:m.sessionId,beforeObjectSessionId:q.before.id,afterObjectSessionId:q.after.id,
      directory:q.before.directory,stateRoot:q.before.stateRoot,bundles:clone(m.bundles),
      phase:selected.request.phase,attempts:selected.request.attempts,cleanCompleted:selected.request.phase==='COMPLETE'&&completed,
      createdAt:selected.request.createdAt,updatedAt:selected.request.updatedAt,
      requestSha256:m.request.sha256,requestBytes:m.request.bytes,artifactCount:artifacts.rows.length,
      artifactBytes:artifacts.rows.reduce((n,row)=>n+row.bytes,0),artifactIdentities:clone(m.artifacts),
      nativeEvidenceHistory:clone(selected.request.local?.objectComparisonEvidence??[]),
      nativeResults,reportGroups:artifacts.groups,result:clone(final),error:clone(selected.request.error??null)}};
}
/** Supply complete already-read artifact byte buffers, once per unique hash. */
export function createComparisonObservationFiles({capturedAt,workspaceId,requestBytes,artifactBytes}){
  const selected=requested(requestBytes);need(Array.isArray(artifactBytes),'supply the original artifact byte array');
  const inventory=new Map();
  for(const raw of artifactBytes){const body=Buffer.from(raw),h=sha(body);need(!inventory.has(h),'duplicate artifact input');inventory.set(h,body);}
  need(inventory.size===selected.references.length,'artifact input count differs');
  const rows=selected.references.map(ref=>{
    const body=inventory.get(ref.sha256);need(body&&body.length===ref.bytes,'original artifact input is missing or changed');
    return {...ref,data:body.toString('base64')};
  });
  const q=selected.review,v=selected.request.review;
  const meta={schema:COMPARISON_SCHEMA,capturedAt,workspaceId,profileId:v.profileId,requestId:v.operationId,
    reviewHash:v.reviewHash,command:v.command,sessionId:q.before.sessionId,beforeObjectSessionId:q.before.id,afterObjectSessionId:q.after.id,
    request:{sha256:sha(selected.bytes),bytes:selected.bytes.length},artifacts:selected.references,
    bundles:Object.fromEntries(['before','after'].map(side=>[side,{path:q[side].bundle,recordSha256:q[side+'ExpectedRecordSha256'],availability:'EXTERNAL_NATIVE_BUNDLE'}]))};
  const files={'comparison-observation.json':Buffer.from(JSON.stringify(meta)+'\n'),
    'comparison-request.json':selected.bytes,'comparison-artifacts.ndjson':Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n')};
  readComparisonObservationFiles(files);return files;
}
export function comparisonCaptureView(capture,currentInputs){
  const s=capture.original.summary;
  return {kind:'OBJECT_COMPARISON',scope:capture.scope,caseMatches:isDeepStrictEqual(capture.scope.inputs,currentInputs),
    capturedAt:capture.original.meta.capturedAt,startedAt:s.createdAt,sessionId:s.sessionId,
    mode:'RETAINED_OBJECT_COMPARISON',observerAttached:null,observerErrors:0,route:{id:s.requestId,method:null},
    native:null,objectComparison:clone(s),
    alerts:[...(s.cleanCompleted?[]:['The saved request is '+s.phase+'. An absent, partial or unclean result is not a completed comparison.']),
      'Reopening checks the complete retained comparison content and reviewed source bindings. It does not authenticate or decrypt either backup again.',
      'Both encrypted native bundles remain external. This capture does not restore a session or authorize a restore.',
      ...(s.nativeResults.some(row=>!row.selectionMatches)?['Some retained native evidence does not match the trusted reviewed source. Its complete original bytes remain attached as failure evidence.']:[])],
    files:Object.entries(capture.files).map(([name,row])=>({name,bytes:row.bytes,sha256:row.sha256}))};
}
export function compareComparisonCaptures(before,after){
  if(before.kind!=='OBJECT_COMPARISON'||after.kind!=='OBJECT_COMPARISON')return {state:'DIFFERENT_OBSERVATION_KINDS',detail:'Object backup comparisons and other observations keep their original meanings.',interval:null};
  const a=before.objectComparison,b=after.objectComparison;
  if(['workspaceId','profileId','requestId','reviewHash'].some(key=>a[key]!==b[key]))return {state:'SEPARATE_COMPARISON_OPERATIONS',detail:'These captures retain separate original reviewed comparison requests; each outcome remains independent.',interval:null};
  if(after.capturedAt<=before.capturedAt)return {state:'CAPTURE_ORDER',detail:'The after capture must be later than the before capture.',interval:null};
  if(a.createdAt!==b.createdAt||a.attempts>b.attempts||a.updatedAt>b.updatedAt||
    a.artifactIdentities.some(ref=>!b.artifactIdentities.some(next=>isDeepStrictEqual(ref,next)))||
    !isDeepStrictEqual(a.nativeEvidenceHistory,b.nativeEvidenceHistory.slice(0,a.nativeEvidenceHistory.length)))
    return {state:'COMPARISON_HISTORY_DIFFERS',detail:'The later capture does not retain the complete original artifact inventory and ordered native evidence history. Preserve both sources and reconcile their original request.',interval:null};
  return {state:a.requestSha256===b.requestSha256?'SAME_COMPARISON_REQUEST_CAPTURE':'SAME_COMPARISON_OPERATION',
    detail:'The same reviewed comparison request is retained. Native completion, process outcomes and publication errors remain separate; no new backup verification is inferred.',interval:null};
}
export function comparisonRepairQueue(capture,side){
  const s=capture.objectComparison,rows=[];
  if(!s.cleanCompleted)rows.push({source:side,routeId:s.requestId,kind:'comparison',action:'Review the original comparison request, complete SDK result and publication outcomes. Continue through its original SF101 request and review/attempt guards.'});
  if(s.nativeResults.some(row=>!row.selectionMatches))rows.push({source:side,routeId:s.requestId,kind:'identity',action:'Preserve the exact native failure and reconcile its original trusted backup pair before treating it as the selected comparison.'});
  return rows;
}
const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(typeof value==='object'&&value!==null?JSON.stringify(value):value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function comparisonCaptureHtml(capture){
  const s=capture.objectComparison;
  return '<h3>Original Object backup comparison</h3>'+table(['Workspace / profile','Request','Saved phase / attempts','Clean completed result'],
    [[s.workspaceId+' / '+s.profileId,s.requestId,s.phase+' / '+s.attempts,s.cleanCompleted?'Yes':'No']])+
    table(['Native session','Canonical source','State root','Reviewed selection SHA-256'],[[s.sessionId,s.directory,s.stateRoot,s.reviewHash]])+
    '<h3>External encrypted backups</h3>'+table(['Selected side','Declaration','Bundle','Record SHA-256'],
      ['before','after'].map(side=>[side,s[side+'ObjectSessionId'],s.bundles[side].path,s.bundles[side].recordSha256]))+
    '<p>Complete original JSON, HTML and Markdown artifact bytes remain in comparison-artifacts.ndjson in the handoff. Reopening validates saved content; it does not decrypt or restore either backup.</p>'+
    '<h3>Unique native comparison results</h3>'+table(['Result SHA-256','Native status','Retained content','Selected source matches','Clean native completion','Process / changes'],
      s.nativeResults.map(row=>[row.sha256,row.status,row.validation,row.selectionMatches?'Yes':'No',row.cleanNativeCompleted?'Yes':'No',{process:row.process,changes:row.changes}]))+
    '<h3>Original ordered artifact history</h3>'+table(['Entry','Observed','Saved status','Artifact identities'],
      s.nativeEvidenceHistory.map((row,i)=>[i+1,row.observedAt,row.status,row.artifacts]))+
    '<p>Repeated artifact references are preserved. History entries and unique artifacts are not request-attempt counts.</p>'+
    '<h3>Complete artifact inventory</h3>'+table(['SHA-256','Bytes','Media type'],s.artifactIdentities.map(row=>[row.sha256,row.bytes,row.mediaType]))+
    '<details><summary>Original outcomes, failures and report bindings</summary><pre>'+esc(JSON.stringify({result:s.result,error:s.error,nativeResults:s.nativeResults,reportGroups:s.reportGroups},null,2))+'</pre></details>';
}
