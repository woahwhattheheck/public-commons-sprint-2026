// MIT. Portable handover of the original standalone Object recovery bundle.
import { mkdir, rename, rm, open, readdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ObjectSessionRecovery } from '../../sf88-operator-buyer-cli/node/workspace-recovery.mjs';
import { acquireWorkspace } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';
import { FORMAT,LIMITS,jsonBytes,sha,hex,same,check,abort,absolute,present,directory,sync,
  readSmall,readJson,atomicJson,immutableJson,fileIdentity,inventory,copyBundle,writeAll,
  verifyInventory,validateManifest,createArchive,parseArchive,retainArchive } from './recovery-bundle-format.mjs';

const RESULT='stellar-forge.sf101.object-recovery-transfer-result.v1';
const INTENT='stellar-forge.sf101.object-recovery-transfer-intent.v1';
const RECEIPT='stellar-forge.sf101.object-recovery-transfer-owner.v1';
const NATIVE='stellar-forge.sf88.object-session-recovery.v1';
const runtimeDefault=fileURLToPath(new URL('../../sf88-operator-buyer-cli/',import.meta.url)).replace(/\/$/,'');
function selectionIdentity({expectedRecordSha256,objectSession}){
  check(hex(expectedRecordSha256)&&objectSession&&typeof objectSession==='object'&&!Array.isArray(objectSession)&&
    typeof objectSession.sessionId==='string'&&typeof objectSession.directory==='string',
    'OBJECT_BUNDLE_ORIGINAL_SESSION_REQUIRED');
  check(jsonBytes(objectSession).length<=262144,'OBJECT_BUNDLE_IDENTITY_TOO_LARGE');
  return {recordSha256:expectedRecordSha256,objectSession:JSON.parse(JSON.stringify(objectSession))};
}
function lineageValue(value={}){
  check(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_BUNDLE_LINEAGE_INVALID');
  const allowed=['workspaceId','profileId','requestId','reviewHash','requestSha256','caseId','caseRevision'];
  check(Object.keys(value).every(key=>allowed.includes(key)),'OBJECT_BUNDLE_LINEAGE_INVALID');
  const result={};
  for(const key of allowed){
    const field=value[key]??null;
    check(field===null||typeof field==='string'&&field.length>0&&field.length<=512||
      key==='caseRevision'&&Number.isSafeInteger(field)&&field>=0,'OBJECT_BUNDLE_LINEAGE_INVALID');
    result[key]=field;
  }
  for(const key of ['reviewHash','requestSha256'])check(result[key]===null||hex(result[key]),'OBJECT_BUNDLE_LINEAGE_INVALID');
  return result;
}
function apart(left,right){
  const a=relative(left,right),b=relative(right,left);
  // path.relative has platform-native separators; the supported native runtime is Linux.
  check(a!==''&&b!==''&&(a==='..'||a.startsWith('../')||a.startsWith('/'))&&
    (b==='..'||b.startsWith('../')||b.startsWith('/')),'OBJECT_BUNDLE_OVERLAPPING_PATHS');
}
async function withOperation(options,operation,selection,work){
  const root=absolute(options.directory);await directory(root,true);
  const release=await acquireWorkspace(root);let result,primary;
  try{
    const intentPath=join(root,'intent.json');let intent;
    if(await present(intentPath)){
      intent=await readJson(intentPath);
      check(intent.schema===INTENT&&intent.operation===operation&&same(intent.selection,selection)&&
        /^[a-f0-9-]{36}$/.test(intent.token),'OBJECT_BUNDLE_OPERATION_CONFLICT');
    }else{
      // The exact selection owns one deterministic preparation leaf. A failed
      // first write can be resumed even before intent.json was published.
      const preparedName='.intent-'+sha(jsonBytes({operation,selection}))+'.pending',
        preparedPath=join(root,preparedName);
      check((await readdir(root)).every(name=>name==='publisher.lock'||name===preparedName),
        'OBJECT_BUNDLE_OPERATION_DIRECTORY_NOT_EMPTY');
      if(await present(preparedPath)){
        const bytes=await readSmall(preparedPath);
        try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
          if(value.schema===INTENT&&value.operation===operation&&same(value.selection,selection)&&
            /^[a-f0-9-]{36}$/.test(value.token))intent=value;
        }catch{}
        if(!intent){await rm(preparedPath);await sync(root);}
      }
      if(!intent){
        intent={schema:INTENT,operation,selection,token:randomUUID(),createdAt:new Date().toISOString()};
        const handle=await open(preparedPath,'wx',0o600);
        try{await writeAll(handle,jsonBytes(intent));await handle.sync();}finally{await handle.close();}
      }
      await rename(preparedPath,intentPath);await sync(root);
    }
    abort(options.signal);result=await work(root,intent);
  }catch(error){primary=error;}
  try{await release();}catch(error){if(primary)primary.lockReleaseError={code:error.code??'OBJECT_BUNDLE_LOCK_RELEASE_FAILED'};
    else primary=Object.assign(new Error('OBJECT_BUNDLE_LOCK_RELEASE_FAILED'),{code:'OBJECT_BUNDLE_LOCK_RELEASE_FAILED',result});}
  if(primary)throw primary;return result;
}
function compactManifest(manifest,sha256){
  return {schema:manifest.schema,sha256,recordSha256:manifest.recordSha256,
    objectSession:manifest.objectSession,lineage:manifest.lineage,fileCount:manifest.fileCount,bytes:manifest.bytes};
}
async function retainedResult(root,operation,options){
  const path=join(root,'result.json');if(!await present(path))return null;
  const result=await readJson(path);
  check(result.schema===RESULT&&result.operation===operation,'OBJECT_BUNDLE_RETAINED_RESULT_INVALID');
  const report=await fileIdentity(result.report.path,{maximum:LIMITS.metadata,signal:options.signal});
  check(same(report,result.report),'OBJECT_BUNDLE_REPORT_CHANGED');
  if(result.verification){
    const identity=await fileIdentity(result.verification.path,{maximum:LIMITS.metadata,signal:options.signal});
    check(same(identity,result.verification),'OBJECT_BUNDLE_VERIFICATION_CHANGED');
  }
  return result;
}
async function authenticate(root,bundle,identity,options){
  const runtimeDirectory=absolute(options.runtimeDirectory??runtimeDefault);
  const recovery=new ObjectSessionRecovery({runtimeDirectory,environment:options.environment??process.env});
  const id=randomUUID(),path=join(root,'native-verify-'+id+'.json');let nativeResult;
  try{
    nativeResult=await recovery.verify({bundle,expectedRecordSha256:identity.recordSha256,
      passphraseEnv:options.passEnv??'SF88_BACKUP_PASSPHRASE',signal:options.signal});
  }catch(error){
    if(error.result){const retained=await immutableJson(path,error.result);error.verification=retained;}
    throw error;
  }
  const retained=await immutableJson(path,nativeResult);
  // Preserve the complete SDK process result before interpreting the exact identity.
  if(!(nativeResult.ok===true&&nativeResult.native?.schema===NATIVE&&
    nativeResult.native.status==='OBJECT_SESSION_BACKUP_VERIFIED'&&
    nativeResult.native.recordSha256===identity.recordSha256&&
    same(nativeResult.native.objectSession,identity.objectSession))){
    throw Object.assign(new Error('OBJECT_BUNDLE_AUTHENTICATED_IDENTITY_MISMATCH'),
      {code:'OBJECT_BUNDLE_AUTHENTICATED_IDENTITY_MISMATCH',verification:retained});
  }
  return retained;
}
async function finish(root,operation,parsed,{verification=null,bundleOut=null,reopened=false,receipt=null}={}){
  const reportValue={schema:'stellar-forge.sf101.object-recovery-transfer-report.v1',operation,
    archive:parsed.archive,manifest:parsed.manifest,manifestSha256:parsed.manifestSha256,
    verification,bundleOut,receipt};
  const report=await immutableJson(join(root,'report.json'),reportValue);
  const result={schema:RESULT,operation,status:operation==='export'?'OBJECT_RECOVERY_BUNDLE_EXPORTED':
    operation==='receive'?'OBJECT_RECOVERY_BUNDLE_RECEIVED':'OBJECT_RECOVERY_BUNDLE_INSPECTED',
    archive:parsed.archive,manifest:compactManifest(parsed.manifest,parsed.manifestSha256),
    recordSha256:parsed.manifest.recordSha256,objectSession:parsed.manifest.objectSession,
    authenticated:operation!=='inspect',verification,report,...(bundleOut?{bundleOut}:{}),reopened:false};
  await immutableJson(join(root,'result.json'),result);return {...result,reopened};
}
async function cleanOwnedStage(root,name){
  const path=join(root,name);if(await present(path)){await directory(path);await rm(path,{recursive:true,force:false});await sync(root);}
  await directory(path,true);await sync(root);return path;
}
async function nativeManifestCheck(bundle,members){
  const file=await readSmall(join(bundle,'manifest.json'),12*1024**2);let manifest;
  try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file));}catch{check(false,'OBJECT_BUNDLE_NATIVE_MANIFEST_INVALID');}
  check(manifest.schema==='stellar-forge.merchant-recovery.v1'&&Array.isArray(manifest.entries),
    'OBJECT_BUNDLE_NATIVE_MANIFEST_INVALID');
  const byPath=new Map(members.map(member=>[member.path,member]));
  for(const entry of manifest.entries)if(entry.kind==='file'){
    check(typeof entry.object==='string'&&/^objects\/[0-9]{6}\.gcm$/.test(entry.object),
      'OBJECT_BUNDLE_NATIVE_OBJECT_INVALID');
    const member=byPath.get(entry.object);
    check(member?.type==='file'&&member.bytes===entry.size&&member.sha256===entry.cipherSha256,
      'OBJECT_BUNDLE_NATIVE_OBJECT_MISSING_OR_CHANGED');
  }
}
export async function exportObjectRecoveryBundle(options={}){
  const identity=selectionIdentity(options),bundle=absolute(options.bundle),root=absolute(options.directory);
  apart(root,bundle);const lineage=lineageValue(options.lineage);
  const selection={bundle,...identity,lineage};
  return withOperation(options,'export',selection,async(root,intent)=>{
    const completed=await retainedResult(root,'export',options);
    if(completed){
      const parsed=await parseArchive(completed.archive.path,{expectedArchiveSha256:completed.archive.sha256,signal:options.signal});
      check(same(parsed.archive,completed.archive),'OBJECT_BUNDLE_RETAINED_ARCHIVE_CHANGED');
      return {...completed,reopened:true};
    }
    const capture=join(root,'capture'),copied=join(capture,'bundle'),captureRecord=join(root,'capture.json');
    let captured;
    if(await present(captureRecord)){
      captured=await readJson(captureRecord);await verifyInventory(copied,captured.members,options.signal);
    }else{
      await cleanOwnedStage(root,'capture');await directory(copied,true);
      captured=await copyBundle(bundle,copied,options.signal);await nativeManifestCheck(copied,captured.members);
      await immutableJson(captureRecord,captured);
    }
    let verification;
    const verifiedPath=join(root,'verified.json');
    if(await present(verifiedPath)){
      verification=await readJson(verifiedPath);
      check(same(await fileIdentity(verification.path,{maximum:LIMITS.metadata,signal:options.signal}),verification),
        'OBJECT_BUNDLE_VERIFICATION_CHANGED');
    }else{
      verification=await authenticate(root,copied,identity,options);
      await immutableJson(verifiedPath,verification);
    }
    const manifest={schema:FORMAT,createdAt:intent.createdAt,...identity,lineage,
      fileCount:captured.files,bytes:captured.bytes,members:captured.members,
      exportVerification:{bytes:verification.bytes,sha256:verification.sha256}};
    validateManifest(manifest);
    const archive=await createArchive(join(root,'recovery.tar'),{manifest,verification,bundle:copied},options.signal);
    const parsed={archive,manifest,manifestSha256:sha(jsonBytes(manifest))};
    return finish(root,'export',parsed,{verification});
  });
}
export async function inspectObjectRecoveryBundle(options={}){
  const archive=absolute(options.archive),root=absolute(options.directory);
  check(hex(options.expectedArchiveSha256),'OBJECT_BUNDLE_ARCHIVE_DIGEST_REQUIRED');apart(root,archive);
  return withOperation(options,'inspect',{archive,archiveSha256:options.expectedArchiveSha256},async root=>{
    const completed=await retainedResult(root,'inspect',options);
    const parsed=await parseArchive(archive,{expectedArchiveSha256:options.expectedArchiveSha256,signal:options.signal});
    if(completed){check(same(parsed.archive,completed.archive),'OBJECT_BUNDLE_RETAINED_ARCHIVE_CHANGED');return {...completed,reopened:true};}
    return finish(root,'inspect',parsed);
  });
}
function receiptFor(intent,archive,bundleOut){
  return {schema:RECEIPT,operationToken:intent.token,archiveSha256:archive.sha256,
    recordSha256:intent.selection.recordSha256,objectSession:intent.selection.objectSession,
    bundleOut};
}
function ownership(intent,parsed,bundleOut){
  const receipt=receiptFor(intent,parsed.archive,bundleOut),
    path='.sf101-transfers/'+intent.token+'.json',bytes=jsonBytes(receipt),expected=parsed.manifest.members;
  const previous=expected.find(member=>member.path==='.sf101-transfers');
  check(!previous||previous.type==='directory','OBJECT_BUNDLE_OWNER_DIRECTORY_CONFLICT');
  check(!expected.some(member=>member.path===path),'OBJECT_BUNDLE_OWNER_TOKEN_COLLISION');
  const extras=[...(!previous?[{path:'.sf101-transfers',type:'directory',bytes:0}]:[]),
    {path,type:'file',bytes:bytes.length,sha256:sha(bytes)}];
  check(expected.length+extras.length<=LIMITS.files&&parsed.manifest.bytes+bytes.length<=LIMITS.bytes,
    'OBJECT_BUNDLE_OWNERSHIP_CAPACITY_REQUIRED');
  return {receipt,path,bytes,extras};
}
async function verifyPublished(root,intent,parsed,bundleOut,signal){
  const owner=ownership(intent,parsed,bundleOut);
  check((await readSmall(join(bundleOut,owner.path))).equals(owner.bytes),'OBJECT_BUNDLE_DESTINATION_NOT_OWNED');
  await verifyInventory(bundleOut,parsed.manifest.members,signal,{extra:owner.extras});return owner.receipt;
}

