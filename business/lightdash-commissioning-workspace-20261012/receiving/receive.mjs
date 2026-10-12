// One original application/dbt/Lightdash receiving operation; all prior work is retained.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {readFile,mkdir,realpath,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {CommissioningWorkspace} from '../workspace.mjs';
import {createWorkspaceServer} from '../server.mjs';
import {createHandover,inspectHandover} from '../packaging.mjs';
import * as engine from '../native/index.mjs';
import {receivingLease,inheritReceiving} from '../native/lease.mjs';
import {check,readJson,saveJson,fileIdentity,verifyManifest,inventory,objectDigest,digest,scrub,safeRelative,durable} from '../native/files.mjs';
import {normalizeConnection,UPSTREAM} from '../native/contract.mjs';
import {verifyExample,RECEIVING_SCHEMA} from './prepare.mjs';
import {expectedSales,compareNativeSales,csvRows,MODEL,CHART,CHART_SLUG} from './fixture.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),APP=path.dirname(HERE);
const {values}=parseArgs({options:{input:{type:'string'},'input-sha256':{type:'string'}}});
check(values.input&&values['input-sha256'],'LIGHTDASH_RECEIVING_INPUT','Use the prepared original input and exact SHA256 through receiving/host.py.');
const inputBytes=await readFile(values.input),inputSha256=digest(inputBytes),input=JSON.parse(inputBytes);
check(inputSha256===values['input-sha256']&&input.schema===RECEIVING_SCHEMA&&input.appRoot===APP,'LIGHTDASH_RECEIVING_INPUT','Original receiving selection or source root changed.');
const lease=receivingLease();check(lease&&lease.identity.operationId===input.operationId&&lease.identity.inputSha256===inputSha256,'LIGHTDASH_RECEIVING_LEASE','Run this complete receiver under its original prepared host lease.');
const output=input.outputDirectory,workspaceDirectory=path.join(output,'workspace'),journalFile=path.join(output,'receiving-state.json'),resultFile=path.join(output,'receiving-result.json');
check(await realpath(output)===output,'LIGHTDASH_RECEIVING_OUTPUT','Receiving output changed its filesystem identity.');
const selectedSecrets=[process.env[input.connection.tokenEnv],input.connection.proxyAuthorizationEnv?process.env[input.connection.proxyAuthorizationEnv]:null,...Object.values(input.connection.environment??{}).map(k=>process.env[k])].filter(Boolean);
const errorRecord=e=>scrub({name:e.name,code:e.code??null,message:String(e.message??e),details:e.details??null},selectedSecrets);
const now=()=>new Date().toISOString();
let state=await readJson(journalFile,{optional:true})??{schema:'lightdash-commissioning.receiving-state.v1',operationId:input.operationId,inputSha256,startedAt:now(),stages:{},events:[],lostExecute:null};
check(state.operationId===input.operationId&&state.inputSha256===inputSha256,'LIGHTDASH_RECEIVING_INPUT','The original receiving journal names another input.');
let workspace=null,service=null,browser=null,page=null,stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const same=(a,b)=>objectDigest(a)===objectDigest(b);
async function save(){await saveJson(journalFile,state);}
async function event(kind,details={}){state.events.push({at:now(),kind,...details});await save();console.log(JSON.stringify({operationId:input.operationId,kind,...details}));}
function stableId(key){const bytes=createHash('sha256').update(input.operationId+'\0'+key).digest();bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.subarray(0,16).toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
async function stage(name,{selection,recover,run}){
 check(!stopping,'LIGHTDASH_RECEIVING_STOPPING','The original whole receiving is stopping.');
 let item=state.stages[name];
 if(item?.state==='COMPLETE')return item.result;
 if(!item){item={state:'PREPARED',preparedAt:now(),selection:await selection()};state.stages[name]=item;await save();}
 const recovered=recover?await recover(item.selection):null;
 if(recovered!==null&&recovered!==undefined){item.result=recovered;item.state='COMPLETE';item.completedAt=now();item.recovered=true;await event('STAGE_RECOVERED',{stage:name});return recovered;}
 await event('STAGE_STARTED',{stage:name});
 try{const value=await run(item.selection);item.result=value;item.state='COMPLETE';item.completedAt=now();await event('STAGE_COMPLETE',{stage:name});return value;}
 catch(error){item.error=errorRecord(error);item.state='INCOMPLETE';item.lastFailedAt=now();await event('STAGE_INCOMPLETE',{stage:name,error:item.error});throw error;}
}
async function originalOperation(id){try{return workspace.operation(id);}catch(e){if(e.code==='OPERATION_NOT_FOUND')return null;throw e;}}
async function uiReady(view){
 await page.goto(service.url,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#workspace-revision')?.textContent.startsWith('Revision '));
 if(view)await page.locator('[data-view="'+view+'"]').click();
}
async function uiPost(route,click){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname===route&&r.request().method()==='POST');
 await click();const result=await response,data=await result.json();check(result.ok(),'LIGHTDASH_WORKSPACE_HTTP','Original workspace action did not succeed.',{status:result.status(),error:data.error??null});return data;
}
async function waitOperation(id){
 const deadline=Date.now()+input.operationTimeoutMs;let last=null;
 for(;;){
  check(!stopping,'LIGHTDASH_RECEIVING_STOPPING','Receiving stopped while its original native operation drains.');
  let op=workspace.operation(id);
  if(op.status!==last){last=op.status;await event('NATIVE_STATE',{nativeOperationId:id,action:op.action,state:op.status});}
  if(op.status==='SUCCEEDED')return op;
  if(Date.now()>deadline)check(false,'LIGHTDASH_RECEIVING_WAIT','The original operation remains incomplete; resume this same receiving input.',{nativeOperationId:id,state:op.status});
  if(workspace.inflight.has(id)){try{await workspace.inflight.get(id);}catch{}continue;}
  const inspected=await workspace.execute(id,{inspect:true});op=inspected.operation;
  if(op.status==='SUCCEEDED')return op;
  if(op.status==='PLANNED'){await workspace.execute(id);continue;}
  if(['RUNNING','BUSY'].includes(op.status)){await pause(2000);continue;}
  check(false,'LIGHTDASH_NATIVE_RECEIVING','The original native action needs its retained recovery before receiving can continue.',{nativeOperationId:id,action:op.action,state:op.status,error:op.nativeResult?.error??op.lastError??null,recovery:op.nativeResult?.recovery??null});
 }
}
async function native(name,action,editionId,operationInput={},options={}){
 const operationId=stableId('native:'+name);
 return stage('native:'+name,{
  selection:async()=>({operationId,action,editionId,input:operationInput}),
  recover:async selected=>{
   const old=await originalOperation(selected.operationId);if(!old)return null;
   check(old.action===selected.action&&old.editionId===selected.editionId&&same(old.input,selected.input),'LIGHTDASH_RECEIVING_OPERATION','Original native input changed.');
   if(old.status==='SUCCEEDED')return old;
   if(old.status!=='PLANNED')return waitOperation(old.id);
   return null;
  },
  run:async selected=>{
   let op=await originalOperation(selected.operationId);
   if(!op){
    if(options.browser){
     await uiReady('operations');await page.locator('#operation-edition').selectOption(selected.editionId);await page.locator('#operation-action').selectOption(selected.action);
     await page.locator('#operation-id').fill(selected.operationId);await page.locator('#operation-input').fill(JSON.stringify(selected.input,null,2));
     op=(await uiPost('/api/plan',()=>page.locator('#operation-plan button[type="submit"]').click())).operation;
    }else op=(await workspace.plan(selected,workspace.metadata().revision)).operation;
   }
   if(options.dropExecuteReply&&!state.lostExecute?.aborted){
    if(!options.browser)await uiReady('operations');
    await page.locator('#operations').getByRole('button',{name:op.id,exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('#operation-title')?.textContent===id,op.id);
    state.lostExecute={operationId:op.id,requestSha256:op.requestSha256,state:'PREPARED',preparedAt:now()};await save();
    let resolve,reject;const accepted=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const handler=async route=>{
     const body=route.request().postDataJSON();if(body.operationId!==op.id){await route.continue();return;}
     try{const response=await route.fetch(),body=await response.json();check(response.status()===202&&body.operationId===op.id,'LIGHTDASH_RECEIVING_HTTP','Original execute did not accept the selected operation.');
      state.lostExecute={...state.lostExecute,state:'ACCEPTED',response:body,acceptedAt:now()};await save();
      await route.abort('failed');state.lostExecute={...state.lostExecute,aborted:true};await save();resolve();
     }catch(error){reject(error);throw error;}
    };
    await page.route('**/api/execute',handler);
    try{await page.locator('#run-operation').click();await accepted;}
    finally{await page.unroute('**/api/execute',handler);}
   }else await workspace.execute(op.id);
   const result=await waitOperation(op.id);
   if(state.lostExecute?.operationId===op.id){state.lostExecute={...state.lostExecute,recoveredFromOriginalOperation:true,finalState:result.status};await save();}
   return result;
  }
 });
}
async function exportSelection(op,role){
 const item=op.nativeResult?.contentExports?.find(x=>x.role===role);check(item,'LIGHTDASH_NATIVE_CONTENT','The original operation lacks the selected completed native export.',{nativeOperationId:op.id,role});
 await verifyManifest(item);
 return {directory:item.directory,manifestFile:item.manifestFile,manifestSha256:item.manifestSha256,sourceProjectUuid:item.sourceProjectUuid,sourceOperationId:op.id};
}
async function editionContent(editionId,subdirectory){
 const edition=await workspace.nativeEdition(editionId),directory=path.join(edition.directory,safeRelative(subdirectory)),files=await inventory(directory);
 const manifestFile=path.join(output,'content-selections',editionId+'-'+digest(subdirectory).slice(0,12)+'.json');
 await saveJson(manifestFile,{schema:'lightdash-commissioning.edition-content.v1',sourceEditionId:editionId,sourceProjectUuid:input.connection.projectUuid,sourceSha256:edition.sourceSha256,files},{createOnly:true});
 return {directory,manifestFile,manifestSha256:(await fileIdentity(manifestFile)).sha256,sourceProjectUuid:input.connection.projectUuid,sourceEditionId:editionId};
}
function editNativeChart(value){
 check(value&&value.slug===CHART_SLUG&&value.tableName==='regional_sales'&&value.spaceSlug==='jaffle-shop','LIGHTDASH_NATIVE_CHART','Native chart identity differs from the original source.');
 check(same(value.metricQuery.dimensions,['regional_sales_sale_date_month','regional_sales_region']),'LIGHTDASH_NATIVE_CHART','Native chart source dimensions changed.');
 const addMetrics=values=>{check(Array.isArray(values)&&values.includes('regional_sales_total_revenue'),'LIGHTDASH_NATIVE_CHART','Original chart lost its revenue metric.');const remaining=values.filter(x=>!['regional_sales_total_units','regional_sales_revenue_per_unit'].includes(x)),at=remaining.indexOf('regional_sales_total_revenue');remaining.splice(at+1,0,'regional_sales_total_units','regional_sales_revenue_per_unit');return remaining;};
 const after={...value,name:'Monthly Regional Revenue, Volume and Unit Yield',description:'Monthly revenue in USD, units sold and weighted USD per unit by region, with revenue share of the selected period and each month.',metricQuery:{...value.metricQuery,metrics:addMetrics(value.metricQuery.metrics)},tableConfig:{...value.tableConfig,columnOrder:addMetrics(value.tableConfig.columnOrder)}};
 check(same(after.metricQuery.tableCalculations,value.metricQuery.tableCalculations)&&same(after.pivotConfig,value.pivotConfig),'LIGHTDASH_NATIVE_CHART','Original native calculations or pivot changed.');
 return after;
}
async function candidateFiles(exported){
 const verified=await verifyManifest(exported),yaml=createRequire(input.connection.runtime.cliEntry)('js-yaml'),files=[];
 files.push({path:MODEL,content:await readFile(path.join(HERE,'candidate','regional_sales.yml'),'utf8')});
 files.push({path:CHART,content:await readFile(path.join(HERE,'candidate','regional-sales-total-row-total-demo.yml'),'utf8')});
 let changed=0,nativeChartPath=null;
 for(const item of verified.files){
  const bytes=await readFile(path.join(exported.directory,item.path));
  let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{check(false,'LIGHTDASH_NATIVE_CONTENT','Original core content contains a non-text asset that needs explicit complete source intake.',{path:item.path});}
  check(!content.includes('\0'),'LIGHTDASH_NATIVE_CONTENT','Original native content contains a binary file.',{path:item.path});
  if(/\.ya?ml$/i.test(item.path)){
   const value=yaml.load(content);if(value&&typeof value==='object'&&value.slug===CHART_SLUG&&value.tableName==='regional_sales'){
    content=yaml.dump(editNativeChart(value),{noRefs:true,lineWidth:-1,sortKeys:false});changed++;nativeChartPath='commissioning-content/'+item.path;
   }
  }
  files.push({path:'commissioning-content/'+item.path,content});
 }
 check(changed===1,'LIGHTDASH_NATIVE_CHART','The original complete export must contain exactly one regional sales chart.');
 return {files:files.map(f=>({...f,bytes:Buffer.byteLength(f.content),sha256:digest(f.content)})),nativeChartPath,sourceExport:exported};
}
async function writeDraftFile(file,draftId,useBrowser){
 const key='draft-file:'+digest(file.path).slice(0,24);
 return stage(key,{
  selection:async()=>({path:file.path,sha256:file.sha256,bytes:file.bytes,draftId}),
  recover:async selected=>{
   check(workspace.metadata().draft.id===selected.draftId,'LIGHTDASH_DRAFT_CHANGED','The original receiving draft is no longer selected.');
   try{const saved=await workspace.readSource({draft:true,path:selected.path});return saved.sha256===selected.sha256?{path:selected.path,sha256:saved.sha256,bytes:saved.bytes}:null;}catch(e){if(['SOURCE_NOT_FOUND'].includes(e.code)||e.code==='ENOENT')return null;throw e;}
  },
  run:async selected=>{
   const manifest=await workspace.draftManifest(),old=manifest.files.find(x=>x.path===selected.path);
   let result;
   if(useBrowser){
    await uiReady('draft');await page.waitForFunction(id=>document.querySelector('#draft-title')?.textContent.includes(id.slice(0,12)),draftId);
    if(old)await page.locator('#draft-files').getByRole('button',{name:selected.path,exact:true}).click();
    else{await page.locator('#new-file').click();await page.locator('#editor-path').fill(selected.path);}
    await page.locator('#editor-content').fill(file.content);
    result=await uiPost('/api/draft/file',()=>page.locator('#editor button[type="submit"]').click());
   }else result=await workspace.editDraft({path:selected.path,content:file.content,expectedFileSha256:old?.sha256??null,expectedDraftId:draftId},workspace.metadata().revision);
   check(result.file?.sha256===file.sha256,'LIGHTDASH_DRAFT_CHANGED','Original draft did not retain the full intended source file.');
   return result.file;
  }
 });
}
async function reviewNativeChart(exported,{candidate}){
 const selection=await verifyManifest(exported),yaml=createRequire(input.connection.runtime.cliEntry)('js-yaml');let found=null;
 for(const f of selection.files.filter(f=>/\.ya?ml$/i.test(f.path))){
  const value=yaml.load(await readFile(path.join(exported.directory,f.path),'utf8'));
  if(value?.slug===CHART_SLUG&&value.tableName==='regional_sales'){check(!found,'LIGHTDASH_NATIVE_CHART','Native export has duplicate chart identity.');found={file:f,value};}
 }
 check(found&&found.value.spaceSlug==='jaffle-shop','LIGHTDASH_NATIVE_CHART','Original chart/space identity is absent.');
 const metrics=found.value.metricQuery.metrics;check(metrics.includes('regional_sales_total_revenue'),'LIGHTDASH_NATIVE_CHART','Original revenue metric is absent.');
 if(candidate)check(metrics.includes('regional_sales_total_units')&&metrics.includes('regional_sales_revenue_per_unit')&&found.value.name==='Monthly Regional Revenue, Volume and Unit Yield','LIGHTDASH_NATIVE_CHART','Promoted native chart did not retain reviewed units and weighted unit revenue.');
 else check(!metrics.includes('regional_sales_revenue_per_unit'),'LIGHTDASH_NATIVE_CHART','Backup restore did not preserve the earlier chart definition.');
 return {file:found.file,slug:found.value.slug,spaceSlug:found.value.spaceSlug,name:found.value.name,metrics,dimensions:found.value.metricQuery.dimensions,tableCalculations:found.value.metricQuery.tableCalculations,updatedAt:found.value.updatedAt??null,downloadedAt:found.value.downloadedAt??null};
}
async function queryResult(op,expected,candidate){
 const output=op.nativeResult?.native?.queryOutputs?.filter(x=>x.ready).at(-1);check(output?.resultFile&&output.csv,'LIGHTDASH_NATIVE_QUERY','Original query outputs were not retained.');
 for(const value of [output.resultFile,output.csv]){const actual=await fileIdentity(value.path);check(actual.sha256===value.sha256&&actual.bytes===value.bytes,'LIGHTDASH_NATIVE_QUERY','Retained query output changed.');}
 const body=await readJson(output.resultFile.path);check(body.operationId===op.id&&body.digest===op.plan.digest,'LIGHTDASH_NATIVE_QUERY','Native query result is bound to another operation.');
 const compared=compareNativeSales(body,expected,{candidate});
 const csv=csvRows(await readFile(output.csv.path,'utf8'));check(csv.length===compared.rows+1&&csv[0].includes('regional_sales_total_revenue'),'LIGHTDASH_NATIVE_QUERY','Original native CSV does not contain the same complete selected rows.');
 return {...compared,resultFile:output.resultFile,csv:output.csv,nativeOperationId:op.id};
}
async function screen(name,width=1440){
 await page.setViewportSize({width,height:960});const file=path.join(output,name+'.png');await page.screenshot({path:file,fullPage:true});return {path:file,...await fileIdentity(file)};
}
async function extractHandover(handover,destination){
 const stdout=await open(path.join(output,'handover-extraction.stdout.log'),'a',0o600);
 const stderr=await open(path.join(output,'handover-extraction.stderr.log'),'a',0o600);
 const command=['-I','-B',path.join(HERE,'handover.py'),'--app',APP,
  '--application-manifest-sha256',input.applicationSource.manifestSha256,
  '--archive',handover.archive.path,'--archive-sha256',handover.archive.sha256,
  '--archive-bytes',String(handover.archive.bytes),'--destination',destination,
  '--operation-id',input.operationId,'--input-sha256',inputSha256];
 let child=null,completed=null;
 const interrupt=()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
 try{
  child=spawn(input.connection.runtime.python,command,{...inheritReceiving(['ignore',stdout.fd,stderr.fd]),shell:false});
  completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
  const exit=await completed;
  await stdout.sync();await stderr.sync();
  check(exit.code===0,'LIGHTDASH_HANDOVER_EXTRACTION','The original create-only handover extraction did not complete; resume this same receiving input.',{exit});
  return await readJson(path.join(destination,'extraction.json'));
 }finally{
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
  if(child&&child.exitCode===null&&child.signalCode===null){interrupt();if(completed)await completed.catch(()=>{});}
  await stdout.close();await stderr.close();
 }
}
async function receiveDetachedHandover(handover,beforeClose,targetQueryId,chromium){
 const destination=path.join(output,'received-handover'),receiptFile=path.join(destination,'extraction.json'),openedFile=path.join(destination,'open-intent.json');
 const selection={operationId:input.operationId,inputSha256,handoverId:handover.id,archive:handover.archive,workspaceId:beforeClose.workspaceId,applicationSourceSha256:input.applicationSource.manifestSha256};
 let opened=await readJson(openedFile,{optional:true}),extraction;
 if(!opened){
  extraction=await extractHandover(handover,destination);
  opened={schema:'lightdash-commissioning.handover-open.v1',selection,extraction:{path:receiptFile,...await fileIdentity(receiptFile)}};
  await saveJson(openedFile,opened,{createOnly:true});
 }else{
  check(same(opened.selection,selection)&&opened.extraction.path===receiptFile,'LIGHTDASH_HANDOVER_RECEIVING','The retained receiving copy belongs to another original archive.');
  const actual=await fileIdentity(receiptFile);check(actual.bytes===opened.extraction.bytes&&actual.sha256===opened.extraction.sha256,'LIGHTDASH_HANDOVER_RECEIVING','Original complete extraction receipt changed.');
  extraction=await readJson(receiptFile);
 }
 check(extraction.state==='COMPLETE'&&extraction.operationId===input.operationId&&extraction.inputSha256===inputSha256&&extraction.handoverId===handover.id&&extraction.workspaceId===beforeClose.workspaceId&&same(extraction.archive,handover.archive),'LIGHTDASH_HANDOVER_RECEIVING','The actual complete extracted archive does not match this original handover.');
 const receivedRoot=path.join(destination,'package'),receivedApp=path.join(receivedRoot,'app'),receivedWorkspace=path.join(receivedRoot,'workspace');
 check(extraction.packageDirectory===receivedRoot&&extraction.applicationDirectory===receivedApp&&extraction.workspaceDirectory===receivedWorkspace,'LIGHTDASH_HANDOVER_RECEIVING','The original receiving placement changed.');
 const actualManifest=await fileIdentity(extraction.manifest.path);
 check(extraction.manifest.path===path.join(receivedRoot,'manifest.json')&&same(actualManifest,{bytes:extraction.manifest.bytes,sha256:extraction.manifest.sha256}),'LIGHTDASH_HANDOVER_RECEIVING','The original archive manifest changed after extraction.');
 const manifest=await readJson(extraction.manifest.path);
 check(manifest.handoverId===handover.id&&manifest.workspaceId===beforeClose.workspaceId&&manifest.includeOperatorPrivate===false&&manifest.applicationSourceManifest.sha256===input.applicationSource.manifestSha256,'LIGHTDASH_HANDOVER_RECEIVING','The detached copy changed its original complete selection.');
 // SQLite may acquire its original WAL and local inspection history after open-intent.
 // Every included immutable member still has to match the original archive bytes.
 for(const member of manifest.files){
  const filename=path.join(receivedRoot,safeRelative(member.path));
  if(member.path==='workspace/commissioning.sqlite')continue;
  const actual=await fileIdentity(filename);
  check(actual.bytes===member.bytes&&actual.sha256===member.sha256&&!!(fs.lstatSync(filename).mode&0o111)===!!member.executable,'LIGHTDASH_HANDOVER_RECEIVING','An included source/content member changed.',{path:member.path});
 }
 await verifyManifest({directory:receivedApp,manifestFile:path.join(receivedApp,'source-manifest.json'),manifestSha256:input.applicationSource.manifestSha256});
 const snapshot=await readJson(path.join(receivedRoot,'workspace.json'));
 check(snapshot.schema==='lightdash.commissioning-handover.v1'&&snapshot.metadata.id===beforeClose.workspaceId&&snapshot.metadata.revision===manifest.workspaceRevision,'LIGHTDASH_HANDOVER_RECEIVING','The complete source workspace selection differs.');
 const receivedModule=await import(pathToFileURL(path.join(receivedApp,'workspace.mjs')).href);
 const receivedServer=await import(pathToFileURL(path.join(receivedApp,'server.mjs')).href);
 const receivedEngine=await import(pathToFileURL(path.join(receivedApp,'native/index.mjs')).href);
 let received=null,localService=null,localBrowser=null,localPage=null;
 try{
  received=await receivedModule.CommissioningWorkspace.open(receivedWorkspace,{create:false,engine:receivedEngine});
  let current=await received.state();
  check(current.metadata.id===beforeClose.workspaceId&&same(current.metadata.connection,{})&&current.metadata.receiving?.connectionDetached===true&&current.metadata.receiving.originWorkspaceId===beforeClose.workspaceId&&current.metadata.receiving.originRevision===manifest.workspaceRevision&&current.metadata.revision>=manifest.workspaceRevision+1,'LIGHTDASH_HANDOVER_RECEIVING','The receiving SQLite did not reopen with its original identity and detached private connection.');
  const originalMetadata={...snapshot.metadata},receivedMetadata={...current.metadata};for(const name of ['revision','connection','receiving']){delete originalMetadata[name];delete receivedMetadata[name];}
  check(same(originalMetadata,receivedMetadata),'LIGHTDASH_HANDOVER_RECEIVING','The receiving source selection or original workspace metadata changed.');
  const order=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
  check(same(current.operations.map(o=>o.id).sort(),beforeClose.operationIds)&&current.operations.every(o=>o.status==='SUCCEEDED')&&same(order(current.reviews),order(snapshot.reviews)),'LIGHTDASH_HANDOVER_RECEIVING','The receiving copy lost original reviews or terminal operation identities.');
  const reopenedSnapshot=await received.exportSnapshot();
  check(same(order(reopenedSnapshot.editions),order(snapshot.editions))&&same(order(reopenedSnapshot.drafts),order(snapshot.drafts)),'LIGHTDASH_HANDOVER_RECEIVING','Complete original editions or SQLite draft overlays did not survive the handover.');
  for(const edition of current.editions)await verifyManifest(await received.nativeEdition(edition.id));
  const nativeProof=[];
  for(const original of snapshot.operations){
   const retained=received.operation(original.id),clean=value=>{const copy={...value};delete copy.updatedAt;delete copy.inspection;return copy;};
   check(same(clean(retained),clean(original)),'LIGHTDASH_HANDOVER_RECEIVING','An original native result, input or request identity changed.',{operationId:original.id});
   const absent=path.join(receivedWorkspace,'operations',original.id,'native','plan.json');
   check(!fs.existsSync(absent),'LIGHTDASH_HANDOVER_RECEIVING','The default receiving copy unexpectedly includes an operator-private native dispatch journal.');
   nativeProof.push({id:original.id,requestSha256:original.requestSha256,state:retained.status,nativeResultSha256:objectDigest(retained.nativeResult)});
   for(const content of await received.contentExports(original.id)){
    check(!content.error,'LIGHTDASH_HANDOVER_RECEIVING','A complete included native content export did not reopen.',{operationId:original.id,error:content.error});
    await verifyManifest(content);
   }
  }
  const prior=received.operation(targetQueryId),replayed=await received.execute(targetQueryId);
  check(replayed.replayed&&same(replayed.operation.nativeResult,prior.nativeResult)&&replayed.operation.status==='SUCCEEDED','LIGHTDASH_HANDOVER_RECEIVING','The detached recipient did not reopen its exact original completed query.');
  let inspected=prior;
  if(prior.inspection?.code!=='ORIGINAL_NATIVE_JOURNAL_UNAVAILABLE')inspected=(await received.execute(targetQueryId,{inspect:true})).operation;
  check(inspected.status==='SUCCEEDED'&&same(inspected.nativeResult,prior.nativeResult)&&inspected.requestSha256===prior.requestSha256&&inspected.inspection?.available===false&&inspected.inspection?.code==='ORIGINAL_NATIVE_JOURNAL_UNAVAILABLE','LIGHTDASH_HANDOVER_RECEIVING','Historical Inspect did not retain its original terminal result without private native journals.');
  current=await received.state();
  check(same(current.metadata.connection,{})&&current.metadata.receiving.connectionDetached===true&&!fs.existsSync(path.join(receivedWorkspace,'native-state'))&&current.pendingOperationIds.length===0,'LIGHTDASH_HANDOVER_RECEIVING','The detached receiving leg acquired a native connection or dispatched a provider operation.');
  localService=await receivedServer.createWorkspaceServer({workspace:received,port:0});
  localBrowser=await chromium.launch({headless:true,executablePath:input.browser.executable,args:['--no-sandbox','--disable-dev-shm-usage']});
  localPage=await localBrowser.newPage({viewport:{width:1440,height:960}});
  await localPage.goto(localService.url,{waitUntil:'networkidle'});
  await localPage.waitForFunction(()=>document.querySelector('#workspace-revision')?.textContent.startsWith('Revision '));
  await localPage.locator('[data-view="operations"]').click();
  const http=await localPage.evaluate(async()=>{const response=await fetch('/api/state');if(!response.ok)throw Error('Original receiving state read failed');return response.json();});
  check(http.metadata.id===beforeClose.workspaceId&&http.metadata.receiving.connectionDetached&&same(http.operations.map(o=>o.id).sort(),beforeClose.operationIds),'LIGHTDASH_HANDOVER_RECEIVING','The included application did not display the original detached receiving workspace.');
  const screenPath=path.join(output,'received-handover-desktop.png');await localPage.screenshot({path:screenPath,fullPage:true});
  return {state:'COMPLETE',handoverId:handover.id,extraction:opened.extraction,archive:handover.archive,applicationDirectory:receivedApp,workspaceDirectory:receivedWorkspace,workspaceId:beforeClose.workspaceId,originRevision:manifest.workspaceRevision,receivingRevision:http.metadata.revision,connectionDetached:true,originalEditionIds:current.editions.map(e=>e.id),originalReviewIds:current.reviews.map(r=>r.id),nativeResults:nativeProof,queryUuid:prior.nativeResult.native.queryOutputs.at(-1).queryUuid,historicalInspection:inspected.inspection,providerDispatch:false,screenshot:{path:screenPath,...await fileIdentity(screenPath)}};
 }finally{
  const errors=[];
  if(received?.inflight.size)await Promise.allSettled([...received.inflight.values()]);
  if(localPage)try{await localPage.close();}catch(error){errors.push(error);}
  if(localBrowser)try{await localBrowser.close();}catch(error){errors.push(error);}
  if(localService)try{await localService.close();}catch(error){errors.push(error);}
  if(received)try{await received.close();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'The included application receiving resources did not all close cleanly.');
 }
}

async function closeWorkspace(){
 const errors=[];
 if(workspace?.inflight?.size)await Promise.allSettled([...workspace.inflight.values()]);
 if(page)try{await page.close();page=null;}catch(error){errors.push(error);}
 if(browser)try{await browser.close();browser=null;}catch(error){errors.push(error);}
 if(service)try{await service.close();service=null;}catch(error){errors.push(error);}
 if(workspace)try{await workspace.close();workspace=null;}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'The original receiving resources did not all close cleanly.');
}
let final=null,failure=null;
try{
 await verifyManifest({directory:APP,...input.applicationSource});
 check(objectDigest(await normalizeConnection(input.connection))===input.connectionSha256,'LIGHTDASH_RECEIVING_RUNTIME','Original selected runtime or private profile identity changed.');
 await verifyExample(input.example.directory,input.example.upstreamLicense.file);
 for(const e of [input.estate,...input.estate.evidence]){const actual=await fileIdentity(e.file);check(actual.sha256===e.sha256&&actual.bytes===e.bytes,'LIGHTDASH_ESTATE','Original estate observation changed.');}
 for(const [file,expected]of [[input.browser.moduleFile,input.browser.moduleIdentity],[input.browser.executable,input.browser.executableIdentity]]){const actual=await fileIdentity(file);check(actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'LIGHTDASH_BROWSER','Original selected browser changed.');}
 const previous=await readJson(resultFile,{optional:true});
 if(previous?.state==='SUCCEEDED'){
  check(previous.inputSha256===inputSha256,'LIGHTDASH_RECEIVING_INPUT','Completed receiving is bound to another input.');
  const archive=await fileIdentity(previous.handover.archive.path);check(archive.sha256===previous.handover.archive.sha256&&archive.bytes===previous.handover.archive.bytes,'LIGHTDASH_HANDOVER','Completed original handover changed.');final={...previous,replayed:true};
 }else{
  await save();await event('RECEIVING_STARTED',{applicationSourceSha256:input.applicationSource.manifestSha256,upstreamCommit:UPSTREAM.commit});
  const database=path.join(workspaceDirectory,'commissioning.sqlite');let databaseExists=false;try{databaseExists=fs.lstatSync(database).isFile();}catch(error){if(error.code!=='ENOENT')throw error;}
  const exists=await readJson(path.join(output,'workspace-binding.json'),{optional:true});
  workspace=await CommissioningWorkspace.open(workspaceDirectory,{create:!databaseExists,label:'Lightdash monthly regional sales commissioning',engine});
  if(exists)check(exists.workspaceId===workspace.metadata().id,'LIGHTDASH_WORKSPACE','Original receiving workspace identity changed.');
  else await saveJson(path.join(output,'workspace-binding.json'),{operationId:input.operationId,inputSha256,workspaceId:workspace.metadata().id},{createOnly:true});
  const configured=await stage('configuration',{
   selection:async()=>({connection:input.connection,editionSettings:{projectDir:'dbt',profilesDir:'profiles',profile:'jaffle_shop',target:'jaffle',includeProfileFiles:true}}),
   recover:async s=>same(workspace.metadata().connection,s.connection)&&same(workspace.metadata().editionSettings,s.editionSettings)?{workspaceId:workspace.metadata().id,connectionSha256:objectDigest(s.connection)}:null,
   run:async s=>{check(Object.keys(workspace.metadata().connection).length===0,'LIGHTDASH_WORKSPACE','Retained workspace has another host selection.');workspace.configure(s,workspace.metadata().revision);return {workspaceId:workspace.metadata().id,connectionSha256:objectDigest(s.connection)};}
  });
  service=await createWorkspaceServer({workspace,port:0});
  const playwright=await import(pathToFileURL(input.browser.moduleFile).href),chromium=playwright.chromium??playwright.default?.chromium;
  check(chromium,'LIGHTDASH_BROWSER','Selected browser module does not expose Chromium.');
  browser=await chromium.launch({headless:true,executablePath:input.browser.executable,args:['--no-sandbox','--disable-dev-shm-usage']});
  page=await browser.newPage({viewport:{width:1440,height:960}});await uiReady('source');
  const baseline=await stage('baseline-source',{
   selection:async()=>({projectRoot:input.example.directory,label:'Original full Jaffle 2.568.0',note:'Complete 189-file upstream '+UPSTREAM.commit+'; same disposable receiving estate.',operationId:stableId('baseline-source')}),
   recover:async s=>{const found=(await workspace.state()).editions.filter(e=>e.sourceOperationId===s.operationId);check(found.length<=1,'LIGHTDASH_SOURCE','Original source operation was duplicated.');return found[0]??null;},
   run:async s=>{await uiReady('source');for(const [selector,value]of [['#source-root',s.projectRoot],['#source-label',s.label],['#source-note',s.note],['#source-operation',s.operationId]])await page.locator(selector).fill(value);return (await uiPost('/api/intake',()=>page.locator('#intake button[type="submit"]').click())).edition;}
  });
  check(baseline.fileCount===189&&baseline.bytes===UPSTREAM.exampleBytes,'LIGHTDASH_SOURCE','Original complete baseline was not retained.');
  const baselineManifest=await workspace.editionManifest(baseline.id);for(const original of input.example.files){const captured=baselineManifest.files.find(f=>f.path===original.path);check(captured&&captured.sha256===original.sha256&&captured.bytes===original.bytes&&captured.executable===original.executable,'LIGHTDASH_SOURCE','Captured baseline differs from the original complete source.',{path:original.path});}
  const expected=await expectedSales(input.example.directory);await saveJson(path.join(output,'source-derived-expectations.json'),expected,{createOnly:true});
  const inspected=await native('initial-project','inspect',baseline.id);
  check(inspected.nativeResult.native.observation.serverVersion===input.estate.observed.serverVersion,'LIGHTDASH_SERVER_VERSION','Actual Lightdash server differs from its original prepared-estate receipt.');
  await native('original-target-backup','download',baseline.id);
  await native('warehouse-build','dbt-build',baseline.id,{}, {browser:true,dropExecuteReply:true});
  await native('baseline-compile','compile',baseline.id);
  await native('baseline-deploy','deploy',baseline.id);
  const sourceContent=await editionContent(baseline.id,'dbt');
  await native('baseline-original-content','upload',baseline.id,{content:sourceContent,applySpaceAccess:false});
  const baselineDownload=await native('baseline-content-download','download',baseline.id),baselineExport=await exportSelection(baselineDownload,'download');
  await reviewNativeChart(baselineExport,{candidate:false});
  const changes=await candidateFiles(baselineExport);
  const draft=await stage('candidate-draft',{
   selection:async()=>({baselineId:baseline.id,existingDrafts:(await workspace.state()).drafts.map(d=>d.id)}),
   recover:async s=>{const found=(await workspace.state()).drafts.filter(d=>!s.existingDrafts.includes(d.id)&&d.baseEditionId===s.baselineId);check(found.length<=1,'LIGHTDASH_DRAFT_CHANGED','Another draft was created after the retained selection.');if(!found.length)return null;check(workspace.metadata().draft.id===found[0].id,'LIGHTDASH_DRAFT_CHANGED','Original receiving draft is no longer selected.');return {id:found[0].id,baseEditionId:s.baselineId};},
   run:async s=>{await uiReady('draft');await page.locator('#new-draft-edition').selectOption(s.baselineId);const result=await uiPost('/api/draft',()=>page.locator('#new-draft').click());return {id:result.draft.id,baseEditionId:s.baselineId};}
  });
  for(const file of changes.files)await writeDraftFile(file,draft.id,[MODEL,CHART,changes.nativeChartPath].includes(file.path));
  check(workspace.metadata().draft.id===draft.id,'LIGHTDASH_DRAFT_CHANGED','Select the original receiving draft before continuing its exact source edits.');
  const draftManifest=await workspace.draftManifest(),expectedFiles=new Map(baselineManifest.files.map(f=>[f.path,f]));
  for(const file of changes.files)expectedFiles.set(file.path,{path:file.path,bytes:file.bytes,sha256:file.sha256,executable:expectedFiles.get(file.path)?.executable??false});
  const expectedSourceFiles=[...expectedFiles.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  check(same(draftManifest.files,expectedSourceFiles),'LIGHTDASH_DRAFT_CHANGED','The complete draft includes another edit; preserve it for explicit operator review before continuation.');
  const candidate=await stage('candidate-seal',{
   selection:async()=>({draftId:draft.id,sourceSha256:draftManifest.sourceSha256,label:'Monthly regional revenue, units and weighted USD per unit',note:'Original metric and consuming chart improved; native content IDs and timestamps retained from '+baselineDownload.id+'.'}),
   recover:async s=>{const rows=(await workspace.state()).editions.filter(e=>e.draftId===s.draftId&&e.sourceSha256===s.sourceSha256&&e.label===s.label);check(rows.length<=1,'LIGHTDASH_EDITION','Candidate sealing was duplicated.');return rows[0]??null;},
   run:async s=>{await uiReady('draft');await page.locator('#candidate-label').fill(s.label);await page.locator('#candidate-note').fill(s.note);return (await uiPost('/api/seal',()=>page.locator('#seal button[type="submit"]').click())).edition;}
  });
  const comparison=await workspace.compare(baseline.id,candidate.id);
  check(comparison.changes.length===changes.files.length&&comparison.changes.every(c=>changes.files.some(f=>f.path===c.path&&f.sha256===c.after?.sha256)),'LIGHTDASH_SOURCE_REVIEW','Candidate contains a different source change set.');
  const review=await stage('candidate-review',{
   selection:async()=>({baselineId:baseline.id,candidateId:candidate.id,reviewedBy:'TJL receiving operator',note:'Review '+input.operationId+': preserve the original six-month regional source and native chart/space identities; publish total units and sum(USD revenue)/sum(units) for each month and region. Zero units remains null. Promote only to the selected disposable project '+input.connection.projectUuid+'.',decisions:comparison.changes.map(c=>({path:c.path,decision:'REVIEWED_SOURCE'})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)}),
   recover:async s=>{const rows=(await workspace.state()).reviews.filter(x=>x.baselineId===s.baselineId&&x.candidateId===s.candidateId&&x.reviewedBy===s.reviewedBy&&x.note===s.note&&same(x.decisions,s.decisions));check(rows.length<=1,'LIGHTDASH_SOURCE_REVIEW','Original source review was duplicated.');return rows[0]??null;},
   run:async s=>{await uiReady('review');await page.locator('#review-baseline').selectOption(s.baselineId);await page.locator('#review-candidate').selectOption(s.candidateId);await page.locator('#comparison button[type="submit"]').click();await page.waitForFunction(n=>document.querySelectorAll('#changes input[type="checkbox"]').length===n,comparison.changes.length);
    for(const box of await page.locator('#changes input[type="checkbox"]').all())await box.check();await page.locator('#reviewer').fill(s.reviewedBy);await page.locator('#review-note').fill(s.note);return (await uiPost('/api/review',()=>page.locator('#save-review button[type="submit"]').click())).review;}
  });
  await uiReady('review');await page.locator('#review-baseline').selectOption(baseline.id);await page.locator('#review-candidate').selectOption(candidate.id);await page.locator('#comparison button[type="submit"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#changes input[type="checkbox"]').length===n,comparison.changes.length);
  const desktop=await screen('source-review-desktop'),mobile=await screen('source-review-mobile',390);await page.setViewportSize({width:1440,height:960});
  const preview=await native('candidate-preview','start-preview',candidate.id,{name:'commissioning-'+stableId('preview').slice(0,18),expiresInHours:24,skipCopyContent:false,warehouseCredentials:'profiles'});
  const previewId=preview.nativeResult.native.preview?.projectUuid;check(previewId,'LIGHTDASH_PREVIEW','Original native preview creation UUID is absent.');
  const previewTarget={projectUuid:previewId,startOperationId:preview.id};
  await native('preview-validation','validate',candidate.id,{...previewTarget,severity:'error',only:['tables','charts','dashboards']});
  const queryInput={...previewTarget,chartPath:changes.nativeChartPath,limit:500,pageSize:500};
  const previewQuery=await native('preview-chart-query','run-chart',candidate.id,queryInput),previewValues=await queryResult(previewQuery,expected,true);
  await native('preview-content-download','download',candidate.id,previewTarget);
  await native('candidate-promotion','deploy',candidate.id);
  const candidateContent=await editionContent(candidate.id,'commissioning-content');
  const promoted=await native('candidate-content-promotion','upload',candidate.id,{content:candidateContent,applySpaceAccess:false});
  const promotedExport=await exportSelection(promoted,'target-after-upload'),promotedChart=await reviewNativeChart(promotedExport,{candidate:true});
  const targetQuery=await native('promoted-chart-query','run-chart',candidate.id,{chartPath:changes.nativeChartPath,limit:500,pageSize:500}),targetValues=await queryResult(targetQuery,expected,true);
  await native('promoted-validation','validate',candidate.id,{severity:'error',only:['tables','charts','dashboards']});
  await native('candidate-preview-stop','stop-preview',candidate.id,{name:preview.plan.input.name,previewProjectUuid:previewId,startOperationId:preview.id});
  const restore=await native('backup-restore-preview','start-preview',baseline.id,{name:'restore-'+stableId('restore-preview').slice(0,18),expiresInHours:24,skipCopyContent:true,warehouseCredentials:'profiles'});
  const restoreId=restore.nativeResult.native.preview?.projectUuid;check(restoreId&&restoreId!==previewId,'LIGHTDASH_PREVIEW','Original empty restore preview identity is absent.');
  const restoreTarget={projectUuid:restoreId,startOperationId:restore.id},priorContent=await exportSelection(promoted,'target-before-upload');
  const restored=await native('backup-native-content-restore','upload',baseline.id,{...restoreTarget,content:priorContent,applySpaceAccess:false});
  const restoredExport=await exportSelection(restored,'target-after-upload'),restoredChart=await reviewNativeChart(restoredExport,{candidate:false});
  const restoreQuery=await native('restored-chart-query','run-chart',baseline.id,{...restoreTarget,chartPath:CHART,limit:500,pageSize:500}),restoredValues=await queryResult(restoreQuery,expected,false);
  await native('backup-restore-preview-stop','stop-preview',baseline.id,{name:restore.plan.input.name,previewProjectUuid:restoreId,startOperationId:restore.id});
  const completeState=await workspace.state(),operationIds=completeState.operations.map(x=>x.id).sort();
  check(completeState.operations.every(o=>o.status==='SUCCEEDED'),'LIGHTDASH_NATIVE_RECEIVING','A retained operation remains incomplete.');
  const handoverId=stableId('complete-handover');
  const handover=await stage('complete-handover',{
   selection:async()=>({id:handoverId,includeOperatorPrivate:false,workspaceId:workspace.metadata().id}),
   recover:async s=>{try{const old=await readJson(path.join(workspace.root,'handover',s.id,'result.json'),{optional:true});if(old?.state==='SUCCEEDED')return await inspectHandover({workspace,id:s.id,python:input.connection.runtime.python});return null;}catch(e){if(e.code==='ENOENT')return null;throw e;}},
   run:async s=>createHandover({workspace,id:s.id,includeOperatorPrivate:s.includeOperatorPrivate,python:input.connection.runtime.python})
  });
  check(handover.state==='SUCCEEDED'&&handover.archive,'LIGHTDASH_HANDOVER','Original whole handover did not complete.');
  const beforeClose={workspaceId:workspace.metadata().id,baselineId:baseline.id,candidateId:candidate.id,reviewId:review.id,operationIds,sourceHashes:completeState.editions.map(e=>({id:e.id,sourceSha256:e.sourceSha256})).sort((a,b)=>a.id.localeCompare(b.id))};
  await closeWorkspace();workspace=await CommissioningWorkspace.open(workspaceDirectory,{create:false,engine});
  const reopened=await workspace.state();check(reopened.metadata.id===beforeClose.workspaceId&&reopened.reviews.some(x=>x.id===review.id)&&same(reopened.operations.map(x=>x.id).sort(),operationIds)&&same(reopened.editions.map(e=>({id:e.id,sourceSha256:e.sourceSha256})).sort((a,b)=>a.id.localeCompare(b.id)),beforeClose.sourceHashes),'LIGHTDASH_REOPEN','Original source/review/operation identities did not survive reopening.');
  const replay=(await workspace.execute(targetQuery.id)).operation;check(replay.status==='SUCCEEDED'&&replay.nativeResult.native.queryOutputs.at(-1).queryUuid===targetValues.queryUuid,'LIGHTDASH_REOPEN','Completed native query did not reopen as its original request.');
  const sameHandover=await createHandover({workspace,id:handoverId,includeOperatorPrivate:false,python:input.connection.runtime.python});
  check(sameHandover.archive.sha256===handover.archive.sha256&&sameHandover.archive.bytes===handover.archive.bytes,'LIGHTDASH_HANDOVER','Same handover ID did not reopen exact complete archive.');
  service=await createWorkspaceServer({workspace,port:0});browser=await chromium.launch({headless:true,executablePath:input.browser.executable,args:['--no-sandbox','--disable-dev-shm-usage']});page=await browser.newPage({viewport:{width:1440,height:960}});await uiReady('handover');
  const download=await fetch(service.url+'/api/handover?'+new URLSearchParams({id:handoverId,download:'true'}));check(download.ok,'LIGHTDASH_HANDOVER_HTTP','Original browser handover download is unavailable.');
  const deliveredBytes=Buffer.from(await download.arrayBuffer());check(deliveredBytes.length===handover.archive.bytes&&digest(deliveredBytes)===handover.archive.sha256,'LIGHTDASH_HANDOVER_HTTP','Browser did not deliver the exact whole handover.');
  const reopenedScreen=await screen('reopened-handover-desktop');
  await closeWorkspace();
  const detachedHandover=await stage('detached-handover-receiving',{
   selection:async()=>({handoverId,archive:handover.archive,workspaceId:beforeClose.workspaceId,targetQueryId:targetQuery.id}),
   run:async selected=>{check(same(selected,{handoverId,archive:handover.archive,workspaceId:beforeClose.workspaceId,targetQueryId:targetQuery.id}),'LIGHTDASH_HANDOVER_RECEIVING','The original recipient reopening input changed.');return receiveDetachedHandover(handover,beforeClose,targetQuery.id,chromium);}
  });
  final={schema:'lightdash-commissioning.receiving-result.v1',operationId:input.operationId,inputSha256,state:'SUCCEEDED',startedAt:state.startedAt,completedAt:now(),upstream:UPSTREAM,applicationSource:input.applicationSource,workspaceDirectory,workspaceId:configured.workspaceId,source:{baseline,candidate,review,comparison,originalFixture:expected.source,sourceTransactions:expected.rows,sourceDateRange:[expected.minDate,expected.maxDate]},native:{operationIds,allStates:'SUCCEEDED',originalSourceProjectUuid:input.connection.projectUuid,candidatePreviewUuid:previewId,restorePreviewUuid:restoreId,previewsStopped:true,previewValues,targetValues,restoredValues,promotedChart,restoredChart},lostExecute:state.lostExecute,reopen:beforeClose,handover,detachedHandover,screenshots:[desktop,mobile,reopenedScreen,detachedHandover.screenshot],claims:{usesOriginalDbtAndLightdash:true,replacementQueryEngine:false,warehouseRowsReadFromNativeQuery:true,fullDatabaseBackup:false,contentRestore:'Original native core-content upsert into a newly created, owned empty preview; source/target identities retained.',customerAcceptance:false}};
  await saveJson(resultFile,final);await event('RECEIVING_COMPLETE',{handoverSha256:handover.archive.sha256,nativeOperations:operationIds.length});
 }
}catch(error){
 failure=errorRecord(error);final={schema:'lightdash-commissioning.receiving-result.v1',operationId:input.operationId,inputSha256,state:stopping?'INTERRUPTED':'INCOMPLETE',startedAt:state.startedAt,observedAt:now(),error:failure,workspaceDirectory,completedStages:Object.keys(state.stages).filter(k=>state.stages[k].state==='COMPLETE'),sameInputResume:true,automaticMutationReplay:false};
 try{await saveJson(resultFile,final);}catch(saveError){console.error(JSON.stringify({error:failure,resultWriteError:errorRecord(saveError)}));}
 process.exitCode=3;
}finally{
 try{await closeWorkspace();}catch(error){process.exitCode=3;const closeError=errorRecord(error);console.error(JSON.stringify({closeError}));if(final){final={...final,state:'INCOMPLETE',closeError};try{await saveJson(resultFile,final);}catch{}}}
}
console.log(JSON.stringify({operationId:input.operationId,state:final?.state??'INTERRUPTED',resultFile,replayed:final?.replayed??false,handover:final?.handover?.archive??null}));
