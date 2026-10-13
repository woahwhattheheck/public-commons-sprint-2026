#!/usr/bin/env node
// MIT. Full original Curriculum receiving through the maintained Runtime, SDK, agent and browser.
import {readFile,writeFile,open,mkdir,rename,stat,realpath} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openRuntimeWorkspace} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {createCurriculumMigrationClient} from '../../products/curriculum-migration-workbench/client.mjs';
import {MerchantCurriculumMigration,readCurriculumMigrationConfiguration} from '../../products/curriculum-migration-workbench/merchant.mjs';
import {createStore} from '../../products/curriculum-migration-workbench/store.mjs';
import * as Model from '../../products/curriculum-migration-workbench/app/model.mjs';
import * as Curriculum from '../../products/curriculum-migration-workbench/app/curriculum-migration.mjs';
import {inspectSource,readConnection} from '../../products/curriculum-migration-workbench/binding.mjs';
import {canonical,sha,need,absolute,UUID,SOURCE_SHA256,bytes,jsonFile} from '../../products/curriculum-migration-workbench/contract.mjs';
let interruption=null,cleanupDepth=0;const children=new Set();
const interrupted=signal=>{interruption??=new Error('Managed Curriculum receiving interrupted by '+signal);for(const child of children)try{child.kill(signal);}catch{}};
const onTerm=()=>interrupted('SIGTERM'),onInt=()=>interrupted('SIGINT');
process.on('SIGTERM',onTerm);process.on('SIGINT',onInt);
const HERE=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(HERE,'../..'),PRODUCT=join(ROOT,'products','curriculum-migration-workbench');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const digest=v=>sha(canonical(v));
const uuid=(operation,label)=>{const h=createHash('sha256').update(operation+'\0'+label).digest('hex').slice(0,32).split('');h[12]='5';h[16]=((parseInt(h[16],16)&3)|8).toString(16);const s=h.join('');return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');};
async function syncDir(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function privateDir(path){await mkdir(path,{recursive:true,mode:0o700});const s=await stat(path);need(s.isDirectory()&&(s.mode&0o077)===0&&await realpath(path)===path,'RECEIVING_DIRECTORY');}
async function retain(path,value){
 const raw=Buffer.from(canonical(value));await privateDir(dirname(path));
 try{const old=await bytes(path,512*1024*1024,{privateOnly:true});need(old.equals(raw),'RECEIVING_INPUT_CHANGED',path);return value;}catch(e){if(e.code!=='ENOENT')throw e;}
 const partial=path+'.partial',fd=await open(partial,'w',0o600);
 try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
 await rename(partial,path);await syncDir(dirname(path));return value;
}
async function optional(path){try{return await jsonFile(path,512*1024*1024,{privateOnly:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}}
class Course{
 constructor(directory,input){this.directory=directory;this.input=input;this.operation=input.operationId;}
 id(label){return uuid(this.operation,'managed/'+label);}
 async effect(label,make,run){
  if(interruption&&!cleanupDepth)throw interruption;
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
 let latest;while(Date.now()<deadline){if(interruption&&!cleanupDepth)throw interruption;latest=await read();if(accept(latest))return latest;await wait(750);}
 const error=new Error(label+' is still pending; resume this same operation.');error.code='CURRICULUM_MIGRATION_MANAGED_PENDING';error.observation=latest;throw error;
}
async function outputFile(path,producer,expected){
 await privateDir(dirname(path));try{const raw=await bytes(path,512*1024*1024,{privateOnly:true});if(expected)need(raw.length===expected.bytes&&sha(raw)===expected.sha256,'DELIVERY_CHANGED');return {path,bytes:raw.length,sha256:sha(raw)};}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=path+'.partial',fd=await open(temporary,'w',0o600);let n=0;
 let result;try{result=await producer(async b=>{let at=0;while(at<b.length){const r=await fd.write(b,at,b.length-at,n+at);need(r.bytesWritten>0,'FILE_WRITE');at+=r.bytesWritten;}n+=b.length;});await fd.sync();}finally{await fd.close();}
 const raw=await bytes(temporary,512*1024*1024,{privateOnly:true});need(result.bytes===n&&raw.length===n&&sha(raw)===result.sha256,'DELIVERY_CHANGED');if(expected)need(n===expected.bytes&&sha(raw)===expected.sha256,'DELIVERY_CHANGED');
 await rename(temporary,path);await syncDir(dirname(path));return {path,bytes:n,sha256:result.sha256};
}
async function start(model,course,applicationId,settings,label,timeout,onDispatch=()=>{}){
 const startId=course.id(label);
 const reviewed=await course.effect(label+'-review',()=>({applicationId}),x=>model.applicationsStartReview(x));
 await course.effect(label+'-dispatch',()=>({applicationId,reviewId:reviewed.id,requestId:startId}),x=>{onDispatch();return model.applicationsStart(x);});
 const prior=await currentApplication(model,applicationId);
 if(prior.current?.id===startId&&prior.current.active===false&&['INTERRUPTED','FAILED'].includes(prior.current.phase)){
  await course.effect(label+'-recover',()=>({applicationId,operationId:startId}),x=>model.applicationsRecover(x));
 }
 const row=await poll('Original managed application '+startId,Date.now()+timeout,()=>currentApplication(model,applicationId),
  value=>value.current?.id===startId&&value.phase==='RUNNING'&&value.current.active===true);
 const selectedStore=await jsonFile(join(settings.workspaceDirectory,'creation.json'));
 const connection=await readConnection(settings.connectionFile,{storeId:selectedStore.id,workspaceDirectory:settings.workspaceDirectory,applicationRequestId:startId});
 need(connection.applicationRequestId===startId,'APPLICATION_RUN_CHANGED');
 return {applicationId,operationId:startId,phase:row.phase,instanceId:connection.instanceId,process:connection.process};
}
async function stop(model,course,applicationId,label,timeout){
 const operationId=course.id(label),input={applicationId,operationId},errors=[];
 let attempted=false,row=null;
 try{
  await course.effect(label+'-stop-request',()=>input,async selected=>{
   need(selected.applicationId===applicationId&&selected.operationId===operationId,'MANAGED_STOP_CHANGED');
   attempted=true;return model.applicationsStop(input);
  });
 }catch(error){errors.push(error);}
 // The original native operation owns its stop request. Failure to read or
 // persist the course journal must not prevent this exact owned shutdown.
 if(!attempted)try{await model.applicationsStop(input);}catch(error){errors.push(error);}
 try{
  row=await poll('Original managed stop '+operationId,Date.now()+timeout,()=>currentApplication(model,applicationId),
   value=>value.current?.id===operationId&&value.current.active===false&&['STOPPED','FAILED','CANCELLED','SUCCEEDED'].includes(value.phase));
  need(row.phase==='STOPPED','MANAGED_CLOSE_FAILED','Inspect the retained original command result.');
 }catch(error){errors.push(error);}
 let result=null;
 if(row?.phase==='STOPPED')try{
  result=await course.effect(label+'-closed',()=>input,async()=>({applicationId,operationId,phase:row.phase,closed:true}));
 }catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'The original managed stop or its retained course result requires recovery.');
 return result;
}
async function saveApplication(model,course,label,settings){
 const reviewed=await course.effect(label+'-application-review',()=>({runtimeId:course.input.runtimeId,kind:'curriculum-migration-workbench',label:course.input.label+' — '+label,settings}),x=>model.applicationsReview(x));
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
  // A previous finally may have dispatched stop before its closure receipt was saved.
  // Complete that original stop before considering a fresh application start.
  const pendingStop=await optional(join(course.directory,'control',runLabel+'-stop-request','input.json'));
  if(pendingStop){
   cleanupDepth++;
   try{
    await stop(model,course,applicationId,runLabel,course.input.timeoutMs);
    await retain(join(attempt,'outcome.json'),{applicationId,runLabel,closed:true,dispatched:true,
     workCompleted:Boolean(done),state:done?'CLOSED':'INTERRUPTED'});
   }finally{cleanupDepth--;}
   if(done&&done.runLabel===runLabel)return;continue;
  }
  await retain(join(attempt,'input.json'),{applicationId,runLabel,settingsSha256:digest(settings)});
  break;
 }
 let client=null,failure=null,startRequested=false,workCompleted=Boolean(done);
 const errors=[];
 try{
  if(!done){
   await start(model,course,applicationId,settings,runLabel,course.input.timeoutMs,()=>{startRequested=true;});
   const selectedStore=await jsonFile(join(settings.workspaceDirectory,'creation.json'));
   client=createCurriculumMigrationClient({connectionFile:settings.connectionFile,storeId:selectedStore.id,storeDirectory:settings.workspaceDirectory});
   await job(client);
   await retain(completedPath,{applicationId,runLabel,completed:true});workCompleted=true;
  }
 }catch(error){failure=error;}
 finally{
  cleanupDepth++;
  try{
   try{await client?.close();}catch(error){errors.push(error);}
   let dispatched=null,dispatchRead=false,closed=false;
   try{dispatched=await optional(join(course.directory,'control',runLabel+'-dispatch','input.json'));dispatchRead=true;}
   catch(error){errors.push(error);}
   // This exact start operation remains the shutdown target even when reading
   // its retained dispatch metadata fails after native dispatch.
   try{
    if(startRequested||dispatched)await stop(model,course,applicationId,runLabel,course.input.timeoutMs);
    closed=dispatchRead||startRequested;
   }catch(error){errors.push(error);}
   if(closed)try{
    const completed=await optional(completedPath);workCompleted=Boolean(completed)||workCompleted;
    await retain(join(attempt,'outcome.json'),{applicationId,runLabel,closed:true,
     dispatched:dispatchRead?Boolean(dispatched):null,startAttempted:startRequested,workCompleted,state:failure||errors.length?'INTERRUPTED':'CLOSED'});
   }catch(error){errors.push(error);}
  }finally{cleanupDepth--;}
 }
 if(failure||errors.length)throw new AggregateError([...(failure?[failure]:[]),...errors],
  'Original managed stage interrupted; retain this run outcome and every business request before resuming.');
}


const ORIGINAL_OPERATION='curriculum-migration-complete-receiving-20261013';
const expected=row=>({workspaceId:row.workspaceId,revision:row.revision,snapshotSha256:row.snapshotSha256});
function portable(value){
 const w=value?.format==='curriculum-workspace-export.v1'?(need(value.sha256===sha(canonical(value.workspace)),'PORTABLE'),value.workspace):value;
 const workspace=Curriculum.receiveCurriculumWorkspace(w);return {format:'curriculum-workspace-export.v1',sha256:sha(canonical(workspace)),workspace};
}
function originalBasis(initial,value,bulk){
 const source=portable(value).workspace;
 need(initial.cases.length===25&&initial.history.length===51,'ORIGINAL_PUBLISHED_BASELINE');
 need(source.id===initial.id&&canonical(source.history.slice(0,initial.history.length))===canonical(initial.history),'ORIGINAL_HISTORY_CHANGED');
 for(const e of initial.editions)need(canonical(source.editions.find(x=>x.id===e.id))===canonical(e),'ORIGINAL_EDITION_CHANGED');
 for(const c of initial.cases){const present=source.cases.find(x=>x.id===c.id);
  need(present&&present.operationKey===c.operationKey&&present.sourceEditionId===c.sourceEditionId&&canonical(present.responses.original)===canonical(c.responses.original),'ORIGINAL_CASE_CHANGED',c.id);
 }
 if(bulk){
  const c=source.cases.find(x=>x.id===bulk.caseId);
  need(c?.operationKey==='BULK'&&bulk.namespaces&&Array.isArray(bulk.mappings)&&['accepted','changes-required'].includes(bulk.decision?.outcome)&&typeof bulk.decision.note==='string'&&bulk.decision.note.trim(),'ACTUAL_BULK_SELECTION');
  for(const lane of ['original','candidate'])need(['captured-http','operator-file'].includes(c.responses[lane]?.provenance?.kind),'ACTUAL_BULK_SOURCE');
  need(typeof bulk.namespaces.original==='string'&&bulk.namespaces.original.trim()&&typeof bulk.namespaces.candidate==='string'&&bulk.namespaces.candidate.trim(),'BULK_NAMESPACES');
 }
 return portable(source);
}
async function artifact(course,name,value){
 const path=join(course.directory,'artifacts',name);await retain(path,value);const raw=await bytes(path,512*1024*1024,{privateOnly:true});
 return {path,bytes:raw.length,sha256:sha(raw)};
}
async function originalReports(client,course,label,id,want=null){
 const observation=await course.effect(label,()=>({id,want}),async input=>{
  const row=await client.branch(input.id);if(input.want)need(canonical(expected(row))===canonical(input.want),'BRANCH_CHANGED');
  const w=Curriculum.receiveCurriculumWorkspace(row.snapshot),selection={id:row.id,expected:expected(row)},history=[];
  for await(const page of client.history(selection)){need(page.total===w.history.length,'HISTORY_TOTAL');history.push(...page.items);}
  need(canonical(history)===canonical(w.history),'HISTORY_COVERAGE');
  const reports={portfolio:await client.report({...selection,kind:'portfolio',options:{}}),curriculumPortfolio:await client.report({...selection,kind:'curriculumPortfolio',options:{}})};
  const editions=[],sources=[];
  for(let i=0;i<w.editions.length;i++){
   const e=w.editions[i],inventory=await client.report({...selection,kind:'sourceInventory',options:{editionId:e.id}}),sdk=await client.report({...selection,kind:'sdk',options:{editionId:e.id}});
   need(sdk.result.editionId===e.id&&sdk.result.files.length===3&&sdk.result.descriptors.length===3,'SDK_COVERAGE');
   const generated=[];
   for(const f of sdk.result.files){
    const d=sdk.result.descriptors.find(x=>x.path===f.path);need(d&&d.bytes===Buffer.byteLength(f.content)&&d.sha256===sha(f.content),'SDK_FILE_CHANGED');
    const path=join(course.directory,'sources',label,'edition-'+String(i).padStart(4,'0'),f.path);
    generated.push({...d,...await outputFile(path,consume=>client.download({...selection,kind:'sdkFile',options:{editionId:e.id,path:f.path}},consume,d),d)});
   }
   editions.push({editionId:e.id,inventory,sdk,generated});
  }
  for(let i=0;i<w.assets.length;i++){
   const a=w.assets[i],raw=Buffer.from(a.content),d={bytes:raw.length,sha256:sha(raw)},path=join(course.directory,'sources',label,'asset-'+String(i).padStart(4,'0')+'.bin');
   sources.push({id:a.id,name:a.name,kind:a.kind,...await outputFile(path,consume=>client.downloadAsset({...selection,assetId:a.id},consume,d),d)});
  }
  const plans=[];
  for(const c of w.cases)for(const p of c.curriculumPlans??[]){
   const plan=await client.report({...selection,kind:'curriculumPlan',options:{caseId:c.id,planId:p.id}});
   const rows=await client.report({...selection,kind:'curriculumReviewRows',options:{caseId:c.id,planId:p.id}});
   need(canonical(plan.result)===canonical(p)&&canonical(rows.result)===canonical(Curriculum.curriculumReviewRows(p)),'CURRICULUM_REPORT_CHANGED');
   plans.push({caseId:c.id,planId:p.id,plan,rows});
  }
  const after=await client.branch(id);need(canonical(expected(after))===canonical(expected(row)),'BRANCH_CHANGED');
  return {schema:'stellar-forge.curriculum-managed-observation.v1',branch:row,history,reports,editions,sources,plans};
 });
 await restoreObservationSources(course,label,observation);return observation;
}
async function restoreObservationSources(course,label,observation){
 const w=Curriculum.receiveCurriculumWorkspace(observation.branch.snapshot),files=[];
 need(observation.sources.length===w.assets.length&&observation.editions.length===w.editions.length,'SOURCE_COVERAGE');
 for(let i=0;i<w.assets.length;i++){
  const a=w.assets[i],saved=observation.sources[i],raw=Buffer.from(a.content),path=join(course.directory,'sources',label,'asset-'+String(i).padStart(4,'0')+'.bin');
  need(saved.id===a.id&&saved.path===path&&saved.bytes===raw.length&&saved.sha256===sha(raw),'SOURCE_COVERAGE');
  files.push(await outputFile(path,async consume=>{await consume(raw);return {bytes:raw.length,sha256:sha(raw)};},saved));
 }
 for(let i=0;i<w.editions.length;i++){
  const saved=observation.editions[i];need(saved.editionId===w.editions[i].id,'EDITION_COVERAGE');
  for(const f of saved.sdk.result.files){
   const path=join(course.directory,'sources',label,'edition-'+String(i).padStart(4,'0'),f.path),d=saved.generated.find(x=>x.path===path),raw=Buffer.from(f.content);
   need(d&&d.bytes===raw.length&&d.sha256===sha(raw),'SDK_COVERAGE');
   files.push(await outputFile(path,async consume=>{await consume(raw);return {bytes:raw.length,sha256:sha(raw)};},d));
  }
 }
 return files;
}
async function managedCommand(client,course,label,id,build){
 return course.effect(label,async()=>{
  const branch=await client.branch(id);
  const command=await build(branch.snapshot,{actor:course.input.actor,at:new Date().toISOString()});
  return {id,expected:expected(branch),requestId:course.id(label),command};
 },x=>client.command(x));
}
async function verifyReplay(client,course,label,phase,id,selected){
 const original=await optional(join(course.directory,'control',phase,'input.json'));
 const outcome=await optional(join(course.directory,'control',phase,'result.json'));need(original&&outcome,'ORIGINAL_REQUEST_MISSING');
 await course.effect(label,()=>original,async x=>{
  const replay=await client.command(x);need(canonical(replay)===canonical(outcome),'FIRST_RESULT_CHANGED');
  const lookup=await client.request(x.requestId);need(lookup&&canonical(lookup.result)===canonical(outcome),'FIRST_RESULT_LOOKUP_CHANGED');
  const current=await client.branch(id);need(canonical(expected(current))===canonical(selected),'REPLAY_LOST_FOLLOWING_EDIT');return {requestId:x.requestId,originalResult:replay,current};
 });
}
async function originalApplicationSource(client,course){
 const source=await inspectSource(join(PRODUCT,'app'));
 const selected=await course.effect('published-application-source',()=>({sourceSha256:SOURCE_SHA256}),async()=>{
  const files=[];
  for(const f of source.selection.files){
   const path=join(course.directory,'sources','published-application',f.path);
   files.push({...f,...await outputFile(path,consume=>client.downloadApplicationSource(f.path,consume,f),f)});
  }
  return {sourceSha256:SOURCE_SHA256,files};
 });
 for(const f of source.selection.files){const saved=selected.files.find(x=>x.path===join(course.directory,'sources','published-application',f.path));need(saved&&saved.bytes===f.bytes&&saved.sha256===f.sha256,'PUBLISHED_SOURCE_COVERAGE');
  const raw=await bytes(join(PRODUCT,'app',f.path),16*1024*1024);await outputFile(saved.path,async consume=>{await consume(raw);return {bytes:raw.length,sha256:sha(raw)};},f);
 }
 return selected;
}

async function agentProgramme(client,course,settings,label,branch){
 const creation=await jsonFile(join(settings.workspaceDirectory,'creation.json')),storage=join(course.directory,'control','agent-files');await privateDir(storage);
 const configPath=join(course.directory,'control','agent-'+label+'.json');
 await retain(configPath,{schema:'stellar-forge.curriculum-migration-workspaces.v1',storageDirectory:storage,stores:{selected:{connectionFile:settings.connectionFile,storeId:creation.id,storeDirectory:settings.workspaceDirectory}},files:{}});
 const owner=new MerchantCurriculumMigration({curriculumMigration:await readCurriculumMigrationConfiguration(configPath)}),scope={store:'selected',storeId:creation.id,storeDirectory:settings.workspaceDirectory},selected={...scope,branchId:branch.id,expected:expected(branch)};
 try{
  const report=await course.effect(label+'-agent-records',()=>selected,async input=>{
   const state=await owner.call('merchant_curriculum_migration_state',scope),summary=await owner.call('merchant_curriculum_migration_branch',input),collections={};
   for(const kind of ['editions','cases','assets','history']){
    let offset=0,total=null;const rows=[];
    do{
     const page=await owner.call('merchant_curriculum_migration_records',{...input,collection:kind,offset,limit:100});
     need(page.offset===offset&&(total===null||page.total===total),'AGENT_PAGE');total=page.total;rows.push(...page.items);
     need(page.nextOffset===null||page.nextOffset>offset,'AGENT_PAGE');offset=page.nextOffset;
    }while(offset!==null);
    need(rows.length===total&&canonical(rows)===canonical(branch.snapshot[kind]),'AGENT_COMPLETE_COLLECTION');collections[kind]=rows;
   }
   const original=await optional(join(course.directory,'control','published-candidate-response','input.json')),first=await optional(join(course.directory,'control','published-candidate-response','result.json'));
   const replay=await owner.call('merchant_curriculum_migration_command',{...scope,branchId:original.id,expected:original.expected,requestId:original.requestId,command:original.command});
   need(canonical(replay)===canonical(first),'AGENT_FIRST_RESULT');
   const current=await client.branch(branch.id);need(canonical(expected(current))===canonical(expected(branch)),'AGENT_REPLAY_CHANGED_BRANCH');
   return {state,summary,collections,replay};
  });
  const exported=await client.exportBranch({id:branch.id,expected:expected(branch)});
  const received=await course.effect(label+'-agent-file',()=>selected,async input=>{
   let offset=0,descriptor=null,readId=null;const chunks=[];
   try{
    do{
     const page=await owner.call('merchant_curriculum_migration_file_read',{...input,selection:{kind:'workspace'},offset,limit:196608,...(readId?{readId}:{})});
     need(page.offset===offset,'AGENT_FILE_PAGE');descriptor??=page.file;need(canonical(page.file)===canonical(descriptor),'AGENT_FILE_CHANGED');readId=page.readId;
     const chunk=Buffer.from(page.data,'base64');need(chunk.length===page.bytesRead,'AGENT_FILE_PAGE');chunks.push(chunk);
     need(page.nextOffset===null||page.nextOffset>offset,'AGENT_FILE_PAGE');offset=page.nextOffset;
    }while(offset!==null);
   }finally{if(readId)await owner.call('merchant_curriculum_migration_file_release',{...scope,branchId:branch.id,readId});}
   const raw=Buffer.concat(chunks);need(raw.length===descriptor.bytes&&sha(raw)===descriptor.sha256,'AGENT_FILE_CHANGED');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);need(canonical(portable(JSON.parse(text)))===canonical(exported),'AGENT_PORTABLE');
   return {descriptor,contentUtf8:text};
  });
  const path=join(course.directory,'artifacts',label+'-agent-workspace.json'),raw=Buffer.from(received.contentUtf8);
  const file=await outputFile(path,async consume=>{await consume(raw);return {bytes:raw.length,sha256:sha(raw)};},received.descriptor);
  return {report,artifact:file};
 }finally{await owner.close();}
}
async function browserProgramme(client,course,settings,branch,guard){
 const directory=join(course.directory,'browser');await privateDir(directory);
 const packet=await course.effect('browser-selected-workspace',()=>({id:branch.id,expected:expected(branch)}),x=>client.exportBranch(x));
 const basis=await artifact(course,'Browser_Selected_Workspace.json',packet);
 const connection=await readConnection(settings.connectionFile,{storeId:client.selectedStore.storeId,workspaceDirectory:settings.workspaceDirectory});
 const stable={schema:'stellar-forge.curriculum-managed-browser.v1',operationId:course.id('browser'),directory,
  storeId:client.selectedStore.storeId,storeDirectory:settings.workspaceDirectory,branchId:branch.id,sourceSha256:SOURCE_SHA256,
  acceptedWorkspaceFile:basis.path,offlinePort:course.input.offlinePort,actor:course.input.actor,bulkOptions:course.input.bulkOptions};
 await retain(join(directory,'input-binding.json'),stable);
 const live=join(directory,'connection.json'),temporary=live+'.partial',fd=await open(temporary,'w',0o600);
 try{await fd.writeFile(canonical({...stable,url:connection.url}));await fd.sync();}finally{await fd.close();}await rename(temporary,live);await syncDir(directory);
 let result=await optional(join(directory,'result.json'));
 if(result?.status!=='COMPLETE'){
  let stdout=null,stderr=null,primary=null;const closing=[];
  try{
   stdout=await open(join(directory,'stdout.log'),'a',0o600);
   stderr=await open(join(directory,'stderr.log'),'a',0o600);
   const code=await new Promise((done,reject)=>{
    let childError=null;
    const child=spawn(course.input.nodeExecutable,[join(HERE,'managed-browser-receiving.mjs'),live],{cwd:join(PRODUCT,'app'),
     env:{...process.env,CURRICULUM_RECEIVING_GUARD_FD:'3',CURRICULUM_RECEIVING_PYTHON:course.input.pythonExecutable,CURRICULUM_CHROMIUM_EXECUTABLE:course.input.chromiumExecutable,NODE_OPTIONS:'--max-old-space-size=512'},
     stdio:['ignore',stdout.fd,stderr.fd,guard]});
    children.add(child);
    child.once('error',error=>{childError??=error;});
    child.once('close',(code,signal)=>{
     children.delete(child);
     if(childError)reject(childError);
     else if(signal)reject(new Error('Original browser ended by '+signal));
     else done(code);
    });
   });need(code===0,'BROWSER_INTERRUPTED');
  }catch(error){primary=error;}
  finally{
   for(const handle of [stdout,stderr])if(handle){
    try{await handle.sync();}catch(error){closing.push(error);}
    try{await handle.close();}catch(error){closing.push(error);}
   }
  }
  if(primary||closing.length)throw new AggregateError([...(primary?[primary]:[]),...closing],
   'Original browser receiving or log closure did not complete.');
  result=await optional(join(directory,'result.json'));
 }
 need(result?.status==='COMPLETE'&&result.operation===stable.operationId&&result.browserClosed&&result.serverClosed,'BROWSER_INCOMPLETE');
 for(const item of result.artifacts){const path=resolve(directory,item.path);need(path.startsWith(directory+'/')&&!item.path.split('/').includes('..'),'BROWSER_ARTIFACT_PATH');const raw=await bytes(path,512*1024*1024);need(raw.length===item.bytes&&sha(raw)===item.sha256,'BROWSER_ARTIFACT_CHANGED');}
 return result;
}
async function restoreCompleteInventory(course){
 const directory=course.directory,files=[],artifactPhases={
  'Original_Observation.json':'original-observation','Original_Workspace.json':'original-export',
  'Following_Observation.json':'following-observation','Following_Workspace.json':'following-export',
  'Agent_Observation.json':'following-agent-records',
  'Received_Before_Browser.json':'received-before-browser','Browser_Selected_Workspace.json':'browser-selected-workspace',
  'Received_After_Browser.json':'received-after-browser','Received_Workspace.json':'received-export',
  'Reopened_Received_Branch.json':'received-reopened-observation','Original_Reopened_Copy.json':'original-reopened-observation',
  'Cold_Observation.json':'cold-observation','Cold_Workspace.json':'received-export','Bulk_Receiving_Status.json':'bulk-receiving',
  'Published_Application_Source.json':'published-application-source'
 };
 for(const [name,phase]of Object.entries(artifactPhases)){
  const value=await optional(join(directory,'control',phase,'result.json'));need(value!==null,'PHASE_INCOMPLETE');files.push(await artifact(course,name,value));
 }
 for(const label of ['original-observation','following-observation','received-before-browser','received-after-browser','cold-observation']){
  const observation=await optional(join(directory,'control',label,'result.json'));need(observation,'PHASE_INCOMPLETE');files.push(...await restoreObservationSources(course,label,observation));
 }
 const agent=await optional(join(directory,'control','following-agent-file','result.json'));need(agent,'PHASE_INCOMPLETE');
 const agentRaw=Buffer.from(agent.contentUtf8),agentPath=join(directory,'artifacts','following-agent-workspace.json');
 files.push(await outputFile(agentPath,async consume=>{await consume(agentRaw);return {bytes:agentRaw.length,sha256:sha(agentRaw)};},agent.descriptor));
 const source=await inspectSource(join(PRODUCT,'app')),published=await optional(join(directory,'control','published-application-source','result.json'));need(published.sourceSha256===SOURCE_SHA256,'PUBLISHED_SOURCE_CHANGED');
 for(const f of source.selection.files){
  const path=join(directory,'sources','published-application',f.path),selected=published.files.find(x=>x.path===path);need(selected&&selected.bytes===f.bytes&&selected.sha256===f.sha256,'PUBLISHED_SOURCE_CHANGED');
  const raw=await bytes(join(PRODUCT,'app',f.path),16*1024*1024);files.push(await outputFile(path,async consume=>{await consume(raw);return {bytes:raw.length,sha256:sha(raw)};},f));
 }
 const browser=await optional(join(directory,'control','browser-complete','result.json'));need(browser?.status==='COMPLETE'&&browser.browserClosed&&browser.serverClosed,'BROWSER_INCOMPLETE');
 for(const item of browser.artifacts){const path=resolve(directory,'browser',item.path);need(path.startsWith(join(directory,'browser')+'/')&&!item.path.split('/').includes('..'),'BROWSER_ARTIFACT_PATH');files.push({...item,path});}
 need(new Set(files.map(f=>f.path)).size===files.length,'DELIVERY_DUPLICATE');return files;
}
export async function runManagedReceiving(input){
 need(input.schema==='stellar-forge.curriculum-migration-managed-receiving.v1'&&input.originalOperation===ORIGINAL_OPERATION&&UUID.test(input.operationId)&&input.sourceSha256===SOURCE_SHA256,'RECEIVING_INPUT');
 const directory=absolute(input.directory),operation=absolute(input.operationDirectory);await privateDir(directory);await retain(join(directory,'input.json'),input);
 const guard=Number(process.env.CURRICULUM_MANAGED_GUARD_FD);need(Number.isSafeInteger(guard)&&guard>=3,'RECEIVING_GUARD');
 const actual=await stat('/proc/self/fd/'+guard),selected=await stat(join(operation,'complete-receiving.lock'));need(actual.dev===selected.dev&&actual.ino===selected.ino,'RECEIVING_GUARD');
 const selectedRaw=await bytes(input.selectedWorkspace.path,160*1024*1024,{privateOnly:true});need(selectedRaw.length===input.selectedWorkspace.bytes&&sha(selectedRaw)===input.selectedWorkspace.sha256,'SELECTED_WORKSPACE_CHANGED');
 const initial=Curriculum.receiveCurriculumWorkspace(await jsonFile(join(PRODUCT,'app','initial-workspace.json'),160*1024*1024));
 const accepted=originalBasis(initial,JSON.parse(selectedRaw),input.bulkOptions);
 const course=new Course(directory,input),done=await optional(join(directory,'result.json'));
 if(done){
  need(done.state==='COMPLETE'&&done.inputSha256===digest(input)&&done.allOwnedResourcesClosed,'RESULT_CHANGED');
  const restored=await restoreCompleteInventory(course);need(canonical(restored)===canonical(done.files),'RESULT_INVENTORY_CHANGED');
  for(const f of done.files){const raw=await bytes(f.path,512*1024*1024);need(raw.length===f.bytes&&sha(raw)===f.sha256,'RESULT_FILE_CHANGED');}return done;
 }
 await inspectSource(join(PRODUCT,'app'));
 const model=await openRuntimeWorkspace({directory:absolute(input.runtimeWorkspace)});let modelClosed=false;
 try{
  const modelState=await model.state({runtimeId:input.runtimeId}),runtime=modelState.runtimes.find(x=>x.id===input.runtimeId);need(runtime?.phase==='READY','RUNTIME_NOT_READY');
  const installed=await inspectMerchantRuntime(runtime.directory,{load:false,source:false});need(await realpath(installed.sourceRoot)===await realpath(ROOT),'INSTALLED_SOURCE_CHANGED');
  const originalSettings={workspaceDirectory:join(directory,'stores','original'),connectionFile:join(directory,'stores','original','connection.json'),port:0};
  await privateDir(dirname(originalSettings.workspaceDirectory));
  const originalStore=await course.effect('create-original',()=>({directory:originalSettings.workspaceDirectory,id:course.id('original-store'),title:input.label,createdAt:input.startedAt,initialSnapshot:accepted.workspace}),x=>createStore(x));
  const originalId=await saveApplication(model,course,'original',originalSettings);
  await withRun(model,course,originalId,originalSettings,'original',async client=>{
   const baseline=await originalReports(client,course,'original-observation',originalStore.defaultBranchId,{workspaceId:accepted.workspace.id,revision:accepted.workspace.revision,snapshotSha256:accepted.sha256});
   await artifact(course,'Original_Observation.json',baseline);
   await originalApplicationSource(client,course);
   const seed=await course.effect('original-export',()=>({id:baseline.branch.id,expected:expected(baseline.branch)}),x=>client.exportBranch(x)),exported=await artifact(course,'Original_Workspace.json',seed);
   const copy=await course.effect('receive-original-copy',()=>({id:'branch-'+course.id('original-copy'),label:'Independent managed curriculum receiving branch',origin:{purpose:'Original published source receiving',sourceSha256:SOURCE_SHA256},requestId:course.id('receive-original-copy')}),x=>client.receiveFile(x,exported.path,exported));
   const example=initial.cases.find(c=>c.id==='oak-example-01');need(example?.responses.original,'PUBLISHED_EXAMPLE_MISSING');
   const caseId='receiving-'+course.id('published-example-case');
   await managedCommand(client,course,'published-case',copy.id,(_w,context)=>({kind:'addCase',...context,body:{case:{id:caseId,name:'Managed receiving — original published '+example.name,operationKey:example.operationKey,sourceEditionId:example.sourceEditionId,targetEditionId:example.sourceEditionId,request:example.request}}}));
   await managedCommand(client,course,'published-original-response',copy.id,(_w,context)=>({kind:'saveResponse',...context,body:{caseId,lane:'original',response:example.responses.original}}));
   await managedCommand(client,course,'published-candidate-response',copy.id,(_w,context)=>({kind:'saveResponse',...context,body:{caseId,lane:'candidate',response:example.responses.original}}));
   await managedCommand(client,course,'published-comparison',copy.id,(_w,context)=>({kind:'compareCase',...context,body:{caseId}}));
   await managedCommand(client,course,'published-decision',copy.id,(w,context)=>{
    const c=w.cases.find(c=>c.id===caseId),run=c?.runs.at(-1);need(run?.status==='MATCH','PUBLISHED_COMPARISON_CHANGED');
    return {kind:'decide',...context,body:{caseId,decision:{runId:run.id,outcome:'accepted',note:'Receiving exercise of the exact published Oak example in both lanes; this is not a customer staging response or BULK commissioning.'}}};
   });
   const modelSource=await bytes(join(PRODUCT,'app','model.mjs'),16*1024*1024);
   await managedCommand(client,course,'published-source-asset',copy.id,(_w,context)=>({kind:'addAsset',...context,body:{asset:{id:'source-'+course.id('original-model'),name:'Exact original model.mjs — managed receiving source',kind:'source-notes',content:new TextDecoder('utf-8',{fatal:true}).decode(modelSource)}}}));
   let bulkStatus;
   if(input.bulkOptions){
    const b=input.bulkOptions;
    await managedCommand(client,course,'actual-bulk-plan',copy.id,(_w,context)=>({kind:'planCurriculumCase',...context,body:{caseId:b.caseId,options:{namespaces:b.namespaces,mappings:b.mappings}}}));
    await managedCommand(client,course,'actual-bulk-decision',copy.id,(w,context)=>{
     const plan=w.cases.find(c=>c.id===b.caseId).curriculumPlans.at(-1);
     return {kind:'decideCurriculumPlan',...context,body:{caseId:b.caseId,decision:{planId:plan.id,...b.decision}}};
    });
    bulkStatus=await course.effect('bulk-receiving',()=>b,async()=>({status:'COMPLETE',basis:'OPERATOR_SUPPLIED_ACTUAL_BULK',caseId:b.caseId,selection:b}));
   }else bulkStatus=await course.effect('bulk-receiving',()=>({selected:false}),async()=>({status:'PENDING_INPUT',reason:'Actual original/candidate BULK responses and reviewed namespace/mapping/decision input have not been supplied.'}));
   await artifact(course,'Bulk_Receiving_Status.json',bulkStatus);
   const following=await originalReports(client,course,'following-observation',copy.id);await artifact(course,'Following_Observation.json',following);
   await verifyReplay(client,course,'published-first-result-replay','published-candidate-response',copy.id,expected(following.branch));
   const repeatedInput=await optional(join(directory,'control','receive-original-copy','input.json')),originalReceive=await optional(join(directory,'control','receive-original-copy','result.json'));
   await course.effect('repeat-receive-first-result',()=>repeatedInput,async x=>{const r=await client.receiveFile(x,exported.path,exported);need(canonical(r)===canonical(originalReceive),'RECEIVE_FIRST_RESULT_CHANGED');return r;});
   const retained=await client.branch(copy.id);need(canonical(expected(retained))===canonical(expected(following.branch)),'FOLLOWING_EDIT_LOST');
   const portableFollowing=await course.effect('following-export',()=>({id:copy.id,expected:expected(following.branch)}),x=>client.exportBranch(x));await artifact(course,'Following_Workspace.json',portableFollowing);
   const agent=await agentProgramme(client,course,originalSettings,'following',following.branch);await artifact(course,'Agent_Observation.json',agent.report);
  });
  const following=await optional(join(directory,'control','following-export','result.json'));
  const receivedSettings={workspaceDirectory:join(directory,'stores','received'),connectionFile:join(directory,'stores','received','connection.json'),port:0};
  const receivedStore=await course.effect('create-received',()=>({directory:receivedSettings.workspaceDirectory,id:course.id('received-store'),title:input.label+' — independent receiving',createdAt:input.startedAt,initialSnapshot:following.workspace}),x=>createStore(x));
  const receivedId=await saveApplication(model,course,'received',receivedSettings);
  await withRun(model,course,receivedId,receivedSettings,'received',async client=>{
   const basis=await originalReports(client,course,'received-before-browser',receivedStore.defaultBranchId,{workspaceId:following.workspace.id,revision:following.workspace.revision,snapshotSha256:following.sha256});
   await artifact(course,'Received_Before_Browser.json',basis);
   const browser=await browserProgramme(client,course,receivedSettings,basis.branch,guard);await course.effect('browser-complete',()=>({operation:browser.operation}),async()=>browser);
   const current=await originalReports(client,course,'received-after-browser',receivedStore.defaultBranchId);
   need(canonical(current.branch.snapshot)===canonical(browser.steps.finalOriginal.snapshot),'BROWSER_BRANCH_CHANGED');await artifact(course,'Received_After_Browser.json',current);
   const whole=await course.effect('received-export',()=>({id:current.branch.id,expected:expected(current.branch)}),x=>client.exportBranch(x));await artifact(course,'Received_Workspace.json',whole);
  });
  const received=await optional(join(directory,'control','received-export','result.json'));
  await withRun(model,course,receivedId,receivedSettings,'received-reopen',async client=>{
   const row=await course.effect('received-reopened-observation',()=>({id:receivedStore.defaultBranchId}),x=>client.branch(x.id));need(canonical(row.snapshot)===canonical(received.workspace),'REOPEN_CHANGED');await artifact(course,'Reopened_Received_Branch.json',row);
  });
  await withRun(model,course,originalId,originalSettings,'original-reopen',async client=>{
   const row=await client.branch(originalStore.defaultBranchId);need(canonical(row.snapshot)===canonical(accepted.workspace),'ORIGINAL_BRANCH_CHANGED');
   const copy=await optional(join(directory,'control','receive-original-copy','input.json')),file=await artifact(course,'Original_Workspace.json',await optional(join(directory,'control','original-export','result.json')));
   await course.effect('reopened-original-receive',()=>copy,x=>client.receiveFile(x,file.path,file));
   const current=await course.effect('original-reopened-observation',()=>({id:copy.id}),x=>client.branch(x.id));need(canonical(current.snapshot)===canonical(following.workspace),'FOLLOWING_EDIT_LOST');await artifact(course,'Original_Reopened_Copy.json',current);
  });
  const coldSettings={workspaceDirectory:join(directory,'stores','cold'),connectionFile:join(directory,'stores','cold','connection.json'),port:0};
  const coldStore=await course.effect('create-cold',()=>({directory:coldSettings.workspaceDirectory,id:course.id('cold-store'),title:input.label+' — final receiving',createdAt:input.startedAt,initialSnapshot:received.workspace}),x=>createStore(x));
  const coldId=await saveApplication(model,course,'cold',coldSettings);
  await withRun(model,course,coldId,coldSettings,'cold',async client=>{
   const observation=await originalReports(client,course,'cold-observation',coldStore.defaultBranchId,{workspaceId:received.workspace.id,revision:received.workspace.revision,snapshotSha256:received.sha256});await artifact(course,'Cold_Observation.json',observation);
   const out=await client.exportBranch({id:coldStore.defaultBranchId,expected:expected(observation.branch)});need(canonical(out)===canonical(received),'COLD_RECEIVING_CHANGED');await artifact(course,'Cold_Workspace.json',out);
  });
  const files=await restoreCompleteInventory(course),browser=await optional(join(directory,'control','browser-complete','result.json'));
  await model.close();modelClosed=true;need(!interruption,'RECEIVING_INTERRUPTED');
  const result={schema:'stellar-forge.curriculum-migration-managed-result.v1',state:'COMPLETE',originalOperation:ORIGINAL_OPERATION,operationId:input.operationId,inputSha256:digest(input),sourceSha256:SOURCE_SHA256,
   selectedWorkspace:input.selectedWorkspace,bulkReceiving:await optional(join(directory,'control','bulk-receiving','result.json')),runtimeId:input.runtimeId,runtimeDirectory:runtime.directory,
   applications:{original:originalId,received:receivedId,cold:coldId},stores:{original:originalStore,received:receivedStore,cold:coldStore},browser,files,allOwnedResourcesClosed:true};
  await retain(join(directory,'result.json'),result);return result;
 }finally{if(!modelClosed)await model.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const input=await jsonFile(absolute(process.argv[2]),512*1024*1024,{privateOnly:true});console.log(JSON.stringify(await runManagedReceiving(input)));}
 finally{process.removeListener('SIGTERM',onTerm);process.removeListener('SIGINT',onInt);}
}
