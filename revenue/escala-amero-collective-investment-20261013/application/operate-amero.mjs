#!/usr/bin/env node
// MIT. One original Amero commissioning course and its complete receiving continuation.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {
  need,hash,canonical,jsonBytes,directory,confined,writeExact,readJSON,
  fileDescriptor,verifyFile,copyDeclared,lease,syncDirectory,publicError,
} from './lib/files.mjs';
import {parseSourceJSON} from './lib/source-json.mjs';
import {assertExactNativeNumbers} from './lib/provider-auth.mjs';
import {openAmeroWorkspace,TABLES} from './lib/workspace.mjs';
import {captureAmeroSource,retainAmeroRuntime,verifyAmeroRuntime,restoreAmeroRuntime} from './lib/runtime.mjs';
import {exportAmeroWorkspace,inspectAmeroDelivery,receiveAmeroDelivery} from './lib/receiving.mjs';
import {streamAmeroDelivery,unpackAmeroDelivery} from './lib/archive.mjs';

const SCHEMA='amero.commissioning-course.v1';
const MAX_INPUT=96*1024*1024;
const PHASES=['01-source-runtime','02-producer-intake','03-provider-course',
 '04-book-decisions','05-original-report','06-producer-handover',
 '07-customer-receive','08-customer-continuation','09-customer-return',
 '10-independent-return','11-original-request-replay'];
