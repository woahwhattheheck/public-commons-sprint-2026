// MIT. Operate the original installed SEC source application and reopen its customer work.
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const need=(value,message)=>{if(!value)throw new Error(message);};
const absolute=value=>{
 need(typeof value==='string'&&value===resolve(value)&&!value.includes('\0'),'Use absolute original SEC input paths.');
 return value;
};
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
async function waitFor(read,ready,description){
 const deadline=Date.now()+90000;let value;
 while(Date.now()<deadline){
  value=await read();if(ready(value))return value;
  if(['FAILED','UNAVAILABLE','INTERRUPTED'].includes(value?.phase))
   throw new Error(description+': '+JSON.stringify(value.error??value.current?.result??value.phase));
  await pause(400);
 }
 throw new Error(description+' did not complete: '+JSON.stringify(value));
}
async function closed(value){
 const url=new URL(value);
 return new Promise(done=>{
  const socket=createConnection({host:'127.0.0.1',port:Number(url.port)});
  const finish=value=>{socket.destroy();done(value);};
  socket.once('connect',()=>finish(false));socket.once('error',()=>finish(true));
  socket.setTimeout(1000,()=>finish(false));
 });
}
async function connect(selected){
 const response=await fetch(new URL('/api/session',selected.origin),{
  method:'POST',headers:{'Content-Type':'application/json',Origin:selected.origin},
  body:JSON.stringify({key:selected.key}),redirect:'error',signal:AbortSignal.timeout(10000)});
 const session=await response.json(),cookie=response.headers.get('set-cookie')?.split(';')[0];
 need(response.ok&&session.connected===true&&cookie,'The original browser session did not connect.');
 return async(path,body,{method=body===undefined?'GET':'POST',type='application/json'}={})=>{
  const response=await fetch(new URL(path,selected.origin),{method,
   headers:{Accept:'application/json',Cookie:cookie,Origin:selected.origin,
    ...(body===undefined?{}:{'Content-Type':type})},
   body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),
   redirect:'error',signal:AbortSignal.timeout(30000)});
  const bytes=Buffer.from(await response.arrayBuffer());let value;
  try{value=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('The original SEC operation returned a non-JSON response.');}
  need(response.ok,'The original SEC operation failed: '+JSON.stringify(value));
  return {bytes,value,status:response.status};
 };
}
/**
 * Use a real READY runtime and complete original merchant export.
 * Review/Save/Start/Stop all use that runtime's original Applications model.
 */
