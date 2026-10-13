#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Receive the complete original Flowable workspace and original SF47 Installation. */
import {constants,createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open,link,unlink,realpath,lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {reopenFlowableInstallation} from './flowable-installation.mjs';
import {openFlowableWorkspace} from '../../../scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/model.mjs';
import {regular,operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {hashPrivate,privateDirectory,syncDirectory} from '../../../scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

export const FLOWABLE_INSTALLATION_RECEIVING_SCHEMA='stellar-forge.flowable-installation-complete-receiving.v1';
const SCHEMA=FLOWABLE_INSTALLATION_RECEIVING_SCHEMA,HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX=8*1024*1024*1024,JSON_MAX=128*1024*1024;
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_INSTALLATION_RECEIVING'});};
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parsed=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const originalRoot=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const originalCli=join(originalRoot,'stellar/scf_2026/sf47_budget_model/workspace/cli.py');
const archiveHelper=fileURLToPath(new URL('./flowable-installation-operations.py',import.meta.url));
const contains=(a,b)=>{const r=relative(a,b);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../');};
const ordinary=name=>typeof name==='string'&&name.length<=1024&&!/^[\/\\]|[\\:\u0000-\u001f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
async function ownDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});await privateDirectory(path);
 need(await realpath(path)===path,'Select an owned private directory without symbolic-link ancestors.');return path;
}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function originalIdentity(path,maximum=MAX){const v=await hashPrivate(path,maximum);return{bytes:v.bytes,sha256:v.hash};}
// A crashed create-only publication can leave its private temporary hardlink.
// Reconcile only this publisher's UUID name, same inode and exact full bytes.
async function settlePublished(path,expected,maximum=MAX){
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat();
  need(before.isFile()&&!(before.mode&0o077)&&before.uid===process.getuid?.()&&before.size<=maximum,
   'Preserve the original private published file: '+path);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of handle.createReadStream({autoClose:false})){
   size+=chunk.length;need(size<=maximum,'The published file exceeds its original limit.');hash.update(chunk);
  }
  const identity={bytes:size,sha256:hash.digest('hex')},after=await handle.stat();
  need(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
   'The published original changed while being read.');
  if(expected)need(same(identity,expected),'The retained original bytes differ: '+path);
  const linked=await lstat(path);
  need(linked.isFile()&&linked.dev===before.dev&&linked.ino===before.ino,'The published original was replaced.');
  const prefix=basename(path)+'.pending-',pending=[];
  for(const name of await readdir(dirname(path))){
   if(!name.startsWith(prefix)||!UUID.test(name.slice(prefix.length)))continue;
   const candidate=join(dirname(path),name);let info;
   try{info=await lstat(candidate);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(info.isFile()&&info.dev===before.dev&&info.ino===before.ino)pending.push(candidate);
  }
  need(after.nlink===1+pending.length,'Preserve unrecognized hardlinks; do not change foreign publication residue.');
  for(const candidate of pending){
   const info=await lstat(candidate),current=await lstat(path);
   need(info.isFile()&&info.dev===before.dev&&info.ino===before.ino&&current.dev===before.dev&&current.ino===before.ino,
    'The retained publication link changed before cleanup.');
   await unlink(candidate);
  }
  // Also retry directory durability after a prior unlink succeeded but its sync failed.
  await syncDirectory(dirname(path));
  const final=await handle.stat(),current=await lstat(path);
  need(final.nlink===1&&final.size===before.size&&final.mtimeMs===before.mtimeMs&&
   current.isFile()&&current.dev===before.dev&&current.ino===before.ino,
   'Complete original publication cleanup before continuing.');
  return identity;
 }finally{await handle.close();}
}
async function readRetained(path,maximum=JSON_MAX){
 await settlePublished(path,null,maximum);return regular(path,maximum);
}
async function retain(path,raw){
 await ownDirectory(dirname(path));
 const identity={bytes:raw.length,sha256:digest(raw)};
 if(await exists(path)){await settlePublished(path,identity,raw.length);return;}
 const temporary=path+'.pending-'+randomUUID();let file;
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(raw);await file.sync();await file.close();file=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
 }finally{
  await file?.close();
  try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  await syncDirectory(dirname(path));
 }
 await settlePublished(path,identity,raw.length);
}
async function sourceIdentity(path){
 const actual=await realpath(path),info=await lstat(actual);need(info.isFile(),'Select the original source or executable.');
 const raw=await regular(actual,128*1024*1024);return{path,realpath:actual,bytes:raw.length,sha256:digest(raw)};
}
async function copyOriginal(from,to,identity,signal){
 need(Number.isSafeInteger(identity.bytes)&&identity.bytes>=0&&identity.bytes<=MAX&&HASH.test(identity.sha256),'Retain the whole original file identity.');
 need(same(await originalIdentity(from),{bytes:identity.bytes,sha256:identity.sha256}),'The original full file changed: '+from);
 await ownDirectory(dirname(to));
 if(!(await exists(to))){
  const temporary=to+'.pending-'+randomUUID();
  try{
   await pipeline(createReadStream(from),createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal});
   need(same(await originalIdentity(temporary),{bytes:identity.bytes,sha256:identity.sha256}),'The full transfer differs.');
   const handle=await open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
   try{await link(temporary,to);}catch(e){if(e.code!=='EEXIST')throw e;}
   await syncDirectory(dirname(to));
  }finally{try{await unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}await syncDirectory(dirname(to));}
 }
 await settlePublished(to,{bytes:identity.bytes,sha256:identity.sha256},identity.bytes);
 return{path:to,bytes:identity.bytes,sha256:identity.sha256};
}
function selectedOptions(input){
 need(input&&typeof input==='object'&&!Array.isArray(input),'Supply the complete original receiving selection.');
 const names=['preparationDirectory','expectedPreparationSha256','operationsWorkspace','caseId','receivingOperationsDirectory','receivingFlowableDirectory','outputDirectory','actor','python'];
 const optional=['installationId','installationRevision','save'];
 need(Object.keys(input).every(k=>[...names,...optional].includes(k))&&names.every(k=>Object.hasOwn(input,k)),'Use the complete declared receiving fields.');
 const v={...input};
 for(const key of ['preparationDirectory','operationsWorkspace','receivingOperationsDirectory','receivingFlowableDirectory','outputDirectory','python']){
  need(typeof v[key]==='string'&&isAbsolute(v[key])&&!v[key].includes('\0'),'Select absolute original host paths.');v[key]=resolve(v[key]);
 }
 need(HASH.test(v.expectedPreparationSha256),'Select the exact complete preparation SHA-256.');
 need(typeof v.caseId==='string'&&v.caseId&&typeof v.actor==='string'&&v.actor.trim()&&v.actor.length<=160,'Select the original case and actual receiving operator.');
 if(v.save){
  need(!v.installationId&&!v.installationRevision&&Object.keys(v.save).every(k=>['requestId','note'].includes(k))&&
   UUID.test(v.save.requestId)&&typeof v.save.note==='string'&&v.save.note.trim()&&v.save.note.length<=12000,
   'Choose one original explicit first-save request, or an already saved Installation.');
 }else need(typeof v.installationId==='string'&&v.installationId&&Number.isSafeInteger(v.installationRevision)&&v.installationRevision>=1,
  'Select the actual saved historical Installation identity and revision.');
 const paths=['preparationDirectory','operationsWorkspace','receivingOperationsDirectory','receivingFlowableDirectory','outputDirectory'];
 for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)
  need(!contains(v[paths[i]],v[paths[j]])&&!contains(v[paths[j]],v[paths[i]]),'Use separate preparation, sender, receiving and output directories.');
 for(const key of ['receivingOperationsDirectory','receivingFlowableDirectory','outputDirectory'])
  need(!contains(originalRoot,v[key]),'Receive outside the installed source.');
 return v;
}
async function nativeCommand({python,args,outputDirectory,name,signal,timeoutMs=300000}){
 signal?.throwIfAborted();await ownDirectory(join(outputDirectory,'native'));
 const attempt=name+'-'+randomUUID(),stdoutPath=join(outputDirectory,'native',attempt+'.stdout'),
  stderrPath=join(outputDirectory,'native',attempt+'.stderr');
 const stdout=await open(stdoutPath,'wx',0o600);let stderr,child,timer,killTimer,stopping=false,cause=null;
 const failures=[],cleanupErrors=[];
 const errorValue=error=>({code:error.code??'NATIVE_IO_FAILED',message:String(error.message??error)});
 const kill=()=>{
  if(!child?.pid)return;
  try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  killTimer??=setTimeout(()=>{try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGKILL');}catch{}},5000);
 };
 const stop=()=>{stopping=true;cause=signal?.aborted?'cancelled':'timeout';kill();};
 let outcome;
 try{
  stderr=await open(stderrPath,'wx',0o600);
  child=spawn(python,args,{cwd:dirname(originalCli),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},
   shell:false,detached:process.platform!=='win32',stdio:['ignore',stdout.fd,stderr.fd]});
  signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
  timer=setTimeout(stop,timeoutMs);
  outcome=await new Promise((resolve,reject)=>{
   child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
  });
 }catch(error){failures.push(error);outcome={code:null,signal:null,error:errorValue(error)};}
 finally{
  clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);
  // Drain both owned handles even when either fsync or close rejects. The
  // command outcome remains separate from these terminal file failures.
  await Promise.allSettled([['stdout',stdout],['stderr',stderr]].map(async([stream,handle])=>{
   if(!handle)return;
   try{await handle.sync();}catch(error){failures.push(error);cleanupErrors.push({stream,action:'sync',...errorValue(error)});}
   finally{try{await handle.close();}catch(error){failures.push(error);cleanupErrors.push({stream,action:'close',...errorValue(error)});}}
  }));
 }
 const logs={};
 await Promise.allSettled([['stdout',stdoutPath],...(stderr?[['stderr',stderrPath]]:[])].map(async([stream,path])=>{
  try{logs[stream]={path,...await originalIdentity(path,320*1024*1024)};}
  catch(error){failures.push(error);logs[stream]={path,completeIdentity:false,error:errorValue(error)};}
 }));
 if(stopping||outcome?.code!==0)failures.unshift(Object.assign(new Error(
  'The actual original native command did not complete; inspect retained '+attempt+' logs and resume the same request.'),
  {code:'FLOWABLE_INSTALLATION_NATIVE_INCOMPLETE',outcome,cause}));
 try{await retain(join(outputDirectory,'native',attempt+'.json'),encoded({python,args,outcome,cause,logs,cleanupErrors}));}
 catch(error){failures.push(error);}
 if(failures.length){
  const error=failures.length===1?failures[0]:new AggregateError(failures,
   'The original native command or its complete log drain failed; preserve the same request and retained files.');
  error.code??='FLOWABLE_INSTALLATION_NATIVE_INCOMPLETE';throw error;
 }
 const raw=await regular(stdoutPath,128*1024*1024);
 return parsed(raw);
}

