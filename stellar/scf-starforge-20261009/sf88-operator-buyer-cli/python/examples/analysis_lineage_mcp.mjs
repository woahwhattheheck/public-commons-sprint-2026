// SPDX-License-Identifier: MIT
/** Receiving continuation for the original accepted Analysis lineage publication.
 * Called by the original browser programme while its Analysis server remains live.
 * No source import, query, workbook, provider acquisition or new publication is made.
 */
import {constants as FS} from 'node:fs';
import {promises as fs} from 'node:fs';
import {join,resolve,isAbsolute,dirname,sep} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.analysis-lineage-mcp-receiving.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const INDEX_NAME='lineage-download-index.json';
const need=(value,message)=>{if(!value)throw new Error(message);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const same=(a,b)=>canonical(a)===canonical(b);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const exists=async path=>{try{await fs.lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function privateDirectory(path){
 need(isAbsolute(path),'Use an absolute original receiving directory.');
 await fs.mkdir(path,{recursive:true,mode:0o700});
 const info=await fs.lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
  (!process.getuid||info.uid===process.getuid()),'Receiving directory must remain caller-owned and private.');
 return path;
}
async function read(path,limit=2*1024*1024){
 const h=await fs.open(path,FS.O_RDONLY|FS.O_NOFOLLOW);
 try{
  const before=await h.stat();need(before.isFile()&&before.size<=limit,'Read the bounded original regular file.');
  const raw=await h.readFile(),after=await h.stat();
  need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&
   before.ctimeMs===after.ctimeMs&&raw.length===before.size,'Original receiving file changed during read.');
  return raw;
 }finally{await h.close();}
}
async function record(path){
 const h=await fs.open(path,FS.O_RDONLY|FS.O_NOFOLLOW);
 try{
  const before=await h.stat();need(before.isFile(),'Retained receiving file is not regular.');
  const hash=createHash('sha256');let bytes=0;
  for await(const block of h.createReadStream({autoClose:false})){hash.update(block);bytes+=block.length;}
  const after=await h.stat();
  need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&
   before.ctimeMs===after.ctimeMs&&bytes===before.size,'Retained file changed during verification.');
  return {path:resolve(path),bytes,sha256:hash.digest('hex')};
 }finally{await h.close();}
}
async function write(path,value,{immutable=false,raw=false}={}){
 const body=raw?Buffer.from(value):json(value);
 if(immutable&&await exists(path)){need((await read(path,body.length+1)).equals(body),'Original immutable receiving record changed.');return;}
 const temporary=path+'.pending';
 await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
 const h=await fs.open(temporary,'wx',0o600);
 try{await h.writeFile(body);await h.sync();}finally{await h.close();}
 if(immutable){
  try{await fs.link(temporary,path);}
  catch(e){if(e.code!=='EEXIST')throw e;need((await read(path,body.length+1)).equals(body),'Original concurrent receiving record differs.');}
  await fs.unlink(temporary);
 }else await fs.rename(temporary,path);
 const d=await fs.open(dirname(path),FS.O_RDONLY);try{await d.sync();}finally{await d.close();}
}
async function verifyFiles(files,root){
 for(const item of Object.values(files)){
  need(item&&typeof item.path==='string'&&item.path.startsWith(root+sep)&&Number.isSafeInteger(item.bytes)&&HASH.test(item.sha256),
   'Original receiving file record is invalid.');
  const actual=await record(item.path);need(actual.bytes===item.bytes&&actual.sha256===item.sha256,'Original receiving file changed.');
 }
}