export async function runSecEdgarApplications(input){
 need(Number(process.versions.node.split('.')[0])>=24,'Use the existing Node 24 runtime.');
 need(input?.schema==='stellar-forge.sec-edgar-managed-input.v1','Select the original SEC managed operation input.');
 const runtimeDirectory=absolute(input.runtimeDirectory),workspaceDirectory=absolute(input.workspaceDirectory);
 const storeDirectory=absolute(input.storeDirectory),reference=absolute(input.referenceExportDirectory),output=absolute(input.outputDirectory);
 need(/^[a-f0-9]{64}$/.test(input.manifestSha256??''),'Retain the exact original export manifest SHA-256.');
 const manifestBytes=await readFile(join(reference,'manifest.json'));
 need(hash(manifestBytes)===input.manifestSha256,'The original SEC export manifest changed.');
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 need(manifest.schema==='stellar-forge.sec-edgar-merchant-export.v1'&&
  Array.isArray(manifest.editions)&&manifest.editions.length>0,'Use a complete original SEC merchant export.');
 const merchantBytes=await readFile(join(reference,'merchant.json'));
 need(hash(merchantBytes)===manifest.files?.['merchant.json']?.sha256&&
  merchantBytes.length===manifest.files['merchant.json'].bytes,'The original merchant configuration changed.');
 const merchant=JSON.parse(merchantBytes.toString('utf8')),captures=[];
 for(const edition of manifest.editions){
  need(/^[a-f0-9]{64}$/.test(edition.sourceSha256??''),'Use original immutable SEC source editions.');
  const bytes=await readFile(join(reference,'source-store','blobs',edition.sourceSha256+'.json'));
  need(hash(bytes)===edition.sourceSha256&&bytes.length===edition.sourceBytes,'An original SEC capture changed.');
  captures.push({edition,bytes});
 }
 const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
 const root=join(runtime.sourceRoot,'stellar/scf-starforge-20261009');
 const [{createRuntimeWorkspace,openRuntimeWorkspace},{reviewSecEdgarInputs,secEdgarPrivateUrl},
  {compileEdgarMerchant},{exportEdgarMerchant}]=await Promise.all([
   import(pathToFileURL(join(root,'distribution/runtime-workspace/model.mjs')).href),
   import(pathToFileURL(join(root,'sf30-seller-sdk/sec-edgar/managed-launch.mjs')).href),
   import(pathToFileURL(join(root,'sf30-seller-sdk/sec-edgar/config.mjs')).href),
   import(pathToFileURL(join(root,'sf30-seller-sdk/sec-edgar/cli.mjs')).href)]);
 const before=await reviewSecEdgarInputs({directory:workspaceDirectory,storeDirectory,optional:true});
 const compiled=compileEdgarMerchant(merchant);
 if(before.selection?.configSha256)need(before.selection.configSha256===hash(JSON.stringify(merchant)),
  'Select the retained workspace for this original merchant configuration.');
 await mkdir(output,{mode:0o700});await writeFile(join(output,'input.json'),json(input),{flag:'wx',mode:0o600});
 await mkdir(join(output,'downloads'),{mode:0o700});await mkdir(join(output,'previews'),{mode:0o700});
 const controller=join(output,'applications');await createRuntimeWorkspace({directory:controller});
 let model=await openRuntimeWorkspace({directory:controller}),applicationId,activeOperation=null;
 const receipt={schema:'stellar-forge.sec-edgar-managed-operation.v1',startedAt:new Date().toISOString(),
  runtime:{directory:runtime.directory,sourceCommit:runtime.sourceCommit,sourceManifestSha256:runtime.sourceManifestSha256},
  inputManifestSha256:input.manifestSha256,controller,imports:[],previews:[],downloads:[],runs:[]};
 const save=()=>writeFile(join(output,'result.json'),json(receipt),{mode:0o600});
 const current=async()=>(await model.applicationsState()).applications.find(value=>value.id===applicationId);
 async function start(){
  const review=await model.applicationsStartReview({applicationId}),requestId=randomUUID();
  await model.applicationsStart({applicationId,requestId,reviewId:review.id});activeOperation=requestId;
  const running=await waitFor(current,value=>value?.phase==='RUNNING'&&Boolean(value.current?.privateUrl),
   'Original managed SEC startup');
  need(running.current.id===requestId,'The application opened a different original operation.');
  const original=running.current.url?.original;
  const selected=await reviewSecEdgarInputs({directory:workspaceDirectory,storeDirectory});
  need(same(original?.workspace,selected.workspace)&&same(original?.store,selected.store)&&
   same(original?.selection,selected.selection),'The application selected different original SEC source or state.');
  const privateUrl=secEdgarPrivateUrl(running.current.privateUrl),request=await connect(privateUrl);
  const state=(await request('/api/state')).value;
  const run={operationId:requestId,origin:privateUrl.origin,original,
   workspaceId:state.workspaceId,revision:state.revision,configSha256:state.configSha256,startedAt:new Date().toISOString()};
  receipt.runs.push(run);await save();return {run,request};
 }
 async function stop(run){
  await model.applicationsStop({applicationId,operationId:run.operationId});
  await waitFor(current,value=>value?.phase==='STOPPED'&&value.current?.active===false,'Original managed SEC stop');
  await waitFor(async()=>({closed:await closed(run.origin)}),value=>value.closed,'Original SEC listener closure');
  activeOperation=null;run.stoppedAt=new Date().toISOString();await save();
 }
 try{
  const attached=await model.attach({directory:runtimeDirectory,label:'Original SEC installed runtime'});
  const settings={workspaceDirectory,storeDirectory,port:0,
   ...(input.environmentFile?{environmentFile:absolute(input.environmentFile)}:{})};
  const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'sec-edgar',
   settings,label:'SEC source operator and customer export'});
  const saved=await model.applicationsSave({requestId:randomUUID(),reviewId:review.id});
  need(!saved.connectionError,'The original runtime connection failed: '+JSON.stringify(saved.connectionError));
  applicationId=saved.applicationId;receipt.applicationId=applicationId;
  await waitFor(current,value=>value?.phase==='READY','Original SEC installed runtime adoption');
  const first=await start();
  let state=(await first.request('/api/state')).value;
  for(const {edition,bytes}of captures){
   const query=new URLSearchParams({id:edition.id,kind:edition.kind,cik:edition.cik,
    sourceUrl:edition.sourceUrl,capturedAt:edition.capturedAt});
   const imported=(await first.request('/api/import?'+query,bytes)).value;
   need(imported.record.sourceSha256===edition.sourceSha256,'The original import selected a different source.');
   receipt.imports.push({id:imported.record.id,sourceSha256:edition.sourceSha256,
    records:imported.record.recordCount,recovered:imported.recovered});
  }
  state=(await first.request('/api/draft',{expectedRevision:state.revision,config:merchant},{method:'PUT'})).value;
  receipt.saved={workspaceId:state.workspaceId,revision:state.revision,configSha256:state.configSha256};
  for(const [index,product]of merchant.products.entries()){
   const response=await first.request('/api/query',{productId:product.id,query:product.example??{}});
   need(response.value.rows.length>0&&response.value.edition.sourceSha256===product.sourceSha256,
    'The original product preview selected different records.');
   const file=join(output,'previews',String(index+1).padStart(4,'0')+'.json');
   await writeFile(file,response.bytes,{flag:'wx',mode:0o600});
   receipt.previews.push({productId:product.id,sourceSha256:product.sourceSha256,
    rows:response.value.rows.length,totalMatched:response.value.totalMatched,file,sha256:hash(response.bytes)});
  }
  for(const type of ['config','openapi','handoff']){
   const response=await first.request('/api/download/'+type),file=join(output,'downloads',type+'.json');
   await writeFile(file,response.bytes,{flag:'wx',mode:0o600});
   receipt.downloads.push({type,file,sha256:hash(response.bytes),bytes:response.bytes.length});
  }
  receipt.customerExport=await exportEdgarMerchant(compiled,join(output,'customer-export'),{storeDirectory});
  await save();await stop(first.run);await model.close();
  model=await openRuntimeWorkspace({directory:controller});
  const reopened=await start(),stateAgain=(await reopened.request('/api/state')).value;
  need(same(reopened.run.original.workspace,first.run.original.workspace)&&
   same(reopened.run.original.store,first.run.original.store)&&
   stateAgain.workspaceId===receipt.saved.workspaceId&&stateAgain.revision===receipt.saved.revision&&
   stateAgain.configSha256===receipt.saved.configSha256,'The reopened SEC workspace lost its original saved work.');
  for(const edition of manifest.editions){
   const value=(await reopened.request('/api/editions/'+encodeURIComponent(edition.id))).value;
   need(value.record.sourceSha256===edition.sourceSha256,'The reopened source edition changed.');
  }
  const reopenedConfig=await reopened.request('/api/download/config');
  need(hash(reopenedConfig.bytes)===receipt.downloads.find(value=>value.type==='config').sha256,
   'The reopened customer configuration changed.');
  await stop(reopened.run);
  receipt.completedAt=new Date().toISOString();receipt.state='COMPLETED';await save();
  return {directory:output,applicationId,imports:receipt.imports,previews:receipt.previews.map(({file,...value})=>value),
   sourceCommit:runtime.sourceCommit,result:join(output,'result.json')};
 }catch(error){
  receipt.state='FAILED';receipt.error={code:error.code??error.name,message:error.message};await save();throw error;
 }finally{
  if(activeOperation)await model.applicationsStop({applicationId,operationId:activeOperation}).catch(()=>{});
  await model.close();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--input')throw new TypeError('Use --input with the original SEC managed input JSON.');
 runSecEdgarApplications(JSON.parse(await readFile(absolute(args[1]),'utf8')))
  .then(value=>console.log(json(value)))
  .catch(error=>{console.error(json({error:error.code??'SEC_MANAGED_OPERATION_FAILED',message:error.message}));process.exitCode=1;});
}
