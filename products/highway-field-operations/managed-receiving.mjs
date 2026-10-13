#!/usr/bin/env node
// MIT. Continue the original completed commissioning through actual Applications and agent APIs.
import {readFile,writeFile,open,mkdir,rename,stat,realpath} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {createHighwayFieldClient} from './client.mjs';
import {MerchantHighwayField,readHighwayFieldConfiguration} from './merchant.mjs';
import {inspectSource,readConnection} from './binding.mjs';
import {canonical,sha,need,absolute,UUID,SOURCE_SHA256,bytes,jsonFile} from './contract.mjs';
const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'../..');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const digest=v=>sha(canonical(v));
async function finishResources(primary,actions,message){
 const errors=primary?[primary]:[];
 for(const close of actions)try{await close();}catch(error){errors.push(error);}
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,message);
}
const uuid=(operation,label)=>{const h=createHash('sha256').update(operation+'\0'+label).digest('hex').slice(0,32).split('');h[12]='5';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const s=h.join('');return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');};
async function syncDir(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function privateDir(path){await mkdir(path,{recursive:true,mode:0o700});const s=await stat(path);need(s.isDirectory()&&(s.mode&0o077)===0&&await realpath(path)===path,'RECEIVING_DIRECTORY');}
async function retain(path,value){
 const raw=Buffer.from(canonical(value));await privateDir(dirname(path));
 try{const old=await bytes(path,32*1024*1024,{privateOnly:true});need(old.equals(raw),'RECEIVING_INPUT_CHANGED',path);return value;}catch(e){if(e.code!=='ENOENT')throw e;}
 const partial=path+'.partial',fd=await open(partial,'w',0o600);
 try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
 await rename(partial,path);await syncDir(dirname(path));return value;
}
async function optional(path){try{return await jsonFile(path,32*1024*1024,{privateOnly:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}}
class Course{
 constructor(directory,input){this.directory=directory;this.input=input;this.operation=input.operationId;}
 id(label){return uuid(this.operation,'managed/'+label);}
 async effect(label,make,run){
  need(/^[a-z0-9_-]+$/.test(label),'RECEIVING_LABEL');
  const path=join(this.directory,'control',label);await privateDir(path);
  const frozen=await optional(join(path,'input.json'))??await retain(join(path,'input.json'),await make());
  const result=await optional(join(path,'result.json'));if(result!==null)return result;
  const returned=await run(frozen);need(returned!==undefined,'RECEIVING_RESULT');
  return retain(join(path,'result.json'),returned);
 }
}
async function currentApplication(model,id){const value=await model.applicationsState({historyLimit:5});const row=value.applications.find(x=>x.id===id);need(row,'APPLICATION_MISSING');return row;}
async function poll(label,deadline,read,accept){
 let latest;while(Date.now()<deadline){latest=await read();if(accept(latest))return latest;await wait(750);}
 const error=new Error(label+' is still pending; resume this same operation.');error.code='PROPERTY_CONTINUITY_MANAGED_PENDING';error.observation=latest;throw error;
}
async function outputFile(path,producer,expected){
 await privateDir(dirname(path));try{const raw=await bytes(path,384*1024*1024,{privateOnly:true});if(expected)need(raw.length===expected.bytes&&sha(raw)===expected.sha256,'DELIVERY_CHANGED');return {path,bytes:raw.length,sha256:sha(raw)};}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=path+'.partial',fd=await open(temporary,'w',0o600);let n=0;
 let result;try{result=await producer(async b=>{let at=0;while(at<b.length){const r=await fd.write(b,at,b.length-at,n+at);need(r.bytesWritten>0,'FILE_WRITE');at+=r.bytesWritten;}n+=b.length;});await fd.sync();}finally{await fd.close();}
 const raw=await bytes(temporary,384*1024*1024,{privateOnly:true});need(result.bytes===n&&raw.length===n&&sha(raw)===result.sha256,'DELIVERY_CHANGED');if(expected)need(n===expected.bytes&&sha(raw)===expected.sha256,'DELIVERY_CHANGED');
 await rename(temporary,path);await syncDir(dirname(path));return {path,bytes:n,sha256:result.sha256};
}
async function start(model,course,applicationId,settings,label,timeout){
 const startId=course.id(label);
 const reviewed=await course.effect(label+'-review',()=>({applicationId}),x=>model.applicationsStartReview(x));
 await course.effect(label+'-dispatch',()=>({applicationId,reviewId:reviewed.id,requestId:startId}),x=>model.applicationsStart(x));
 const prior=await currentApplication(model,applicationId);
 if(prior.current?.id===startId&&prior.current.active===false&&['INTERRUPTED','FAILED'].includes(prior.current.phase)){
  await course.effect(label+'-recover',()=>({applicationId,operationId:startId}),x=>model.applicationsRecover(x));
 }
 const row=await poll('Original managed application '+startId,Date.now()+timeout,()=>currentApplication(model,applicationId),
  value=>value.current?.id===startId&&value.phase==='RUNNING'&&value.current.active===true);
 const connection=await readConnection(settings.connectionFile,{workspaceId:course.input.workspaceId,workspaceDirectory:settings.workspaceDirectory,applicationRequestId:startId});
 need(connection.applicationRequestId===startId,'APPLICATION_RUN_CHANGED');
 return {applicationId,operationId:startId,phase:row.phase,instanceId:connection.instanceId,process:connection.process};
}
async function stop(model,course,applicationId,label,timeout){
 const operationId=course.id(label);
 await course.effect(label+'-stop-request',()=>({applicationId,operationId}),x=>model.applicationsStop(x));
 const row=await poll('Original managed stop '+operationId,Date.now()+timeout,()=>currentApplication(model,applicationId),
  value=>value.current?.id===operationId&&value.current.active===false&&['STOPPED','FAILED','CANCELLED','SUCCEEDED'].includes(value.phase));
 need(row.phase==='STOPPED','MANAGED_CLOSE_FAILED','Inspect the retained original command result.');
 return course.effect(label+'-closed',()=>({applicationId,operationId}),async()=>({applicationId,operationId,phase:row.phase,closed:true}));
}
async function merchantArchive(owner,scope,selection,path){
 const fd=await open(path+'.partial','w',0o600);let offset=0,readId=null,identity=null,archiveFailure=null;
 try{
  do{
   const page=await owner.call('merchant_highway_file_read',{...scope,selection,offset,limit:196608,...(readId?{readId}:{}),expectedSha256:selection.expectedSha256});
   need(page.offset===offset,'FILE_PAGE');readId=page.readId;identity??=page.file;
   need(canonical(page.file)===canonical(identity),'FILE_PAGE');
   const chunk=Buffer.from(page.data,'base64');need(chunk.length===page.bytesRead,'FILE_PAGE');
   let at=0;while(at<chunk.length){const result=await fd.write(chunk,at,chunk.length-at,offset+at);need(result.bytesWritten>0,'FILE_WRITE');at+=result.bytesWritten;}
   offset=page.nextOffset;
  }while(offset!==null);
  await fd.sync();
 }catch(error){archiveFailure=error;throw error;}
 finally{await finishResources(archiveFailure,[()=>fd.close(),()=>readId?owner.call('merchant_highway_file_release',{...scope,readId}):undefined],'Original archive read and resource release failed.');}
 const raw=await bytes(path+'.partial',384*1024*1024,{privateOnly:true});
 need(raw.length===selection.expectedBytes&&sha(raw)===selection.expectedSha256,'MERCHANT_FILE_CHANGED');
 await rename(path+'.partial',path);await syncDir(dirname(path));return {path,bytes:raw.length,sha256:sha(raw)};
}

const ORIGINAL_SOURCE='16b651c694f00b28a1c18d27b88b196a02d6f5e1c5933a94085ead4ecf1cca6a';
async function reportFile(course,label,value){
 const result=await course.effect(label,()=>({schema:'geocove.managed-report-input.v1',label}),value);
 const sourcePath=join(course.directory,'control',label,'result.json'),raw=await bytes(sourcePath,64*1024*1024,{privateOnly:true});
 const path=join(course.directory,'reports',label+'.json');await restoreFile({path,sourcePath,bytes:raw.length,sha256:sha(raw)});
 return {path,sourcePath,bytes:raw.length,sha256:sha(raw),result};
}
async function restoreFile(item){
 let raw;try{raw=await bytes(item.path,384*1024*1024,{privateOnly:true});}
 catch(e){if(e.code!=='ENOENT')throw e;raw=await bytes(item.sourcePath,384*1024*1024,{privateOnly:true});
  need(raw.length===item.bytes&&sha(raw)===item.sha256,'DELIVERY_CHANGED');await privateDir(dirname(item.path));
  const temp=item.path+'.partial',fd=await open(temp,'w',0o600);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
  await rename(temp,item.path);await syncDir(dirname(item.path));
 }
 need(raw.length===item.bytes&&sha(raw)===item.sha256,'DELIVERY_CHANGED');return item;
}
async function snapshot(client,plan,expected=null){
 const current=await client.state();if(expected)need(current.revision===expected.revision&&current.sha256===expected.sha256,'STAFF_REVISION_CHANGED');
 const history=[];for await(const page of client.pages('history',{}, {limit:100}))history.push(...page.items);
 need(history.length===current.revision,'HISTORY_COVERAGE');
 const captures=[];
 for(const captureId of plan.captureIds)for(const layerId of plan.datasetIds){
  const pages=[];for await(const page of client.pages('records',{captureId,layerId},{limit:100}))pages.push(page);
  need(pages.length&&pages.reduce((n,p)=>n+p.records.length,0)===pages[0].total,'SOURCE_COVERAGE');
  captures.push({captureId,layerId,pages});
 }
 const after=await client.state();need(after.revision===current.revision&&after.sha256===current.sha256,'STAFF_REVISION_CHANGED');
 return {schema:'geocove.managed-staff-report.v1',current,history,captures};
}
async function nativeReports(client,course,label,native){
 const report=await course.effect(label+'-report',()=>({operationId:course.id(label+'-report'),operation:'read',body:{kind:'report',id:native.reportId}}),
  x=>client.native(x.operationId,x.operation,x.body));
 const pages={};for(const kind of ['rows','groups','decisions']){
  let offset=0;pages[kind]=[];
  do{
   const row=await course.effect(label+'-'+kind+'-'+offset,()=>({operationId:course.id(label+'-'+kind+'-'+offset),operation:'page',body:{kind,id:native.runId,offset,limit:100}}),x=>client.native(x.operationId,x.operation,x.body));
   const page=row.result.result;need(page&&page.offset===offset,'NATIVE_PAGE');pages[kind].push(row);
   const next=page.next_offset;need(next===null||Number.isSafeInteger(next)&&next>offset,'NATIVE_PAGE');offset=next;
  }while(offset!==null);
 }
 return {schema:'geocove.managed-native-report.v1',nativeWorkspaceId:report.result.nativeWorkspaceId,report,pages};
}
async function saveApplication(model,course,label,settings){
 const reviewed=await course.effect(label+'-application-review',()=>({runtimeId:course.input.runtimeId,kind:'highway-field-operations',label:course.input.label+' — '+label,settings}),x=>model.applicationsReview(x));
 const saved=await course.effect(label+'-application-save',()=>({requestId:course.id(label+'-application-save'),reviewId:reviewed.id}),x=>model.applicationsSave(x));
 need(!saved.superseded,'APPLICATION_SUPERSEDED');
 await course.effect(label+'-application-connect',()=>({applicationId:saved.applicationId}),x=>model.applicationsConnect(x));
 await poll('Original application connection',Date.now()+course.input.timeoutMs,()=>currentApplication(model,saved.applicationId),x=>Boolean(x.release)&&x.connectionReady===true);
 return saved.applicationId;
}
async function withRun(model,course,applicationId,settings,label,job){
 // Each definitively closed interrupted start is retained. Business phase IDs remain unchanged.
 const completedPath=join(course.directory,'control',label+'-job-complete','result.json');
 const attempts=join(course.directory,'control',label+'-runs');await privateDir(attempts);
 let index=0,attempt,runLabel,done;
 for(;;index++){
  attempt=join(attempts,String(index).padStart(5,'0'));await privateDir(attempt);
  runLabel=label+'-attempt-'+String(index).padStart(5,'0');
  done=await optional(completedPath);
  const closed=await optional(join(attempt,'outcome.json'));
  if(closed){
   need(closed.closed===true&&closed.applicationId===applicationId&&closed.runLabel===runLabel,'MANAGED_RUN_CHANGED');
   if(done&&done.runLabel===runLabel)return;continue;
  }
  await retain(join(attempt,'input.json'),{applicationId,runLabel,settingsSha256:digest(settings)});
  break;
 }
 let client=null,failure=null;
 const errors=[];
 try{
  if(!done){
   await start(model,course,applicationId,settings,runLabel,course.input.timeoutMs);
   client=createHighwayFieldClient({connectionFile:settings.connectionFile,workspaceId:course.input.workspaceId,workspaceDirectory:settings.workspaceDirectory});
   await job(client);
   await retain(completedPath,{applicationId,runLabel,completed:true});
  }
 }catch(error){failure=error;}
 finally{
  try{await client?.close();}catch(error){errors.push(error);}
  let dispatched=null,dispatchKnown=false,closed=false;
  try{
   dispatched=await optional(join(course.directory,'control',runLabel+'-dispatch','input.json'));
   dispatchKnown=true;
  }catch(error){errors.push(error);}
  try{
   if(dispatched)await stop(model,course,applicationId,runLabel,course.input.timeoutMs);
   else if(!dispatchKnown){
    // A broken local request file must not bypass cleanup of this exact managed run.
    const current=await currentApplication(model,applicationId);
    need(current.current?.id===course.id(runLabel),'MANAGED_RUN_CHANGED');
    await stop(model,course,applicationId,runLabel,course.input.timeoutMs);
   }
   closed=true;
  }catch(error){errors.push(error);}
  if(closed)try{
   await retain(join(attempt,'outcome.json'),{applicationId,runLabel,closed:true,
    dispatched:dispatchKnown?Boolean(dispatched):true,
    workCompleted:Boolean(await optional(completedPath)),state:failure||errors.length?'INTERRUPTED':'CLOSED'});
  }catch(error){errors.push(error);}
 }
 if(failure||errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],
  'Original managed stage interrupted; retain this run outcome and every business request before resuming.');
}
async function browserProgramme(course,settings,basis,guard){
 const directory=join(course.directory,'browser');await privateDir(directory);
 const connection=await readConnection(settings.connectionFile,{workspaceId:course.input.workspaceId,workspaceDirectory:settings.workspaceDirectory});
 const url=new URL(connection.url),native=basis.native;
 const input={schema:'geocove.browser-programme.v1',operationId:course.id('managed-browser'),url:connection.url,origin:url.origin,directory,
  executablePath:basis.plan.browserExecutable,workspaceId:course.input.workspaceId,sourceSha256:SOURCE_SHA256,actor:basis.plan.actor,
  inspectionId:native.inspectionId,assignmentId:native.assignmentId,reportRecordId:native.nativeExportRecordId,runId:native.runId,reportId:native.reportId};
 // Only the private live connection may change. The maintained browser freezes every identity and original UI request.
 const file=join(directory,'connection.json'),temp=file+'.partial',fd=await open(temp,'w',0o600);
 try{await fd.writeFile(canonical(input));await fd.sync();}finally{await fd.close();}await rename(temp,file);await syncDir(directory);
 let complete=await optional(join(directory,'result.json'));
 if(!complete){
  let stdout=null,stderr=null,browserFailure=null;
  try{
   stdout=await open(join(directory,'stdout.log'),'a',0o600);
   stderr=await open(join(directory,'stderr.log'),'a',0o600);
   const code=await new Promise((done,reject)=>{
    const child=spawn(course.input.settings.nodeExecutable,[join(HERE,'app','tools','browser_program.cjs'),file],{
     cwd:HERE,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=192'},stdio:['ignore',stdout.fd,stderr.fd,guard]});
    child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(new Error('Original browser child ended by '+signal)):done(code));
   });need(code===0,'BROWSER_INTERRUPTED','Retain the original browser intent, profile ownership and logs.');
  }catch(error){browserFailure=error;throw error;}
  finally{await finishResources(browserFailure,[()=>stdout?.close(),()=>stderr?.close()],'Original browser and log cleanup failed.');}
  complete=await optional(join(directory,'result.json'));
 }
 need(complete?.state==='COMPLETE'&&complete.allOwnedResourcesClosed===true&&complete.operationId===input.operationId,'BROWSER_INCOMPLETE');
 for(const item of complete.screenshots){const raw=await bytes(item.path,64*1024*1024);need(raw.length===item.bytes&&sha(raw)===item.sha256,'SCREENSHOT_CHANGED');}
 return complete;
}
export async function runManagedReceiving(input){
 need(input.schema==='stellar-forge.highway-field-operations-managed-receiving.v1'&&UUID.test(input.operationId),'MANAGED_INPUT');
 need(input.sourceSha256===SOURCE_SHA256&&input.originalSourceSha256===ORIGINAL_SOURCE,'SOURCE_CHANGED');
 const operation=absolute(input.operationDirectory),directory=join(operation,'managed-highway-integration');
 await privateDir(directory);
 const guard=Number(process.env.HIGHWAY_FIELD_RECEIVING_GUARD_FD);need(Number.isSafeInteger(guard)&&guard>=3,'ORIGINAL_GUARD');
 const actual=await stat('/proc/self/fd/'+guard),selected=await stat(join(operation,'programme.lock'));
 need(actual.dev===selected.dev&&actual.ino===selected.ino,'ORIGINAL_GUARD');
 const basisPath=join(directory,'original-basis.json'),basis=await jsonFile(basisPath,64*1024*1024,{privateOnly:true});
 need(sha(await bytes(basisPath,64*1024*1024,{privateOnly:true}))===input.basisSha256&&basis.plan.operationId===input.operationId&&basis.native.state==='COMPLETE','ORIGINAL_BASIS');
 need(basis.native.inputSha256===digest(basis.plan)&&basis.native.sourceSha256===ORIGINAL_SOURCE&&basis.native.allOwnedResourcesClosed===true,'ORIGINAL_PROGRAMME_INCOMPLETE');
 need(basis.native.workspaceId===input.workspaceId&&input.settings.workspaceDirectory===join(operation,'workspace'),'ORIGINAL_BRANCH');
 await retain(join(directory,'input.json'),input);
 const completed=await optional(join(directory,'result.json'));
 if(completed){
  need(completed.state==='COMPLETE'&&completed.inputSha256===digest(input)&&completed.allOwnedResourcesClosed===true,'RESULT_CHANGED');
  for(const item of [...completed.artifacts,...completed.reportFiles])await restoreFile(item);
  for(const item of completed.browser.screenshots){const raw=await bytes(item.path,64*1024*1024);need(raw.length===item.bytes&&sha(raw)===item.sha256,'SCREENSHOT_CHANGED');}
  return completed;
 }
 await inspectSource(join(HERE,'app'));
 const model=await openRuntimeWorkspace({directory:absolute(input.runtimeWorkspace)}),course=new Course(directory,input);
 let modelCloseAttempted=false,modelFailure=null;
 try{
  const modelState=await model.state({runtimeId:input.runtimeId}),runtime=modelState.runtimes.find(x=>x.id===input.runtimeId);
  need(runtime?.phase==='READY','RUNTIME_NOT_READY');
  const installed=await inspectMerchantRuntime(runtime.directory,{load:false,source:false});
  need(await realpath(installed.sourceRoot)===await realpath(ROOT),'INSTALLED_SOURCE_CHANGED');
  const originalId=await saveApplication(model,course,'original',input.settings),reports=[],artifacts=[];
  const capturePlan={captureIds:basis.native.captureIds,datasetIds:[...basis.plan.layerIds,...(basis.plan.tableIds??[])]};
  const firstExportPath=join(directory,'artifacts','Original_Workspace.zip');
  await withRun(model,course,originalId,input.settings,'original-run',async client=>{
   await reportFile(course,'original-staff',()=>snapshot(client,capturePlan,basis.originalCurrent));
   await reportFile(course,'original-native',()=>nativeReports(client,course,'original-native-records',basis.native));
   await course.effect('original-request-replay',()=>basis.firstCommand,async x=>{const returned=await client.command(x.command,x.expectedRevision);need(returned.reused===true,'ORIGINAL_REQUEST_REPLAY');return returned;});
   const first=await course.effect('first-export',async()=>({publicationId:course.id('first-export'),revision:(await client.state()).revision}),x=>client.exportWorkspace(x.publicationId,x.revision));
   await outputFile(firstExportPath,consume=>client.download({kind:'archive',id:course.id('first-export'),expectedSha256:first.sha256,expectedBytes:first.bytes},consume),first);
   await client.uploadFile('archive',firstExportPath,first);
   await course.effect('first-receive',()=>({operationId:course.id('first-receive'),sha256:first.sha256,bytes:first.bytes}),x=>client.receive(x));
   const configPath=join(directory,'control','agent.json'),storage=join(directory,'control','file-reads');await privateDir(storage);
   await retain(configPath,{schema:'stellar-forge.highway-field-operations-workspaces.v1',storageDirectory:storage,
    workspaces:{original:{connectionFile:input.settings.connectionFile,workspaceId:input.workspaceId,workspaceDirectory:input.settings.workspaceDirectory}},
    files:{attachment:{path:basis.attachment.path,bytes:basis.attachment.bytes,sha256:basis.attachment.sha256}}});
   const owner=new MerchantHighwayField({highwayField:await readHighwayFieldConfiguration(configPath)});
   const scope={workspace:'original',workspaceId:input.workspaceId,workspaceDirectory:input.settings.workspaceDirectory};
   let ownerFailure=null;
   try{
    await course.effect('agent-state',()=>scope,x=>owner.call('merchant_highway_state',x));
    await course.effect('agent-attachment',()=>({...scope,kind:'blob',fileAlias:'attachment',bytes:basis.attachment.bytes,sha256:basis.attachment.sha256}),x=>owner.call('merchant_highway_upload',x));
    await course.effect('agent-request-replay',()=>({...scope,...basis.firstCommand}),async x=>{const returned=await owner.call('merchant_highway_command',x);need(returned.reused===true,'AGENT_REPLAY');return returned;});
    await merchantArchive(owner,scope,{kind:'archive',id:course.id('first-export'),expectedSha256:first.sha256,expectedBytes:first.bytes},join(directory,'artifacts','Agent_Original_Workspace.zip'));
   }catch(error){ownerFailure=error;throw error;}
   finally{await finishResources(ownerFailure,[()=>owner.close()],'Original agent work and client cleanup failed.');}
  });
  const received=await optional(join(directory,'control','first-receive','result.json'));
  need(received?.directory===join(input.settings.receivingDirectory,course.id('first-receive'))&&received.current.state.id===input.workspaceId,'RECEIVED_BRANCH');
  const receivingSettings={...input.settings,workspaceDirectory:received.directory,connectionFile:join(received.directory,'highway-field-connection.json'),receivingDirectory:join(directory,'following-workspaces')};
  delete receivingSettings.pairedWorkspaceDirectory;delete receivingSettings.pairedWorkspaceId;
  const receiverId=await saveApplication(model,course,'received-staff',receivingSettings);
  await withRun(model,course,receiverId,receivingSettings,'received-staff-run',async client=>{
   const restoration=await course.effect('restore-native',()=>({recordId:basis.native.nativeExportRecordId,operationId:course.id('restore-native')}),x=>client.restoreNative(x.recordId,x.operationId));
   await course.effect('restore-association',async()=>({command:{requestId:restoration.recordRequestId,kind:'reconciliation.record',actor:basis.plan.actor,at:new Date().toISOString(),body:restoration.recordBody},expectedRevision:(await client.state()).revision}),x=>client.command(x.command,x.expectedRevision));
   // Reuse the original explicitly local receiving follow-up body and operator. No new field observation is invented.
   await course.effect('received-followup',async()=>({command:basis.receivedFollowup.command,expectedRevision:(await client.state()).revision}),x=>client.command(x.command,x.expectedRevision));
   const attachment=await outputFile(join(directory,'reports','Received_Source_Attachment.bin'),consume=>client.download({kind:'blob',id:basis.attachment.sha256,expectedBytes:basis.attachment.bytes},consume),basis.attachment);
   await course.effect('received-attachment',()=>attachment,async x=>x);
  });
  const pairedSettings={...receivingSettings,pairedWorkspaceDirectory:join(received.directory,'native-receiving',course.id('restore-native'),'workspace'),pairedWorkspaceId:basis.native.nativeWorkspaceId};
  const pairedId=await saveApplication(model,course,'received-paired',pairedSettings);
  await withRun(model,course,pairedId,pairedSettings,'received-paired-run',async client=>{
   await reportFile(course,'received-native',()=>nativeReports(client,course,'received-native-records',basis.native));
   const browser=await browserProgramme(course,pairedSettings,basis,guard);
   await course.effect('browser-complete',()=>({operationId:browser.operationId}),async()=>browser);
   await reportFile(course,'received-staff',()=>snapshot(client,capturePlan));
   const following=await course.effect('following-export',async()=>({publicationId:course.id('following-export'),revision:(await client.state()).revision}),x=>client.exportWorkspace(x.publicationId,x.revision));
   const path=join(directory,'artifacts','Received_Workspace.zip');
   await outputFile(path,consume=>client.download({kind:'archive',id:course.id('following-export'),expectedSha256:following.sha256,expectedBytes:following.bytes},consume),following);
   await client.uploadFile('archive',path,following);
   await course.effect('following-receive',()=>({operationId:course.id('following-receive'),sha256:following.sha256,bytes:following.bytes}),x=>client.receive(x));
  });
  // Reopen the same original Application and repeat its original receiving request: later receiver edits must survive.
  await withRun(model,course,originalId,input.settings,'original-reopen',async client=>{
   const initial=await optional(join(directory,'control','first-receive','input.json'));
   const repeated=await course.effect('repeat-receive',()=>initial,x=>client.receive(x));
   const saved=await optional(join(directory,'control','received-staff','result.json'));
   need(repeated.reused===true&&repeated.current.sha256===saved.current.sha256&&repeated.current.revision===saved.current.revision,'LATER_EDITS_CHANGED');
   await course.effect('original-reopened',async()=>({revision:(await client.state()).revision}),async x=>x);
  });
  const cold=await optional(join(directory,'control','following-receive','result.json'));
  const coldSettings={...receivingSettings,workspaceDirectory:cold.directory,connectionFile:join(cold.directory,'highway-field-connection.json'),receivingDirectory:join(directory,'final-workspaces')};
  const coldId=await saveApplication(model,course,'cold-received',coldSettings);
  await withRun(model,course,coldId,coldSettings,'cold-received-run',async client=>{
   const saved=await optional(join(directory,'control','received-staff','result.json'));
   await reportFile(course,'cold-staff',()=>snapshot(client,capturePlan,{revision:saved.current.revision,sha256:saved.current.sha256}));
  });
  for(const label of ['original-staff','original-native','received-staff','received-native','cold-staff']){
   const sourcePath=join(directory,'control',label,'result.json'),raw=await bytes(sourcePath,64*1024*1024,{privateOnly:true});
   const item={path:join(directory,'reports',label+'.json'),sourcePath,bytes:raw.length,sha256:sha(raw)};await restoreFile(item);reports.push(item);
  }
  reports.push({path:join(directory,'reports','Received_Source_Attachment.bin'),sourcePath:basis.attachment.path,bytes:basis.attachment.bytes,sha256:basis.attachment.sha256});
  for(const [name,label,workspace] of [['Original_Workspace.zip','first-export',input.settings.workspaceDirectory],['Agent_Original_Workspace.zip','first-export',input.settings.workspaceDirectory],['Received_Workspace.zip','following-export',received.directory]]){
   const original=await optional(join(directory,'control',label,'result.json')),intent=await optional(join(directory,'control',label,'input.json'));
   const item={path:join(directory,'artifacts',name),sourcePath:join(workspace,'exports',intent.publicationId,'Highway_Field_Workspace.zip'),bytes:original.bytes,sha256:original.sha256};
   await restoreFile(item);artifacts.push(item);
  }
  const browser=await optional(join(directory,'control','browser-complete','result.json'));
  const result={schema:'stellar-forge.highway-field-operations-managed-result.v1',state:'COMPLETE',operationId:input.operationId,inputSha256:digest(input),
   sourceSha256:SOURCE_SHA256,originalSourceSha256:ORIGINAL_SOURCE,basisSha256:input.basisSha256,runtimeId:input.runtimeId,runtimeDirectory:runtime.directory,
   applications:{original:originalId,receivedStaff:receiverId,receivedPaired:pairedId,cold:coldId},originalWorkspaceDirectory:input.settings.workspaceDirectory,
   receivedDirectory:received.directory,coldDirectory:cold.directory,nativeWorkspaceId:basis.native.nativeWorkspaceId,artifacts,reportFiles:reports,browser,allOwnedResourcesClosed:true};
  for(const item of reports)await restoreFile(item);
  modelCloseAttempted=true;await model.close();await retain(join(directory,'result.json'),result);return result;
 }catch(error){modelFailure=error;throw error;}
 finally{if(!modelCloseAttempted)await finishResources(modelFailure,[()=>model.close()],'Original managed receiving and model cleanup failed.');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const input=await jsonFile(absolute(process.argv[2]),32*1024*1024,{privateOnly:true});
 console.log(JSON.stringify(await runManagedReceiving(input)));
}
