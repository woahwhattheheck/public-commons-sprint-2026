// MIT. Complete the original installed Fiscal application and its retained analyst workflow.
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { acquireWorkspace } from '../../postgres/publisher/files.mjs';

export const FISCAL_APPLICATION_RECEIVING='stellar-forge.fiscaldata-application-receiving.v1';
const INPUT='stellar-forge.fiscaldata-application-receiving-input.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):
 Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]))):value;
const identity=value=>digest(json(canonical(value)));
const need=(value,message,code='FISCAL_APPLICATION_RECEIVING_INVALID')=>{
 if(!value)throw Object.assign(new Error(message),{code});
};
function absolute(value){
 need(typeof value==='string'&&value===resolve(value)&&!value.includes('\0'),'Use canonical absolute receiving paths.');
 return value;
}
function actor(value){
 need(value&&/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,159}$/.test(value.id??'')&&
  typeof value.label==='string'&&value.label.trim()&&value.label.length<=200&&!/[\x00-\x1f\x7f]/.test(value.label),
  'Declare the original named receiving operator.');
 return {id:value.id,label:value.label};
}
function briefingContext(value){
 if(value===undefined)return null;
 need(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>['title','audience','notes'].includes(key)),
  'Use authored title, audience and notes for the optional customer briefing.');
 const title=value.title,audience=value.audience??'',notes=value.notes??'';
 need(typeof title==='string'&&title.trim()&&title.length<=240&&!/[\x00-\x1f\x7f]/.test(title)&&
  typeof audience==='string'&&audience.length<=400&&!/[\x00-\x1f\x7f]/.test(audience)&&
  typeof notes==='string'&&notes.length<=64000&&!notes.includes('\0'),
  'Keep the original customer briefing text within its supported limits.');
 return {title:title.trim(),audience:audience.trim(),notes};
}
function actionResult(value){
 need(value&&typeof value==='object'&&Object.hasOwn(value,'result')&&
  value.state?.schema==='stellar-forge.fiscaldata-workspace.v1',
  'The original Fiscal action did not return its result and workspace state.');
 return value.result;
}
async function optional(path){
 try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function privateDirectory(path,{create=false}={}){
 absolute(path);
 if(create)await mkdir(path,{mode:0o700,recursive:true});
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
  !(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),'Use an existing owned0700 directory: '+path);
 return path;
}
async function publish(path,value,{immutable=false}={}){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));
 const previous=await readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(immutable&&previous){need(previous.equals(bytes),'This original receiving input is already bound to different bytes.');return;}
 const temporary=join(dirname(path),'.'+path.split('/').at(-1)+'.'+randomUUID()+'.partial');
 const file=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 try{
  // The original output-directory kernel lease serializes this publisher.
  // A partial attempt stays private; a selected name always owns complete bytes.
  const current=immutable?await readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;}):null;
  if(current)need(current.equals(bytes),'A concurrent receiving input selected different bytes.');
  else await rename(temporary,path);
  const directory=await open(dirname(path),constants.O_RDONLY);
  try{await directory.sync();}finally{await directory.close();}
 }catch(error){error.retainedAttempt=temporary;throw error;}
}
async function waitFor(read,ready,label,timeout=120000){
 const deadline=Date.now()+timeout;let value;
 while(Date.now()<deadline){
  value=await read();if(ready(value))return value;
  if(['FAILED','UNAVAILABLE'].includes(value?.phase))
   throw Object.assign(new Error(label+': '+json(value.error??value.current?.result??value.phase)),{code:'FISCAL_APPLICATION_NATIVE_FAILED'});
  await pause(400);
 }
 throw Object.assign(new Error(label+' remains in its original state: '+json(value)),{code:'FISCAL_APPLICATION_WAITING'});
}
async function listenerClosed(address){
 const url=new URL(address);
 return new Promise(done=>{
  const socket=createConnection({host:url.hostname,port:Number(url.port)});
  const finish=value=>{socket.destroy();done(value);};
  socket.once('connect',()=>finish(false));socket.once('error',()=>finish(true));socket.setTimeout(1000,()=>finish(false));
 });
}
function endpoint(value){
 const url=new URL(value);
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&!url.username&&!url.password&&!url.search&&!url.hash,
  'Use the original authenticated loopback Fiscal URL selected by Applications.');
 return url;
}
async function fiscalSession(address){
 const url=endpoint(address),response=await fetch(new URL('api/state',url),{
  headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 const state=await response.json();
 need(response.ok&&typeof state.sessionToken==='string','The original Fiscal listener did not open its session.');
 const cookie=response.headers.get('set-cookie')?.split(';')[0];
 need(cookie,'The original Fiscal listener did not return its private session cookie.');
 return {
  initial:state,
  async request(path,body,{raw=false}={}){
   const target=new URL(path,url);
   need(target.origin===url.origin,'Use this original Fiscal listener.');
   const response=await fetch(target,{
    method:body===undefined?'GET':'POST',headers:{Accept:raw?'application/octet-stream':'application/json',
     Cookie:cookie,Origin:url.origin,'x-fiscaldata-session':state.sessionToken,
     ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:json(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
   const bytes=Buffer.from(await response.arrayBuffer());
   let value;
   if(!raw||!response.ok)try{value=JSON.parse(bytes.toString('utf8'));}catch{}
   need(response.ok,'The original Fiscal operation failed: '+json(value??{status:response.status}),value?.code);
   return {value,bytes,status:response.status,sha256:response.headers.get('x-content-sha256')};
  },
  async action(action,payload){
   const value=(await this.request('api/action',{action,payload})).value;
   return actionResult(value);
  }
 };
}

/**
 * Own one source-bound installed receiving. Existing source, publication and
 * payment engines remain with the original Fiscal/MCP/Applications modules.
 * A retry reopens this exact controller, receiving intent and saved application.
 */
export async function receiveFiscalApplication(input){
 need(Number(process.versions.node.split('.')[0])>=24,'Use the installed Node24 runtime.');
 need(input?.schema===INPUT&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,151}$/.test(input.operationId??''),'Select a stable original receiving input with room for its receiving suffix.');
 const runtimeDirectory=absolute(input.runtimeDirectory),workspaceDirectory=absolute(input.workspaceDirectory);
 const outputDirectory=absolute(input.outputDirectory),packagePath=absolute(input.packagePath),operator=actor(input.operator),
  briefing=briefingContext(input.briefing);
 need(HASH.test(input.packageSha256??'')&&UUID.test(input.workspaceId??'')&&UUID.test(input.editionId??'')&&
  UUID.test(input.comparisonId??'')&&UUID.test(input.exportId??'')&&HASH.test(input.exportSha256??''),'Pin the complete original package, dataset and comparison delivery.');
 const outputRelative=relative(workspaceDirectory,outputDirectory);
 need(outputRelative==='..'||outputRelative.startsWith('../'),'Keep operator output outside the received source workspace.');
 if(input.managedHomeDirectory)absolute(input.managedHomeDirectory);
 if(input.browser){
  absolute(input.browser.chromium);absolute(input.browser.playwright);
  need((await lstat(input.browser.chromium)).isFile(),'Use the existing actual Chromium executable.');
 }
 await privateDirectory(outputDirectory,{create:true});
 const releaseOutput=await acquireWorkspace(outputDirectory);
 try{
 const inputFile=join(outputDirectory,'input.json');
 await publish(inputFile,input,{immutable:true});
 const inputSha256=identity(input),resultFile=join(outputDirectory,'result.json');
 let report=await optional(resultFile);
 if(report){
  need(report.schema===FISCAL_APPLICATION_RECEIVING&&report.inputSha256===inputSha256,'Reopen this original receiving with its original input.');
  if(report.status==='COMPLETED')return report;
 }else report={schema:FISCAL_APPLICATION_RECEIVING,inputSha256,operationId:input.operationId,
  startedAt:new Date().toISOString(),status:'PREPARING',operator,stages:[],runs:[]};
 const save=()=>publish(resultFile,report);
 const mark=async(name,value={})=>{
  const prior=report.stages.find(item=>item.name===name);
  if(prior)return prior;
  const item={name,at:new Date().toISOString(),...value};report.stages.push(item);await save();return item;
 };
 const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
 if(report.runtime)need(report.runtime.sourceCommit===runtime.sourceCommit&&
  report.runtime.sourceManifestSha256===runtime.sourceManifestSha256&&report.runtime.directory===runtime.directory,
  'The original installed receiving runtime changed.');
 else report.runtime={directory:runtime.directory,sourceCommit:runtime.sourceCommit,
  sourceManifestSha256:runtime.sourceManifestSha256,profileId:runtime.profileId,sourceRoot:runtime.sourceRoot};
 await save();
 const root=join(runtime.sourceRoot,'stellar/scf-starforge-20261009');
 const [{receiveFiscalSourcePackage,inspectFiscalSourcePackage},{createRuntimeWorkspace,openRuntimeWorkspace},
  {inspectFiscalManagedSelection,inspectFiscalManagedSource}]=await Promise.all([
   import(pathToFileURL(join(root,'sf30-seller-sdk/fiscaldata/portable.mjs')).href),
   import(pathToFileURL(join(root,'distribution/runtime-workspace/model.mjs')).href),
   import(pathToFileURL(join(root,'sf30-seller-sdk/fiscaldata/managed.mjs')).href)
  ]);
 const inspected=await inspectFiscalSourcePackage({packagePath,expectedSha256:input.packageSha256});
 const received=await receiveFiscalSourcePackage({directory:workspaceDirectory,packagePath,expectedSha256:input.packageSha256,
  operationId:input.operationId+':receive',actor:operator});
 need(received.workspace?.id===input.workspaceId,'The original source package contains a different workspace.');
 await mark('complete-source-received',{workspace:received.workspace,originalWorkspace:received.originalWorkspace,
  originalFiles:received.originalFiles,originalBytes:received.originalBytes,packageSha256:input.packageSha256,
  manifestSha256:received.manifestSha256,receivingId:received.receivingId,inspectionSchema:inspected.schema});
 const exportsDirectory=join(outputDirectory,'fiscal-exports'),connectionFile=join(outputDirectory,'fiscal-connection.json');
 await privateDirectory(exportsDirectory,{create:true});
 const workspaceAlias=input.workspaceAlias??'treasury';
 need(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspaceAlias),'Choose one original Fiscal alias.');
 await publish(connectionFile,{schema:'stellar-forge.fiscaldata-workspace-connection.v1',operator,
  workspaces:{[workspaceAlias]:{label:input.label??'Reviewed Treasury source',directory:workspaceDirectory}}},{immutable:true});
 const selection=await inspectFiscalManagedSelection({connectionFile,workspaceAlias,exportsDirectory});
 const source=await inspectFiscalManagedSource(runtime.sourceRoot);
 const controller=join(outputDirectory,'applications');
 if(!await optional(join(controller,'workspace.json')))await createRuntimeWorkspace({directory:controller});
 let model=await openRuntimeWorkspace({directory:controller}),browser=null,activeOperation=null,applicationId=report.applicationId;
 const browserErrors=[];
 const current=async()=>(await model.applicationsState()).applications.find(item=>item.id===applicationId);
 async function start(label){
  let original=await current(),run;
  if(original?.current?.active||['STARTING','RUNNING','INTERRUPTED'].includes(original?.phase)){
   run=report.runs.find(item=>item.requestId===original.current?.id);
   need(run,'A different original application operation remains active or requires its own recovery.');
   if(original.phase==='INTERRUPTED')
    await model.applicationsRecover({applicationId,operationId:run.requestId});
   activeOperation=run.requestId;
  }else{
   const previous=report.runs.filter(item=>item.label===label).at(-1);
   if(previous&&!previous.startedAt&&!previous.stoppedAt&&original.current?.id!==previous.requestId)run=previous;
   else{
    run={label,requestId:randomUUID(),...(previous?{continuationOf:previous.requestId}:{})};
    report.runs.push(run);await save();
   }
   if(!run.reviewId){
    const review=await model.applicationsStartReview({applicationId});run.reviewId=review.id;await save();
   }
   activeOperation=run.requestId;
   await model.applicationsStart({applicationId,requestId:run.requestId,reviewId:run.reviewId});
  }
  original=await waitFor(current,item=>item?.phase==='RUNNING'&&Boolean(item.current?.privateUrl),'Original Fiscal Applications startup');
  need(original.current.id===run.requestId,'The original application selected a different operation.');
  const native=original.current.url?.original;
  need(native?.schema==='stellar-forge.fiscaldata-application-startup.v1'&&native.workspaceId===input.workspaceId&&
   native.workspaceAlias===workspaceAlias&&native.directory===workspaceDirectory&&native.operator?.id===operator.id&&
   native.connectionSha256===selection.connectionSha256&&native.workspaceIdentity===selection.workspace.sha256&&
   native.sourceSha256===source.sha256,'The native startup differs from its exact original source/operator selection.');
  const session=await fiscalSession(original.current.privateUrl),actual=(await session.request('api/identity')).value;
  need(identity(actual)===identity(native),'The authenticated listener differs from the retained original startup.');
  const state=session.initial;
  need(state.schema==='stellar-forge.fiscaldata-workspace.v1'&&state.createdAt===selection.workspace.createdAt,
   'The listener opened a different Fiscal workspace.');
  need(state.managedApplication?.operator?.id===operator.id&&state.managedApplication?.workspaceAlias===workspaceAlias,
   'The original operator identity is absent from the browser state.');
  run.startedAt??=new Date().toISOString();run.instanceId=actual.instanceId;run.modelInstanceId=actual.modelInstanceId;
  run.workspaceId=input.workspaceId;run.sourceSha256=source.sha256;run.origin=new URL(original.current.privateUrl).origin;
  await save();return {run,session,address:original.current.privateUrl,state};
 }
 async function stop(run){
  const value=await current();
  if(value?.phase!=='STOPPED'||value.current?.id!==run.requestId)
   await model.applicationsStop({applicationId,operationId:run.requestId});
  await waitFor(current,item=>item?.phase==='STOPPED'&&item.current?.id===run.requestId&&item.current?.active===false,
   'Original Fiscal Applications stop');
  if(run.origin)await waitFor(async()=>({closed:await listenerClosed(run.origin)}),item=>item.closed,'Original Fiscal listener close');
  activeOperation=null;run.stoppedAt??=new Date().toISOString();await save();
 }
 try{
  const attached=await model.attach({directory:runtimeDirectory,label:input.label??'Original Fiscal installed runtime'});
  let homeId;
  if(input.managedHomeDirectory){
   const home=await model.openManagedHome({directory:input.managedHomeDirectory,label:'Original shared installed runtime'});
   homeId=home.homeId??home.home?.id??home.id;
   need(homeId,'The original managed home did not return its identity.');
  }
  if(!applicationId){
   if(!report.reviewId){
    const reviewed=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'fiscaldata',
     settings:{connectionFile,workspaceAlias,exportsDirectory,port:0},label:input.label??'Treasury source and comparison',
     ...(homeId?{homeId}:{})});
    report.reviewId=reviewed.id;report.saveRequestId=randomUUID();await save();
   }
   const saved=await model.applicationsSave({requestId:report.saveRequestId,reviewId:report.reviewId});
   need(!saved.connectionError,'The original runtime adoption needs its retained recovery: '+json(saved.connectionError));
   applicationId=report.applicationId=saved.applicationId;await save();
  }
  await waitFor(current,item=>['READY','STOPPED','RUNNING','STARTING','INTERRUPTED'].includes(item?.phase),'Original reviewed runtime adoption');
  await mark('application-reviewed-and-saved',{applicationId,runtimeId:attached.runtimeId,workspaceAlias,
   workspaceIdentity:selection.workspace.sha256,connectionSha256:selection.connectionSha256,sourceSha256:source.sha256});
  const first=await start('first');
  const edition=await first.session.action('editions.get',{id:input.editionId});
  need(edition.status==='READY'&&edition.fields?.length>0,'Select the original reviewed READY edition.');
  const query=await first.session.action('editions.query',{id:input.editionId,query:input.query??'limit=2'});
  const page=query.response?.body??query.body??query;
  need(Array.isArray(page.rows)&&page.rows.length>0,'The original native query returned no rows.');
  const comparison=await first.session.action('comparisons.get',{id:input.comparisonId,offset:0,limit:100,changesOnly:false});
  need(comparison.status==='READY'&&comparison.summary?.measureTotals,'Select the original complete exact comparison.');
  for(const total of Object.values(comparison.summary.measureTotals)){
   need([total.leftSum,total.rightSum,total.delta].every(value=>value===null||typeof value==='string'),
    'The original exact decimal values were converted to another type.');
  }
  const selectedExport=first.state.exports.find(item=>item.id===input.exportId);
  const archive=selectedExport?.files?.find(file=>file.name==='delivery.tar.gz');
  need(selectedExport?.status==='READY'&&archive?.sha256===input.exportSha256,'The original complete comparison export changed.');
  await mark('retained-analyst-data',{editionId:edition.id,editionSha256:edition.sha256,fields:edition.fields.length,
   query:page,comparisonId:comparison.id,comparisonSha256:comparison.sha256,summary:comparison.summary,
   captures:first.state.captures.length,editions:first.state.editions.length,exports:first.state.exports.length});
  const downloads=join(outputDirectory,'downloads');await privateDirectory(downloads,{create:true});
  const downloadPath=join(downloads,'comparison-delivery.tar.gz');
  let briefingReceived=false;
  async function customerBriefing(session,browserPage=null){
   if(!briefing)return null;
   const definition={comparisonId:comparison.id,expectedComparisonSha256:comparison.sha256,
    exportId:input.exportId,...briefing};
   if(report.briefing)need(identity(report.briefing.definition)===identity(definition),
    'The retained customer briefing belongs to a different source or authored context.');
   else{report.briefing={definition};await save();}
   let selected;
   if(report.briefing.payload){
    const {requestId,...retained}=report.briefing.payload;
    need(typeof requestId==='string'&&requestId.length<=160&&identity(retained)===identity(definition),
     'Continue the exact original customer briefing request.');
    selected=await session.action('briefings.create',report.briefing.payload);
   }else if(browserPage){
    await browserPage.waitForSelector('#briefing-form:not([hidden])');
    await browserPage.locator('#briefing-source').selectOption(input.exportId);
    await browserPage.locator('#briefing-title').fill(briefing.title);
    await browserPage.locator('#briefing-audience').fill(briefing.audience);
    await browserPage.locator('#briefing-notes').fill(briefing.notes);
    const routePattern='**/api/action';let captureError=null;
    const retainRequest=async route=>{
     const request=route.request();
     if(request.method()!=='POST')return route.continue();
     const body=request.postDataJSON();
     if(body?.action!=='briefings.create')return route.continue();
     try{
      const {requestId,...authored}=body.payload??{};
      need(typeof requestId==='string'&&requestId.length<=160&&identity(authored)===identity(definition),
       'The visible briefing form selected different source or authored values.');
      // Retain the browser's own request ID before its original POST can reach the model.
      // A restart uses this same payload through the original action, without another form intent.
      report.briefing.payload=body.payload;await save();await route.continue();
     }catch(error){captureError=error;await route.abort('failed');}
    };
    await browserPage.route(routePattern,retainRequest);
    try{
     const [response]=await Promise.all([
      browserPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/action'&&
       response.request().method()==='POST'&&response.request().postDataJSON()?.action==='briefings.create',
       {timeout:120000}),
      browserPage.locator('#briefing-create').click()]);
     const value=await response.json();
     need(response.ok(),'The original customer briefing could not finish: '+json(value),value?.code);
     selected=actionResult(value);
     need(report.briefing.payload,'The original browser request was not retained before submission.');
    }catch(error){throw captureError??error;}
    finally{await browserPage.unroute(routePattern,retainRequest);}
   }else{
    const requestId='fiscal-application-briefing-'+identity({operationId:input.operationId,inputSha256}).slice(0,40);
    report.briefing.payload={...definition,requestId};await save();
    selected=await session.action('briefings.create',report.briefing.payload);
   }
   need(UUID.test(selected?.id??'')&&HASH.test(selected?.sha256??'')&&
    selected.kind==='briefing'&&selected.status==='READY'&&selected.sourceId===comparison.id&&
    selected.sourceSha256===comparison.sha256&&selected.briefing?.sourceExportId===input.exportId&&
    selected.briefing.sourceExportSha256===selectedExport.sha256&&
    selected.briefing.title===briefing.title&&selected.briefing.audience===briefing.audience&&
    selected.briefing.notes===briefing.notes,'The complete briefing differs from its original selection.');
   if(report.briefing.exportId)need(selected.id===report.briefing.exportId&&selected.sha256===report.briefing.sha256,
    'The original briefing retry selected another retained export.');
   report.briefing.exportId=selected.id;report.briefing.sha256=selected.sha256;await save();
   const directory=join(downloads,'briefing');await privateDirectory(directory,{create:true});
   const files=[],contents=new Map();
   for(const name of ['briefing.tar.gz','briefing-manifest.json','briefing.json','briefing.md','dated-measures.csv']){
    const descriptor=selected.files?.find(file=>file.name===name);
    need(descriptor&&HASH.test(descriptor.sha256??'')&&Number.isSafeInteger(descriptor.size)&&descriptor.size>=0,
     'The original briefing delivery is missing '+name+'.');
    const target=join(directory,name);let bytes;
    if(browserPage&&name==='briefing.tar.gz'){
     const link=browserPage.locator('#briefing-results a[href*="/api/files/export/'+selected.id+'/briefing.tar.gz"]').first();
     await link.waitFor({state:'visible',timeout:30000});
     const downloading=browserPage.waitForEvent('download');
     await link.click();
     const temporary=join(directory,'.browser-'+randomUUID()+'.partial');
     await (await downloading).saveAs(temporary);
     bytes=await readFile(temporary);
     need(bytes.length===descriptor.size&&digest(bytes)===descriptor.sha256,
      'The full browser briefing download differs from its original sealed bytes.');
     await publish(target,bytes,{immutable:true});await unlink(temporary);
    }else{
     const response=await session.request('api/files/export/'+selected.id+'/'+name,undefined,{raw:true});
     need(response.sha256===descriptor.sha256,'The original briefing download header changed.');
     bytes=response.bytes;
     need(bytes.length===descriptor.size&&digest(bytes)===descriptor.sha256,
      'The briefing file differs from its original sealed bytes: '+name);
     await publish(target,bytes,{immutable:true});
    }
    files.push({name,path:target,size:bytes.length,sha256:descriptor.sha256});
    if(name.endsWith('.json'))contents.set(name,JSON.parse(bytes.toString('utf8')));
   }
   const document=contents.get('briefing.json'),manifest=contents.get('briefing-manifest.json');
   need(document?.workspace?.id===input.workspaceId&&document.comparison?.id===comparison.id&&
    document.comparison.sha256===comparison.sha256&&document.exportId===input.exportId&&
    document.title===briefing.title&&document.audience===briefing.audience&&document.notes===briefing.notes&&
    identity(document.comparison.summary)===identity(comparison.summary)&&
    document.sourceArchive?.sha256===input.exportSha256,
    'The downloaded customer report lost its source, exact comparison or authored context.');
   need(manifest?.workspace?.id===input.workspaceId&&manifest.comparison?.id===comparison.id&&
    manifest.comparison.sha256===comparison.sha256&&manifest.exportId===input.exportId&&
    manifest.sourceArchive?.sha256===input.exportSha256&&Array.isArray(manifest.files),
    'The original full report manifest does not match this source delivery.');
   const members=new Map(manifest.files.map(file=>[file.path,file]));
   const pages=Object.values(document.pages??{}).flat();
   for(const name of ['index.html','briefing.json','dated-measures.csv','rows.jsonl','changes.csv',
    'source-delivery.tar.gz','left-source.json','left-review.json','right-source.json','right-review.json',...pages])
    need(members.has(name),'The full report does not retain its original member '+name+'.');
   need(members.get('source-delivery.tar.gz').sha256===input.exportSha256,
    'The original comparison archive identity changed inside the briefing.');
   report.briefing.files=files;report.briefing.report={createdAt:document.createdAt,
    workspace:document.workspace,comparison:manifest.comparison,sourceArchive:document.sourceArchive,
    manifestSha256:files.find(file=>file.name==='briefing-manifest.json').sha256,
    datedMeasures:document.datedMeasures,rows:comparison.summary,rowPages:pages.length,members:manifest.files.length};
   briefingReceived=true;await save();
   await mark('complete-customer-briefing',{exportId:selected.id,sha256:selected.sha256,
    title:briefing.title,sourceExportId:input.exportId,files,report:report.briefing.report});
   return selected;
  }
  if(input.browser&&!report.stages.some(item=>item.name==='browser-operator')){
   const require=createRequire(import.meta.url),{chromium}=require(require.resolve('playwright',{paths:[input.browser.playwright]}));
   browser=await chromium.launch({headless:true,executablePath:input.browser.chromium,args:['--no-sandbox','--disable-dev-shm-usage']});
   const page=await browser.newPage({viewport:{width:1360,height:940}});
   page.on('pageerror',error=>browserErrors.push(String(error.message)));
   await page.goto(first.address,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!document.getElementById('workspace-operator').hidden);
   need((await page.locator('#workspace-operator').innerText()).includes(operator.label),'The original named operator is missing from the visible footer.');
   await page.locator('#sources-list button').first().click();
   await page.waitForFunction(()=>document.getElementById('source-name').value.length>0);
   const notes=await page.locator('#source-notes').inputValue();
   const review=report.sourceReview?.notes??notes+'\nReviewed through the installed Fiscal Applications workflow by '+operator.label+'.';
   report.sourceReview??={notes:review};await save();
   await page.locator('#source-notes').fill(review);
   const [saved]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/action'&&response.request().method()==='POST'),
    page.locator('#source-form button[type="submit"]').click()]);
   need(saved.ok(),'The original source review did not save.');
   report.sourceReview={notes:review,saved:await saved.json()};await save();
   await page.goto(first.address+'#editions/'+input.editionId,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.getElementById('edition-status').textContent==='READY');
   await page.locator('#edition-query').fill(input.query??'limit=2');
   await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/action'&&response.request().postDataJSON()?.action==='editions.query'),
    page.locator('#edition-query-form button[type="submit"]').click()]);
   await page.waitForFunction(()=>document.querySelectorAll('#edition-query-result tbody tr').length>0);
   await page.goto(first.address+'#compare/'+input.comparisonId,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelectorAll('#comparison-measures .measure-card').length>0);
   if(briefing)await customerBriefing(first.session,page);
   const views=[];
   const screenshots=join(outputDirectory,'screenshots');await privateDirectory(screenshots,{create:true});
   for(const width of [1360,390]){
    await page.setViewportSize({width,height:width===1360?940:844});
    for(const view of ['capture','editions/'+input.editionId,'compare/'+input.comparisonId]){
     await page.goto(first.address+'#'+view,{waitUntil:'domcontentloaded'});
     await page.waitForFunction(()=>document.getElementById('connection').textContent==='Connected');
     const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
     need(dimensions.scroll<=dimensions.width,'The installed Fiscal view overflows the viewport.');
     if(view==='capture'){
      const badges=await page.locator('#captures-list td:nth-child(2) .status').evaluateAll(items=>items.map(item=>getComputedStyle(item).whiteSpace));
      need(badges.length>0&&badges.every(value=>value==='nowrap'),'The capture status badge wraps inside the original column.');
     }
     views.push({view,...dimensions});
    }
    await page.screenshot({path:join(screenshots,width+'-comparison.png'),fullPage:true});
   }
   const download=page.waitForEvent('download');
   await page.locator('a[href*="/api/files/export/'+input.exportId+'/delivery.tar.gz"]').click();
   await (await download).saveAs(downloadPath);
   need(browserErrors.length===0,'The installed browser reported JavaScript errors: '+json(browserErrors));
   await browser.close();browser=null;
   await mark('browser-operator',{operator,views,sourceReview:report.sourceReview,browserErrors});
  }else{
   const response=await first.session.request('api/files/export/'+input.exportId+'/delivery.tar.gz',undefined,{raw:true});
   need(response.sha256===archive.sha256,'The original download header changed.');
   await publish(downloadPath,response.bytes,{immutable:true});
  }
  if(briefing&&!briefingReceived)await customerBriefing(first.session);
  const delivered=await readFile(downloadPath);
  need(delivered.length===archive.size&&digest(delivered)===archive.sha256,'The complete source delivery differs from its original retained bytes.');
  await mark('complete-delivery',{exportId:input.exportId,sha256:archive.sha256,bytes:delivered.length,path:downloadPath});
  const beforeStop=(await first.session.request('api/state')).value;
  report.expectedReopen={workspaceId:input.workspaceId,revision:beforeStop.revision,
   sourceRevisions:beforeStop.sources.map(item=>({id:item.id,revision:item.revision,sha256:item.sha256,notes:item.notes})),
   captures:beforeStop.captures.map(item=>({id:item.id,status:item.status,sha256:item.sha256})),
   editions:beforeStop.editions.map(item=>({id:item.id,revision:item.revision,sha256:item.sha256})),
   exports:beforeStop.exports.map(item=>({id:item.id,sha256:item.sha256}))};
  await save();await stop(first.run);await model.close();model=await openRuntimeWorkspace({directory:controller});
  const reopened=await start('reopened');
  need(reopened.run.instanceId!==first.run.instanceId,'The managed Stop/reopen reused an ended listener instance.');
  need(reopened.state.revision>=report.expectedReopen.revision,'The reopened workspace lost its retained revision.');
  const preserved={workspaceId:input.workspaceId,sourceRevisions:reopened.state.sources.map(item=>({id:item.id,revision:item.revision,sha256:item.sha256,notes:item.notes})),
   captures:reopened.state.captures.map(item=>({id:item.id,status:item.status,sha256:item.sha256})),
   editions:reopened.state.editions.map(item=>({id:item.id,revision:item.revision,sha256:item.sha256})),
   exports:reopened.state.exports.map(item=>({id:item.id,sha256:item.sha256}))};
  const {revision,...expected}=report.expectedReopen;
  need(identity(preserved)===identity(expected),'The reopened application differs from its original saved source, capture, edition or delivery.');
  const again=await reopened.session.action('editions.query',{id:input.editionId,query:input.query??'limit=2'});
  const againPage=again.response?.body??again.body??again;
  need(identity(againPage)===identity(page),'The reopened original dataset query changed.');
  if(briefing){
   const repeated=await reopened.session.action('briefings.create',report.briefing.payload);
   need(repeated?.status==='READY'&&repeated.kind==='briefing'&&repeated.id===report.briefing.exportId&&
    repeated.sha256===report.briefing.sha256,'The reopened application replaced the original completed briefing.');
   const afterRepeat=(await reopened.session.request('api/state')).value;
   need(identity(afterRepeat.exports.map(item=>({id:item.id,sha256:item.sha256})))===
    identity(report.expectedReopen.exports),'The same briefing request created another export after reopening.');
   const original=report.briefing.files.find(file=>file.name==='briefing.tar.gz');
   const response=await reopened.session.request('api/files/export/'+repeated.id+'/briefing.tar.gz',undefined,{raw:true});
   need(response.sha256===original.sha256&&response.bytes.length===original.size&&digest(response.bytes)===original.sha256,
    'The full customer briefing changed after the original application stopped and reopened.');
   await mark('customer-briefing-reopened',{exportId:repeated.id,sha256:repeated.sha256,
    archiveSha256:original.sha256,bytes:original.size,exports:afterRepeat.exports.length});
  }
  await mark('application-stopped-and-reopened',{workspaceId:input.workspaceId,firstInstance:first.run.instanceId,
   reopenedInstance:reopened.run.instanceId,preserved});
  await stop(reopened.run);
  report.status='COMPLETED';report.completedAt=new Date().toISOString();delete report.error;await save();return report;
 }catch(error){
  report.status='INTERRUPTED';report.error={code:error.code??error.name,message:String(error.message).slice(0,3000)};
  await save();throw error;
 }finally{
  await browser?.close().catch(()=>{});
  if(activeOperation&&applicationId){
   const run=report.runs.find(item=>item.requestId===activeOperation);
   if(run)await stop(run).catch(error=>{report.cleanupError={code:error.code??error.name,message:String(error.message).slice(0,1500)};});
  }
  await model.close();
  if(report.cleanupError)await save().catch(()=>{});
 }
 }finally{await releaseOutput();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--input')throw new TypeError('Use --input with one original Fiscal Applications receiving JSON.');
 receiveFiscalApplication(JSON.parse(await readFile(absolute(args[1]),'utf8')))
  .then(value=>console.log(json({schema:value.schema,status:value.status,operationId:value.operationId,
   applicationId:value.applicationId,completedAt:value.completedAt,runtime:value.runtime})))
  .catch(error=>{console.error(json({code:error.code??'FISCAL_APPLICATION_RECEIVING_FAILED',message:error.message}));process.exitCode=1;});
}
