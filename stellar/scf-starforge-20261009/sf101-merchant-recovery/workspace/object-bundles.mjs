// SPDX-License-Identifier: MIT
// Complete encrypted transport through the existing SF101 reviewed request queue.
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {retainCaseArtifact} from '../../sf74-merchant-support-console/case-store.mjs';
import {createRecoveryObservationFiles,readRecoveryObservationFiles,recoveryEvidenceReferences}
  from '../../sf74-merchant-support-console/recovery-runtime.mjs';
import {createComparisonObservationFiles,readComparisonObservationFiles,comparisonArtifactReferences}
  from '../../sf74-merchant-support-console/comparison-runtime.mjs';
import {exportObjectRecoveryBundle,inspectObjectRecoveryBundle,receiveObjectRecoveryBundle}
  from './recovery-bundle.mjs';

const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const MAX_JSON=2*1024*1024,MAX_REPORT=32*1024*1024;
const schema='stellar-forge.sf101.object-bundle-selection.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const json=value=>Buffer.from(JSON.stringify(value)+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const pin=value=>({bytes:value.length,sha256:sha(value)});
const same=isDeepStrictEqual;
const inside=(root,path)=>root===path||path.startsWith(root+sep);
function need(ok,code,message=code){if(!ok)throw Object.assign(new Error(message),{code,status:409});}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exact(value,keys){need(object(value)&&Object.keys(value).every(key=>keys.includes(key)),'WORKSPACE_BUNDLE_INPUT_INVALID');}
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!==sep&&
  !/[\u0000-\u001f]/.test(path),'WORKSPACE_BUNDLE_PATH_INVALID');return path;}
export const objectBundleCommand=command=>['object-bundle-export','object-bundle-receive'].includes(command);
export function compileObjectBundleArchives(input,{downloadRoot,controls=[],objectSessions=[]}={}){
  need(input===undefined||Array.isArray(input),'WORKSPACE_BUNDLE_ARCHIVES_INVALID');
  need((input??[]).length<=32,'WORKSPACE_BUNDLE_ARCHIVES_INVALID');
  const seen=new Set();
  return (input??[]).map(raw=>{
    exact(raw,['id','label','path','sha256']);const path=absolute(raw.path);
    need(ID.test(raw.id??'')&&!seen.has(raw.id)&&HASH.test(raw.sha256??''),'WORKSPACE_BUNDLE_ARCHIVE_INVALID');
    seen.add(raw.id);
    const label=raw.label??raw.id;
    need(typeof label==='string'&&label.trim()&&label.length<=160&&!/[\u0000-\u001f]/.test(label),
      'WORKSPACE_BUNDLE_ARCHIVE_LABEL_INVALID');
    need(path!==downloadRoot&&inside(downloadRoot,path),'WORKSPACE_BUNDLE_ARCHIVE_OUTSIDE_DOWNLOAD_ROOT');
    for(const control of [...controls,...objectSessions.flatMap(row=>[row.stateRoot,row.bundle])])
      need(!inside(control,path)&&!inside(path,control),'WORKSPACE_BUNDLE_ARCHIVE_OVERLAP');
    return {id:raw.id,label,path,sha256:raw.sha256};
  });
}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&!(st.mode&0o077)&&await realpath(path)===path,
    'WORKSPACE_BUNDLE_PRIVATE_DIRECTORY_REQUIRED');
}
async function bytes(path,maximum){
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const a=await fd.stat({bigint:true});
    need(a.isFile()&&a.nlink===1n&&!(a.mode&0o077n)&&a.size>0n&&a.size<=BigInt(maximum),
      'WORKSPACE_BUNDLE_PRIVATE_FILE_REQUIRED');
    const retained=Buffer.alloc(Number(a.size)+1);let count=0;
    while(count<retained.length){const read=await fd.read(retained,count,retained.length-count,null);if(!read.bytesRead)break;count+=read.bytesRead;}
    const raw=retained.subarray(0,count),b=await fd.stat({bigint:true});
    need(BigInt(raw.length)===a.size&&['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]),
      'WORKSPACE_BUNDLE_SOURCE_CHANGED');return raw;
  }finally{await fd.close();}
}
function checkResult(result,{operation,recordSha256,objectSession,archiveSha256}){
  need(result?.schema==='stellar-forge.sf101.object-recovery-transfer-result.v1'&&result.operation===operation&&
    HASH.test(result.archive?.sha256??'')&&Number.isSafeInteger(result.archive.bytes)&&result.archive.bytes>0&&
    HASH.test(result.manifest?.sha256??'')&&HASH.test(result.recordSha256??'')&&
    result.manifest.recordSha256===result.recordSha256&&same(result.manifest.objectSession,result.objectSession),
    'WORKSPACE_BUNDLE_NATIVE_RESULT_CHANGED');
  if(recordSha256)need(result.recordSha256===recordSha256,'WORKSPACE_BUNDLE_NATIVE_RECORD_CHANGED');
  if(objectSession)need(same(result.objectSession,objectSession),'WORKSPACE_BUNDLE_NATIVE_SESSION_CHANGED');
  if(archiveSha256)need(result.archive.sha256===archiveSha256,'WORKSPACE_BUNDLE_ARCHIVE_CHANGED');
  need(result.authenticated===(operation!=='inspect'),'WORKSPACE_BUNDLE_AUTHENTICATION_INCOMPLETE');
  return result;
}


