#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Independently receive both complete applications from an actual saved Installation. */
import {mkdir,open,link,unlink,realpath,lstat} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createDcatInstallationService} from './dcat-installation/service.mjs';
import {exportDcatInstallationFile} from './dcat-installation.mjs';
import {inspectDcatInstallationArchive} from './dcat-installation-source.mjs';
import {dcatInstallationSame as same,validateDcatInstallationSource} from './dcat-installation-core.mjs';
import {receiveCkanWorkspaceArchive} from '../../../scf-starforge-20261009/sf30-seller-sdk/ckan/archive.mjs';
import {openCkanWorkbench} from '../../../scf-starforge-20261009/sf30-seller-sdk/ckan/model.mjs';
import {regular,operationLease} from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {hashPrivate,privateDirectory,syncDirectory} from '../../../scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SCHEMA='stellar-forge.dcat-installation-complete-receiving.v1';
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'DCAT_INSTALLATION_RECEIVING'});};
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const parsed=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const originalRoot=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const originalCli=join(originalRoot,'stellar/scf_2026/sf47_budget_model/workspace/cli.py');
const archiveHelper=fileURLToPath(new URL('./dcat-installation-operations.py',import.meta.url));
const contains=(a,b)=>{const r=relative(a,b);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../');};
async function ownDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});await privateDirectory(path);
 need(await realpath(path)===path,'Select an owned directory without symbolic-link ancestors.');return path;
}
async function retain(path,raw){
 await ownDirectory(dirname(path));
 let prior;try{prior=await regular(path,Math.max(raw.length,128*1024*1024));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior){need(prior.equals(raw),'Preserve the differing retained original: '+path);return;}
 const temporary=path+'.pending-'+randomUUID();let file;
 try{
  file=await open(temporary,'wx',0o600);await file.writeFile(raw);await file.sync();await file.close();file=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await regular(path,raw.length)).equals(raw),'The concurrently retained source differs.');}
  await syncDirectory(dirname(path));
 }finally{await file?.close();try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function originalIdentity(path,maximum){const value=await hashPrivate(path,maximum);return{bytes:value.bytes,sha256:value.hash};}
async function sourceIdentity(path){
 const real=await realpath(path),info=await lstat(real);need(info.isFile()&&info.size<=128*1024*1024,'Select the original source/executable file.');
 const bytes=await regular(real,128*1024*1024);return{path,realpath:real,bytes:bytes.length,sha256:digest(bytes)};
}
function selectedOptions(input){
 const required=['preparationDirectory','preparationRequestId','operationsWorkspace','caseId','installationId',
  'installationRevision','receivingOperationsDirectory','receivingCatalogDirectory','outputDirectory','actor','python'];
 need(input&&typeof input==='object'&&!Array.isArray(input)&&required.every(key=>Object.hasOwn(input,key)),
  'Provide the complete original prepared/saved Installation and independent receiving directories.');
 const value=Object.fromEntries(required.map(key=>[key,input[key]]));
 for(const key of ['preparationDirectory','operationsWorkspace','receivingOperationsDirectory','receivingCatalogDirectory','outputDirectory','python']){
  need(typeof value[key]==='string'&&isAbsolute(value[key])&&!value[key].includes('\0'),'Select absolute original host paths.');
  value[key]=resolve(value[key]);
 }
 need(UUID.test(value.preparationRequestId),'Use the actual completed preparation request UUID.');
 need(typeof value.caseId==='string'&&value.caseId&&typeof value.installationId==='string'&&value.installationId,
  'Use the actual original case and saved Installation IDs.');
 need(Number.isSafeInteger(value.installationRevision)&&value.installationRevision>=1,'Select the actual saved historical Installation revision.');
 need(typeof value.actor==='string'&&value.actor.trim()===value.actor&&value.actor.length>0&&value.actor.length<=160,
  'Name the actual receiving operator.');
 const paths=['preparationDirectory','operationsWorkspace','receivingOperationsDirectory','receivingCatalogDirectory','outputDirectory'];
 for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)
  need(!contains(value[paths[i]],value[paths[j]])&&!contains(value[paths[j]],value[paths[i]]),
   'Use independent non-overlapping preparation, sender, receiver and output directories.');
 need(!contains(originalRoot,value.outputDirectory)&&!contains(originalRoot,value.receivingCatalogDirectory)&&
  !contains(originalRoot,value.receivingOperationsDirectory),'Receive outside the installed original source.');
 return value;
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
  {code:'DCAT_INSTALLATION_NATIVE_INCOMPLETE',outcome,cause}));
 try{await retain(join(outputDirectory,'native',attempt+'.json'),encoded({python,args,outcome,cause,logs,cleanupErrors}));}
 catch(error){failures.push(error);}
 if(failures.length){
  const error=failures.length===1?failures[0]:new AggregateError(failures,
   'The original native command or its complete log drain failed; preserve the same request and retained files.');
  error.code??='DCAT_INSTALLATION_NATIVE_INCOMPLETE';throw error;
 }
 const raw=await regular(stdoutPath,128*1024*1024);
 return parsed(raw);
}
/** No migration, semantic engine, case terms or Installation save is fabricated here. */
export async function runDcatInstallationReceiving(input,{signal,playwright,chromiumPath,browserContext}={}){
 const options=selectedOptions(input),out=await ownDirectory(options.outputDirectory);
 const lease=await operationLease(join(out,'dcat-installation-receiving.lock'));
 let service,model,server,primaryError;
 const browserRequested=Boolean(playwright);
 const saved=(name,value)=>retain(join(out,name),encoded(value));
 const phase=async(name,action)=>{
  try{return parsed(await regular(join(out,name+'.json'),128*1024*1024));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  signal?.throwIfAborted();const value=await action();await saved(name+'.json',value);return value;
 };
 const native=(name,args,workspace=options.operationsWorkspace)=>nativeCommand({
  python:options.python,args:[originalCli,'operations','--workspace',workspace,...args],outputDirectory:out,name,signal});
 try{
  await saved('Original_Receiving_Arguments.json',{...options,browserRequested,
   browser:browserRequested?{chromium:chromiumPath?await sourceIdentity(chromiumPath):null,
    module:input.playwrightModule?await sourceIdentity(resolve(input.playwrightModule)):null,
    borrowedContext:Boolean(browserContext)}:null});
  await saved('Original_Receiving_Source.json',{schema:SCHEMA+'.source',root:originalRoot,
   cli:await sourceIdentity(originalCli),archiveHelper:await sourceIdentity(archiveHelper),
   python:await sourceIdentity(options.python)});
  service=await createDcatInstallationService({directory:options.preparationDirectory});
  const prepared=await service.get(options.preparationRequestId);
  need(prepared.status==='COMPLETE'&&prepared.type==='prepare'&&prepared.installation&&prepared.scope,
   'Select the actual completed whole Installation preparation.');
  await saved('Original_Preparation.json',prepared);
  const document=prepared.installation,scope=prepared.scope;
  need(scope.originalCase?.caseId===options.caseId&&same(scope.workshare,document.workshare),
   'Preserve the exact original case and commercial Workshare.');
  const selected=new Map(),descriptors=[];
  await ownDirectory(join(out,'prepared'));
  for(const descriptor of prepared.files){
   need(HASH.test(descriptor.fileId??'')&&HASH.test(descriptor.sha256??''),
    'Retain the exact full preparation file identities.');
   // Names may repeat across independently imported files. File IDs keep them distinct.
   const filename=descriptor.fileId+'-'+descriptor.name;
   const result=await exportDcatInstallationFile({service,fileId:descriptor.fileId,
    expectedSha256:descriptor.sha256,out:join(out,'prepared',filename),signal});
   descriptors.push({...descriptor,retainedPath:result.file});
   if(['Dcat_Complete_Source_Report.json','installation-input.json','Dcat_Installation_Scope.json',
    'Selected_Dcat_Scope.json'].includes(descriptor.name))
    selected.set(descriptor.name,parsed(await regular(result.file,128*1024*1024)));
  }
  const source=validateDcatInstallationSource(selected.get('Dcat_Complete_Source_Report.json'));
  need(same(selected.get('installation-input.json'),document)&&same(selected.get('Dcat_Installation_Scope.json'),scope)&&
   scope.sourceSha256===source.sourceSha256&&scope.manifestSha256===source.manifestSha256,
   'The prepared original document or selected complete source changed.');
  const archiveDescriptor=prepared.files.find(file=>file.fileId===prepared.archiveId);
  need(archiveDescriptor?.kind==='archive'&&archiveDescriptor.sha256===source.archive.sha256&&archiveDescriptor.bytes===source.archive.bytes,
   'Retain the exact full original .ckanw archive.');
  const catalogArchive=descriptors.find(file=>file.fileId===prepared.archiveId).retainedPath;
  const members=[];
  for(const member of source.manifest.files){
   signal?.throwIfAborted();
   const selectedMember=await service.sourceFile({inspectionId:prepared.inspectionId,path:member.path});
   need(selectedMember.sha256===member.sha256&&selectedMember.bytes===member.bytes,'An original complete archive member changed.');
   const destination=join(out,'catalogue-members',member.path);
   need(contains(join(out,'catalogue-members'),destination),'The original member path leaves the owned output.');
   await ownDirectory(dirname(destination));
   const exported=await exportDcatInstallationFile({service:{file:async()=>({
    path:selectedMember.path,descriptor:{name:member.path.split('/').at(-1),bytes:member.bytes,sha256:member.sha256}})},
    fileId:member.path,expectedSha256:member.sha256,out:destination,signal});
   members.push({path:member.path,retainedPath:exported.file,bytes:member.bytes,sha256:member.sha256});
  }
  await saved('Complete_Preparation_Files.json',{files:descriptors,members});
  await service.close();service=null;
  const original=await phase('Original_Saved_Installation',async()=>{
   const value=await native('installation-show',['installation-show','--case',options.caseId,
    '--installation',options.installationId,'--revision',String(options.installationRevision)]);
   need(value.id===options.installationId&&value.revision===options.installationRevision&&
    same(value.preview.document,document),'Select the actual original saved revision of this exact preparation.');
   return value;
  });
  // A retained phase remains bound to the same complete selected document on every continuation.
  need(same(original.preview.document,document)&&original.id===options.installationId&&
   original.revision===options.installationRevision,'The saved Installation selection changed.');
  const originalCase=await phase('Original_Operations_Case',async()=>{
   const value=await native('case-show',['show','--case',options.caseId]);
   need(value.program?.id===options.caseId&&Array.isArray(value.sources),'Retain the actual original Operations case.');
   return value;
  });
  const sourceIds=[...new Set([...document.source.sourceIds,...document.receiving.sourceIds])];
  for(const [id,identity]of [[scope.archive.sourceId,scope.archive],[scope.selection.sourceId,scope.selection]]){
   need(sourceIds.includes(id)&&originalCase.sources.some(row=>row.id===id&&
    row.bytes===identity.bytes&&row.sha256===identity.sha256),'The saved case lacks its complete original selected source.');
  }
  const receiving=await receiveCkanWorkspaceArchive({file:catalogArchive,expectedSha256:source.archive.sha256,
   directory:options.receivingCatalogDirectory,signal});
  need(receiving.state==='COMPLETE'&&receiving.archiveSha256===source.archive.sha256&&
   receiving.manifestSha256===source.manifestSha256,'Continue the same complete original catalogue receive.');
  await phase('Catalogue_Independent_Receive',async()=>receiving);
  const reopened=await inspectDcatInstallationArchive({archivePath:catalogArchive,
   expectedArchiveSha256:source.archive.sha256,directory:options.receivingCatalogDirectory,signal});
  need(reopened.sourceSha256===source.sourceSha256,'The independently received original catalogue source differs.');
  await phase('Catalogue_Complete_Inspection',async()=>reopened);
  model=await openCkanWorkbench({directory:options.receivingCatalogDirectory});
  let actual=model.status();need(actual.createdAt===source.project.createdAt&&actual.catalogOrigin===source.project.catalogOrigin,
   'The independently opened catalogue has a different original identity.');
  const before={createdAt:actual.createdAt,catalogOrigin:actual.catalogOrigin,sourceKind:actual.sourceKind,
   dcat:actual.dcat};await model.close();model=null;
  model=await openCkanWorkbench({directory:options.receivingCatalogDirectory});
  actual=model.status();const after={createdAt:actual.createdAt,catalogOrigin:actual.catalogOrigin,
   sourceKind:actual.sourceKind,dcat:actual.dcat};
  need(same(before,after),'The original catalogue changed during its cold reopen.');
  await saved('Catalogue_Cold_Reopen_'+digest(encoded(after))+'.json',after);await model.close();model=null;
  const archivePath=join(out,'Complete_Original_Installation.zip');
  const exported=await phase('Installation_Export',async()=>{
   let exists=true;try{await lstat(archivePath);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
   if(!exists)await native('installation-export',['installation-export','--case',options.caseId,
    '--installation',options.installationId,'--revision',String(options.installationRevision),'--output',archivePath]);
   return{path:archivePath,...await originalIdentity(archivePath,320*1024*1024)};
  });
  need(same(await originalIdentity(archivePath,320*1024*1024),{bytes:exported.bytes,sha256:exported.sha256}),
   'The complete original Installation export changed.');
  const archiveSelection={schema:'stellar-forge.dcat-installation-archive-selection.v1',caseId:options.caseId,
   installation:{id:options.installationId,revision:options.installationRevision,sha256:original.sha256},
   document,sources:sourceIds.map(id=>{
    const row=originalCase.sources.find(item=>item.id===id);need(row,'Keep every original Installation source.');
    return{id:row.id,bytes:row.bytes,sha256:row.sha256};
   })};
  await saved('Original_Archive_Selection.json',archiveSelection);
  // Always inspect the exact whole archive before import, including a previously published file whose response was lost.
  const inspected=await nativeCommand({python:options.python,args:[archiveHelper,'--archive',archivePath,
   '--selection',join(out,'Original_Archive_Selection.json')],outputDirectory:out,name:'archive-inspection',signal});
  need(same(inspected.archive,{bytes:exported.bytes,sha256:exported.sha256}),
   'The original saved Installation archive differs before import.');
  await phase('Installation_Archive_Inspection',async()=>inspected);
  const requestId='dcat-installation-'+digest(encoded({archive:exported.sha256,
   workspace:options.receivingOperationsDirectory,actor:options.actor})).slice(0,32);
  await saved('Original_Import_Intent.json',{requestId,archiveSha256:exported.sha256,
   workspace:options.receivingOperationsDirectory,actor:options.actor});
  const imported=await native('installation-import',['import','--file',archivePath,'--name',
   'Received catalogue Installation','--actor',options.actor,'--request-id',requestId],options.receivingOperationsDirectory);
  need(typeof imported.id==='string'&&imported.id,'Retain the actual independent receiving case ID.');
  const firstImport=await phase('Installation_Independent_Import',async()=>imported);
  need(firstImport.id===imported.id,'The same original import request returned another case.');
  const readRecipient=async(name)=>{
   const value=await native(name+'-installation',['installation-show','--case',imported.id,
    '--installation',options.installationId,'--revision',String(options.installationRevision)],options.receivingOperationsDirectory);
   const full=await native(name+'-case',['show','--case',imported.id],options.receivingOperationsDirectory);
   need(value.sha256===original.sha256&&same(value.preview.document,document),
    'The independent original saved Installation edition differs.');
   for(const before of archiveSelection.sources){
    const after=full.sources.find(row=>row.id===before.id);
    need(after&&after.bytes===before.bytes&&after.sha256===before.sha256,'An original complete receiving source changed.');
   }
   return{caseId:imported.id,installationId:value.id,revision:value.revision,sha256:value.sha256,
    workshare:value.preview.document.workshare,sources:archiveSelection.sources};
  };
  const opened=await readRecipient('recipient'),cold=await readRecipient('cold-recipient');
  need(same(opened,cold),'The original Installation changed during independent cold reopen.');
  await phase('Installation_Cold_Reopen',async()=>cold);
  let browser=null;
  const verifyBrowserFiles=async value=>{
   for(const row of [...(value.downloads??[]),...(value.screenshots??[])]){
    need(typeof row.path==='string'&&isAbsolute(row.path)&&contains(join(out,'browser'),resolve(row.path))&&
     Number.isSafeInteger(row.bytes)&&row.bytes>=0&&HASH.test(row.sha256??''),
     'Retain complete browser file identities under the owned browser output.');
    let maximum=320*1024*1024;
    if(row.role==='original-source-member'){
     const member=source.manifest.files.find(file=>file.path===row.source?.path);
     need(member&&row.source.inspectionId===prepared.inspectionId&&member.bytes===row.bytes&&
      member.sha256===row.sha256&&member.bytes<=8*1024*1024*1024,
      'The larger browser member must bind its exact original archive descriptor.');
     maximum=member.bytes;
    }
    need(same(await originalIdentity(row.path,maximum),{bytes:row.bytes,sha256:row.sha256}),
     'A retained original browser attachment or image changed.');
   }
  };
  if(playwright){
   let priorBrowser;
   try{priorBrowser=await regular(join(out,'Browser_Receiving.json'),128*1024*1024);}
   catch(error){if(error.code!=='ENOENT')throw error;}
   if(priorBrowser){
    browser=parsed(priorBrowser);
    need(browser.complete===true&&browser.preparationRequestId===options.preparationRequestId,
     'The original completed browser phase has another preparation.');
    await verifyBrowserFiles(browser);
   }
  }
  if(playwright&&!browser){
   const {createDcatInstallationServer}=await import('./dcat-installation/server.mjs');
   const {runDcatInstallationBrowser}=await import('./dcat-installation-browser.mjs');
   server=await createDcatInstallationServer({directory:options.preparationDirectory,host:'127.0.0.1',port:0});
   browser=await runDcatInstallationBrowser({playwright,chromiumPath,browserContext,
    listener:{url:server.url,origin:server.origin},outputDirectory:join(out,'browser'),
    preparationRequestId:options.preparationRequestId,expectedPreparation:prepared,signal});
   need(browser?.preparationRequestId===options.preparationRequestId,
    'Retain the actual selected browser preparation request.');
   await verifyBrowserFiles(browser);
   if(browser.browserPreparation){
    const next=await server.service.get(browser.browserPreparation.requestId);
    need(next.status==='COMPLETE'&&next.type==='prepare'&&same(next.installation,prepared.installation)&&
     same(next.scope,prepared.scope)&&same(next.source,prepared.source),
     'The browser-produced original preparation differs from the selected complete Installation.');
    need(same(next,browser.browserPreparation),
     'The browser-produced preparation receipt differs from the actual service.');
   }
   await server.close();server=null;
   await saved(browser.complete?'Browser_Receiving.json':'Browser_Incomplete_'+randomUUID()+'.json',browser);
  }
  const result={schema:SCHEMA,state:browserRequested&&!browser?.complete?'BROWSER_INCOMPLETE':'COMPLETE',sourceReceivingComplete:true,
   browserRequested,
   original:{caseId:options.caseId,installationId:options.installationId,revision:options.installationRevision,
    sha256:original.sha256,preparationRequestId:options.preparationRequestId},
   received:{caseId:imported.id,operationsDirectory:options.receivingOperationsDirectory,
    catalogueDirectory:options.receivingCatalogDirectory,sourceSha256:source.sourceSha256,
    manifestSha256:source.manifestSha256},archive:exported,originalCatalogue:source.archive,
   requestId,files:descriptors,members,browser,
   renderedUse:{performed:Boolean(browser?.complete),viewedByOperator:false,
    requirement:'Open the actual outgoing applications and every attachment, use important controls at desktop/narrow widths, and inspect saved images. Native source receiving is complete; personal visual review is separate.'}};
  await saved(result.state==='COMPLETE'?'Dcat_Installation_Complete_Receiving.json':'Dcat_Installation_Incomplete_'+randomUUID()+'.json',result);return result;
 }catch(error){
  primaryError=error;
  await saved('receiving-error-'+randomUUID()+'.json',{schema:SCHEMA+'.error',
   code:error.code??'DCAT_INSTALLATION_RECEIVING',message:String(error.message),at:new Date().toISOString()});throw error;
 }finally{
  const closed=await Promise.allSettled([server?.close(),model?.close(),service?.close()]);
  const failures=closed.filter(value=>value.status==='rejected').map(value=>value.reason);
  try{await lease.close();}catch(error){failures.push(error);}
  if(failures.length){
   await saved('receiving-cleanup-'+randomUUID()+'.json',{schema:SCHEMA+'.cleanup',complete:false,
    errors:failures.map(error=>({code:error.code??'CLOSE_FAILED',message:String(error.message??error)}))});
   throw new AggregateError([...(primaryError?[primaryError]:[]),...failures],
    'The original receiving owner has not completed shutdown.');
  }
 }
}
export async function main(argv=process.argv.slice(2)){
 need(argv.length===2&&argv[0]==='--input','Use dcat-installation-receive --input /private/receiving.json');
 const options=parsed(await regular(resolve(argv[1]),8*1024*1024));
 const controller=new AbortController(),stop=()=>controller.abort(new Error('Original receiving cancelled.'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  let playwright,chromiumPath;
  if(options.playwrightModule){need(isAbsolute(options.playwrightModule),'Use the host’s original explicit Playwright module.');
   const loaded=await import(pathToFileURL(options.playwrightModule).href);playwright=loaded.default??loaded;
   chromiumPath=options.chromiumPath;need(typeof chromiumPath==='string'&&isAbsolute(chromiumPath),'Select the actual installed browser executable.');}
  const result=await runDcatInstallationReceiving(options,{signal:controller.signal,playwright,chromiumPath});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'DCAT_INSTALLATION_RECEIVING',
  message:String(error.message)})+'\n');process.exitCode=1;});