async function publishNoReplace(root,source,destination,python){
  // renameat2(RENAME_NOREPLACE) also rejects a destination created after our
  // last path check. The original queue still owns this entire operation.
  absolute(python);
  const script="import ctypes,errno,os,sys\nlib=ctypes.CDLL(None,use_errno=True)\nfn=lib.renameat2\nfn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nfn.restype=ctypes.c_int\nr=fn(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)\nif r!=0: raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))\nprint('PUBLISHED')\n";
  const outcome=await new Promise(resolveResult=>{
    let output='',errors='',started=false,errorCode=null,timer;
    const child=spawn(python,['-I','-c',script,source,destination],{stdio:['ignore','pipe','pipe'],env:{},shell:false});
    child.once('spawn',()=>{started=true;});
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>4096)child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{errors+=chunk.toString('utf8');if(errors.length>8192)child.kill('SIGKILL');});
    child.once('error',error=>{errorCode=error.code??'PUBLICATION_PROCESS_FAILED';});
    child.once('close',(exitCode,exitSignal)=>{clearTimeout(timer);resolveResult({
      started,exitCode,exitSignal,errorCode,stdout:output.slice(0,4096),stderr:errors.slice(0,8192)});});
    timer=setTimeout(()=>{errorCode='PUBLICATION_PROCESS_TIMEOUT';child.kill('SIGKILL');},10000);
  });
  const record=await immutableJson(join(root,'publish-attempt-'+randomUUID()+'.json'),outcome);
  if(!(outcome.exitCode===0&&!outcome.exitSignal&&!outcome.errorCode&&outcome.stdout==='PUBLISHED\n')){
    throw Object.assign(new Error('OBJECT_BUNDLE_PUBLICATION_NOT_COMPLETED'),
      {code:'OBJECT_BUNDLE_PUBLICATION_NOT_COMPLETED',publication:record});
  }
}