/** Exact two-file delivery selection; no authentication or source read occurs here. */
export function comparisonBundlePair(before,after){
  const entries={before,after};
  for(const side of ['before','after']){
    const entry=entries[side],t=entry?.transport,a=entry?.archive;
    need(t?.status==='COMPLETE'&&t.command==='object-bundle-export'&&t.authenticated===true&&
      t.sourceComparison?.side===side&&HASH.test(t.sourceComparison.comparisonSha256??'')&&
      HASH.test(t.originalRequest?.sha256??'')&&HASH.test(a?.sha256??'')&&
      Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.sha256===t.archive?.sha256&&a.bytes===t.archive?.bytes&&
      t.recordSha256===t.sourceComparison[side+'RecordSha256']&&ID.test(t.workspaceOperationId??''),
      'WORKSPACE_BUNDLE_COMPARISON_EXPORT_REQUIRED');
  }
  const left=before.transport,right=after.transport;
  need(same(left.originalRequest,right.originalRequest)&&
    left.sourceComparison.comparisonSha256===right.sourceComparison.comparisonSha256&&
    same(left.sourceComparison.resultArtifact,right.sourceComparison.resultArtifact)&&
    ['beforeRecordSha256','afterRecordSha256'].every(key=>left.sourceComparison[key]===right.sourceComparison[key])&&
    left.workspaceOperationId!==right.workspaceOperationId,
    'WORKSPACE_BUNDLE_COMPARISON_PAIR_CHANGED');
  const value={schema:'stellar-forge.sf101.comparison-bundle-pair.v1',
    comparisonSha256:left.sourceComparison.comparisonSha256,sourceRequest:clone(left.originalRequest),
    archives:Object.fromEntries(Object.entries(entries).map(([side,{archive,transport}])=>[side,{
      requestId:transport.workspaceOperationId,bytes:archive.bytes,sha256:archive.sha256,recordSha256:transport.recordSha256}]))};
  return {...value,pairSha256:sha(json(value))};
}

