// SPDX-License-Identifier: MIT
/** Receiving continuation for the original completed Analysis dataset publication.
 * Called by the original browser programme while its Analysis server remains live.
 * No source import, query, workbook, provider acquisition or new publication is made.
 */
import {constants as FS} from 'node:fs';
import {promises as fs} from 'node:fs';
import {join,resolve,isAbsolute,dirname,sep} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.analysis-dataset-mcp-receiving.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
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


/** Continues the two completed browser jobs; every mutation reuses their exact IDs. */
export async function runAnalysisPublicationMcpJourney({
 directory,checkout,analysisDirectory,operationId,phase,workspaceId,packageId,
 packageIndexSha256,sourceJobId,sourceIndexSha256,packageRequest,sourceRequest,originalPackage
}={}){
 need(['publish','restore'].includes(phase)&&ID.test(workspaceId)&&ID.test(packageId)&&ID.test(sourceJobId)&&
  HASH.test(packageIndexSha256)&&HASH.test(sourceIndexSha256)&&packageRequest?.id===packageId&&
  sourceRequest?.id===sourceJobId&&sourceRequest.action==='download-export'&&
  sourceRequest.package_id===packageId&&sourceRequest.index_sha256===packageIndexSha256&&
  HASH.test(originalPackage?.sha256)&&Number.isSafeInteger(originalPackage.bytes),
  'Select the exact original package/source jobs and browser download.');
 for(const path of [directory,checkout,analysisDirectory])
  need(typeof path==='string'&&isAbsolute(path),'Original receiving paths must be absolute.');
 const root=await privateDirectory(join(resolve(directory),'mcp-'+phase));
 const selected={schema:SCHEMA,phase,operation_id:operationId,workspace_id:workspaceId,
  analysis_directory:resolve(analysisDirectory),checkout:resolve(checkout),
  package_id:packageId,package_index_sha256:packageIndexSha256,
  source_job_id:sourceJobId,source_index_sha256:sourceIndexSha256,
  package_request:packageRequest,source_request:sourceRequest,
  package_file:{bytes:originalPackage.bytes,sha256:originalPackage.sha256}};
 const selectionPath=join(root,'selection.json');await write(selectionPath,selected,{immutable:true});
 const selection=await record(selectionPath),resultPath=join(root,'result.json');
 const {startMcpWorkspace}=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/serve.mjs')).href);
 const {createNativeAnalysis}=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/native-analysis.mjs')).href);
 const sdk=await import(pathToFileURL(join(checkout,'stellar-forge/mcp-paid-agent/native-analysis-publication-download.mjs')).href);
 const choices=[
  {key:'package',source:false,id:packageId,indexSha:packageIndexSha256,name:'downloads.json',directory:join(root,'package')},
  {key:'source',source:true,id:sourceJobId,indexSha:sourceIndexSha256,name:'files-index.json',directory:join(root,'source')},
 ];
 async function offlineAll(){
  const result={};
  for(const choice of choices){
   const opened=await sdk.reopenNativeAnalysisDataset({directory:choice.directory,jobId:choice.id,
    source:choice.source,expectedWorkspaceId:workspaceId,expectedIndexSha256:choice.indexSha});
   need(opened.state==='COMPLETE'&&opened.offline===true,'Original source-local native files did not reopen.');
   result[choice.key]=opened;
  }
  return result;
 }
 if(await exists(resultPath)){
  const saved=JSON.parse(await read(resultPath,20*1024*1024));
  need(saved.schema===SCHEMA&&saved.status==='COMPLETE'&&saved.selection.sha256===selection.sha256&&
   saved.workspace_id===workspaceId&&saved.package_id===packageId&&saved.source_job_id===sourceJobId,
   'Completed original MCP receiving selection changed.');
  await verifyFiles(saved.files,root);await offlineAll();return{...saved,reused:true};
 }
 const journalPath=join(root,'journal.json');
 let journal=await exists(journalPath)?JSON.parse(await read(journalPath,20*1024*1024)):{
  schema:SCHEMA,selection_sha256:selection.sha256,steps:{},indices:{},
  requests:{package:packageRequest,source:sourceRequest},created_at:new Date().toISOString()};
 need(journal.schema===SCHEMA&&journal.selection_sha256===selection.sha256&&
  same(journal.requests.package,packageRequest)&&same(journal.requests.source,sourceRequest),
  'Original MCP request journal changed.');
 let writes=Promise.resolve(),host,native,client,primaryError;
 function checkpoint(){const raw=json(journal);writes=writes.then(()=>write(journalPath,raw,{raw:true}));return writes;}
 await checkpoint();
 const operatorDirectory=await privateDirectory(join(root,'operator'));
 const serverDirectory=await privateDirectory(join(root,'server'));
 const tokenPath=join(root,'mcp-token.txt');
 if(!await exists(tokenPath))await write(tokenPath,randomBytes(32).toString('hex')+'\n',{raw:true,immutable:true});
 const token=(await read(tokenPath,1024)).toString('utf8').trim();
 need(token.length>=24&&!/[^\x21-\x7e]/.test(token),'Original MCP token is invalid.');
 const alias='DatasetOriginal';
 async function closeServer(){
  client=null;
  if(host){const previous=host;host=null;try{await previous.close();}finally{native=null;}}
  else if(native){const previous=native;native=null;await previous.close();}
 }
 async function startServer(){
  need(!host&&!native,'The original MCP listener is already owned.');
  native=createNativeAnalysis({manifest:{directory:operatorDirectory}});
  try{
   const registration=await native.register({name:alias,database:analysisDirectory});
   need(registration.workspaceId===workspaceId&&registration.status==='ORIGINAL_ANALYSIS_REGISTERED',
    'The original MCP Analysis registration changed.');
   host=await startMcpWorkspace({environment:{
    BAZAAR_DISCOVERY_URL:'https://example.invalid/discovery',MCP_ACCESS_TOKEN:token,
    MCP_STATE_DIR:serverDirectory,MCP_PORT:'0',PAID_RESOURCE_ORIGINS:'https://example.invalid'
   },operatorAdapter:{agentCommerce:(args,context)=>native.call(args,context),
    approve:async()=>false,signPayment:async()=>{throw new Error('MCP_NATIVE_TOOL_REQUIRED');},
    close:()=>native.close()}});
   need(host.address.startsWith('http://127.0.0.1:'),'Use the original loopback MCP listener.');
   client=await sdk.openNativeAnalysisDatasetClient({url:host.address+'/mcp',analysisWorkspace:alias,
    environment:{MCP_ACCESS_TOKEN:token}});
   journal.steps.servers??=[];journal.steps.servers.push({url:host.address+'/mcp',at:new Date().toISOString()});
   await checkpoint();
  }catch(error){await closeServer().catch(()=>{});throw error;}
 }
 async function call(operation,body={}){
  need(client,'The original MCP listener is not connected.');return client.call(operation,body);
 }
 async function originalJobs(){
  const packageJob=await call('dataset-job',{id:packageId});
  const sourceJob=await call('dataset-job',{id:sourceJobId});
  need(packageJob.id===packageId&&packageJob.kind==='dataset-package'&&packageJob.status==='COMPLETE'&&
   same(packageJob.request,packageRequest),'Original complete package job changed.');
  need(sourceJob.id===sourceJobId&&sourceJob.kind==='dataset-source'&&sourceJob.status==='COMPLETE'&&
   same(sourceJob.request.original_request,sourceRequest)&&sourceJob.result.source_files.index_sha256===sourceIndexSha256,
   'Original complete source job changed.');
  return{package:packageJob,source:sourceJob};
 }
 try{
  await startServer();
  const configuration=await call('dataset-configuration');
  need(configuration.workspace_id===workspaceId&&Array.isArray(configuration.connections)&&
   (phase!=='restore'||configuration.connections.length===0),'Original MCP configuration changed.');
  const before=await originalJobs(),packageView=await call('dataset-package',{id:packageId});
  need(packageView.index.job_id===packageId&&packageView.index.workspace_id===workspaceId&&
   packageView.index.index_sha256===packageIndexSha256,'Native MCP selected a different package.');
  journal.steps.configuration={workspace_id:workspaceId,bridge_available:configuration.bridge_available,
   connections:configuration.connections.map(v=>({name:v.name,workspace_id:v.workspace_id}))};
  journal.steps.original_jobs={package:{id:packageId,sha256:sha(json(before.package))},
   source:{id:sourceJobId,sha256:sha(json(before.source))}};
  await checkpoint();
  if(phase==='publish'){
   await checkpoint();const replayedPackage=await call('dataset-prepare',journal.requests.package);
   need(replayedPackage.id===packageId&&replayedPackage.status==='COMPLETE','Native MCP changed the original package request.');
   await checkpoint();const replayedSource=await call('dataset-source',journal.requests.source);
   need(replayedSource.id===sourceJobId&&replayedSource.status==='COMPLETE','Native MCP changed the original source request.');
   journal.steps.same_request_replay={package_job_id:packageId,source_job_id:sourceJobId,status:'COMPLETE'};
   await checkpoint();
  }
  for(const choice of choices){
   if(!journal.indices[choice.key]){
    const reviewed=await sdk.inspectNativeAnalysisDataset({client,analysisWorkspace:alias,jobId:choice.id,
     source:choice.source,expectedWorkspaceId:workspaceId});
    need(reviewed.state==='REVIEW'&&reviewed.index.index_sha256===choice.indexSha&&
     reviewed.index.job_id===choice.id,'Original complete raw index changed.');
    journal.indices[choice.key]=reviewed.index;await checkpoint();
   }
   const index=journal.indices[choice.key];
   need(index.index_sha256===choice.indexSha&&index.workspace_id===workspaceId&&index.job_id===choice.id,
    'Original retained index changed.');
   if(!choice.source){
    const file=index.files.find(v=>v.name==='publication.zip');
    need(file?.bytes===originalPackage.bytes&&file.sha256===originalPackage.sha256,
     'MCP package ZIP differs from the actual browser download.');
   }else need(index.package_id===packageId&&index.package_index_sha256===packageIndexSha256,
    'Original source files belong to a different package.');
   const options=()=>({client,analysisWorkspace:alias,jobId:choice.id,source:choice.source,
    directory:choice.directory,expectedIndexSha256:choice.indexSha,expectedWorkspaceId:workspaceId,chunkSize:1024});
   if(phase==='publish'&&!choice.source&&!journal.steps.download_interruption){
    let captured=false;
    try{
     await sdk.downloadNativeAnalysisDataset({...options(),onProgress:async progress=>{
      if(captured)return;captured=true;
      need(progress.state==='DOWNLOADING'&&progress.bytes>0&&progress.exportId===choice.id,
       'Original durable byte prefix was not observed.');
      journal.steps.download_interruption={state:'ACTUAL_DURABLE_PREFIX',...progress,at:new Date().toISOString()};
      await checkpoint();
      throw Object.assign(new Error('ORIGINAL_DATASET_DOWNLOAD_PREFIX_INTERRUPTION'),
       {code:'ORIGINAL_DATASET_DOWNLOAD_PREFIX_INTERRUPTION'});
     }});
     journal.steps.download_interruption={state:'ORIGINAL_COMPLETE_DOWNLOAD_RECOVERED',at:new Date().toISOString()};
     await checkpoint();
    }catch(error){
     if(error.code!=='ORIGINAL_DATASET_DOWNLOAD_PREFIX_INTERRUPTION')throw error;
     need(captured&&journal.steps.download_interruption?.state==='ACTUAL_DURABLE_PREFIX',
      'Download interruption lacks its original byte checkpoint.');
    }
    const previous=host.address;await closeServer();await startServer();
    journal.steps.server_restart={previous_url:previous+'/mcp',current_url:host.address+'/mcp',
     same_native_workspace:true,same_original_jobs:true};await checkpoint();
   }
   const completed=await sdk.downloadNativeAnalysisDataset(options());
   need(completed.state==='COMPLETE'&&completed.files===index.files.length,'Original complete file delivery is incomplete.');
   if(!choice.source&&journal.steps.download_interruption?.state==='ACTUAL_DURABLE_PREFIX')
    need(completed.resumed===true&&completed.resumedBytes>0,'Original durable byte prefix was not resumed.');
   journal.steps[choice.key+'_download']=completed;await checkpoint();
  }
  const after=await originalJobs();
  need(same(before,after),'Original completed jobs changed during retained-file receiving.');
  journal.steps.original_jobs_preserved=true;await checkpoint();await closeServer();
  journal.steps.offline=await offlineAll();await checkpoint();
  const files={};
  for(const choice of choices)for(const name of [choice.name,...journal.indices[choice.key].files.map(v=>v.name)])
   files[choice.key+'/'+name]=await record(join(choice.directory,name));
  need(files['package/publication.zip'].sha256===originalPackage.sha256&&
   files['package/publication.zip'].bytes===originalPackage.bytes,'Native package differs from its original browser receipt.');
  const result={schema:SCHEMA,status:'COMPLETE',operation_id:operationId,phase,workspace_id:workspaceId,
   package_id:packageId,source_job_id:sourceJobId,selection,indices:journal.indices,
   steps:journal.steps,files,completed_at:new Date().toISOString()};
  await verifyFiles(files,root);await write(resultPath,result,{immutable:true});return result;
 }catch(error){
  primaryError=error;await writes.catch(()=>{});
  journal.interruption={at:new Date().toISOString(),message:error.message,code:error.code??null};
  try{await write(journalPath,journal);}catch{}
  throw error;
 }finally{
  let cleanup;try{await writes;}catch(error){cleanup=error;}
  try{await closeServer();}catch(error){cleanup??=error;}
  if(!primaryError&&cleanup)throw cleanup;
 }
}
