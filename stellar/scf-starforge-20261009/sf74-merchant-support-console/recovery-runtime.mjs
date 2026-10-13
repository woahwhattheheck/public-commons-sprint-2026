// MIT. Pure SF101 recovery observations carried by the original SF74 case.
// Original request/evidence bytes are retained; no SDK, filesystem or network action.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const RECOVERY_SCHEMA='stellar-forge.sf101.recovery-observation.v1';
export const RECOVERY_FILES=['recovery-observation.json','recovery-request.json','recovery-evidence.ndjson'];
export const RECOVERY_FILE_LIMIT=64*1024*1024;
const REQUEST_SCHEMA='stellar-forge.recovery-workspace-request.v1';
const EVIDENCE_SCHEMA='stellar-forge.sf101.object-session-evidence.v1';
const NATIVE_SCHEMA='stellar-forge.sf88.object-session-recovery.v1';
const MAX_REQUEST=2*1024*1024,MAX_EVIDENCE=16*1024*1024,MAX_REFS=4096;
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const COMMANDS=['object-snapshot','object-verify','object-restore'];
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{throw new TypeError('Recovery observation: '+message);};
const need=(value,message)=>{if(!value)fail(message);};
function fields(value,allowed,label,required=allowed){
  need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>own(value,k)),'invalid '+label);
  return value;
}
function text(value,label,max=4096){
  need(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=max&&decoder.decode(Buffer.from(value))===value,'invalid '+label);
  return value;
}
function hash(value,label){need(typeof value==='string'&&HASH.test(value),'invalid '+label);return value;}
function count(value,label){need(Number.isSafeInteger(value)&&value>=0,'invalid '+label);return value;}
function instant(value,label){need(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'invalid '+label);return value;}
function identifier(value,label){need(typeof value==='string'&&ID.test(value),'invalid '+label);return value;}
function parse(raw,label,limit){
  const bytes=Buffer.from(raw??[]);
  need(bytes.length>0&&bytes.length<=limit,label+' exceeds its source limit');
  try{return {bytes,value:JSON.parse(decoder.decode(bytes))};}catch{fail(label+' must contain original UTF-8 JSON');}
}
function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function identity(value,label){
  fields(value,['bytes','sha256'],label);count(value.bytes,label+' size');hash(value.sha256,label+' hash');
  need(value.bytes>0,label+' is empty');return value;
}
export function recoveryEvidenceReferences(request){
  const found=new Map();
  const add=(ref,label)=>{
    fields(ref,['sha256','bytes','phase'],label,['sha256','bytes']);
    hash(ref.sha256,label);count(ref.bytes,label);need(ref.bytes>0&&ref.bytes<=MAX_EVIDENCE,'invalid evidence size');
    if(own(ref,'phase'))text(ref.phase,'evidence phase',128);
    const previous=found.get(ref.sha256);
    need(!previous||previous.bytes===ref.bytes,'one evidence hash has conflicting lengths');
    found.set(ref.sha256,{sha256:ref.sha256,bytes:ref.bytes});
    need(found.size<=MAX_REFS,'evidence history exceeds its limit');
  };
  function visit(value,depth=0){
    need(depth<=100,'request nesting exceeds its limit');
    if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}
    if(!plain(value))return;
    for(const [key,v] of Object.entries(value)){
      if(key==='nativeEvidence'&&v!==null)add(v,'native evidence');
      else if(key==='objectRecoveryEvidence'){
        need(Array.isArray(v)&&v.length<=MAX_REFS,'invalid native evidence history');
        for(const ref of v)add(ref,'native evidence history');
      }else visit(v,depth+1);
    }
  }
  visit(request);
  return [...found.values()].sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0);
}
function requested(raw){
  const {bytes,value:r}=parse(raw,'recovery-request.json',MAX_REQUEST);
  fields(r,['schema','review','phase','attempts','createdAt','updatedAt','local','result','error'],
    'original workspace request',['schema','review','phase','attempts','createdAt','updatedAt']);
  need(r.schema===REQUEST_SCHEMA,'unsupported original request schema');
  need(['PREPARED','RUNNING','COMPLETE','INTERRUPTED','FAILED'].includes(r.phase),'invalid saved request phase');
  count(r.attempts,'attempt count');instant(r.createdAt,'request creation');instant(r.updatedAt,'request update');
  need(r.updatedAt>=r.createdAt,'request update precedes creation');
  const v=r.review;
  need(plain(v)&&COMMANDS.includes(v.command)&&plain(v.options)&&plain(v.objectDeclaration)&&plain(v.objectRecovery),'expected original Object recovery review');
  identifier(v.profileId,'profile');identifier(v.operationId,'request');hash(v.reviewHash,'review hash');
  const selected={profileId:v.profileId,command:v.command,operationId:v.operationId,
    store:v.store,snapshotId:v.snapshotId,options:v.options};
  need(sha(JSON.stringify(selected))===v.reviewHash,'original reviewed selection hash differs');
  const d=v.objectDeclaration,o=v.objectRecovery;
  identifier(d.id,'Object declaration');text(d.sessionId,'native session',160);
  for(const key of ['directory','stateRoot','bundle'])text(d[key],key,8192);
  need(Array.isArray(d.include)&&d.include.every(p=>typeof p==='string')&&Array.isArray(d.kinds)&&
    d.kinds.includes(v.command.slice(7)),'original Object declaration is incomplete');
  need(o.declarationSha256===sha(stable(d))&&o.objectSessionId===d.id&&o.sessionId===d.sessionId&&
    o.directory===d.directory&&o.stateRoot===d.stateRoot&&o.bundle===d.bundle&&o.command===v.command&&
    isDeepStrictEqual(v.options.objectRecovery,o)&&v.options.objectSessionId===d.id&&
    v.options.command===v.command&&v.options.id===v.operationId,'review and declaration differ');
  need(plain(o.objectSession)&&o.objectSession.sessionId===d.sessionId&&o.objectSession.directory===d.directory,
    'reviewed native session differs');
  hash(o.objectSession.definitionSha256,'Object definition');hash(o.objectSession.configurationsSha256,'Object configurations');
  need(o.ok===true&&plain(o.nativeEvidence),'original successful review evidence is required');
  if(v.command==='object-snapshot')need(o.quiesced===true&&HASH.test(o.expectedReviewSha256??''),'original snapshot review is incomplete');
  else hash(o.expectedRecordSha256,'original reviewed record');
  if(r.local!==undefined)need(plain(r.local),'invalid original local state');
  if(r.local?.objectRecoveryBinding)need(isDeepStrictEqual(r.local.objectRecoveryBinding,
    {declarationSha256:o.declarationSha256,reviewSha256:sha(stable(o)),passEnv:v.options.passEnv}),
    'original local execution binding differs');
  if(r.result!==undefined)need(r.result===null||plain(r.result),'invalid original result');
  const refs=recoveryEvidenceReferences(r);
  need(refs.some(ref=>ref.sha256===o.nativeEvidence.sha256),'review evidence is missing');
  return {bytes,request:r,declaration:d,review:o,references:refs};
}
function nativeMatches(native,selected,{inspection=false}={}){
  const {declaration:d,review:o}=selected;
  if(!plain(native)||native.schema!==NATIVE_SCHEMA||native.directory!==d.directory||
    native.stateRoot!==d.stateRoot||native.restoreMode!=='ORIGINAL_CANONICAL_STATE_ROOT'||
    native.absentLedger?.state!=='ABSENT'||!isDeepStrictEqual(native.objectSession,o.objectSession)||
    !HASH.test(native.reviewSha256??''))return false;
  if(inspection)return native.reviewSha256===o.expectedReviewSha256&&Array.isArray(native.include)&&
    isDeepStrictEqual([...native.include].sort(),d.include)&&Array.isArray(native.selected)&&Array.isArray(native.sourceFiles);
  if(!HASH.test(native.recordSha256??''))return false;
  return selected.request.review.command==='object-snapshot'?native.reviewSha256===o.expectedReviewSha256:
    native.recordSha256===o.expectedRecordSha256;
}
function cleanResult(value,error){
  return value?.ok===true&&!error&&value.completionReported===true&&value.process?.exitCode===0&&
    !value.process.exitSignal&&!value.process.errorCode&&!value.process.cleanupErrorCode&&
    !value.native?.publicationSyncError&&!(value.native?.nativeReopenErrors?.length)&&
    !(value.native?.cleanupErrors?.length)&&!(value.native?.leaseReleaseErrors?.length);
}
function readEvidence(raw,selected){
  const bytes=Buffer.from(raw??[]);
  need(bytes.length>0&&bytes.length<=RECOVERY_FILE_LIMIT,'evidence source exceeds its limit');
  let body;try{body=decoder.decode(bytes);}catch{fail('evidence must be original UTF-8 NDJSON');}
  need(body.endsWith('\n'),'evidence needs a final newline');
  const lines=body.slice(0,-1).split('\n');
  need(lines.length===selected.references.length&&lines.length<=MAX_REFS,'complete evidence inventory differs');
  const rows=[],byHash=new Map();
  for(let index=0;index<lines.length;index++){
    let row;try{row=JSON.parse(lines[index]);}catch{fail('invalid original evidence row');}
    fields(row,['sha256','bytes','data'],'evidence row');identity({sha256:row.sha256,bytes:row.bytes},'evidence row');
    need(row.bytes<=MAX_EVIDENCE&&typeof row.data==='string'&&row.data.length<=4*Math.ceil(MAX_EVIDENCE/3),'evidence row exceeds its limit');
    const b=Buffer.from(row.data,'base64');
    need(b.length===row.bytes&&b.toString('base64')===row.data&&sha(b)===row.sha256,'evidence bytes or hash differ');
    const expected=selected.references[index];
    need(row.sha256===expected.sha256&&row.bytes===expected.bytes,'evidence rows must be unique, complete and ordered by original hash');
    const {value}=parse(b,'native evidence',MAX_EVIDENCE);
    fields(value,['schema','declarationSha256','command','method','result','error'],'native evidence');
    need(value.schema===EVIDENCE_SCHEMA&&value.declarationSha256===selected.review.declarationSha256,
      'evidence belongs to another native declaration');
    need(['object-inspect',...COMMANDS].includes(value.command)&&['inspect','snapshot','verify','restore'].includes(value.method),
      'invalid original native evidence operation');
    need(value.result===null||plain(value.result),'invalid original SDK result');
    need(value.error===null||plain(value.error),'invalid original native error');
    if(row.sha256===selected.review.nativeEvidence.sha256){
      const snapshot=selected.request.review.command==='object-snapshot';
      need(value.command===(snapshot?'object-inspect':selected.request.review.command)&&
        value.method===(snapshot?'inspect':'verify')&&cleanResult(value.result,value.error)&&
        nativeMatches(value.result?.native,selected,{inspection:snapshot}),'saved review evidence is inconsistent');
    }else {
      const permitted=selected.request.review.command==='object-restore'?['verify','restore']:
        [selected.request.review.command.slice(7)];
      need(value.command===selected.request.review.command&&permitted.includes(value.method),
        'attempt evidence belongs to another command');
    }
    const entry={sha256:row.sha256,bytes:row.bytes,evidence:value,source:b};
    rows.push(entry);byHash.set(row.sha256,entry);
  }
  return {bytes,rows,byHash};
}
function bundleReference(value,selected,recordSha256){
  fields(value,['path','recordSha256','availability','sourceDelivery'],'external native bundle');
  need(value.path===selected.declaration.bundle&&value.recordSha256===recordSha256&&
    value.availability==='EXTERNAL_NATIVE_BUNDLE','original external bundle binding differs');
  if(value.sourceDelivery!==null){
    fields(value.sourceDelivery,['operationId','manifestSha256','fileSha256','bytes'],'external source delivery reference');
    text(value.sourceDelivery.operationId,'source delivery operation',160);
    hash(value.sourceDelivery.manifestSha256,'source delivery manifest');
    hash(value.sourceDelivery.fileSha256,'source delivery file');
    count(value.sourceDelivery.bytes,'source delivery bytes');
    need(value.sourceDelivery.bytes>0,'source delivery is empty');
  }
}
function recordIdentity(selected,evidence){
  // A failed native binding may report another record. Keep that result as evidence
  // without relabeling the reviewed external bundle as the contradictory record.
  if(selected.review.expectedRecordSha256)return selected.review.expectedRecordSha256;
  const records=new Set(evidence.rows.filter(row=>row.evidence.method==='snapshot'&&
    cleanResult(row.evidence.result,row.evidence.error)&&nativeMatches(row.evidence.result?.native,selected))
    .map(row=>row.evidence.result.native.recordSha256));
  return records.size===1?[...records][0]:null;
}
/** Validate exact UTF-8 files without opening a path or performing a recovery. */
export function readRecoveryObservationFiles(files){
  fields(files,RECOVERY_FILES,'recovery files');
  const selected=requested(files['recovery-request.json']),evidence=readEvidence(files['recovery-evidence.ndjson'],selected);
  const parsed=parse(files['recovery-observation.json'],'recovery-observation.json',MAX_REQUEST),m=parsed.value;
  fields(m,['schema','capturedAt','workspaceId','profileId','requestId','reviewHash','objectSessionId',
    'sessionId','command','request','evidence','bundle'],'recovery observation');
  need(m.schema===RECOVERY_SCHEMA,'unsupported observation schema');
  instant(m.capturedAt,'capture time');text(m.workspaceId,'workspace identity',160);
  need(m.profileId===selected.request.review.profileId&&m.requestId===selected.request.review.operationId&&
    m.reviewHash===selected.request.review.reviewHash&&m.objectSessionId===selected.declaration.id&&
    m.sessionId===selected.declaration.sessionId&&m.command===selected.request.review.command,
    'observation and original request differ');
  identity(m.request,'original request identity');
  need(m.request.bytes===selected.bytes.length&&m.request.sha256===sha(selected.bytes),'complete request identity differs');
  need(isDeepStrictEqual(m.evidence,selected.references),'complete original evidence references differ');
  need(m.capturedAt>=selected.request.updatedAt,'capture precedes the retained request');
  const recordSha256=recordIdentity(selected,evidence);
  bundleReference(m.bundle,selected,recordSha256);
  need(parsed.bytes.length+selected.bytes.length+evidence.bytes.length<=RECOVERY_FILE_LIMIT,
    'complete capture exceeds 64 MiB of original UTF-8 sources');
  const final=selected.request.result??selected.request.local?.objectRecoveryLastResult??null;
  let finalEvidence=null,consistentCompletion=false;
  if(final?.nativeEvidence){
    finalEvidence=evidence.byHash.get(final.nativeEvidence.sha256);
    need(finalEvidence&&finalEvidence.bytes===final.nativeEvidence.bytes,'final native evidence is absent');
    const expectedMethod=m.command.slice(7);
    consistentCompletion=final.ok===true&&final.status==='COMPLETE'&&cleanResult(finalEvidence.evidence.result,finalEvidence.evidence.error)&&
      finalEvidence.evidence.method===expectedMethod&&nativeMatches(finalEvidence.evidence.result?.native,selected);
  }
  if(selected.request.phase==='COMPLETE')need(consistentCompletion,'a completed request needs the exact clean completed native result');
  const attempts=evidence.rows.filter(row=>row.sha256!==selected.review.nativeEvidence.sha256).map(row=>{
    const v=row.evidence,n=v.result?.native;
    return {sha256:row.sha256,bytes:row.bytes,command:v.command,method:v.method,
      ok:cleanResult(v.result,v.error)&&nativeMatches(n,selected),completionReported:v.result?.completionReported===true,
      process:clone(v.result?.process??null),status:n?.status??null,recordSha256:n?.recordSha256??null,
      reviewSha256:n?.reviewSha256??null,error:clone(v.error),publicationSyncError:clone(n?.publicationSyncError??null),
      nativeReopenErrors:clone(n?.nativeReopenErrors??[]),cleanupErrors:clone(n?.cleanupErrors??[]),
      leaseReleaseErrors:clone(n?.leaseReleaseErrors??[]),selectionMatches:nativeMatches(n,selected)};
  });
  const phase=selected.request.phase;
  return {meta:m,request:selected.request,evidence:evidence.rows,
    summary:{workspaceId:m.workspaceId,profileId:m.profileId,requestId:m.requestId,reviewHash:m.reviewHash,
      command:m.command,objectSessionId:m.objectSessionId,sessionId:m.sessionId,
      declarationSha256:selected.review.declarationSha256,objectSession:clone(selected.review.objectSession),
      directory:selected.declaration.directory,stateRoot:selected.declaration.stateRoot,
      bundle:clone(m.bundle),phase,attempts:selected.request.attempts,
      cleanCompleted:phase==='COMPLETE'&&consistentCompletion,
      requestSha256:m.request.sha256,requestBytes:m.request.bytes,evidenceCount:evidence.rows.length,
      evidenceBytes:evidence.rows.reduce((n,row)=>n+row.bytes,0),evidenceIdentities:clone(m.evidence),
      nativeEvidenceHistory:clone(selected.request.local?.objectRecoveryEvidence??[]),nativeOperations:attempts,
      result:clone(final),error:clone(selected.request.error??null),localProgress:selected.request.local?.progress??null,
      createdAt:selected.request.createdAt,updatedAt:selected.request.updatedAt}};
}
/** Build the same strict file cohort from already-read original request/evidence. */
export function createRecoveryObservationFiles({capturedAt,workspaceId,requestBytes,evidenceBytes,sourceDelivery=null}){
  const selected=requested(requestBytes);
  need(Array.isArray(evidenceBytes),'supply the complete original evidence byte array');
  const inventory=new Map();
  for(const raw of evidenceBytes){
    const b=Buffer.from(raw),h=sha(b);
    need(!inventory.has(h),'duplicate evidence input');inventory.set(h,b);
  }
  need(inventory.size===selected.references.length,'evidence input count differs');
  const rows=selected.references.map(ref=>{
    const b=inventory.get(ref.sha256);need(b&&b.length===ref.bytes,'original evidence input is missing or changed');
    return {...ref,data:b.toString('base64')};
  });
  const evidence=Buffer.from(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const m={schema:RECOVERY_SCHEMA,capturedAt,workspaceId,profileId:selected.request.review.profileId,
    requestId:selected.request.review.operationId,reviewHash:selected.request.review.reviewHash,
    objectSessionId:selected.declaration.id,sessionId:selected.declaration.sessionId,command:selected.request.review.command,
    request:{bytes:selected.bytes.length,sha256:sha(selected.bytes)},evidence:selected.references,
    bundle:{path:selected.declaration.bundle,recordSha256:recordIdentity(selected,readEvidence(evidence,selected)),
      availability:'EXTERNAL_NATIVE_BUNDLE',sourceDelivery}};
  const files={'recovery-observation.json':Buffer.from(JSON.stringify(m)+'\n'),
    'recovery-request.json':selected.bytes,'recovery-evidence.ndjson':evidence};
  readRecoveryObservationFiles(files);
  return files;
}
export function recoveryCaptureView(capture,currentInputs){
  const s=capture.original.summary;
  return {kind:'RECOVERY_OPERATION',scope:capture.scope,caseMatches:isDeepStrictEqual(capture.scope.inputs,currentInputs),
    capturedAt:capture.original.meta.capturedAt,startedAt:s.createdAt,sessionId:s.sessionId,
    mode:'ORIGINAL_RECOVERY_EVIDENCE',observerAttached:null,observerErrors:0,
    route:{id:s.requestId,method:null},native:null,recovery:clone(s),
    alerts:[...(s.cleanCompleted?[]:['The retained request phase is '+s.phase+'. Completion is not inferred from missing output or an interrupted native result.']),
      'The encrypted native bundle is external to this UTF-8 case capture. Its original record identity is retained; restore requires the actual original bundle and owner-authorized secret.',
      ...(s.bundle.sourceDelivery?['The source-delivery identity is retained as an external reference. This file review has not reopened or verified that delivery.']:[]),
      'This is a saved recovery observation. It does not inspect current paths, rerun recovery, acquire buyer data or evaluate payments.'],
    files:Object.entries(capture.files).map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256}))};
}
export function compareRecoveryCaptures(before,after){
  if(before.kind!=='RECOVERY_OPERATION'||after.kind!=='RECOVERY_OPERATION')return {
    state:'DIFFERENT_OBSERVATION_KINDS',detail:'Recovery operations and other runtime observations retain separate source meanings.',interval:null};
  const a=before.recovery,b=after.recovery;
  if(a.workspaceId!==b.workspaceId||a.profileId!==b.profileId||a.requestId!==b.requestId||a.reviewHash!==b.reviewHash||
    a.declarationSha256!==b.declarationSha256)return {state:'SEPARATE_RECOVERY_OPERATIONS',
      detail:'These captures select different original recovery operations. Their outcomes are shown independently.',interval:null};
  if(after.capturedAt<=before.capturedAt)return {state:'CAPTURE_ORDER',
    detail:'The after capture must be later than the before capture.',interval:null};
  if(b.createdAt!==a.createdAt||b.attempts<a.attempts||a.evidenceIdentities.some(ref=>
    !b.evidenceIdentities.some(next=>next.sha256===ref.sha256&&next.bytes===ref.bytes)))return {state:'RECOVERY_HISTORY_DIFFERS',
    detail:'The later capture does not retain the same creation identity, attempt count or complete earlier evidence set. Preserve and reconcile both original request histories.',interval:null};
  return {state:a.requestSha256===b.requestSha256?'SAME_RECOVERY_REQUEST_CAPTURE':'SAME_RECOVERY_OPERATION',
    detail:'These captures retain the same reviewed operation. Attempt, native completion and process-cleanup facts are compared without attributing causation.',
    interval:null,recovery:{before:{phase:a.phase,attempts:a.attempts,cleanCompleted:a.cleanCompleted},
      after:{phase:b.phase,attempts:b.attempts,cleanCompleted:b.cleanCompleted}}};
}
export function recoveryRepairQueue(capture,side){
  const s=capture.recovery,rows=[];
  if(!s.cleanCompleted)rows.push({source:side,routeId:s.requestId,kind:'recovery',
    action:'Review the complete original request and native evidence. Continue only that saved operation through its original SF101 owner and exact review/attempt guards.'});
  if(s.nativeOperations.some(row=>!row.selectionMatches))rows.push({source:side,routeId:s.requestId,kind:'identity',
    action:'A native result differs from the reviewed source binding. Preserve the original failure and reconcile its exact declaration and evidence.'});
  if(s.nativeOperations.some(row=>row.publicationSyncError||row.nativeReopenErrors.length||row.cleanupErrors.length||row.leaseReleaseErrors.length))
    rows.push({source:side,routeId:s.requestId,kind:'recovery',
      action:'Reconcile the recorded publication, native reopen, cleanup or lease-release failures before claiming a complete recovery.'});
  return rows;
}
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(typeof x==='object'&&x!==null?JSON.stringify(x):x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
export function recoveryCaptureHtml(capture){
  const s=capture.recovery;
  return '<h3>Original recovery operation</h3>'+table(['Workspace / profile','Request','Action','Saved phase / attempts'],
    [[s.workspaceId+' / '+s.profileId,s.requestId,s.command,s.phase+' / '+s.attempts]])+
    table(['Native session','Reviewed selection SHA-256','Complete request SHA-256','Clean completed result'],
    [[s.sessionId,s.reviewHash,s.requestSha256,s.cleanCompleted?'Yes':'No']])+
    '<h3>Native bundle custody</h3>'+table(['Canonical source','State root','External bundle','Original record SHA-256'],
    [[s.directory,s.stateRoot,s.bundle.path,s.bundle.recordSha256]])+
    '<p>The encrypted bundle is not embedded in this textual case. Restore requires its exact original bytes and the authorized native recovery owner.</p>'+
    '<h3>Unique native evidence records</h3>'+table(['Method','Native status','Clean result','Process','Evidence SHA-256','Recorded failures'],
    s.nativeOperations.map(r=>[r.method,r.status,r.ok?'Yes':'No',r.process,r.sha256,
      {error:r.error,publicationSyncError:r.publicationSyncError,nativeReopenErrors:r.nativeReopenErrors,
        cleanupErrors:r.cleanupErrors,leaseReleaseErrors:r.leaseReleaseErrors}]))+
    '<h3>Original native evidence history</h3>'+table(['Entry','Saved phase','Evidence SHA-256'],
      s.nativeEvidenceHistory.map((row,index)=>[index+1,row.phase,row.sha256]))+
    '<p>Saved history entries preserve repeated references. Evidence hashes and native phases are not request-attempt counts.</p>'+
    '<details><summary>Complete reviewed Object identity</summary><pre>'+esc(JSON.stringify(s.objectSession,null,2))+'</pre></details>'+
    '<details><summary>Saved request outcome</summary><pre>'+esc(JSON.stringify({result:s.result,error:s.error,localProgress:s.localProgress},null,2))+'</pre></details>';
}