/** Reuses the browser's exact completed plan and publication request. */
export async function runAnalysisLineageMcpJourney({
 directory,checkout,analysisDirectory,operationId,phase,workspaceId,rootJobId,plan,publicationRequest,originalHandover
}={}){
 need(['publish','restore'].includes(phase)&&ID.test(workspaceId)&&ID.test(rootJobId)&&
  typeof operationId==='string'&&operationId.length>0&&ID.test(plan?.id)&&HASH.test(plan?.plan_sha256)&&
  plan.workspace_id===workspaceId&&plan.request?.job_id===rootJobId&&
  plan.publication?.status==='ACCEPTED'&&ID.test(plan.publication.job_id)&&
  publicationRequest?.id===plan.publication.job_id&&publicationRequest.plan_id===plan.id&&
  publicationRequest.plan_sha256===plan.plan_sha256&&HASH.test(originalHandover?.sha256)&&
  Number.isSafeInteger(originalHandover.bytes),'Select the original accepted browser publication and handover.');
 for(const path of [directory,checkout,analysisDirectory])need(typeof path==='string'&&isAbsolute(path),'Original receiving paths must be absolute.');
 const root=await privateDirectory(join(resolve(directory),'mcp-'+phase));
 const selected={schema:SCHEMA,phase,operation_id:operationId,workspace_id:workspaceId,root_job_id:rootJobId,
  analysis_directory:resolve(analysisDirectory),checkout:resolve(checkout),plan_id:plan.id,plan_sha256:plan.plan_sha256,
  publication_request:publicationRequest,plan_request:plan.request,events_sha256:plan.events_sha256,
  handover:{bytes:originalHandover.bytes,sha256:originalHandover.sha256}};
 const selectionPath=join(root,'selection.json');
 await write(selectionPath,selected,{immutable:true});
 const selection=await record(selectionPath),resultPath=join(root,'result.json');
 const {startMcpWorkspace}=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/serve.mjs')).href);
 const {createNativeAnalysis}=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/native-analysis.mjs')).href);
 const sdk=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/native-analysis-lineage-download.mjs')).href);
 const outputDirectory=join(root,'handover');
 if(await exists(resultPath)){
  const value=JSON.parse(await read(resultPath));
  need(value.schema===SCHEMA&&value.status==='COMPLETE'&&value.selection.sha256===selection.sha256&&
   value.plan_id===plan.id&&value.workspace_id===workspaceId,'Completed original MCP receiving selection changed.');
  await verifyFiles(value.files,root);
  const offline=await sdk.reopenNativeAnalysisLineage({directory:outputDirectory,planId:plan.id,
   expectedPlanSha256:plan.plan_sha256,expectedIndexSha256:value.index.index_sha256});
  need(offline.state==='COMPLETE'&&offline.offline===true,'Original offline receiving did not reopen.');
  return {...value,reused:true};
 }
 const journalPath=join(root,'journal.json');
 let journal=await exists(journalPath)?JSON.parse(await read(journalPath)):{
  schema:SCHEMA,selection_sha256:selection.sha256,steps:{},requests:{
   plan:plan.request,publication:publicationRequest},created_at:new Date().toISOString()};
 need(journal.schema===SCHEMA&&journal.selection_sha256===selection.sha256&&
  same(journal.requests.plan,plan.request)&&same(journal.requests.publication,publicationRequest),'Original MCP receiving journal changed.');
 let writes=Promise.resolve(),host,native,client,primaryError;
 const checkpoint=()=>{const value=json(journal);writes=writes.then(()=>write(journalPath,value,{raw:true}));return writes;};
 await checkpoint();
 const operatorDirectory=await privateDirectory(join(root,'operator'));
 const serverDirectory=await privateDirectory(join(root,'server'));
 const tokenPath=join(root,'mcp-token.txt');
 if(!await exists(tokenPath))await write(tokenPath,randomBytes(32).toString('hex')+'\n',{raw:true,immutable:true});
 const token=(await read(tokenPath,1024)).toString('utf8').trim();
 need(token.length>=24&&!/[^\x21-\x7e]/.test(token),'Original MCP token is invalid.');
 const alias='LineageOriginal';
 async function closeServer(){
  client=null;
  if(host){const previous=host;host=null;try{await previous.close();}finally{native=null;}}
  else if(native){const previous=native;native=null;await previous.close();}
 }
 async function startServer(){
  need(!host&&!native,'The original MCP server is already owned.');
  native=createNativeAnalysis({manifest:{directory:operatorDirectory}});
  try{
   const registration=await native.register({name:alias,database:analysisDirectory});
   need(registration.workspaceId===workspaceId&&registration.status==='ORIGINAL_ANALYSIS_REGISTERED','Original MCP Analysis registration changed.');
   host=await startMcpWorkspace({environment:{
    BAZAAR_DISCOVERY_URL:'https://example.invalid/discovery',MCP_ACCESS_TOKEN:token,
    MCP_STATE_DIR:serverDirectory,MCP_PORT:'0',PAID_RESOURCE_ORIGINS:'https://example.invalid'
   },operatorAdapter:{agentCommerce:(args,context)=>native.call(args,context),
    approve:async()=>false,signPayment:async()=>{throw new Error('MCP_NATIVE_TOOL_REQUIRED');},close:()=>native.close()}});
   need(host.address.startsWith('http://127.0.0.1:'),'Use the original loopback MCP listener.');
   client=await sdk.openNativeAnalysisLineageClient({url:host.address+'/mcp',analysisWorkspace:alias,
    environment:{MCP_ACCESS_TOKEN:token}});
   journal.steps.servers??=[];journal.steps.servers.push({url:host.address+'/mcp',at:new Date().toISOString()});
   await checkpoint();
  }catch(error){await closeServer().catch(()=>{});throw error;}
 }
 async function call(operation,body={}){
  need(client,'The original MCP client is not connected.');
  return client.call(operation,body);
 }
 async function accepted(){
  const view=await call('lineage-plan',{plan_id:plan.id});
  need(view.id===plan.id&&view.workspace_id===workspaceId&&view.plan_sha256===plan.plan_sha256&&
   view.publication?.job_id===publicationRequest.id&&view.publication.status==='ACCEPTED',
   'Native MCP returned another original publication.');
  return view;
 }
 try{
  await startServer();
  const configuration=await call('lineage-configuration');
  need(configuration.workspace_id===workspaceId&&(phase!=='restore'||configuration.can_publish===false),
   'Original MCP collector configuration changed.');
  const before=await accepted();
  const beforePublication=await call('lineage-publication',{id:publicationRequest.id});
  need(beforePublication.id===publicationRequest.id&&beforePublication.status==='COMPLETE',
   'Read the same original complete Analysis publication.');
  journal.steps.configuration={workspace_id:workspaceId,can_publish:configuration.can_publish};
  journal.steps.original_publication={id:beforePublication.id,status:beforePublication.status,sha256:sha(json(beforePublication))};
  await checkpoint();
  if(phase==='publish'){
   // Both POST bodies are the requests already durably owned by this same browser.
   // The original service resolves these IDs before creating any new action.
   await checkpoint();
   const saved=await call('lineage-save-plan',journal.requests.plan);
   need(saved.id===plan.id&&saved.plan_sha256===plan.plan_sha256,'Native MCP changed the original saved review.');
   await checkpoint();
   const published=await call('lineage-publish',journal.requests.publication);
   need(published.id===publicationRequest.id&&published.status==='COMPLETE','Native MCP did not reopen the accepted original job.');
   journal.steps.same_request_replay={plan_id:plan.id,publication_job_id:publicationRequest.id,status:'COMPLETE'};
   await checkpoint();
  }
  let selectedIndex;
  if(journal.index)selectedIndex=journal.index;
  else{
   const review=await sdk.inspectNativeAnalysisLineage({client,analysisWorkspace:alias,planId:plan.id});
   need(review.state==='REVIEW'&&review.index.workspace_id===workspaceId&&review.index.plan_sha256===plan.plan_sha256&&
    review.index.events_sha256===plan.events_sha256,'Native MCP review index changed.');
   selectedIndex=review.index;journal.index=selectedIndex;await checkpoint();
  }
  const handover=selectedIndex.files.find(f=>f.name==='handover.zip');
  need(handover?.bytes===originalHandover.bytes&&handover.sha256===originalHandover.sha256,
   'MCP index does not describe the original browser handover.');
  const options=()=>({client,analysisWorkspace:alias,planId:plan.id,directory:outputDirectory,
   expectedPlanSha256:plan.plan_sha256,expectedIndexSha256:selectedIndex.index_sha256,chunkSize:1024});
  if(phase==='publish'&&!journal.steps.download_interruption){
   let captured=false;
   try{
    await sdk.downloadNativeAnalysisLineage({...options(),onProgress:async progress=>{
     if(captured)return;captured=true;
     need(progress.state==='DOWNLOADING'&&progress.bytes>0&&progress.exportId===plan.id,'Original prefix capture is invalid.');
     journal.steps.download_interruption={state:'ACTUAL_DURABLE_PREFIX',...progress,at:new Date().toISOString()};
     await checkpoint();
     throw Object.assign(new Error('ORIGINAL_MCP_DOWNLOAD_PREFIX_INTERRUPTION'),{code:'ORIGINAL_MCP_DOWNLOAD_PREFIX_INTERRUPTION'});
    }});
    // An earlier carrier may have completed all native files before retaining this step.
    // Preserve that actual outcome instead of manufacturing a second interruption.
    journal.steps.download_interruption={state:'ORIGINAL_COMPLETE_DOWNLOAD_RECOVERED',at:new Date().toISOString()};
    await checkpoint();
   }catch(error){
    if(error.code!=='ORIGINAL_MCP_DOWNLOAD_PREFIX_INTERRUPTION')throw error;
    need(captured&&journal.steps.download_interruption?.state==='ACTUAL_DURABLE_PREFIX',
     'Download interruption has no retained original prefix.');
   }
   const oldAddress=host.address;
   await closeServer();await startServer();
   journal.steps.server_restart={previous_url:oldAddress+'/mcp',current_url:host.address+'/mcp',
    same_native_workspace:true,same_plan:true};await checkpoint();
  }
  const completed=await sdk.downloadNativeAnalysisLineage(options());
  need(completed.state==='COMPLETE'&&completed.files===7,'The original native seven-file delivery did not complete.');
  if(journal.steps.download_interruption?.state==='ACTUAL_DURABLE_PREFIX')
   need(completed.resumed===true&&completed.resumedBytes>0,'Original saved byte prefix was not resumed.');
  const after=await accepted(),afterPublication=await call('lineage-publication',{id:publicationRequest.id});
  need(same(before.publication,after.publication)&&same(beforePublication,afterPublication),
   'Reading/reopening the original MCP handover changed its accepted publication.');
  journal.steps.download=completed;
  journal.steps.publication_preserved={id:publicationRequest.id,sha256:sha(json(afterPublication)),unchanged:true};
  await checkpoint();
  await closeServer();
  const offline=await sdk.reopenNativeAnalysisLineage({directory:outputDirectory,planId:plan.id,
   expectedPlanSha256:plan.plan_sha256,expectedIndexSha256:selectedIndex.index_sha256});
  need(offline.state==='COMPLETE'&&offline.offline===true,'Original source-local delivery cannot reopen without the MCP host.');
  const files={};
  for(const name of [INDEX_NAME,...selectedIndex.files.map(f=>f.name)])files[name]=await record(join(outputDirectory,name));
  need(files['handover.zip'].bytes===originalHandover.bytes&&files['handover.zip'].sha256===originalHandover.sha256,
   'Completed MCP handover differs from the browser edition.');
  journal.steps.offline=offline;await checkpoint();
  const result={schema:SCHEMA,status:'COMPLETE',operation_id:operationId,phase,workspace_id:workspaceId,
   root_job_id:rootJobId,plan_id:plan.id,plan_sha256:plan.plan_sha256,publication_job_id:publicationRequest.id,
   selection,index:selectedIndex,steps:journal.steps,files,completed_at:new Date().toISOString()};
  await verifyFiles(files,root);await write(resultPath,result,{immutable:true});
  return result;
 }catch(error){
  primaryError=error;await writes.catch(()=>{});
  journal.interruption={at:new Date().toISOString(),message:error.message,code:error.code??null};
  try{await write(journalPath,journal);}catch{/* Keep the last original durable request and partial files. */}
  throw error;
 }finally{
  let cleanup;
  try{await writes;}catch(error){cleanup=error;}
  try{await closeServer();}catch(error){cleanup??=error;}
  if(!primaryError&&cleanup)throw cleanup;
 }
}