const copy=x=>JSON.parse(JSON.stringify(x));
const equal=(a,b)=>canonical(a)===canonical(b);
const exactKeys=(value,allowed,required=[])=>{
 need(value&&typeof value==='object'&&!Array.isArray(value),'OBJECT_REQUIRED');
 need(Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),
  'INPUT_FIELDS_INVALID');
};
function normalizeInput(raw){
 exactKeys(raw,['schema','operationId','sourceDirectory','runtimeDirectory','nodeExecutable',
  'runtimeLicenseFiles','producerDirectory','customerDirectory','returnedDirectory',
  'sources','operations','captures','book','decisions','plans','customerActions','reportName'],
  ['schema','operationId','sourceDirectory','producerDirectory','customerDirectory',
   'returnedDirectory','sources','book']);
 need(raw.schema==='amero.commissioning-input.v1','INPUT_SCHEMA_REQUIRED');
 need(typeof raw.operationId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(raw.operationId),
  'OPERATION_ID_REQUIRED');
 for(const key of ['sourceDirectory','producerDirectory','customerDirectory','returnedDirectory'])
  need(path.isAbsolute(raw[key])&&path.resolve(raw[key])===raw[key],'ABSOLUTE_CANONICAL_PATH_REQUIRED');
 need(new Set([raw.producerDirectory,raw.customerDirectory,raw.returnedDirectory]).size===3,
  'THREE_INDEPENDENT_WORKSPACE_PATHS_REQUIRED');
 need(Array.isArray(raw.sources)&&Array.isArray(raw.decisions??[])&&
  Array.isArray(raw.operations??[])&&Array.isArray(raw.captures??[])&&
  Array.isArray(raw.customerActions??[])&&Array.isArray(raw.plans??[]),'COMPLETE_COURSE_ARRAYS_REQUIRED');
 const out=copy(raw);
 for(const source of out.sources){
  exactKeys(source,['key','file','sha256','bytes','filename','contentType','connectionAlias',
   'action','input','inputJSON','status','headers','bodyComplete','observedAt'],['key','file','sha256','bytes','connectionAlias','action','status','bodyComplete']);
  need(path.isAbsolute(source.file)&&/^[a-f0-9]{64}$/.test(source.sha256)&&
   Number.isSafeInteger(source.bytes)&&source.bytes>=0,'EXACT_ORIGINAL_SOURCE_REQUIRED');
  need(source.bodyComplete===true,'COMPLETE_ORIGINAL_SOURCE_REQUIRED');
 }
 for(const operation of out.operations??[]){
  exactKeys(operation,['key','connectionAlias','action','input','inputJSON','evidence','dispatch','reconcile'],
   ['key','connectionAlias','action','dispatch']);
  need(typeof operation.dispatch==='boolean'&&
    (operation.reconcile===undefined||typeof operation.reconcile==='boolean'),
    'EXPLICIT_OPERATION_SELECTION_REQUIRED');
 }
 for(const capture of out.captures??[]){
  exactKeys(capture,['key','connectionAlias','action','input','inputJSON','maxPages'],
   ['key','connectionAlias','action']);
 }
 for(const plan of out.plans??[]){
  exactKeys(plan,['key','definition','originalFileIds','preparations'],['key','definition']);
  need(Array.isArray(plan.originalFileIds??[])&&(plan.originalFileIds??[]).every(id=>typeof id==='string'&&id.length>0)&&new Set(plan.originalFileIds??[]).size===(plan.originalFileIds??[]).length,'PLAN_ORIGINAL_FILE_IDS_INVALID');
  need(Array.isArray(plan.preparations??[]),'PLAN_PREPARATIONS_REQUIRED');
  for(const preparation of plan.preparations??[]){
   exactKeys(preparation,['key','stage','disbursementVersionId','status'],['key','stage']);
   need(['create','instructions','status'].includes(preparation.stage),'PLAN_STAGE_INVALID');
  }
 }
 for(const step of out.customerActions??[]){
  exactKeys(step,['key','method','args'],['key','method','args']);
  need(['profile.update','book.save','link.save','reconciliation.create','report.create',
   'source.import','source.project','webhook.reconcile','plan.save','plan.prepare'].includes(step.method),
   'CUSTOMER_CONTINUATION_METHOD_REQUIRED');
 }
 for(const step of [...out.sources,...(out.operations??[]),...(out.captures??[])])need(!(Object.hasOwn(step,'input')&&Object.hasOwn(step,'inputJSON')),'INPUT_FORMS_EXCLUSIVE');
 const all=[...out.sources,...(out.operations??[]),...(out.captures??[]),
  ...(out.customerActions??[]),...(out.plans??[]),...(out.plans??[]).flatMap(plan=>plan.preparations??[])];
 need(all.every(v=>typeof v.key==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v.key))&&
  new Set(all.map(v=>v.key)).size===all.length,'UNIQUE_ORIGINAL_STEP_KEYS_REQUIRED');
 need(out.book&&typeof out.book==='object','ORIGINAL_BOOK_DEFINITION_REQUIRED');
 return out;
}
function requestId(input,label){return 'amero-'+hash(Buffer.from(canonical([input.operationId,label])));}
function catalog(workspace){
 const identity=workspace.describe().workspace;
 return {schema:'amero.course-catalog.v1',workspace:{id:identity.id,revision:identity.revision,head:identity.head},
  tables:Object.fromEntries(TABLES.map(table=>[table,workspace.privateList(table).map(row=>copy(row))]))};
}
function preserves(expected,workspace,{exact=false}={}){
 const actual=catalog(workspace);
 for(const table of TABLES){
  // Operational states may become uncertain/paused at an independent receive.
  if(['operations','attempts','captures','exports','resources','webhooks','streams'].includes(table))continue;
  const rows=new Map(actual.tables[table].map(row=>[row.id,row]));
  for(const row of expected.tables[table])need(rows.has(row.id)&&equal(rows.get(row.id),row),
   'ORIGINAL_RECORD_CHANGED',{table,id:row.id});
  if(exact)need(rows.size===expected.tables[table].length,'RECEIVED_RECORD_COUNT_CHANGED',{table});
 }
 return actual;
}
async function selectedJSON(file){
 const descriptor=await fileDescriptor(file);
 need(descriptor.bytes<=MAX_INPUT,'COMPLETE_INPUT_TOO_LARGE');
 const bytes=await fs.readFile(file);
 need(bytes.length===descriptor.bytes&&hash(bytes)===descriptor.sha256,'INPUT_CHANGED');
 return {descriptor,value:assertExactNativeNumbers(parseSourceJSON(bytes,{maxBytes:MAX_INPUT})),bytes};
}
export async function commissionAmero(input,{operationDirectory,configuration={},signal}={}){
 const selected=normalizeInput(input),inputBytes=jsonBytes(selected),inputSha256=hash(inputBytes);
 need(path.isAbsolute(operationDirectory),'ABSOLUTE_OPERATION_DIRECTORY_REQUIRED');
 need(inputBytes.length<=MAX_INPUT,'COMPLETE_INPUT_TOO_LARGE');
 await directory(operationDirectory);
 const owner=await lease(operationDirectory,'commissioning');
 const owned=new Set(),artifacts=new Map(),phaseValues={};
 const requestSelections=new Map();
 let completed=null,failure=null;
 async function retain(relative,value){
  const body=Buffer.isBuffer(value)?value:jsonBytes(value);
  need(body.length<=MAX_INPUT,'COMPLETE_ARTIFACT_TOO_LARGE');
  const file=await confined(operationDirectory,relative,true);
  await writeExact(file,body);
  const descriptor=await fileDescriptor(file,relative);
  artifacts.set(relative,descriptor);return descriptor;
 }
 async function adopt(descriptor){
  await verifyFile(operationDirectory,descriptor,{mode:true});
  await syncDirectory(path.dirname(await confined(operationDirectory,descriptor.path)));
  artifacts.set(descriptor.path,descriptor);
 }
 async function load(relative,optional=false){
  const file=await confined(operationDirectory,relative,true);
  const value=await readJSON(file,optional);if(value===null&&optional)return null;
  const descriptor=await fileDescriptor(file,relative);
  need(descriptor.bytes<=MAX_INPUT,'COMPLETE_ARTIFACT_TOO_LARGE');
  await adopt(descriptor);return value;
 }
 async function stage(name,run){
  need(PHASES.includes(name),'UNKNOWN_COURSE_PHASE');
  const relative='phases/'+name+'.json',prior=await load(relative,true);
  if(prior){
   need(prior.schema===SCHEMA&&prior.operationId===selected.operationId&&
    prior.inputSha256===inputSha256&&prior.name===name&&prior.status==='COMPLETE'&&
    Array.isArray(prior.artifacts),'PHASE_SELECTION_CHANGED');
   for(const descriptor of prior.artifacts)await adopt(descriptor);
   phaseValues[name]=prior.value;return prior.value;
  }
  signal?.throwIfAborted();
  const value=await run();
  const receipt={schema:SCHEMA,operationId:selected.operationId,inputSha256,name,status:'COMPLETE',
   value,artifacts:[...artifacts.values()].sort((a,b)=>a.path.localeCompare(b.path)),
   completedAt:new Date().toISOString()};
  await retain(relative,receipt);phaseValues[name]=value;
  process.stdout.write(JSON.stringify({phase:name,status:'COMPLETE'})+'\n');
  return value;
 }
 async function verifyPhaseOne(value){
  need(value.application?.directory===path.join(operationDirectory,'application')&&
   value.runtime?.directory===path.join(operationDirectory,'runtime'),'COURSE_SOURCE_PATH_CHANGED');
  const actualRoot=path.dirname(fileURLToPath(import.meta.url));
  for(const member of value.application.files){
   await verifyFile(value.application.directory,member,{mode:true});
   // This invocation must execute the identical selected full application.
   await verifyFile(actualRoot,member,{mode:true});
  }
  const runtime=await verifyAmeroRuntime({directory:value.runtime.directory,
   expectedManifestSha256:value.runtime.manifestSha256});
  need(runtime.id===value.runtime.id,'COURSE_RUNTIME_CHANGED');
  return value;
 }

 async function open(root,config=configuration){
  const workspace=await openAmeroWorkspace({directory:root,connections:config.connections??{},
   sourceDirectory:phaseValues['01-source-runtime'].application.directory,
   runtimeDirectory:phaseValues['01-source-runtime'].runtime.directory,
   expectedManifestSha256:phaseValues['01-source-runtime'].runtime.manifestSha256});
  owned.add(workspace);return workspace;
 }
 async function close(workspace){if(!workspace)return;await workspace.close();owned.delete(workspace);}
 async function command(workspace,label,method,args){
  const relative='requests/'+hash(label),semantic=hash(Buffer.from(canonical({method,args})));
  let original=await load(relative+'/request.json',true);
  if(original)need(original.semanticSha256===semantic&&original.method===method&&equal(original.args,args),
   'ORIGINAL_REQUEST_CHANGED',{label});
  else{
   original={requestId:requestId(selected,label),method,args:copy(args),
    expectedRevision:workspace.describe().workspace.revision,semanticSha256:semantic};
   await retain(relative+'/request.json',original);
  }
  requestSelections.set(label,original);
  let expected=original.expectedRevision;
  for(let attempt=0;attempt<4;attempt++){
   try{
    const returned=await workspace.command({requestId:original.requestId,
     expectedRevision:expected,method:original.method,args:original.args,signal});
    await retain(relative+'/observations/'+hash(jsonBytes(returned))+'.json',returned);
    const prior=await load(relative+'/accepted.json',true);
    if(prior)need(equal(prior,returned),'ACCEPTED_REQUEST_RESULT_CHANGED');
    else await retain(relative+'/accepted.json',returned);
    return returned.result;
   }catch(error){
    const observation={code:error.code??error.name,details:error.details??null,
     expectedRevision:expected,at:new Date().toISOString()};
    await retain(relative+'/observations/'+hash(jsonBytes(observation))+'.json',observation);
    if(error.code!=='REVISION_CONFLICT')throw error;
    expected=workspace.describe().workspace.revision;
   }
  }
  throw Object.assign(new Error('Original revision remains contested.'),{code:'REVISION_CONFLICT'});
 }
 async function frozenCatalog(label,workspace){
  const relative='catalogs/'+label+'.json',prior=await load(relative,true);
  if(prior){preserves(prior,workspace);return prior;}
  const value=catalog(workspace);await retain(relative,value);return value;
 }
 async function delivery(workspace,label){
  const directoryName=path.join(operationDirectory,'deliveries',label);
  const exported=await command(workspace,label+'.export','workspace.export',{destination:directoryName});
  const inspected=await inspectAmeroDelivery({sourceDirectory:directoryName,
   expectedManifestSha256:exported.manifestSha256});
  const {DatabaseSync}=await import('node:sqlite');
  const database=new DatabaseSync(path.join(directoryName,'workspace/workspace.sqlite'),{readOnly:true});
  let snapshot;
  try{
   const meta=key=>JSON.parse(database.prepare('SELECT value FROM meta WHERE key=?').get(key).value);
   snapshot={schema:'amero.course-catalog.v1',
    workspace:{id:meta('identity').id,revision:meta('revision'),head:meta('head')},
    tables:Object.fromEntries(TABLES.map(table=>[table,database.prepare(
     'SELECT document FROM records WHERE table_name=? ORDER BY sequence,id').all(table).map(row=>JSON.parse(row.document))]))};
   need(snapshot.workspace.id===inspected.manifest.workspaceId&&
    snapshot.workspace.revision===inspected.manifest.sourceRevision&&
    snapshot.workspace.head===inspected.manifest.sourceHead,'ARCHIVE_SNAPSHOT_CHANGED');
  }finally{database.close();}
  await retain('catalogs/'+label+'-archive.json',snapshot);
  const archive=path.join(operationDirectory,'archives',label+'.tar.gz');
  await directory(path.dirname(archive));
  let descriptor;
  try{descriptor=await fileDescriptor(archive);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!descriptor){
   const selectedArchive=await streamAmeroDelivery({sourceDirectory:directoryName,
    expectedManifestSha256:exported.manifestSha256,signal});
   const {pipeline}=await import('node:stream/promises');
   const {createWriteStream}=await import('node:fs');
   const temporary=archive+'.pending';
   try{await fs.lstat(temporary);await fs.rename(temporary,temporary+'.interrupted-'+randomUUID());}
   catch(error){if(error.code!=='ENOENT')throw error;}
   try{
    const output=createWriteStream(temporary,{flags:'wx',mode:0o600});
    await pipeline(selectedArchive,output,{signal});
    const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
    await fs.link(temporary,archive);await fs.unlink(temporary);await syncDirectory(path.dirname(archive));
   }catch(error){
    selectedArchive.destroy(error);throw error;
   }
   descriptor=await fileDescriptor(archive);
  }
  // A complete independent unpack proves the actual retained archive population.
  const unpacked=path.join(operationDirectory,'archive-checks',label);
  const {createReadStream}=await import('node:fs');
  const archiveInput=createReadStream(archive);
  await unpackAmeroDelivery({input:archiveInput,destination:unpacked,
   expectedManifestSha256:exported.manifestSha256,signal});
  await inspectAmeroDelivery({sourceDirectory:unpacked,expectedManifestSha256:exported.manifestSha256});
  const result={export:exported,manifest:inspected.manifest,
   archive:{...descriptor,path:archive},snapshot,unpacked};
  await retain('deliveries/'+label+'-selection.json',result);return result;
 }
 async function receive(label,selection,destination){
  const result=await receiveAmeroDelivery({sourceDirectory:selection.unpacked,destination,
   requestId:requestId(selected,label),expectedManifestSha256:selection.export.manifestSha256,signal});
  await retain('receives/'+label+'/observations/'+hash(jsonBytes(result))+'.json',result);
  const acceptance=await load('receives/'+label+'/accepted.json',true);
  const stable=value=>{const out=copy(value);delete out.replayed;return out;};
  if(acceptance)need(equal(stable(result),stable(acceptance)),'ORIGINAL_RECEIVE_RESULT_CHANGED');
  else await retain('receives/'+label+'/accepted.json',result);
  return acceptance??result;
 }
 async function adoptComplete(record){
  need(record.schema===SCHEMA&&record.operationId===selected.operationId&&
   record.inputSha256===inputSha256&&record.status==='COMPLETE'&&
   equal(record.phases,PHASES),'COMPLETED_COURSE_CHANGED');
  for(const name of PHASES){
   const receipt=await load('phases/'+name+'.json');
   need(receipt.schema===SCHEMA&&receipt.operationId===selected.operationId&&
    receipt.inputSha256===inputSha256&&receipt.name===name&&receipt.status==='COMPLETE',
    'COMPLETED_PHASE_CHANGED');
   for(const descriptor of receipt.artifacts)await adopt(descriptor);
   phaseValues[name]=receipt.value;
  }
  for(const descriptor of record.artifacts)await adopt(descriptor);
  await verifyPhaseOne(phaseValues['01-source-runtime']);
  const original=phaseValues['06-producer-handover'],returned=phaseValues['09-customer-return'];
  need(equal(record.courseBasis,phaseValues['04-book-decisions'].courseBasis)&&equal(record.source,phaseValues['01-source-runtime'])&&
   record.producerReport===phaseValues['05-original-report'].report.id&&
   equal(record.producerArchive,original.archive)&&equal(record.customerReturnArchive,returned.archive),
   'COMPLETED_COURSE_BASIS_CHANGED');
  for(const chosen of [original,returned]){
   const descriptor=await fileDescriptor(chosen.archive.path);
   need(descriptor.sha256===chosen.archive.sha256&&descriptor.bytes===chosen.archive.bytes,
    'COMPLETED_ARCHIVE_CHANGED');
   const inspected=await inspectAmeroDelivery({sourceDirectory:chosen.unpacked,
    expectedManifestSha256:chosen.export.manifestSha256});
   need(inspected.manifest.workspaceId===chosen.snapshot.workspace.id&&
    inspected.manifest.sourceRevision===chosen.snapshot.workspace.revision&&
    inspected.manifest.sourceHead===chosen.snapshot.workspace.head,'COMPLETED_ARCHIVE_BASIS_CHANGED');
  }
  const roots=[selected.producerDirectory,path.join(selected.customerDirectory,'workspace'),
   path.join(selected.returnedDirectory,'workspace')];
  const snapshots=[phaseValues['05-original-report'].catalog,
   phaseValues['08-customer-continuation'].catalog,phaseValues['10-independent-return'].catalog];
  for(let i=0;i<roots.length;i++){
   const workspace=await open(roots[i]);
   need(workspace.describe().workspace.id===record.workspaces[i].id,'COMPLETED_WORKSPACE_CHANGED');
   preserves(snapshots[i],workspace);await close(workspace);
  }
  return record;
 }
 try{
  await retain('input.json',inputBytes);
  completed=await load('complete.json',true);
  if(completed)return await adoptComplete(completed);
  await stage('01-source-runtime',async()=>{
   const application=await captureAmeroSource({sourceDirectory:selected.sourceDirectory,
    destination:path.join(operationDirectory,'application')});
   const runtime=selected.runtimeDirectory?
    await restoreAmeroRuntime({sourceDirectory:selected.runtimeDirectory,
     destination:path.join(operationDirectory,'runtime'),expectedManifestSha256:configuration.expectedManifestSha256}):
    await retainAmeroRuntime({directory:path.join(operationDirectory,'runtime'),
     nodeExecutable:selected.nodeExecutable,licenseFiles:selected.runtimeLicenseFiles??[]});
   return {application:{...application,directory:path.join(operationDirectory,'application')},
    runtime:{id:runtime.id,manifestSha256:runtime.manifestSha256,
    directory:runtime.directory,nodeExecutable:runtime.nodeExecutable}};
  });
  await verifyPhaseOne(phaseValues['01-source-runtime']);
  const producer=await open(selected.producerDirectory);
  await stage('02-producer-intake',async()=>{
   const rows=[];
   for(const source of selected.sources){
    const descriptor=await fileDescriptor(source.file);
    need(descriptor.sha256===source.sha256&&descriptor.bytes===source.bytes,'ORIGINAL_SOURCE_CHANGED');
    const raw=await fs.readFile(source.file);
    need(raw.length===source.bytes&&hash(raw)===source.sha256,'ORIGINAL_SOURCE_CHANGED');
    const retained=await producer.retainFile(raw,{filename:source.filename??path.basename(source.file),
     contentType:source.contentType??'application/json',private:true});
    const result=await command(producer,'source.'+source.key,'source.import',{
     fileId:retained.id,connectionAlias:source.connectionAlias,action:source.action,...(source.inputJSON!==undefined?{inputJSON:source.inputJSON}:{input:source.input??{}}),
     status:source.status,headers:source.headers??{},bodyComplete:source.bodyComplete,
     ...(source.observedAt?{observedAt:source.observedAt}:{})});
    rows.push(result);
   }
   return {sources:rows,catalog:catalog(producer)};
  });
  await stage('03-provider-course',async()=>{
   const operations=[],captures=[];
   for(const item of selected.operations??[]){
    const prepared=await command(producer,'prepare.'+item.key,'operation.prepare',{
     connectionAlias:item.connectionAlias,action:item.action,...(item.inputJSON!==undefined?{inputJSON:item.inputJSON}:{input:item.input??{}}),
     ...(item.evidence?{evidence:item.evidence}:{})});
    let outcome=null,reconciliation=null;
    if(item.dispatch){
     need(configuration.allowDispatch===true,'SELECTED_PROVIDER_DISPATCH_NOT_ENABLED');
     if(prepared.request.mutation)await command(producer,'enable-selected-dispatch','delivery.configure',{enabled:true});
     outcome=await command(producer,'dispatch.'+item.key,'operation.dispatch',{operationId:prepared.id});
     if(item.reconcile)reconciliation=await command(producer,'reconcile.'+item.key,
      'operation.reconcile',{operationId:prepared.id});
    }
    operations.push({prepared,outcome,reconciliation});
   }
   for(const item of selected.captures??[]){
    const capture=await command(producer,'capture.'+item.key,'capture.start',{
     connectionAlias:item.connectionAlias,action:item.action,...(item.inputJSON!==undefined?{inputJSON:item.inputJSON}:{input:item.input??{}})});
    let result=capture;
    for(let batch=0;batch<10000;batch++){
     const current=producer.privateItem('captures',capture.id);
     need(current.id===capture.id&&current.connectionAlias===capture.connectionAlias&&
      current.action===capture.action&&equal(current.input,capture.input)&&
      equal(current.connection,capture.connection)&&
      result.pages.every((page,index)=>equal(current.pages[index],page)),
      'ORIGINAL_CAPTURE_SELECTION_CHANGED');
     if(current.status==='COMPLETE'){result=current;break;}
     const label=batch===0?'capture-run.'+item.key:'capture-continue.'+item.key+'.'+batch;
     const previous=await load('requests/'+hash(label)+'/accepted.json',true);
     result=await command(producer,label,'capture.run',{
      captureId:capture.id,maxPages:item.maxPages??1000});
     const observed=producer.privateItem('captures',capture.id);
     need(result.pages.every((page,index)=>equal(observed.pages[index],page)),
      'ORIGINAL_CAPTURE_PAGE_HISTORY_CHANGED');
     if(observed.status==='COMPLETE'){result=observed;break;}
     // A previously accepted bounded/partial response remains exact. On an
     // explicit later invocation a new frozen command continues this capture.
     // A newly observed failed page stops this invocation instead of retrying.
     if(!previous&&['PARTIAL','PAUSED'].includes(result.status))need(false,'ORIGINAL_CAPTURE_NOT_COMPLETE',{
      captureId:capture.id,status:result.status,error:result.error});
    }
    need(result.status==='COMPLETE','ORIGINAL_CAPTURE_NOT_COMPLETE',{captureId:capture.id,status:result.status});
    captures.push(result);
   }
   return {operations,captures,catalog:catalog(producer)};
  });
  const selectedOriginalSources=new Set([
   ...phaseValues['02-producer-intake'].sources.map(row=>row.id),
   ...phaseValues['03-provider-course'].operations.flatMap(row=>row.outcome?.sourceIds??[]),
   ...phaseValues['03-provider-course'].operations.flatMap(row=>row.reconciliation?.reconciliation?.sourceIds??[]),
   ...phaseValues['03-provider-course'].captures.flatMap(row=>row.pages.map(page=>page.sourceId))]);
  const courseVersions=producer.privateList('resourceVersions').filter(row=>
   selectedOriginalSources.has(row.sourceId)&&row.environment===selected.book.environment&&
   Object.values(selected.book.connections).flat().includes(row.connectionAlias)&&
   (/^escala-(fund|contribution|proposal|vote|tally|milestone|evidence|attestation|disbursement)/.test(row.kind)||
    ['sdp-disbursement','sdp-payment','sdp-distribution-wallet'].includes(row.kind)));
  need(courseVersions.length,'ORIGINAL_COLLECTIVE_INVESTMENT_SOURCE_REQUIRED');
  const courseBasis={sourceIds:[...new Set(courseVersions.map(row=>row.sourceId))],
   versionIds:courseVersions.map(row=>row.id),modes:[...new Set(courseVersions.map(row=>row.context?.apiMode??'unknown'))],
   interpretation:'Published mock observations prove application behavior only; provider and operator-supplied records retain their original scope. Completion is not payment authorization.'};
  const book=await stage('04-book-decisions',async()=>{
   const row=await command(producer,'original-book','book.save',{definition:selected.book});
   const decisions=[];
   for(let i=0;i<(selected.decisions??[]).length;i++)decisions.push(await command(producer,
    'original-decision-'+i,'link.save',{bookVersionId:row.id,decision:selected.decisions[i]}));
   const plans=[];
   for(const item of selected.plans??[]){
    const plan=await command(producer,'original-plan.'+item.key,'plan.save',{bookVersionId:row.id,definition:item.definition,...(item.originalFileIds?{originalFileIds:item.originalFileIds}:{})});
    for(const file of plan.files){
     const raw=await producer.fileBytes(file.id);
     need(raw.length===file.bytes&&hash(raw)===file.sha256,'PLAN_FILE_CHANGED');
     await retain('plans/'+item.key+'/'+file.filename,raw);
    }
    const preparations=[];
    for(const preparation of item.preparations??[]){
     const {key,...args}=preparation;
     preparations.push(await command(producer,'plan-preparation.'+key,'plan.prepare',{planId:plan.id,...args}));
    }
    plans.push({plan,preparations});
   }
   return {book:row,decisions,plans,courseBasis,catalog:catalog(producer)};
  });
  await stage('05-original-report',async()=>{
   const result=await command(producer,'original-reconciliation','reconciliation.create',{
    bookVersionId:book.book.id,name:selected.reportName??'Amero original treasury and disbursement reconciliation'});
   const report=await command(producer,'original-report','report.create',{reconciliationId:result.id});
   for(const file of report.files){
    const raw=await producer.fileBytes(file.id);
    need(raw.length===file.bytes&&hash(raw)===file.sha256,'REPORT_FILE_CHANGED');
    await retain('reports/original/'+file.filename,raw);
   }
   return {reconciliation:result,report,catalog:catalog(producer)};
  });
  const exported=await stage('06-producer-handover',()=>delivery(producer,'producer'));
  const customerReceipt=await stage('07-customer-receive',async()=>{
   const result=await receive('customer',exported,selected.customerDirectory);
   const workspace=await open(result.workspace.directory);
   const actual=preserves(exported.snapshot,workspace,{exact:workspace.describe().workspace.revision===result.workspace.revision});
   await close(workspace);return {result,catalog:actual};
  });
  const customer=await open(customerReceipt.result.workspace.directory);
  await stage('08-customer-continuation',async()=>{
   const baseline=await frozenCatalog('customer-before',customer);
   preserves(exported.snapshot,customer);
   const results=[];
   for(const step of selected.customerActions??[])
    results.push(await command(customer,'customer.'+step.key,step.method,step.args));
   return {baseline,results,catalog:catalog(customer)};
  });
  const returned=await stage('09-customer-return',()=>delivery(customer,'customer-return'));
  const final=await stage('10-independent-return',async()=>{
   const result=await receive('returned',returned,selected.returnedDirectory);
   const workspace=await open(result.workspace.directory);
   const actual=preserves(returned.snapshot,workspace,{exact:workspace.describe().workspace.revision===result.workspace.revision});
   const original=phaseValues['05-original-report'];
   need(equal(workspace.privateItem('reconciliations',original.reconciliation.id),original.reconciliation)&&
    equal(workspace.privateItem('reports',original.report.id),original.report),'ORIGINAL_REPORT_HISTORY_CHANGED');
   await close(workspace);return {result,catalog:actual};
  });
  await stage('11-original-request-replay',async()=>{
   const before=catalog(customer),request=await load('requests/'+hash('original-book')+'/request.json');
   const returned=await customer.command({requestId:request.requestId,method:request.method,
    args:request.args,expectedRevision:request.expectedRevision,signal});
   const accepted=await load('requests/'+hash('original-book')+'/accepted.json');
   const originalResult=value=>{const result=copy(value);result.workspaceId=result.originalWorkspaceId??result.workspaceId;
    delete result.originalWorkspaceId;return result;};
   need(returned.workspaceId===customer.describe().workspace.id&&equal(originalResult(returned),originalResult(accepted)),
    'ORIGINAL_REQUEST_REPLAY_CHANGED');
   const after=catalog(customer);need(equal(before,after),'ORIGINAL_REPLAY_CHANGED_LATER_CUSTOMER_WORK');
   return {originalRequest:request,accepted,customer:after.workspace};
  });
  const workspaceIdentities=[producer.describe().workspace,customer.describe().workspace,final.catalog.workspace];
  await close(customer);await close(producer);
  completed={schema:SCHEMA,operationId:selected.operationId,inputSha256,status:'COMPLETE',
   phases:PHASES,workspaces:workspaceIdentities,courseBasis:book.courseBasis,
   source:phaseValues['01-source-runtime'],producerReport:phaseValues['05-original-report'].report.id,
   producerArchive:exported.archive,customerReturnArchive:returned.archive,
   artifacts:[...artifacts.values()].sort((a,b)=>a.path.localeCompare(b.path)),
   closedAt:new Date().toISOString(),lifetimes:'CLOSED'};
  // First completion and later adoption share the exact same complete basis.
  await adoptComplete(completed);
  await retain('complete.json',completed);
  return completed;
 }catch(error){failure=error;throw error;}
 finally{
  const errors=[];
  for(const workspace of [...owned])try{await close(workspace);}catch(error){errors.push(error);}
  if(errors.length){
   await retain('closure-errors/'+hash(jsonBytes(errors.map(publicError)))+'.json',errors.map(publicError));
   // Keep the operation lease owned until every acquired store closes.
   throw new AggregateError([...(failure?[failure]:[]),...errors],'Amero course resources remain unclosed.');
  }
  await owner.release();
 }
}
function flags(argv){
 const result={};for(let i=0;i<argv.length;i+=2){
  need(argv[i].startsWith('--')&&argv[i+1]!==undefined,'ARGUMENT_REQUIRED');
  need(!Object.hasOwn(result,argv[i].slice(2)),'DUPLICATE_ARGUMENT');
  result[argv[i].slice(2)]=argv[i+1];
 }return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const options=flags(process.argv.slice(2)),controller=new AbortController();
 const stop=()=>controller.abort(new Error('Commissioning interrupted.'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  need(options.input&&options.output,'INPUT_AND_OUTPUT_REQUIRED');
  const input=(await selectedJSON(path.resolve(options.input))).value;
  const configuration=options.configuration?(await selectedJSON(path.resolve(options.configuration))).value:{};
  const result=await commissionAmero(input,{operationDirectory:path.resolve(options.output),
   configuration,signal:controller.signal});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }catch(error){
  process.stderr.write(JSON.stringify({error:publicError(error)},null,2)+'\n');process.exitCode=1;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