/** Full original receiving; optional save uses the existing native writer once. */
export async function runFlowableInstallationReceiving(input,{signal}={}){
 const options=selectedOptions(input),out=await ownDirectory(options.outputDirectory);
 const lease=await operationLease(join(out,'flowable-installation-receiving.lock'));
 let model,primaryError,result;
 const saved=(name,value)=>retain(join(out,name),encoded(value));
 const phase=async(name,action)=>{
  const path=join(out,name+'.json');
  if(await exists(path))return parsed(await readRetained(path,JSON_MAX));
  signal?.throwIfAborted();const value=await action();await saved(name+'.json',value);return value;
 };
 const native=(name,args,workspace=options.operationsWorkspace)=>nativeCommand({python:options.python,
  args:[originalCli,'operations','--workspace',workspace,...args],outputDirectory:out,name,signal});
 try{
  await saved('Original_Receiving_Arguments.json',options);
  await saved('Original_Receiving_Source.json',{schema:SCHEMA+'.source',root:originalRoot,
   cli:await sourceIdentity(originalCli),archiveHelper:await sourceIdentity(archiveHelper),
   receiver:await sourceIdentity(fileURLToPath(import.meta.url)),python:await sourceIdentity(options.python)});
  const prepared=await reopenFlowableInstallation({directory:options.preparationDirectory});
  need(prepared.preparationSha256===options.expectedPreparationSha256,'Select the unchanged complete original preparation.');
  const source=prepared.source,document=prepared.document,preview=prepared.preview;
  need(source?.schema==='stellar-forge.flowable-customer-installation.v1.source'&&source.programme?.record?.kind==='programme'&&
   HASH.test(source.programme.record.sha256)&&HASH.test(source.programme.programmeSha256)&&HASH.test(source.programme.basisSha256),
   'Retain the full selected original programme, source and frozen review basis.');
  need(document?.workshare?.caseId===prepared.workshareCaseId&&preview?.expectedVersion&&
   preview.installationId===null&&preview.expectedRevision===0&&same(preview.document,document)&&
   prepared.installationSource?.caseId===options.caseId,
   'Use the complete original planned customer Workshare and case preparation.');
  need(prepared.archive?.name==='source/flowable-workspace.ndjson'&&
   prepared.archive.sha256===source.archive?.sha256&&prepared.archive.bytes===source.archive?.bytes,
   'The complete mandatory Flowable archive differs from the selected source.');
  await saved('Original_Preparation.json',prepared);
  const transferred=[],byName=new Map();
  for(const row of [...prepared.inputs,...prepared.outputs]){
   need(ordinary(row.name),'Use complete ordinary retained preparation file paths.');
   const prior=byName.get(row.name);
   if(prior){need(same(prior,row),'Repeated preparation files differ.');continue;}
   byName.set(row.name,row);
   const file=await copyOriginal(join(options.preparationDirectory,row.name),join(out,'preparation',row.name),row,signal);
   transferred.push({name:row.name,...file});
  }
  need(byName.has('source/flowable-workspace.ndjson')&&byName.has('FLOWABLE_CUSTOMER_SOURCE.json')&&
   byName.has('installation-input.json')&&byName.has('installation-preview-input.json'),
   'Transfer the full archive, source report and original native preparation together.');
  const report=parsed(await regular(join(out,'preparation','FLOWABLE_CUSTOMER_SOURCE.json'),64*1024*1024));
  need(same(report,source)&&same(parsed(await regular(join(out,'preparation','installation-input.json'),128*1024)),document)&&
   same(parsed(await regular(join(out,'preparation','installation-preview-input.json'),128*1024)),preview),
   'The complete retained report or native preparation changed.');
  for(const file of source.files){
   need(ordinary(file.name),'Retain every emitted original source file.');
   const retained=byName.get('delivery/files/'+file.name);
   need(retained&&retained.bytes===file.bytes&&retained.sha256===file.sha256,'The complete selected source file was not transferred: '+file.name);
  }
  const flowableArchive=join(out,'preparation','source','flowable-workspace.ndjson');
  let installation;
  if(options.save){
   // This full original request is durably retained before the first native write.
   const intent=await phase('Original_Save_Intent',async()=>{
    const actual=await native('installation-preview',['installation-preview','--case',options.caseId,
     '--expected-version',String(preview.expectedVersion),'--expected-revision','0',
     '--document',join(out,'preparation','installation-input.json')]);
    need(same(actual.document,document)&&actual.installationId===null&&actual.expectedRevision===0&&
     HASH.test(actual.previewSha256),'Original native preview differs from this preparation.');
    return{requestId:options.save.requestId,actor:options.actor,note:options.save.note,expectedVersion:preview.expectedVersion,
     expectedRevision:0,expectedPreviewSha256:actual.previewSha256,documentFile:'preparation/installation-input.json',preview:actual};
   });
   const receipt=await phase('Original_Save_Result',()=>native('installation-save',['installation-save','--case',options.caseId,
    '--expected-version',String(intent.expectedVersion),'--expected-revision','0','--document',join(out,intent.documentFile),
    '--expected-preview-sha256',intent.expectedPreviewSha256,'--request-id',intent.requestId,'--actor',intent.actor,'--note',intent.note]));
   need(typeof receipt.recordId==='string'&&receipt.recordId&&Number.isSafeInteger(receipt.revision)&&receipt.revision===1,
    'Retain the original saved Installation identity and first revision.');
   installation={id:receipt.recordId,revision:receipt.revision};
  }else installation={id:options.installationId,revision:options.installationRevision};
  const original=await native('installation-selected',['installation-show','--case',options.caseId,
   '--installation',installation.id,'--revision',String(installation.revision)]);
  need(original.id===installation.id&&original.revision===installation.revision&&HASH.test(original.sha256)&&
   same(original.preview.document,document),'The selected saved Installation does not match the complete preparation.');
  const originalCase=await native('installation-original-case',['show','--case',options.caseId]);
  need(originalCase.program?.id===options.caseId&&Array.isArray(originalCase.sources),'Retain the full original customer case.');
  const sourceIds=[...new Set([...(document.source?.sourceIds??[]),...(document.receiving?.sourceIds??[]),
   ...(document.payment?.termsSourceIds??[]),document.workshare.sourceId,document.workshare.packetSourceId].filter(Boolean))];
  const sources=sourceIds.map(id=>{const row=originalCase.sources.find(x=>x.id===id);need(row,'Missing original selected case source.');return{id:row.id,bytes:row.bytes,sha256:row.sha256};});
  const originalSelection={schema:SCHEMA+'.archive-selection',caseId:options.caseId,
   installation:{...installation,sha256:original.sha256},document,sources};
  await saved('Original_Archive_Selection.json',originalSelection);
  const casePath=join(out,'Complete_Original_Installation.zip');
  const exported=await phase('Installation_Export',async()=>{
   if(!(await exists(casePath)))await native('installation-export',['installation-export','--case',options.caseId,
    '--installation',installation.id,'--revision',String(installation.revision),'--output',casePath]);
   return{path:casePath,...await originalIdentity(casePath,320*1024*1024)};
  });
  need(same(await originalIdentity(casePath,320*1024*1024),{bytes:exported.bytes,sha256:exported.sha256}),'The complete original case archive changed.');
  const inspected=await nativeCommand({python:options.python,args:[archiveHelper,'--archive',casePath,
   '--selection',join(out,'Original_Archive_Selection.json')],outputDirectory:out,name:'case-archive-inspection',signal});
  need(same(inspected.archive,{bytes:exported.bytes,sha256:exported.sha256}),'Original case archive inspection selected different bytes.');
  await phase('Installation_Archive_Inspection',async()=>inspected);

  // Receive the mandatory full sidecar through the original native Flowable parser/adopter.
  model=await openFlowableWorkspace({directory:options.receivingFlowableDirectory,signal});
  need(typeof source.workspaceId==='string'&&source.workspaceId&&model.workspaceId!==source.workspaceId,
   'Select an independent Flowable receiving workspace, not the original producing workspace.');
  const flowIntent=await phase('Original_Flowable_Intent',async()=>({
   requestId:randomUUID(),adoptRequestId:randomUUID(),archiveSha256:source.archive.sha256,
   bytes:source.archive.bytes,workspaceId:model.workspaceId}));
  need(flowIntent.workspaceId===model.workspaceId&&flowIntent.archiveSha256===source.archive.sha256&&
   flowIntent.bytes===source.archive.bytes,'Continue the same independent original Flowable workspace.');
  const receiving=await model.inspectDelivery({requestId:flowIntent.requestId,path:flowableArchive,label:'Complete customer Installation source'});
  need(receiving.value.sourceWorkspace?.workspaceId===source.workspaceId&&receiving.value.original.sha256===source.archive.sha256,
   'Original native archive authority differs from the selected complete source.');
  const manifest=(await model.readSource({reference:receiving.value.manifest})).value;
  const adoptIntent=await phase('Original_Flowable_Adopt_Intent',async()=>({requestId:flowIntent.adoptRequestId,id:receiving.id,
   expectedRevision:receiving.revision,manifestSha256:receiving.value.manifestSha256}));
  const adopted=await model.adoptDelivery(adoptIntent);
  need(adopted.value.state==='ADOPTED','Complete original Flowable adoption is unfinished.');
  await phase('Flowable_Adoption',async()=>({id:adopted.id,sha256:adopted.sha256,sourceWorkspace:source.workspaceId,workspaceId:model.workspaceId}));
  const verifyFlowable=async()=>{
   for(const record of manifest.records){
    signal?.throwIfAborted();const actual=await model.getRecord({kind:record.kind,id:record.id,revision:record.revision});
    need(actual.sha256===record.sha256&&actual.bytes===record.bytes,'An imported immutable Flowable record differs.');
   }
   const chosen=source.programme.record,actual=await model.getRecord({kind:'programme',id:chosen.id,revision:chosen.revision});
   need(actual.sha256===chosen.sha256&&actual.value.programmeSha256===source.programme.programmeSha256,
    'The selected immutable programme/source differs after receiving.');
   return{workspaceId:model.workspaceId,sourceWorkspace:source.workspaceId,programme:chosen,
    programmeSha256:source.programme.programmeSha256,retainedBasisSha256:source.programme.basisSha256,
    records:manifest.records.length,receivingId:adopted.id,manifestSha256:adopted.value.manifestSha256};
  };
  const first=await verifyFlowable();await model.close();model=null;
  model=await openFlowableWorkspace({directory:options.receivingFlowableDirectory,signal});
  const cold=await verifyFlowable();need(same(first,cold),'Original immutable Flowable source changed on cold reopen.');
  await saved('Flowable_Cold_Reopen.json',cold);await model.close();model=null;

  const importIntent=await phase('Original_Installation_Import_Intent',async()=>({
   requestId:'flowable-installation-'+digest(encoded({archive:exported.sha256,workspace:options.receivingOperationsDirectory,actor:options.actor})).slice(0,32),
   archiveSha256:exported.sha256,name:'Received Flowable customer Installation',actor:options.actor}));
  const imported=await native('installation-import',['import','--file',casePath,'--name',importIntent.name,
   '--actor',importIntent.actor,'--request-id',importIntent.requestId],options.receivingOperationsDirectory);
  need(typeof imported.id==='string'&&imported.id,'Retain the actual independently imported case ID.');
  const priorImport=await phase('Installation_Independent_Import',async()=>imported);
  need(priorImport.id===imported.id,'The same import request returned a different case.');
  const readCase=async name=>{
   const actual=await native(name,['installation-show','--case',imported.id,'--installation',installation.id,
    '--revision',String(installation.revision)],options.receivingOperationsDirectory);
   need(actual.sha256===original.sha256&&same(actual.preview.document,document),'The independent Installation differs.');
   return{id:actual.id,revision:actual.revision,sha256:actual.sha256,workshare:actual.preview.document.workshare};
  };
  const received=await readCase('recipient-selected'),coldCase=await readCase('recipient-cold-selected');
  need(same(received,coldCase),'The original native Installation changed on cold reopen.');
  // Each execution exports the current receiver under a fresh path. Later local work is retained and compared, never replaced.
  const recipientPath=join(out,'received','Complete_Received_Installation-'+randomUUID()+'.zip');
  await ownDirectory(dirname(recipientPath));
  await native('recipient-export',['installation-export','--case',imported.id,'--installation',installation.id,
   '--revision',String(installation.revision),'--output',recipientPath],options.receivingOperationsDirectory);
  const comparison=await nativeCommand({python:options.python,args:[archiveHelper,'--archive',casePath,
   '--selection',join(out,'Original_Archive_Selection.json'),'--received',recipientPath,'--received-case',imported.id],
   outputDirectory:out,name:'independent-case-history',signal});
  await saved('received/History_Comparison-'+digest(encoded(comparison))+'.json',comparison);
  result={schema:SCHEMA,state:'COMPLETE',sourceReceivingComplete:true,
   original:{caseId:options.caseId,installation:{...installation,sha256:original.sha256},workshareCaseId:prepared.workshareCaseId,
    preparationSha256:prepared.preparationSha256,programme:source.programme.record},
   received:{caseId:imported.id,operationsDirectory:options.receivingOperationsDirectory,flowableDirectory:options.receivingFlowableDirectory,
    flowableWorkspaceId:cold.workspaceId,installation:coldCase},
   completeCase:exported,mandatoryFlowableArchive:{path:flowableArchive,bytes:source.archive.bytes,sha256:source.archive.sha256},
   files:transferred,requestIds:{save:options.save?.requestId??null,caseImport:importIntent.requestId,
    flowableInspect:flowIntent.requestId,flowableAdopt:flowIntent.adoptRequestId},
   renderedUse:{performed:false,viewedByOperator:false,
    requirement:'Open and use the exact original applications at desktop and narrow widths, view every outgoing attachment and usable archive contents, operate important controls, downloads and independent reopen. Native receiving does not establish visual acceptance.'}};
 }catch(error){primaryError=error;
  try{await saved('receiving-error-'+randomUUID()+'.json',{schema:SCHEMA+'.error',at:new Date().toISOString(),
   code:error.code??'FLOWABLE_INSTALLATION_RECEIVING',message:String(error.message)});}catch{}
 }finally{
  const failures=[];try{await model?.close();}catch(e){failures.push(e);}
  try{await lease.close();}catch(e){failures.push(e);}
  if(failures.length)primaryError=new AggregateError([...(primaryError?[primaryError]:[]),...failures],'The original receiving owner has not completed shutdown.');
 }
 if(primaryError)throw primaryError;
 await saved('Flowable_Installation_Complete_Receiving.json',result);return result;
}
export async function main(argv=process.argv.slice(2)){
 need(argv.length===2&&argv[0]==='--input','Use flowable-installation-receive --input /absolute/private/receiving.json');
 const input=parsed(await regular(resolve(argv[1]),8*1024*1024)),controller=new AbortController();
 const stop=()=>controller.abort(new Error('Original complete receiving cancelled.'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const result=await runFlowableInstallationReceiving(input,{signal:controller.signal});process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
 main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(JSON.stringify({state:'ERROR',code:error.code??error.name,message:error.message})+'\n');process.exitCode=1;});

// Shared with the original Source Desk family for complete owned-file recovery.
export {settlePublished as settleFlowableInstallationFile,retain as retainFlowableInstallationFile};
