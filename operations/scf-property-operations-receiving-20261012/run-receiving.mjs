#!/usr/bin/env node
// MIT. Complete installed Property SDK/MCP/Applications and original customer receiving.
import {readFile,open,mkdir,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {receivePropertyAttached} from './receive-attached.mjs';
import {receivePropertyBrowser} from './run-browser.mjs';
import {now,need,view,same,hash,json,absolute,member,exists,directory,separate,identity,readJSON,writeJSON,copyOriginal,runProcess,poll,sealCustomer} from './io.mjs';
const SOURCE_ROOT=fileURLToPath(new URL('../../',import.meta.url)),P='stellar/scf-starforge-20261009/',NATIVE=P+'sf30-seller-sdk/property-operations/';
const load=path=>import(pathToFileURL(join(SOURCE_ROOT,path)));
const SCHEMA='stellar-forge.property-managed-receiving-input.v1';
function config(input){
 need(input&&input.schema===SCHEMA,'PROPERTY_RECEIVING_INPUT');
 const keys=['schema','operationId','runtimeDirectory','runtimeWorkspace','workspaceDirectory','outputDirectory','connectionFile','expectedCreatedAt','baseline','paidDelivery','timeoutSeconds','applicationId','label','expectedInitialWorkspaceSha256','propertyHostFile','browser'];
 need(Object.keys(input).every(k=>keys.includes(k)),'PROPERTY_RECEIVING_INPUT');
 for(const name of ['runtimeDirectory','runtimeWorkspace','workspaceDirectory','outputDirectory'])absolute(input[name]);
 need(typeof input.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,150}$/.test(input.operationId)&&Number.isFinite(Date.parse(input.expectedCreatedAt)),'PROPERTY_RECEIVING_INPUT');
 need(input.baseline&&typeof input.baseline.editionId==='string'&&input.baseline.columns&&Number.isSafeInteger(input.baseline.expectedRows)&&input.baseline.expectedRows>0&&typeof input.baseline.actor==='string'&&input.baseline.actor.trim(),'PROPERTY_RECEIVING_BASELINE_INPUT');
 const paid=input.paidDelivery;need(paid&&absolute(paid.path)&&Number.isSafeInteger(paid.bytes)&&paid.bytes>0&&/^[a-f0-9]{64}$/.test(paid.sha256)&&typeof paid.customerId==='string'&&typeof paid.acquisitionId==='string'&&/^[a-f0-9]{64}$/.test(paid.snapshot),'PROPERTY_RECEIVING_PAID_INPUT');
 if(input.browser!==undefined){
  need(input.browser&&typeof input.browser==='object'&&!Array.isArray(input.browser)&&Object.keys(input.browser).length===2&&
   Object.keys(input.browser).every(key=>['playwrightModule','executablePath'].includes(key)),'PROPERTY_RECEIVING_BROWSER_INPUT');
  absolute(input.browser.playwrightModule);absolute(input.browser.executablePath);
 }
 const seconds=input.timeoutSeconds??300;need(Number.isSafeInteger(seconds)&&seconds>=30&&seconds<=3600,'PROPERTY_RECEIVING_TIMEOUT');
 separate(input.workspaceDirectory,input.outputDirectory);separate(input.outputDirectory,input.workspaceDirectory);separate(input.runtimeDirectory,input.outputDirectory);separate(input.runtimeWorkspace,input.outputDirectory);
 return {...input,timeoutSeconds:seconds,label:input.label??'Property Operations — original HPD receiving',
  connectionFile:input.connectionFile??join(input.outputDirectory,'private','property-connection.json')};
}
function logical(value){const out=structuredClone(value);delete out.updatedAt;delete out.restoredAt;out.exports=[];out.error=null;return out;}
async function portClosed(url){
 const u=new URL(url);return await new Promise((done,reject)=>{const socket=createConnection({host:u.hostname,port:Number(u.port)});
  socket.once('connect',()=>{socket.destroy();done(false);});socket.once('error',e=>{if(['ECONNREFUSED','ECONNRESET'].includes(e.code))done(true);else reject(e);});
  socket.setTimeout(5000,()=>{socket.destroy();reject(Object.assign(new Error('Original listener close could not be observed.'),{code:'PROPERTY_RECEIVING_LISTENER_PENDING'}));});});
}
async function parsedOriginalCli(sourceRoot,directory,command,args=[]){
 const result=await runProcess(process.execPath,[join(sourceRoot,P+'sf30-seller-sdk/socrata/cli.mjs'),command,...args,'--directory',directory]);
 let parsed;try{parsed=JSON.parse(result.stdout);}catch(error){error.result=result;throw error;}
 return {result,parsed};
}
async function savedPackage(file){
 const raw=await readFile(file);need(raw.length<=512*1024*1024,'PROPERTY_RECEIVING_PACKAGE_LIMIT');
 const body=gunzipSync(raw,{maxOutputLength:768*1024*1024});const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
 need(packet.schema==='stellar-forge.socrata-package.v1'&&packet.workspace?.schema==='stellar-forge.socrata-workspace.v1','PROPERTY_RECEIVING_PACKAGE');
 need(Array.isArray(packet.files)&&packet.files.length<=100000,'PROPERTY_RECEIVING_PACKAGE');return packet;
}
export async function receivePropertyOperations(originalInput){
 const input=config(originalInput),output=await directory(input.outputDirectory,{create:true}),customer=await directory(join(output,'customer'),{create:true});
 await directory(join(output,'private'),{create:true});await directory(dirname(input.connectionFile),{create:true});
 const journalFile=join(output,'receiving-operation.json');let journal=null,model=null,primary=null,closingRun=null,stopped=false;
 const inputHash=hash(json(input));const save=()=>writeJSON(journalFile,journal,{replace:true});
 const onSignal=()=>{stopped=true;};
 const ongoing=()=>need(!stopped,'PROPERTY_RECEIVING_INTERRUPTED','Finish the retained original shutdown before resuming.');
 const lease=await acquireStateLease(output);
 try{
  process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
  const retained=await readJSON(journalFile,{optional:true});
  if(retained)need(retained.schema==='stellar-forge.property-managed-receiving.v1'&&retained.inputSha256===inputHash&&retained.operationId===input.operationId&&Array.isArray(retained.runs)&&Array.isArray(retained.failures),'PROPERTY_RECEIVING_JOURNAL_CHANGED');
  journal=retained;
  if(!journal){journal={schema:'stellar-forge.property-managed-receiving.v1',id:randomUUID(),operationId:input.operationId,inputSha256:inputHash,input,createdAt:input.expectedCreatedAt,status:'STARTED',steps:{},runs:[],failures:[],startedAt:now()};await save();}
  if(journal.freeze)return await sealCustomer({journal,customer,output,save});
  const [{inspectMerchantRuntime},binding,framework]=await Promise.all([
   load(P+'sf46-release/runtime-package.mjs'),load(NATIVE+'managed-binding.mjs'),load(P+'distribution/runtime-workspace/model.mjs')]);
  const installed=await inspectMerchantRuntime(input.runtimeDirectory,{load:false});
  need(installed.sourceRoot===await realpath(SOURCE_ROOT),'PROPERTY_RECEIVING_INSTALLED_SOURCE','Run this entry from the original installed package/source directory.');
  const source=await binding.readPropertyApplicationSource(installed.sourceRoot);
  const selected={sourceCommit:installed.sourceCommit,installationId:installed.installationId,profileId:installed.profileId,profileSha256:installed.profileSha256,
   lockSha256:installed.lockSha256,sourceManifestSha256:installed.sourceManifestSha256,source:source.source};
  if(journal.source)need(same(journal.source,selected),'PROPERTY_RECEIVING_SOURCE_CHANGED');else{journal.source=selected;await save();}
  await copyOriginal(join(SOURCE_ROOT,'..','manifest.json'),join(customer,'source','merchant-manifest.json'));
  if(!journal.initialWorkspace){
   const initial=await identity(join(input.workspaceDirectory,'workspace.json'));
   if(input.expectedInitialWorkspaceSha256)need(initial.sha256===input.expectedInitialWorkspaceSha256,'PROPERTY_RECEIVING_WORKSPACE_CHANGED');
   const state=await readJSON(join(input.workspaceDirectory,'workspace.json'));
   need(state.schema==='stellar-forge.socrata-workspace.v1'&&state.createdAt===input.expectedCreatedAt,'PROPERTY_RECEIVING_WORKSPACE_CHANGED');
   journal.initialWorkspace={...initial,createdAt:state.createdAt,captures:state.captures.map(c=>({id:c.id,status:c.status,rowCount:c.rowCount})),editions:state.editions};await save();
  }
  const paid=await copyOriginal(input.paidDelivery.path,join(customer,'original-customer','Socrata_HPD_Completed_Customer_Delivery.zip'),input.paidDelivery);
  await writeJSON(join(customer,'original-customer','IDENTITY.json'),{...input.paidDelivery,path:'Socrata_HPD_Completed_Customer_Delivery.zip',...paid,newPurchase:false});
  if(!await exists(join(input.runtimeWorkspace,'workspace.json'))){
   need(!await exists(input.runtimeWorkspace),'PROPERTY_RECEIVING_RUNTIME_WORKSPACE_INCOMPLETE');
   journal.steps.runtimeWorkspace??={directory:input.runtimeWorkspace,requestedAt:now()};await save();ongoing();
   await framework.createRuntimeWorkspace({directory:input.runtimeWorkspace});
  }
  model=await framework.openRuntimeWorkspace({directory:input.runtimeWorkspace});
  const runtimes=await model.state();
  if(journal.runtimeWorkspaceId)need(journal.runtimeWorkspaceId===runtimes.workspaceId,'PROPERTY_RECEIVING_RUNTIME_WORKSPACE_CHANGED');else{journal.runtimeWorkspaceId=runtimes.workspaceId;await save();}
  if(!journal.runtimeId){const existing=runtimes.runtimes.find(r=>r.directory===input.runtimeDirectory);
   if(existing)journal.runtimeId=existing.id;else{journal.steps.attach??={directory:input.runtimeDirectory,requestedAt:now()};await save();const result=await model.attach({directory:input.runtimeDirectory,label:input.label+' runtime'});journal.steps.attach.result=result;journal.runtimeId=result.runtimeId;}await save();}
  const settings={workspaceDirectory:input.workspaceDirectory,connectionFile:input.connectionFile,port:0,...(input.propertyHostFile?{propertyHostFile:input.propertyHostFile}:{})};
  const application=async()=>{const state=await model.applicationsState({historyLimit:100}),id=journal.application?.id??input.applicationId,value=state.applications.find(x=>x.id===id);
   need(value&&value.kind==='property-operations'&&value.runtimeId===journal.runtimeId&&same(value.settings,settings),'PROPERTY_RECEIVING_APPLICATION_CHANGED');
   if(journal.application)need(value.revision===journal.application.revision,'PROPERTY_RECEIVING_APPLICATION_CHANGED');return value;};
  if(!journal.application){
   if(input.applicationId){const current=await application();need(!current.current?.active,'PROPERTY_RECEIVING_APPLICATION_ACTIVE');journal.application={id:current.id,revision:current.revision};await save();}
   else{
    if(!journal.steps.review){journal.steps.review=await model.applicationsReview({runtimeId:journal.runtimeId,kind:'property-operations',providerId:'property-operations',settings,label:input.label});await save();}
    journal.steps.save??={requestId:randomUUID(),reviewId:journal.steps.review.id};await save();ongoing();
    const result=await model.applicationsSave(journal.steps.save);journal.steps.save.result=result;
    need(result.saved===true,'PROPERTY_RECEIVING_APPLICATION_SAVE');journal.application={id:result.applicationId,revision:result.revision};await save();
   }
  }
  let current=await application();
  if(!current.release){journal.steps.connect??={requestedAt:now()};await save();journal.steps.connect.result=await model.applicationsConnect({applicationId:journal.application.id});await save();}
  // The release directory becomes visible before the original adoption publishes active.json.
  // Wait for that same saved operation to close before binding a start review to the home revision.
  const savedApplication=await readJSON(join(input.runtimeWorkspace,'applications',journal.application.id,'application.json'));
  const adoptionId=savedApplication.adoption?.requestId??null;
  current=await poll(async()=>{
   const value=await application(),state=adoptionId?await model.state():null;
   const adoption=adoptionId?state.operations.find(x=>x.id===adoptionId):null;
   need(value.phase!=='UNAVAILABLE'&&!['FAILED','CANCELLED'].includes(adoption?.phase),'PROPERTY_RECEIVING_ADOPTION_FAILED');
   if(adoptionId)need(adoption&&adoption.operation==='managed-adopt'&&adoption.homeId===savedApplication.homeId,'PROPERTY_RECEIVING_ADOPTION_CHANGED');
   return {value,adoption};
  },v=>Boolean(v.value.release)&&(!adoptionId||(v.adoption.phase==='SUCCEEDED'&&!v.adoption.workerActive&&!v.adoption.commandActive)),
  {seconds:input.timeoutSeconds,label:'original source adoption and owner closure'}).then(v=>v.value);
  if(journal.release)need(same(journal.release,current.release),'PROPERTY_RECEIVING_RELEASE_CHANGED');else{journal.release=current.release;await save();}
  async function history(){
   const rows=[];let cursor=null,total=null;const seen=new Set();
   do{const page=await model.applicationsHistory({applicationId:journal.application.id,limit:100,...(cursor?{cursor}:{})});
    total??=page.totalRuns;need(total===page.totalRuns,'PROPERTY_RECEIVING_HISTORY_CHANGED');rows.push(...page.runs);cursor=page.nextCursor;
    if(cursor){need(!seen.has(cursor),'PROPERTY_RECEIVING_HISTORY_CURSOR');seen.add(cursor);}
   }while(cursor);need(rows.length===total,'PROPERTY_RECEIVING_HISTORY_INCOMPLETE');return rows;
  }
  const runRow=async run=>(await history()).find(r=>r.id===run.id)??null;
  async function closeRun(run,{requireNormal=false}={}){
   if(run.closed){if(requireNormal)need(run.closure.kind==='normal-original-stop','PROPERTY_RECEIVING_NORMAL_STOP');return run.closure;}
   let row=await runRow(run);if(!row)return null;
   if(row.active||['PENDING','QUEUED','RUNNING'].includes(row.phase)){
    run.stop??={requestedAt:now()};await save();run.stop.result=await model.applicationsStop({applicationId:journal.application.id,operationId:run.id});await save();
   }
   row=await poll(()=>runRow(run),v=>v&&!v.active&&!['PENDING','QUEUED','RUNNING'].includes(v.phase),{seconds:input.timeoutSeconds,label:'original managed Stop'});
   if(row.phase==='INTERRUPTED'){run.recover??=[];const note={requestedAt:now()};run.recover.push(note);await save();note.result=await model.applicationsRecover({applicationId:journal.application.id,operationId:run.id});await save();
    row=await runRow(run);need(row&&!row.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(row.phase),'PROPERTY_RECEIVING_CLOSURE_PENDING');}
   const proof=await parsedOriginalCli(SOURCE_ROOT,input.workspaceDirectory,'status');
   need(proof.parsed.createdAt===input.expectedCreatedAt,'PROPERTY_RECEIVING_CLOSURE_WORKSPACE_CHANGED');
   const readyRemoved=!await exists(input.connectionFile);
   let pidAbsent=null,listenerClosed=null;if(run.ready){try{process.kill(run.ready.pid,0);pidAbsent=false;}catch(e){if(e.code==='ESRCH')pidAbsent=true;else throw e;}listenerClosed=await portClosed(run.ready.url);}
   const normal=row.phase==='SUCCEEDED'&&row.result?.state==='STOPPED'&&readyRemoved&&pidAbsent===true&&listenerClosed===true;
   run.closure={kind:normal?'normal-original-stop':'reconciled-original-native-lease',phase:row.phase,result:row.result,
    readyRemoved,pidAbsent,listenerClosed,nativeLeaseOpenedAndClosed:true,workspaceSha256:(await identity(join(input.workspaceDirectory,'workspace.json'))).sha256,observedAt:now()};
   run.closed=true;await save();
   await writeJSON(join(customer,'application','runs',run.id,'closure.json'),run.closure);
   for(const name of ['request.json','state.json']){const path=join(input.runtimeWorkspace,'operations',run.id,name);if(await exists(path))await copyOriginal(path,join(customer,'application','runs',run.id,name));}
   if(requireNormal)need(normal,'PROPERTY_RECEIVING_NORMAL_STOP','The successful receiving run needs the actual original normal Stop result.');
   return run.closure;
  }
  closingRun=closeRun;
  const successful=purpose=>journal.runs.findLast(r=>r.purpose===purpose&&r.receiving&&r.closed&&r.closure.kind==='normal-original-stop'&&(!input.browser||r.browser?.status==='COMPLETE'));
  for(const purpose of ['first-start','reopened-start']){
   const complete=successful(purpose);
   if(complete){if(!complete.workspace){const raw=await readJSON(join(input.workspaceDirectory,'workspace.json'));need(raw.createdAt===input.expectedCreatedAt&&raw.property?.id===journal.propertyId&&raw.property.revision===complete.receiving.revision,'PROPERTY_RECEIVING_WORKSPACE_CHANGED');const path=join(customer,'application',purpose+'-workspace.json');await writeJSON(path,raw);complete.workspace={file:path,...await identity(path)};await save();}continue;}
   ongoing();let run=journal.runs.findLast(r=>r.purpose===purpose&&!r.closed);
   if(!run){run={id:randomUUID(),purpose,requestedAt:now()};journal.runs.push(run);await save();}
   let row=await runRow(run);
   if(!row){
    if(!run.review){run.review=await model.applicationsStartReview({applicationId:journal.application.id});await save();}
    run.request??={applicationId:journal.application.id,requestId:run.id,reviewId:run.review.id};await save();ongoing();
    run.startResult=await model.applicationsStart(run.request);await save();
   }else if(!row.active&&['PENDING','QUEUED','INTERRUPTED'].includes(row.phase)){run.recover??=[];const note={requestedAt:now()};run.recover.push(note);await save();
    note.result=await model.applicationsRecover({applicationId:journal.application.id,operationId:run.id});await save();}
   row=await poll(()=>runRow(run),v=>{ongoing();if(v&&!v.active&&['SUCCEEDED','FAILED','CANCELLED'].includes(v.phase))throw Object.assign(new Error('The original managed attempt ended before receiving.'),{code:'PROPERTY_RECEIVING_ATTEMPT_ENDED',result:v});
    return v?.active&&v.url?.original?.schema==='stellar-forge.property-application-startup.v1';},{seconds:input.timeoutSeconds,label:'original Property ready announcement'});
   const ready=await readJSON(input.connectionFile);need(ready.instanceId===row.url.original.instanceId&&ready.createdAt===input.expectedCreatedAt&&ready.applicationRequestId===run.id,'PROPERTY_RECEIVING_READY_CHANGED');
   if(run.ready)need(same(run.ready,ready),'PROPERTY_RECEIVING_READY_CHANGED');else{run.ready=ready;await save();}
   journal.attached??={id:randomUUID()};await save();
   const result=await receivePropertyAttached({sourceRoot:SOURCE_ROOT,workspaceDirectory:input.workspaceDirectory,connectionFile:input.connectionFile,
    outputDirectory:join(customer,'receiving'),createdAt:input.expectedCreatedAt,baseline:input.baseline,paidDelivery:input.paidDelivery,
    journal:journal.attached,save,readOnly:Boolean(journal.attached.result?.complete)});
   run.receiving={report:result.report,...await identity(result.report),snapshot:result.snapshot,propertyId:result.propertyId,revision:result.propertyRevision};journal.propertyId=result.propertyId;await save();
   if(input.browser&&!run.browser){
    run.browser=await receivePropertyBrowser({url:ready.url,createdAt:input.expectedCreatedAt,propertyId:journal.propertyId,
     outputDirectory:join(customer,'browser',purpose,run.id),inspectionDirectory:join(output,'private','browser-inspection',purpose,run.id),
     playwrightModule:input.browser.playwrightModule,executablePath:input.browser.executablePath});await save();
   }
   await closeRun(run,{requireNormal:true});
   const raw=await readJSON(join(input.workspaceDirectory,'workspace.json'));const rawFile=join(customer,'application',purpose+'-workspace.json');await writeJSON(rawFile,raw);
   run.workspace={file:rawFile,...await identity(rawFile)};await save();
  }
  const first=successful('first-start'),second=successful('reopened-start');need(first&&second&&first.ready.instanceId!==second.ready.instanceId&&same(first.receiving.snapshot,second.receiving.snapshot),'PROPERTY_RECEIVING_REOPEN_CHANGED');
  const firstRaw=await readJSON(first.workspace.file),secondRaw=await readJSON(second.workspace.file);need(same(firstRaw,secondRaw),'PROPERTY_RECEIVING_REOPEN_CHANGED');
  journal.reopen={sameFullWorkspace:true,first:first.id,second:second.id,instanceIds:[first.ready.instanceId,second.ready.instanceId]};await save();
  ongoing();
  const portable=join(customer,'receiving','customer-export','files','starforge-socrata.json.gz'),packet=await savedPackage(portable),cold=join(output,'cold-workspace');
  need(packet.workspace.createdAt===input.expectedCreatedAt&&packet.workspace.property.id===journal.propertyId&&same(logical(packet.workspace),logical(secondRaw)),'PROPERTY_RECEIVING_PORTABLE_CHANGED');
  journal.cold??={directory:cold,package:{path:portable,...await identity(portable)},requestedAt:now()};await save();
  const prior=await readJSON(join(cold,'workspace.json'),{optional:true});
  if(!prior||!prior.captures?.length&&!prior.editions?.length&&!prior.source&&!prior.property){
   journal.cold.importRequest??={action:'package.import',packagePath:portable};await save();ongoing();
   const result=await parsedOriginalCli(SOURCE_ROOT,cold,'action',['package.import','--json',JSON.stringify({packagePath:portable})]);journal.cold.importResult=result.parsed;await save();
  }
  const restored=await parsedOriginalCli(SOURCE_ROOT,cold,'status'),raw=await readJSON(join(cold,'workspace.json'));
  need(raw.createdAt===input.expectedCreatedAt&&same(logical(raw),logical(packet.workspace)),'PROPERTY_RECEIVING_COLD_CHANGED');
  for(const file of packet.files){member(file.path);need(same(await identity(join(cold,file.path)),{bytes:file.bytes,sha256:file.sha256}),'PROPERTY_RECEIVING_COLD_FILE_CHANGED');}
  const coldWorkspaceFile=join(customer,'cold','workspace.json'),coldStatusFile=join(customer,'cold','native-status.json');
  if(await exists(coldWorkspaceFile))need(same(logical(await readJSON(coldWorkspaceFile)),logical(raw)),'PROPERTY_RECEIVING_COLD_CHANGED');else await writeJSON(coldWorkspaceFile,raw);
  if(!await exists(coldStatusFile))await writeJSON(coldStatusFile,restored.parsed);
  journal.cold.verified??={files:packet.files.length,fullLogicalWorkspaceEqual:true,propertyId:raw.property.id,revision:raw.property.revision,verifiedAt:now()};await save();
  // Re-export only this receiver's cold workspace. Its new local export is independently retained.
  if(!journal.cold.reexport){
   const before=await readJSON(join(cold,'workspace.json'));
   if(journal.cold.exportRequest){const added=before.exports.filter(e=>!journal.cold.exportRequest.before.includes(e.id));need(added.length===1,'PROPERTY_RECEIVING_COLD_EXPORT_PENDING');journal.cold.reexport=added[0];await save();}
   else{journal.cold.exportRequest={before:before.exports.map(e=>e.id),requestedAt:now()};await save();
    const result=await parsedOriginalCli(SOURCE_ROOT,cold,'action',['package.export']);journal.cold.reexport=result.parsed.result;await save();}
  }
  const coldPacket=await savedPackage(journal.cold.reexport.packageFile);
  need(same(logical(coldPacket.workspace),logical(packet.workspace))&&same(coldPacket.files,packet.files),'PROPERTY_RECEIVING_COLD_REEXPORT_CHANGED');
  for(const file of journal.cold.reexport.files)await copyOriginal(join(journal.cold.reexport.directory,file.name),join(customer,'cold','export',member(file.name)),file);
  journal.cold.reexportVerified=true;await save();
  const applicationState=await application(),fullHistory=await history();need(!applicationState.current?.active&&journal.runs.every(r=>r.closed),'PROPERTY_RECEIVING_FINAL_OWNER');
  const report=journal.reportBody??{schema:'stellar-forge.property-operations-receiving-report.v1',status:'COMPLETE',operationId:input.operationId,source:journal.source,
   workspace:{createdAt:input.expectedCreatedAt,propertyId:journal.propertyId,baselineEdition:input.baseline.editionId,baselineRows:input.baseline.expectedRows},
   originalCustomer:{customerId:input.paidDelivery.customerId,acquisitionId:input.paidDelivery.acquisitionId,snapshot:input.paidDelivery.snapshot,bytes:paid.bytes,sha256:paid.sha256,newPurchase:false},
   application:journal.application,release:journal.release,reopen:journal.reopen,
   runs:journal.runs.map(r=>({id:r.id,purpose:r.purpose,instanceId:r.ready?.instanceId,pid:r.ready?.pid,receiving:r.receiving,closure:r.closure})),
   nativeReceiving:{tools:22,completeDeclaredCatalog:true,allOriginalRecordsAndFiles:true,originalSourceQueries:journal.attached.query,
    nativeExport:journal.attached.nativeExport,merchantReceiving:journal.attached.receiving},
   cold:journal.cold,behavior:{newProviderCaptures:0,newPropertyVendorRequests:0,newPurchases:0,originalSdkBorrowers:true,originalApplicationsManager:true},
   browser:input.browser?{status:'COMPLETE',first:first.browser,reopened:second.browser}:{status:'NOT_SELECTED',meaning:'This invocation completed the original Applications, SDK, MCP and CLI workflow without opening a browser.'},completedAt:now()};
  journal.reportBody??=report;await save();
  await writeJSON(join(customer,'Property_Operations_Operation.json'),journal.reportBody);
  await writeJSON(join(customer,'application','application.json'),applicationState);await writeJSON(join(customer,'application','history.json'),{applicationId:journal.application.id,runs:fullHistory});
  await copyOriginal(join(SOURCE_ROOT,NATIVE,'INTERFACES.md'),join(customer,'Property_Operations_Interfaces.md'));
  await copyOriginal(join(SOURCE_ROOT,'operations/scf-property-operations-receiving-20261012/README.md'),join(customer,'Receiving.md'));
  journal.status='NATIVE_COMPLETE';journal.nativeReport={path:join(customer,'Property_Operations_Operation.json'),...await identity(join(customer,'Property_Operations_Operation.json'))};await save();
  await model.close();model=null;return await sealCustomer({journal,customer,output,save});
 }catch(error){primary=error;if(journal){journal.failures.push({...view(error),at:now()});journal.status=journal.freeze?'DELIVERY_PENDING':'INTERRUPTED';await save().catch(()=>{});}throw error;}
 finally{
  const errors=[];
  if(model&&journal){for(const run of journal.runs.filter(r=>!r.closed&&r.request)){try{
   if(closingRun)await closingRun(run);else{await model.applicationsStop({applicationId:journal.application.id,operationId:run.id});await poll(()=>model.applicationsOutput({applicationId:journal.application.id,operationId:run.id}),r=>!r.active&&!['PENDING','QUEUED','RUNNING'].includes(r.phase),{seconds:input.timeoutSeconds,label:'original cleanup'});}
  }catch(error){errors.push(error);}}
   try{await model.close();}catch(error){errors.push(error);}
  }
  process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);try{await lease.close();}catch(error){errors.push(error);}
  if(errors.length){if(primary)primary.closeErrors=errors.map(view);else throw new AggregateError(errors,'Original Property receiving cleanup remains incomplete.');}
 }
}
export async function main(args=process.argv.slice(2)){need(args.length===1,'PROPERTY_RECEIVING_USAGE','node run-receiving.mjs /absolute/receiving-input.json');
 const input=await readJSON(absolute(args[0]));const result=await receivePropertyOperations(input);console.log(JSON.stringify(result,null,2));return result;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({status:'INTERRUPTED',...view(error),closeErrors:error.closeErrors??[]},null,2));process.exitCode=1;});