export async function receiveObjectRecoveryBundle(options={}){
  const identity=selectionIdentity(options),archive=absolute(options.archive),root=absolute(options.directory),
    bundleOut=absolute(options.bundleOut);
  check(hex(options.expectedArchiveSha256),'OBJECT_BUNDLE_ARCHIVE_DIGEST_REQUIRED');
  apart(root,archive);apart(root,bundleOut);apart(archive,bundleOut);await directory(dirname(bundleOut));
  const selection={archive,archiveSha256:options.expectedArchiveSha256,bundleOut,...identity};
  return withOperation(options,'receive',selection,async(root,intent)=>{
    const retained=await retainArchive(archive,join(root,'received.tar'),options.expectedArchiveSha256,options.signal);
    const parsed=await parseArchive(retained.path,{expectedArchiveSha256:retained.sha256,signal:options.signal});
    check(parsed.manifest.recordSha256===identity.recordSha256&&same(parsed.manifest.objectSession,identity.objectSession),
      'OBJECT_BUNDLE_SELECTED_IDENTITY_MISMATCH');
    ownership(intent,parsed,bundleOut);
    const completed=await retainedResult(root,'receive',options);
    if(completed){
      await verifyPublished(root,intent,parsed,bundleOut,options.signal);return {...completed,reopened:true};
    }
    const publicationPath=join(root,'publication.json'),verifiedPath=join(root,'verified.json');
    if(await present(bundleOut)){
      check(await present(publicationPath)&&await present(verifiedPath),'OBJECT_BUNDLE_DESTINATION_EXISTS');
      const publication=await readJson(publicationPath),verification=await readJson(verifiedPath);
      check(same(publication,{bundleOut,archiveSha256:retained.sha256,token:intent.token}),
        'OBJECT_BUNDLE_PUBLICATION_INTENT_CHANGED');
      check(same(await fileIdentity(verification.path,{maximum:LIMITS.metadata,signal:options.signal}),verification),
        'OBJECT_BUNDLE_VERIFICATION_CHANGED');
      const receipt=await verifyPublished(root,intent,parsed,bundleOut,options.signal);
      await sync(dirname(bundleOut));return finish(root,'receive',parsed,{verification,bundleOut,receipt,reopened:true});
    }
    // Stage beside the final destination so publication is one same-filesystem rename.
    // The random path is recorded before creation and is private to this operation.
    const staged=join(dirname(bundleOut),'.sf101-receive-'+intent.token);
    const stageRecord=join(root,'receiving-stage.json');
    if(await present(stageRecord)){check(same(await readJson(stageRecord),{path:staged}),'OBJECT_BUNDLE_STAGE_INTENT_CHANGED');}
    else await immutableJson(stageRecord,{path:staged});
    if(await present(staged)){await directory(staged);await rm(staged,{recursive:true,force:false});await sync(dirname(staged));}
    await mkdir(staged,{mode:0o700});await sync(dirname(staged));
    await parseArchive(retained.path,{expectedArchiveSha256:retained.sha256,extract:staged,signal:options.signal});
    await nativeManifestCheck(staged,parsed.manifest.members);
    const verification=await authenticate(root,staged,identity,options);
    // A fresh receive attempt can create a new native verification outcome.
    await atomicJson(verifiedPath,verification);
    const receipt=receiptFor(intent,parsed.archive,bundleOut);
    await directory(join(staged,'.sf101-transfers'),true);
    await immutableJson(join(staged,'.sf101-transfers',intent.token+'.json'),receipt);
    await sync(staged);
    await immutableJson(publicationPath,{bundleOut,archiveSha256:retained.sha256,token:intent.token});
    abort(options.signal);
    check(!await present(bundleOut),'OBJECT_BUNDLE_DESTINATION_EXISTS');
    await publishNoReplace(root,staged,bundleOut,options.python??'/usr/bin/python3');
    await sync(dirname(bundleOut));
    await verifyPublished(root,intent,parsed,bundleOut,options.signal);
    return finish(root,'receive',parsed,{verification,bundleOut,receipt});
  });
}