/** Original workspace owns serialization, request/attempt guards and shutdown. */
export function createObjectBundleAdapter({directory,workspaceId,readRequestBytes,readEvidenceBytes,
  readComparisonArtifactBytes,environment=process.env}){
  absolute(directory);const root=join(directory,'object-bundle-transfers');
  const folder=(profileId,id)=>join(root,sha(profileId+'\n'+id));
  async function originalSelection(profile,input){
    exact(input,['profileId','action','id','sourceRequestId','sourceReviewHash','sourceAttempt','sourceSide']);
    need(ID.test(input.sourceRequestId??'')&&HASH.test(input.sourceReviewHash??'')&&
      Number.isSafeInteger(input.sourceAttempt)&&input.sourceAttempt>=0,'WORKSPACE_BUNDLE_SOURCE_SELECTION_INVALID');
    const destination=folder(profile.id,input.id);await privateDirectory(destination);
    const source=join(destination,'original-recovery');await privateDirectory(source);
    const frozenInput={schema:'stellar-forge.sf101.object-bundle-preparation.v1',workspaceId,input:clone(input)};
    await retainCaseArtifact(join(destination,'preparation.json'),json(frozenInput));
    const requestPath=join(source,'recovery-request.json');
    let raw;
    try{raw=await bytes(requestPath,MAX_JSON);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      raw=await readRequestBytes(profile.id,input.sourceRequestId);
    }
    const request=JSON.parse(raw);
    need(request.review?.reviewHash===input.sourceReviewHash&&request.attempts===input.sourceAttempt&&
      request.review.profileId===profile.id&&request.review.operationId===input.sourceRequestId,
      'WORKSPACE_BUNDLE_ORIGINAL_REQUEST_CHANGED');
    // Persist the exact selected request before any following read or outer review publication.
    await retainCaseArtifact(requestPath,raw);
    if(request.review.command==='object-compare')return comparisonSelection(profile,input,destination,source,raw,request);
    need(input.sourceSide===undefined,'WORKSPACE_BUNDLE_SIDE_NOT_APPLICABLE');
    const refs=recoveryEvidenceReferences(request),evidence=[];
    const evidenceRoot=join(destination,'original-evidence');await privateDirectory(evidenceRoot);
    for(const ref of refs){
      const path=join(evidenceRoot,ref.sha256+'.json');let body;
      try{body=await bytes(path,16*1024*1024);}
      catch(error){if(error.code!=='ENOENT')throw error;body=await readEvidenceBytes(ref.sha256);}
      need(same(pin(body),{sha256:ref.sha256,bytes:ref.bytes}),'WORKSPACE_BUNDLE_ORIGINAL_EVIDENCE_CHANGED');
      await retainCaseArtifact(path,body);evidence.push(body);
    }
    const files=createRecoveryObservationFiles({capturedAt:request.updatedAt,workspaceId,requestBytes:raw,evidenceBytes:evidence});
    const selected=readRecoveryObservationFiles(files),s=selected.summary;
    need(HASH.test(s.bundle.recordSha256??''),'WORKSPACE_BUNDLE_RECORD_REQUIRED',
      'Select a request with its original verified record or completed snapshot evidence.');
    const declaration=profile.objectSessions.find(row=>row.id===s.objectSessionId);
    need(declaration&&same(declaration,request.review.objectDeclaration),'WORKSPACE_BUNDLE_DECLARATION_CHANGED');
    for(const [name,value]of Object.entries(files))await retainCaseArtifact(join(source,name),value);
    return {schema,command:input.action,objectDeclaration:clone(declaration),recordSha256:s.bundle.recordSha256,
      objectSession:clone(s.objectSession),sourceRequest:{id:s.requestId,reviewHash:s.reviewHash,attempt:s.attempts,...pin(raw)},
      lineage:{workspaceId,profileId:profile.id,requestId:s.requestId,reviewHash:s.reviewHash,requestSha256:s.requestSha256},
      sourceFiles:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,pin(value)]))};
  }
  async function comparisonSelection(profile,input,destination,source,raw,request){
    need(['before','after'].includes(input.sourceSide),'WORKSPACE_BUNDLE_COMPARISON_SIDE_REQUIRED');
    need(typeof readComparisonArtifactBytes==='function','WORKSPACE_BUNDLE_COMPARISON_SOURCE_REQUIRED');
    const refs=comparisonArtifactReferences(request),maximum=64*1024*1024;
    need(raw.length+refs.reduce((n,ref)=>n+4*Math.ceil(ref.bytes/3)+Buffer.byteLength(JSON.stringify({...ref,data:''}))+1,1)<=maximum,
      'WORKSPACE_BUNDLE_COMPARISON_TOO_LARGE','The complete comparison capture exceeds 64 MiB; no original artifact or history is omitted.');
    const artifactRoot=join(destination,'original-comparison-artifacts');await privateDirectory(artifactRoot);
    const artifacts=[];
    for(const ref of refs){
      const path=join(artifactRoot,ref.sha256);let body;
      try{body=await bytes(path,maximum);}
      catch(error){if(error.code!=='ENOENT')throw error;body=await readComparisonArtifactBytes(ref);}
      need(same(pin(body),{sha256:ref.sha256,bytes:ref.bytes}),'WORKSPACE_BUNDLE_COMPARISON_ARTIFACT_CHANGED');
      await retainCaseArtifact(path,body);artifacts.push(body);
    }
    const files=createComparisonObservationFiles({capturedAt:request.updatedAt,workspaceId,requestBytes:raw,artifactBytes:artifacts});
    const original=readComparisonObservationFiles(files),summary=original.summary,side=input.sourceSide;
    need(summary.cleanCompleted,'WORKSPACE_BUNDLE_COMPLETED_COMPARISON_REQUIRED',
      'Select the original clean completed comparison before exporting one of its authenticated editions.');
    const resultRef=summary.result.artifacts.result;
    const saved=original.artifacts.find(row=>row.sha256===resultRef.sha256);
    need(saved?.observation.complete===true,'WORKSPACE_BUNDLE_COMPLETED_COMPARISON_REQUIRED');
    const report=saved.result.native,selected=report[side],declaration=request.review.objectComparison[side];
    need(same(profile.objectSessions.find(row=>row.id===declaration.id),declaration),'WORKSPACE_BUNDLE_DECLARATION_CHANGED');
    for(const [name,value]of Object.entries(files))await retainCaseArtifact(join(source,name),value);
    return {schema,command:input.action,objectDeclaration:clone(declaration),recordSha256:selected.recordSha256,
      objectSession:clone(selected.verification.objectSession),
      sourceRequest:{id:summary.requestId,reviewHash:summary.reviewHash,attempt:summary.attempts,...pin(raw)},
      sourceComparison:{side,comparisonSha256:report.comparisonSha256,resultArtifact:clone(resultRef),
        beforeRecordSha256:report.before.recordSha256,afterRecordSha256:report.after.recordSha256},
      lineage:{workspaceId,profileId:profile.id,requestId:summary.requestId,reviewHash:summary.reviewHash,requestSha256:summary.requestSha256},
      sourceFiles:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,pin(value)]))};
  }
  async function inspection(profile,archiveId,{signal}={}){
    const archive=profile.objectBundleArchives.find(row=>row.id===archiveId);
    need(archive,'WORKSPACE_BUNDLE_ARCHIVE_NOT_DECLARED');
    const result=await inspectObjectRecoveryBundle({directory:join(root,'inspections',sha(profile.id+'\n'+archive.id+'\n'+archive.sha256)),
      archive:archive.path,expectedArchiveSha256:archive.sha256,signal});
    return checkResult(result,{operation:'inspect',archiveSha256:archive.sha256});
  }
  async function review(profile,input,{signal}={}){
    need(ID.test(input.id??'')&&input.profileId===profile.id,'WORKSPACE_BUNDLE_SELECTION_INVALID');
    if(input.action==='object-bundle-export')return originalSelection(profile,input);
    exact(input,['profileId','action','id','archiveId','objectSessionId']);
    need(input.action==='object-bundle-receive'&&ID.test(input.archiveId??'')&&ID.test(input.objectSessionId??''),
      'WORKSPACE_BUNDLE_SELECTION_INVALID');
    const declaration=profile.objectSessions.find(row=>row.id===input.objectSessionId);
    const archive=profile.objectBundleArchives.find(row=>row.id===input.archiveId);
    need(declaration&&archive,'WORKSPACE_BUNDLE_DECLARATION_REQUIRED');
    const checked=await inspection(profile,input.archiveId,{signal});
    need(checked.objectSession?.sessionId===declaration.sessionId&&
      checked.objectSession.directory===declaration.directory&&
      (!declaration.expectedRecordSha256||declaration.expectedRecordSha256===checked.recordSha256),
      'WORKSPACE_BUNDLE_RECEIVING_SELECTION_CHANGED');
    return {schema,command:input.action,objectDeclaration:clone(declaration),archiveDeclaration:clone(archive),
      recordSha256:checked.recordSha256,objectSession:clone(checked.objectSession),inspection:checked,
      lineage:clone(checked.manifest.lineage)};
  }
  function binding(profile,reviewed){
    need(reviewed?.schema===schema&&objectBundleCommand(reviewed.command)&&HASH.test(reviewed.recordSha256??''),
      'WORKSPACE_BUNDLE_REVIEW_CHANGED');
    const declaration=profile.objectSessions.find(row=>row.id===reviewed.objectDeclaration?.id);
    need(same(declaration,reviewed.objectDeclaration),'WORKSPACE_BUNDLE_DECLARATION_CHANGED');
    if(reviewed.command==='object-bundle-receive')need(same(
      profile.objectBundleArchives.find(row=>row.id===reviewed.archiveDeclaration?.id),reviewed.archiveDeclaration),
      'WORKSPACE_BUNDLE_ARCHIVE_DECLARATION_CHANGED');
  }
  async function run({profile,id,review:reviewed,state,save,signal,cancelled=()=>false}){
    binding(profile,reviewed);
    const destination=folder(profile.id,id);await privateDirectory(destination);
    const request={profileId:profile.id,id,review:reviewed,passEnv:profile.passEnv};
    await retainCaseArtifact(join(destination,'workspace-request.json'),json(request));
    if(reviewed.sourceFiles){
      const files={};
      for(const [name,identity]of Object.entries(reviewed.sourceFiles)){
        const raw=await bytes(join(destination,'original-recovery',name),64*1024*1024);
        need(same(pin(raw),identity),'WORKSPACE_BUNDLE_ORIGINAL_EVIDENCE_CHANGED');files[name]=raw;
      }
      if(reviewed.sourceComparison){
        const original=readComparisonObservationFiles(files),s=original.summary,selection=reviewed.sourceComparison;
        const result=original.artifacts.find(row=>row.sha256===selection.resultArtifact.sha256);
        const native=result?.result?.native,side=native?.[selection.side];
        need(s.cleanCompleted&&s.requestSha256===reviewed.sourceRequest.sha256&&
          same(s.result.artifacts.result,selection.resultArtifact)&&
          native?.comparisonSha256===selection.comparisonSha256&&
          native.before.recordSha256===selection.beforeRecordSha256&&native.after.recordSha256===selection.afterRecordSha256&&
          side?.recordSha256===reviewed.recordSha256&&same(side.verification.objectSession,reviewed.objectSession)&&
          same(original.request.review.objectComparison[selection.side],reviewed.objectDeclaration),
          'WORKSPACE_BUNDLE_ORIGINAL_COMPARISON_CHANGED');
      }else{
        const original=readRecoveryObservationFiles(files).summary;
        need(original.requestSha256===reviewed.sourceRequest.sha256&&original.bundle.recordSha256===reviewed.recordSha256&&
          same(original.objectSession,reviewed.objectSession),'WORKSPACE_BUNDLE_ORIGINAL_EVIDENCE_CHANGED');
      }
    }
    const requestSha256=sha(json(request));
    if(state.objectBundleRequestSha256)need(state.objectBundleRequestSha256===requestSha256,'WORKSPACE_BUNDLE_REQUEST_CHANGED');
    else state.objectBundleRequestSha256=requestSha256;
    state.progress='OBJECT_BUNDLE_NATIVE_PENDING';await save();
    signal?.throwIfAborted();need(!cancelled(),'WORKSPACE_BUNDLE_CANCELLED');
    const common={directory:join(destination,'native'),expectedRecordSha256:reviewed.recordSha256,
      objectSession:reviewed.objectSession,passEnv:profile.passEnv,environment,signal};
    const operation=reviewed.command==='object-bundle-export'?'export':'receive';
    let result;
    try{result=operation==='export'?
      await exportObjectRecoveryBundle({...common,bundle:reviewed.objectDeclaration.bundle,lineage:reviewed.lineage}):
      await receiveObjectRecoveryBundle({...common,archive:reviewed.archiveDeclaration.path,
        expectedArchiveSha256:reviewed.archiveDeclaration.sha256,bundleOut:reviewed.objectDeclaration.bundle});
    }catch(error){
      const evidence={};
      for(const kind of ['verification','publication'])if(error[kind]){
        const ref=error[kind];
        need(HASH.test(ref.sha256??'')&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=MAX_REPORT&&
          inside(join(destination,'native'),absolute(ref.path)),'WORKSPACE_BUNDLE_ERROR_EVIDENCE_INVALID');
        need(same(pin(await bytes(ref.path,MAX_REPORT)),{bytes:ref.bytes,sha256:ref.sha256}),
          'WORKSPACE_BUNDLE_ERROR_EVIDENCE_CHANGED');evidence[kind]=clone(ref);
      }
      const returned={status:'INTERRUPTED',command:reviewed.command,operation,authenticated:false,
        recordSha256:reviewed.recordSha256,objectSession:reviewed.objectSession,restoreDispatched:false,
        ...evidence,error:{code:error.code??'WORKSPACE_BUNDLE_NATIVE_FAILED',message:String(error.message).slice(0,600)}};
      state.objectBundleFailures??=[];need(state.objectBundleFailures.length<4096,'WORKSPACE_BUNDLE_FAILURE_HISTORY_LIMIT');
      const failureBytes=json(returned),failurePath=join(destination,'failure-'+sha(failureBytes)+'.json');
      await retainCaseArtifact(failurePath,failureBytes);
      state.objectBundleFailures.push({path:failurePath,...pin(failureBytes)});
      state.objectBundleResult=returned;state.progress='INTERRUPTED';await save();return returned;
    }
    checkResult(result,{operation,recordSha256:reviewed.recordSha256,objectSession:reviewed.objectSession,
      ...(operation==='receive'?{archiveSha256:reviewed.archiveDeclaration.sha256}:{})});
    const raw=json({...result,reopened:false});need(raw.length<=MAX_JSON,'WORKSPACE_BUNDLE_COMPACT_RESULT_TOO_LARGE');
    await retainCaseArtifact(join(destination,'result.json'),raw);
    const returned={...result,status:'COMPLETE',nativeStatus:result.status,command:reviewed.command,
      originalRequest:reviewed.sourceRequest??null,sourceComparison:reviewed.sourceComparison??null,restoreDispatched:false};
    state.objectBundleResult=returned;state.progress='COMPLETE';await save();return returned;
  }
  async function report(profileId,id,kind='report',retainedResult=null){
    need(ID.test(profileId??'')&&ID.test(id??'')&&['report','verification','publication'].includes(kind),
      'WORKSPACE_BUNDLE_REPORT_SELECTION_INVALID');
    const destination=folder(profileId,id),result=retainedResult??JSON.parse(await bytes(join(destination,'result.json'),MAX_JSON));
    const selected=result[kind];need(selected&&HASH.test(selected.sha256??'')&&
      Number.isSafeInteger(selected.bytes)&&selected.bytes>0&&selected.bytes<=MAX_REPORT&&
      inside(join(destination,'native'),absolute(selected.path)),'WORKSPACE_BUNDLE_REPORT_INVALID');
    const raw=await bytes(selected.path,MAX_REPORT);need(same(pin(raw),{bytes:selected.bytes,sha256:selected.sha256}),
      'WORKSPACE_BUNDLE_REPORT_CHANGED');
    return {kind,bytes:raw.length,sha256:selected.sha256,content:raw.toString('utf8')};
  }
  async function artifact(profileId,id){
    need(ID.test(profileId??'')&&ID.test(id??''),'WORKSPACE_BUNDLE_REQUEST_INVALID');
    const destination=folder(profileId,id),result=JSON.parse(await bytes(join(destination,'result.json'),MAX_JSON));
    need(result.operation==='export'&&result.authenticated===true&&inside(join(destination,'native'),absolute(result.archive.path)),
      'WORKSPACE_BUNDLE_EXPORT_REQUIRED');
    return {...result.archive,filename:'object-recovery-'+id+'.tar',type:'application/x-tar'};
  }
  return {review,binding,run,inspection,report,artifact};
}
