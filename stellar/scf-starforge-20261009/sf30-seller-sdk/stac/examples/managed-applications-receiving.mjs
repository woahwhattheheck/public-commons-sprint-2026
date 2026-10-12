// MIT. Receive retained imagery and processing through the original Applications manager.
// Run from a complete installed source closure; this driver creates no provider request.
import {constants} from 'node:fs';
import {open,mkdir,readdir,lstat,realpath,rename,unlink,rmdir,link} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectRuntimeInstall} from '../../../distribution/runtime-install.mjs';
import {operationLease} from '../../../distribution/runtime-workspace/storage.mjs';

export const MANAGED_STAC_RECEIVING_INPUT='stellar-forge.stac-managed-applications-input.v1';
const SCHEMA='stellar-forge.stac-managed-applications-receiving.v1';
const SOURCE='stellar/scf-starforge-20261009';
const MAX_JSON=384*1024*1024;
const own=Object.prototype.hasOwnProperty;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>digest(JSON.stringify(canonical(value)));
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const timestamp=()=>new Date().toISOString();
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const safeError=error=>({code:error.code??'MANAGED_STAC_RECEIVING_FAILED',
  message:String(error.message??error).replace(/#session=[A-Za-z0-9_-]+/g,'#session=[private]').slice(0,1600)});
function absolute(value){
  need(typeof value==='string'&&value===resolve(value)&&!value.includes('\0'),'RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function separate(left,right){
  return left!==right&&!left.startsWith(right+sep)&&!right.startsWith(left+sep);
}
async function privateDirectory(path,{create=false}={}){
  absolute(path);
  if(create){
    need(await realpath(dirname(path))===dirname(path),'RECEIVING_REAL_PARENT_REQUIRED');
    try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()))),
    'RECEIVING_PRIVATE_DIRECTORY_REQUIRED','Use a private real directory owned by this operator.');
  return path;
}
async function syncDirectory(path){
  if(process.platform==='win32')return;
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await handle.sync();}finally{await handle.close();}
}
async function readBytes(path,maximum=MAX_JSON){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum),'RECEIVING_FILE_INVALID');
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      BigInt(bytes.length)===before.size,'RECEIVING_SOURCE_CHANGED');
    return bytes;
  }finally{await handle.close();}
}
async function readJSON(path){
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path)));
}
async function atomicBytes(path,bytes){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}
  catch(error){await handle.close();await unlink(temporary).catch(()=>{});throw error;}
  await handle.close();await rename(temporary,path);await syncDirectory(dirname(path));
}
const atomicJSON=(path,value)=>atomicBytes(path,Buffer.from(json(value)));
async function retainBytes(path,bytes){
  if(await exists(path)){
    need((await readBytes(path,bytes.length)).equals(bytes),'RECEIVING_OUTPUT_CONFLICT');return;
  }
  const pending=path+'.pending-'+randomUUID(),handle=await open(pending,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await link(pending,path);}finally{await unlink(pending);}
  await syncDirectory(dirname(path));
}
async function fileDigest(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});need(before.isFile(),'RECEIVING_REGULAR_FILE_REQUIRED');
    const checksum=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let bytes=0;
    while(true){const result=await handle.read(buffer,0,buffer.length,null);if(!result.bytesRead)break;
      checksum.update(buffer.subarray(0,result.bytesRead));bytes+=result.bytesRead;}
    const after=await handle.stat({bigint:true});
    need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      BigInt(bytes)===before.size,'RECEIVING_SOURCE_CHANGED');
    return {bytes,sha256:checksum.digest('hex')};
  }finally{await handle.close();}
}
async function inventory(directory){
  await privateDirectory(directory);
  const files=[],directories=[];
  async function walk(path,prefix=''){
    for(const name of (await readdir(path)).sort()){
      need(name!=='.'&&name!=='..'&&!name.includes('\0'),'RECEIVING_PATH_INVALID');
      const full=join(path,name),nameInTree=prefix?prefix+'/'+name:name,info=await lstat(full);
      need(!info.isSymbolicLink(),'RECEIVING_SOURCE_LINK_UNSUPPORTED','The retained workspace must contain regular files and real directories.');
      if(info.isDirectory()){directories.push(nameInTree);await walk(full,nameInTree);}
      else{need(info.isFile(),'RECEIVING_SOURCE_SPECIAL_FILE');files.push({path:nameInTree,...await fileDigest(full)});}
    }
  }
  await walk(directory);
  return {directories,files,bytes:files.reduce((n,file)=>n+file.bytes,0),
    sha256:hash({directories,files})};
}
async function copyFileVerified(source,target,expected,scratch){
  if(await exists(target)){
    need(hash(await fileDigest(target))===hash({bytes:expected.bytes,sha256:expected.sha256}),'RECEIVING_COPY_CONFLICT');return;
  }
  const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
  const pending=join(scratch,hash({path:expected.path,sha256:expected.sha256})+'.pending');
  if(await exists(pending)){
    const info=await lstat(pending);
    need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),'RECEIVING_COPY_TEMP_CHANGED');
    await unlink(pending);
  }
  const output=await open(pending,'wx',0o600);
  const checksum=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let bytes=0;
  try{
    while(true){const item=await input.read(buffer,0,buffer.length,null);if(!item.bytesRead)break;
      const part=buffer.subarray(0,item.bytesRead);checksum.update(part);bytes+=part.length;
      let written=0;while(written<part.length){const result=await output.write(part,written,part.length-written);written+=result.bytesWritten;}
    }
    need(bytes===expected.bytes&&checksum.digest('hex')===expected.sha256,'RECEIVING_COPY_SOURCE_CHANGED');
    await output.sync();await output.close();await input.close();
    await rename(pending,target);await syncDirectory(dirname(target));
  }catch(error){await output.close().catch(()=>{});await input.close().catch(()=>{});await unlink(pending).catch(()=>{});throw error;}
}
async function copyRetained(source,target,expected){
  need((await inventory(source)).sha256===expected.sha256,'RECEIVING_SOURCE_CHANGED');
  await privateDirectory(target,{create:true});
  const scratch=await privateDirectory(target+'-copy-tmp',{create:true});
  for(const name of expected.directories)await privateDirectory(join(target,name),{create:true});
  for(const file of expected.files)await copyFileVerified(join(source,file.path),join(target,file.path),file,scratch);
  need((await inventory(source)).sha256===expected.sha256,'RECEIVING_SOURCE_CHANGED');
  need((await inventory(target)).sha256===expected.sha256,'RECEIVING_COPY_INCOMPLETE');
}
const originalEdition=value=>{const {receivedFrom,...original}=value;return original;};
function imageryContent(state,editions,assets){
  return {endpoint:state.endpoint,catalog:state.catalog,collections:state.collections,
    editions:editions.map(detail=>({edition:originalEdition(detail.edition),items:detail.items,
      decisions:detail.decisions,assets:detail.assets})),
    decisions:state.decisions,assets};
}
function exportedImageryContent(baseline,bundle){
  const editionIds=new Set(bundle.editions.map(edition=>edition.id)),assetIds=new Set(bundle.assets.map(asset=>asset.id));
  return {...baseline.content,
    editions:baseline.content.editions.filter(detail=>editionIds.has(detail.edition.id)).map(detail=>({
      ...detail,assets:detail.assets.filter(asset=>assetIds.has(asset.id))})),
    decisions:baseline.content.decisions.filter(decision=>editionIds.has(decision.editionId)),
    assets:baseline.content.assets.filter(asset=>assetIds.has(asset.id))};
}
function imageryCounts(value){
  return {editions:value.editions.length,sceneRows:value.editions.reduce((n,e)=>n+e.items.length,0),
    decisions:value.decisions.length,assets:value.assets.length,
    assetBytes:value.assets.reduce((n,a)=>n+a.bytes,0),contentSha256:hash(value)};
}
async function inspectImagery(workspace){
  const state=await workspace.getState();
  need(!state.editions.some(e=>e.status==='RUNNING')&&!state.assets.some(a=>a.status==='RUNNING'),
    'RECEIVING_CLOSED_IMAGERY_REQUIRED','Close the original acquisition before receiving its retained workspace.');
  const editions=[];
  for(const edition of state.editions)editions.push(await workspace.getEdition(edition.id));
  const assets=[];
  for(const asset of state.assets.filter(a=>a.status==='COMPLETE')){
    const file=await workspace.getAssetFile(asset.id),actual=await fileDigest(file.path);
    need(actual.bytes===asset.bytes&&actual.sha256===asset.sha256,'RECEIVING_ASSET_CHANGED');
    assets.push({id:asset.id,editionId:asset.editionId,itemId:asset.itemId,assetKey:asset.assetKey,
      mime:asset.mime,bytes:actual.bytes,sha256:actual.sha256});
  }
  const content=imageryContent(state,editions,assets);
  return {workspaceId:state.id,revision:state.revision,content,summary:imageryCounts(content)};
}
function exportedProcessingContent(baseline,payload){
  const selected=new Set(payload.editions.map(edition=>edition.id));
  return {deployments:payload.deployments,reviews:payload.reviews,
    editions:baseline.content.editions.filter(detail=>selected.has(detail.edition.id)),
    rows:baseline.content.rows.filter(row=>selected.has(row.editionId)),
    associations:payload.associations,operations:payload.operations};
}
async function inspectProcessing(workspace){
  const state=await workspace.getState();
  need(state.editions.every(e=>!e.lease&&!e.tasks.some(task=>task.state==='RUNNING')),
    'RECEIVING_CLOSED_PROCESSING_REQUIRED','Close the original processing capture before receiving it.');
  const editions=[],rows=[];
  for(const edition of state.editions){
    const detail=await workspace.getEdition(edition.id);editions.push(detail);
    rows.push({editionId:edition.id,...(edition.selection.kind==='INVENTORY'?
      {inventory:await workspace.inventory(edition.id)}:{runs:await workspace.runs(edition.id)})});
  }
  const content={deployments:state.deployments,reviews:state.reviews,editions,rows,
    associations:state.associations,operations:state.operations};
  return {workspaceId:state.id,revision:state.revision,content,summary:{
    editions:editions.length,runs:rows.reduce((n,row)=>n+(row.runs?.length??0),0),
    workflows:rows.reduce((n,row)=>n+(row.inventory?.chains.filter(c=>c.kind==='instances')
      .reduce((sum,c)=>sum+c.records.length,0)??0),0),
    associations:state.associations.length,contentSha256:hash(content)}};
}
async function connectSession(value,{timeoutMs=30000}={}){
  const url=new URL(value);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&
    url.pathname==='/'&&!url.search&&/^#session=[A-Za-z0-9_-]{43}$/.test(url.hash),
    'RECEIVING_ORIGINAL_LOCAL_SESSION_REQUIRED');
  const base=url.origin;
  async function response(path,options={}){
    const response=await fetch(new URL(path,base),{...options,redirect:'error',
      signal:AbortSignal.timeout(timeoutMs)});
    return response;
  }
  async function body(response,maximum=MAX_JSON){
    const parts=[];let size=0;
    for await(const part of response.body??[]){size+=part.byteLength;need(size<=maximum,'RECEIVING_RESPONSE_TOO_LARGE');parts.push(part);}
    const bytes=Buffer.concat(parts,size);
    if(!response.ok){
      let detail;try{detail=JSON.parse(bytes.toString('utf8'));}catch{}
      throw Object.assign(new Error(detail?.error?.message??'The original local host returned HTTP '+response.status),
        {code:detail?.error?.code??'RECEIVING_HOST_REQUEST_FAILED',status:response.status});
    }
    return bytes;
  }
  const login=await response('/api/session',{method:'POST',headers:{origin:base,'content-type':'application/json'},
    body:JSON.stringify({token:url.hash.slice('#session='.length)})});
  const credentials=JSON.parse((await body(login,16384)).toString('utf8'));
  const cookie=login.headers.get('set-cookie')?.split(';')[0];
  need(cookie&&typeof credentials.csrfToken==='string','RECEIVING_LOCAL_SESSION_FAILED');
  const headers={cookie,accept:'application/json',origin:base,'x-csrf-token':credentials.csrfToken};
  return {
    async json(path,{method='GET',value}={}){
      const result=await response(path,{method,headers:{...headers,...(value===undefined?{}:{'content-type':'application/json'})},
        ...(value===undefined?{}:{body:JSON.stringify(value)})});
      return JSON.parse((await body(result)).toString('utf8'));
    },
    async checksum(path){
      const result=await response(path,{headers});
      if(!result.ok)await body(result);
      const checksum=createHash('sha256');let bytes=0;
      for await(const part of result.body??[]){checksum.update(part);bytes+=part.byteLength;}
      return {bytes,sha256:checksum.digest('hex'),mime:result.headers.get('content-type')?.split(';')[0]??null};
    },
  };
}
async function inspectHost(client,baseline,processingBaseline){
  const state=await client.json('/api/state');
  need(state.workspace?.id===baseline.workspaceId&&state.workspace.revision===baseline.revision,
    'RECEIVING_MANAGED_WORKSPACE_CHANGED');
  const editions=[];
  for(const edition of state.workspace.editions)
    editions.push(await client.json('/api/editions/'+encodeURIComponent(edition.id)));
  const assets=[];
  for(const asset of state.workspace.assets.filter(a=>a.status==='COMPLETE')){
    const actual=await client.checksum('/api/assets/'+encodeURIComponent(asset.id)+'/download');
    need(actual.bytes===asset.bytes&&actual.sha256===asset.sha256&&actual.mime===asset.mime,
      'RECEIVING_MANAGED_ASSET_CHANGED');
    assets.push({id:asset.id,editionId:asset.editionId,itemId:asset.itemId,assetKey:asset.assetKey,
      mime:asset.mime,bytes:actual.bytes,sha256:actual.sha256});
  }
  const content=imageryContent(state.workspace,editions,assets);
  need(hash(content)===hash(baseline.content),'RECEIVING_MANAGED_IMAGERY_CHANGED');
  let processing=null;
  if(processingBaseline){
    need(state.capabilities?.processing?.enabled===true,'RECEIVING_PROCESSING_NOT_CONNECTED');
    const overview=await client.json('/api/processing/state'),details=[],rows=[];
    need(overview.id===processingBaseline.workspaceId&&overview.revision===processingBaseline.revision,
      'RECEIVING_MANAGED_PROCESSING_CHANGED');
    for(const edition of overview.editions){
      const query='?editionId='+encodeURIComponent(edition.id);
      details.push(await client.json('/api/processing/reads/edition'+query));
      rows.push({editionId:edition.id,...(edition.selection.kind==='INVENTORY'?
        {inventory:await client.json('/api/processing/reads/inventory'+query)}:
        {runs:(await client.json('/api/processing/reads/runs'+query)).runs})});
    }
    need(hash(details)===hash(processingBaseline.content.editions)&&hash(rows)===hash(processingBaseline.content.rows)&&
      hash(overview.associations)===hash(processingBaseline.content.associations),
      'RECEIVING_MANAGED_PROCESSING_CONTENT_CHANGED');
    processing={workspaceId:overview.id,revision:overview.revision,...processingBaseline.summary};
  }
  return {workspaceId:state.workspace.id,revision:state.workspace.revision,...imageryCounts(content),processing};
}
async function waitFor(read,predicate,{timeoutMs,pollMs,label}){
  const deadline=Date.now()+timeoutMs;
  while(true){
    const value=await read();
    if(await predicate(value))return value;
    need(Date.now()<deadline,'RECEIVING_LIFECYCLE_TIMEOUT','The original '+label+' is still retained; resume this receiving directory.');
    await delay(pollMs);
  }
}

/**
 * Operate an existing READY runtime and receive closed original data.
 * All copied data, journal records and complete output files stay under directory.
 * Reusing directory resumes its saved application and request identities.
 */
export async function runManagedStacReceiving({
  runtimeDirectory,sourceWorkspace,sourceProcessingWorkspace=null,directory,
  label='Satellite imagery and processing receiving',timeoutMs=180000,pollMs=500,onStage=()=>{}
}={}){
  for(const value of [runtimeDirectory,sourceWorkspace,directory])absolute(value);
  if(sourceProcessingWorkspace!==null)absolute(sourceProcessingWorkspace);
  need(typeof label==='string'&&label.trim()&&label.length<=120,'RECEIVING_LABEL_REQUIRED');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&Number.isSafeInteger(pollMs)&&pollMs>=50,
    'RECEIVING_WAIT_OPTIONS_INVALID');
  need(separate(directory,runtimeDirectory)&&separate(directory,sourceWorkspace)&&
    (!sourceProcessingWorkspace||separate(directory,sourceProcessingWorkspace)),
    'RECEIVING_SEPARATE_DIRECTORY_REQUIRED');
  const input={runtimeDirectory,sourceWorkspace,sourceProcessingWorkspace,label};
  const journalPath=join(directory,'receiving-journal.json');
  const wasPresent=await exists(directory);
  await privateDirectory(directory,{create:!wasPresent});
  if(wasPresent&&!await exists(journalPath))
    need((await readdir(directory)).every(name=>name==='receiving.lock'),'RECEIVING_NEW_OR_RECORDED_DIRECTORY_REQUIRED');
  const receivingLease=await operationLease(join(directory,'receiving.lock'));
  try{
  let journal=await exists(journalPath)?await readJSON(journalPath):{
    schema:SCHEMA,id:randomUUID(),createdAt:timestamp(),input,stage:'PREPARED',events:[],steps:{},runs:[]};
  need(journal.schema===SCHEMA&&hash(journal.input)===hash(input),'RECEIVING_INPUT_CHANGED');
  const checkpoint=async(stage,details={})=>{
    journal.stage=stage;journal.updatedAt=timestamp();
    journal.events.push({stage,at:journal.updatedAt,...details});
    await atomicJSON(journalPath,journal);await onStage({stage,at:journal.updatedAt,...details});
  };
  await checkpoint('OPENED');
  const paths={copies:join(directory,'copies'),exports:join(directory,'exports'),receiving:join(directory,'receiving'),
    manager:join(directory,'applications'),imagery:join(directory,'copies','imagery'),
    processing:join(directory,'copies','processing'),configuration:join(directory,'processing-host.json'),
    imageryExport:join(directory,'exports','imagery-handover.json'),
    processingExport:join(directory,'exports','processing-handover.json.gz'),
    imageryReceiver:join(directory,'receiving','imagery'),processingReceiver:join(directory,'receiving','processing'),
    processingImageryReceiver:join(directory,'receiving','processing-imagery'),
    processingUnpacked:join(directory,'receiving','processing-input')};
  for(const key of ['copies','exports','receiving'])await privateDirectory(paths[key],{create:true});
  const checked=await inspectRuntimeInstall({directory:runtimeDirectory,load:false});
  need(checked.status==='READY'&&checked.ready===true,
    'RECEIVING_READY_RUNTIME_REQUIRED','Select the original READY runtime containing the reviewed STAC command and source.');
  const binding={directory:checked.directory,installationId:checked.installationId,sourceCommit:checked.sourceCommit,
    profileId:checked.profileId,sourceRoot:checked.sourceRoot};
  if(journal.runtime)need(hash(journal.runtime)===hash(binding),'RECEIVING_RUNTIME_CHANGED');
  else{journal.runtime=binding;await checkpoint('RUNTIME_RETAINED',{sourceCommit:binding.sourceCommit});}
  const packageRoot=join(checked.sourceRoot,SOURCE),stacRoot=join(packageRoot,'sf30-seller-sdk','stac');
  const modelApi=await import(pathToFileURL(join(packageRoot,'distribution','runtime-workspace','model.mjs')).href);
  const {openStacWorkspace}=await import(pathToFileURL(join(stacRoot,'workspace.mjs')).href);
  const processingApi=sourceProcessingWorkspace?
    await import(pathToFileURL(join(stacRoot,'processing','workspace.mjs')).href):null;
  const portable=sourceProcessingWorkspace?
    await import(pathToFileURL(join(stacRoot,'processing','portable.mjs')).href):null;
  let manager=null,originalClient=null;
  const originalClientPath=join(checked.sourceRoot,'stellar-forge','mcp-merchant-operator','stac-workspace-client.mjs');
  const waitOptions={timeoutMs,pollMs};
  async function app(){
    const selected=(await manager.applicationsState()).applications.find(item=>item.id===journal.applicationId);
    need(selected,'RECEIVING_SAVED_APPLICATION_MISSING');return selected;
  }
  const runFor=(application,id)=>application.runs.find(run=>run.id===id);
  const terminal=run=>run&&!run.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase);
  async function stopRun(record){
    let application=await app(),run=runFor(application,record.requestId);
    if(!run)return;
    if(!terminal(run)){
      record.stopRequestedAt??=timestamp();await checkpoint('STOP_INTENT',{runId:record.requestId});
      await manager.applicationsStop({applicationId:journal.applicationId,operationId:record.requestId});
      application=await waitFor(app,value=>{
        const current=runFor(value,record.requestId);return current&&terminal(current);
      },{...waitOptions,label:'application Stop'});
      run=runFor(application,record.requestId);
    }
    record.stoppedAt=timestamp();record.finalPhase=run.phase;record.finalState=run.result?.state??null;
    await checkpoint('STOPPED',{runId:record.requestId,phase:run.phase,state:record.finalState});
  }
  async function ensureRun(slot){
    let record=journal.runs.filter(run=>run.slot===slot).at(-1),application=await app();
    if(application.current?.active&&(!record||application.current.id!==record.requestId))
      need(false,'RECEIVING_OTHER_APPLICATION_RUN','Continue the current receiving run before starting another one.');
    let run=record?runFor(application,record.requestId):null;
    if(record&&terminal(run)){
      record.finalPhase=run.phase;record.finalState=run.result?.state??null;
      await checkpoint('FINISHED_RUN_RETAINED',{runId:record.requestId,phase:run.phase});
      record=null;
    }
    if(!record){
      record={slot,requestId:randomUUID(),createdAt:timestamp(),reason:
        journal.runs.some(run=>run.slot===slot)?'Continue after an original finished run':'Intentional '+slot+' start',recoveries:[]};
      journal.runs.push(record);await checkpoint('START_REVIEW_INTENT',{slot,runId:record.requestId});
    }
    if(!record.reviewId){
      const review=await manager.applicationsStartReview({applicationId:journal.applicationId});
      record.reviewId=review.id;await checkpoint('START_REVIEWED',{slot,runId:record.requestId,reviewId:review.id});
    }
    application=await app();run=runFor(application,record.requestId);
    if(!run){
      record.dispatchedAt=timestamp();await checkpoint('START_INTENT',{slot,runId:record.requestId});
      await manager.applicationsStart({applicationId:journal.applicationId,requestId:record.requestId,reviewId:record.reviewId});
    }else if(!run.active&&['INTERRUPTED','PENDING','QUEUED','FAILED'].includes(run.phase)){
      record.recoveries.push({at:timestamp(),phase:run.phase});await checkpoint('RECOVER_INTENT',{slot,runId:record.requestId,phase:run.phase});
      await manager.applicationsRecover({applicationId:journal.applicationId,operationId:record.requestId});
    }
    const observed=await waitFor(app,value=>{
      const current=runFor(value,record.requestId);
      if(terminal(current))throw Object.assign(new Error('The original application finished before its local host became ready.'),
        {code:'RECEIVING_APPLICATION_FINISHED'});
      if(current?.phase==='INTERRUPTED')throw Object.assign(new Error('The original application is interrupted; resume this directory through Applications recovery.'),
        {code:'RECEIVING_APPLICATION_INTERRUPTED'});
      return current?.active&&current.url?.url&&!current.stop;
    },{...waitOptions,label:'managed application startup'});
    const current=runFor(observed,record.requestId),identity=current.url.original;
    need(identity?.workspaceId===journal.baseline.imagery.workspaceId,'RECEIVING_STARTUP_IDENTITY_CHANGED');
    if(journal.hostSourceSha256)need(identity.sourceSha256===journal.hostSourceSha256,'RECEIVING_HOST_SOURCE_CHANGED');
    else journal.hostSourceSha256=identity.sourceSha256;
    const connectionFile=join(paths.manager,'applications',journal.applicationId,'stac-connection.json');
    need(current.url.connectionFile===connectionFile,'RECEIVING_STABLE_CONNECTION_MISSING');
    const info=await lstat(connectionFile);
    need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
      (!process.getuid||info.uid===process.getuid()),'RECEIVING_STABLE_CONNECTION_NOT_PRIVATE');
    const connectionBytes=await readBytes(connectionFile,65536),connection=JSON.parse(connectionBytes.toString('utf8'));
    need(connection.schema==='stellar-forge.application-url.v1'&&connection.applicationId===journal.applicationId&&
      connection.operationId===record.requestId&&connection.workspaceId===identity.workspaceId&&
      connection.url===current.url.url&&hash(connection.original)===hash(identity),'RECEIVING_STABLE_CONNECTION_CHANGED');
    const retainedConnection={path:connectionFile,sha256:digest(connectionBytes),urlSha256:digest(connection.url),
      workspaceId:connection.workspaceId,instanceId:identity.instanceId,operationId:record.requestId};
    if(slot==='reopened'){
      const initial=journal.runs.filter(run=>run.slot==='initial'&&run.connection).at(-1)?.connection;
      need(initial&&initial.path===connectionFile&&initial.workspaceId===connection.workspaceId&&
        initial.urlSha256!==retainedConnection.urlSha256&&initial.instanceId!==identity.instanceId,
        'RECEIVING_RESTART_CONNECTION_NOT_REPLACED');
    }
    record.connection=retainedConnection;record.instanceId=identity.instanceId;record.readyAt=timestamp();
    if(await exists(originalClientPath)){
      if(!originalClient){
        const clientModule=await import(pathToFileURL(originalClientPath).href);
        need(typeof clientModule.StacWorkspaceClient==='function','RECEIVING_ORIGINAL_CLIENT_REQUIRED');
        originalClient=new clientModule.StacWorkspaceClient({consoleUrlFile:connectionFile,
          workspaceId:identity.workspaceId,maxResponseBytes:MAX_JSON});
        journal.originalClientSource=await fileDigest(originalClientPath);
      }
      const state=await originalClient.state();
      need(state.workspace?.id===identity.workspaceId&&state.workspace.revision===journal.baseline.imagery.revision,
        'RECEIVING_ORIGINAL_CLIENT_WORKSPACE_CHANGED');
      const processing=sourceProcessingWorkspace?await originalClient.processingState():null;
      if(processing)need(processing.id===journal.baseline.processing.workspaceId&&
        processing.revision===journal.baseline.processing.revision,'RECEIVING_ORIGINAL_CLIENT_PROCESSING_CHANGED');
      record.originalClient={workspaceId:originalClient.metadata.workspaceId,
        hostOwnership:originalClient.metadata.hostOwnership,connected:originalClient.metadata.connected,
        processingWorkspaceId:processing?.id??null};
    }
    await checkpoint('HOST_READY',{slot,runId:record.requestId,workspaceId:identity.workspaceId,sourceSha256:identity.sourceSha256,
      stableConnection:true,connectionReplaced:slot==='reopened',...(record.originalClient?{originalClient:true}:{})});
    return {record,client:await connectSession(connection.url)};
  }
  async function verifyCopies(){
    const imagery=await openStacWorkspace({directory:paths.imagery,create:false});let processing=null;
    try{
      const imageryState=await inspectImagery(imagery);
      need(hash(imageryState)===hash(journal.baseline.imagery),'RECEIVING_REOPEN_IMAGERY_CHANGED');
      if(sourceProcessingWorkspace){
        processing=await processingApi.openProcessingWorkspace({directory:paths.processing,stacWorkspace:imagery,create:false});
        need(hash(await inspectProcessing(processing))===hash(journal.baseline.processing),'RECEIVING_REOPEN_PROCESSING_CHANGED');
      }
    }finally{await processing?.close();await imagery.close();}
  }
  try{
    if(!journal.steps.copied){
      if(!journal.originals){
        const imagery=await openStacWorkspace({directory:sourceWorkspace,create:false});let processing=null;
        try{
          const imageryState=await inspectImagery(imagery);
          need(imageryState.content.editions.length>0,'RECEIVING_RETAINED_EDITION_REQUIRED');
          let processingState=null;
          if(sourceProcessingWorkspace){
            processing=await processingApi.openProcessingWorkspace({directory:sourceProcessingWorkspace,stacWorkspace:imagery,create:false});
            processingState=await inspectProcessing(processing);
          }
          journal.baseline={imagery:imageryState,processing:processingState};
        }finally{await processing?.close();await imagery.close();}
        journal.originals={imagery:await inventory(sourceWorkspace),
          processing:sourceProcessingWorkspace?await inventory(sourceProcessingWorkspace):null};
        await checkpoint('COPY_REVIEWED',{imageryFiles:journal.originals.imagery.files.length,
          processingFiles:journal.originals.processing?.files.length??0});
      }
      await copyRetained(sourceWorkspace,paths.imagery,journal.originals.imagery);
      if(sourceProcessingWorkspace)await copyRetained(sourceProcessingWorkspace,paths.processing,journal.originals.processing);
      await verifyCopies();journal.steps.copied=true;await checkpoint('COPIED',{...journal.baseline.imagery.summary});
    }
    if(sourceProcessingWorkspace)await retainBytes(paths.configuration,Buffer.from(json({
      handoverDirectory:join(paths.exports,'processing'),
      receivingDirectory:join(paths.receiving,'host-processing')})));
    if(!await exists(join(paths.manager,'workspace.json'))){
      if(await exists(paths.manager)){
        need(journal.managerCreateIntent,'RECEIVING_MANAGER_RECORD_REQUIRED');
        await privateDirectory(paths.manager);
        const permitted=new Set(['runtimes','archives','entries','operations','observations','sources','incoming']);
        const names=await readdir(paths.manager);
        for(const name of names){
          need(permitted.has(name),'RECEIVING_MANAGER_INITIALIZATION_CHANGED');
          const child=await privateDirectory(join(paths.manager,name));
          need((await readdir(child)).length===0,'RECEIVING_MANAGER_INITIALIZATION_HAS_RECORDS');
        }
        for(const name of names)await rmdir(join(paths.manager,name));
        await rmdir(paths.manager);
      }
      journal.managerCreateIntent={id:journal.managerCreateIntent?.id??randomUUID(),at:timestamp()};
      await checkpoint('MANAGER_CREATE_INTENT',{requestId:journal.managerCreateIntent.id});
      await modelApi.createRuntimeWorkspace({directory:paths.manager});
    }
    manager=await modelApi.openRuntimeWorkspace({directory:paths.manager});
    const catalog=await manager.applicationsState();
    need(catalog.catalog.some(kind=>kind.id==='stac-imagery'),'RECEIVING_STAC_APPLICATION_NOT_INSTALLED',
      'Upgrade through the original runtime installer to a release containing the STAC Applications adapter.');
    if(!journal.runtimeId){
      await checkpoint('ATTACH_INTENT');
      const attached=await manager.attach({directory:runtimeDirectory,label:'Original imagery native runtime'});
      need(attached.status==='READY','RECEIVING_RUNTIME_NOT_READY');journal.runtimeId=attached.runtimeId;
      await checkpoint('ATTACHED',{runtimeId:attached.runtimeId});
    }
    if(!journal.applicationId){
      journal.saveRequestId??=randomUUID();
      if(!journal.applicationReviewId){
        await checkpoint('APPLICATION_REVIEW_INTENT',{requestId:journal.saveRequestId});
        const review=await manager.applicationsReview({runtimeId:journal.runtimeId,kind:'stac-imagery',label,
          settings:{workspaceDirectory:paths.imagery,port:0,...(sourceProcessingWorkspace?{
            processingWorkspaceDirectory:paths.processing,processingConfigurationFile:paths.configuration}:{})}});
        journal.applicationReviewId=review.id;
        journal.connectionRequestId=review.adoption?.requestId??null;
        await checkpoint('APPLICATION_REVIEWED',{reviewId:review.id,connectionRequestId:journal.connectionRequestId});
      }
      await checkpoint('APPLICATION_SAVE_INTENT',{requestId:journal.saveRequestId});
      const saved=await manager.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.applicationReviewId});
      journal.applicationId=saved.applicationId;
      await checkpoint('APPLICATION_SAVED',{applicationId:saved.applicationId,connectionRequestId:journal.connectionRequestId});
      if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
    }
    if(!(await app()).release){
      await checkpoint('CONNECT_INTENT',{applicationId:journal.applicationId,operationId:journal.connectionRequestId});
      await manager.applicationsConnect({applicationId:journal.applicationId});
      await waitFor(app,value=>{
        if(value.adoption&&!value.adoption.active&&['FAILED','INTERRUPTED'].includes(value.adoption.phase))
          throw Object.assign(new Error('The retained runtime connection needs its original Applications recovery.'),{code:'RECEIVING_CONNECTION_INTERRUPTED'});
        return Boolean(value.release);
      },{...waitOptions,label:'runtime connection'});
    }
    await checkpoint('CONNECTED',{applicationId:journal.applicationId});
    if(!journal.steps.exported){
      const {record,client}=await ensureRun('initial');
      const observed=await inspectHost(client,journal.baseline.imagery,journal.baseline.processing);
      journal.initialObservation=observed;await checkpoint('ORIGINAL_HOST_INSPECTED',{...journal.baseline.imagery.summary});
      journal.imageryExportIntent??={id:randomUUID(),at:timestamp()};
      await checkpoint('IMAGERY_EXPORT_INTENT',{requestId:journal.imageryExportIntent.id});
      const bundle=await client.json('/api/handover/export',{method:'POST',value:{includeAssets:true}});
      const bytes=Buffer.from(json(bundle));await retainBytes(paths.imageryExport,bytes);
      journal.expectedImageryReceiving=exportedImageryContent(journal.baseline.imagery,bundle);
      journal.imageryExport={path:paths.imageryExport,bytes:bytes.length,sha256:digest(bytes),digest:bundle.digest,
        editions:bundle.editions.length,files:bundle.files.length,assets:bundle.assets.length};
      if(sourceProcessingWorkspace){
        journal.processingExportId??='managed-export-'+randomUUID();
        await checkpoint('PROCESSING_EXPORT_INTENT',{operationId:journal.processingExportId});
        const job=await client.json('/api/processing/actions/export-handover',{method:'POST',
          value:{operationId:journal.processingExportId,input:{includeStacAssets:true}}});
        need(job.id===journal.processingExportId,'RECEIVING_PROCESSING_JOB_CHANGED');
        const completed=await waitFor(()=>client.json('/api/jobs/'+encodeURIComponent(job.id)),value=>{
          if(value.status==='FAILED')throw Object.assign(new Error(value.error?.message??'The original processing export failed.'),
            {code:value.error?.code??'RECEIVING_PROCESSING_EXPORT_FAILED'});
          return value.status==='COMPLETE';
        },{...waitOptions,label:'processing export'});
        need(completed.result?.exportId===journal.processingExportId,'RECEIVING_PROCESSING_EXPORT_CHANGED');
        const packed=await client.json('/api/processing/reads/handover?exportId='+encodeURIComponent(journal.processingExportId));
        const bytes=Buffer.from(packed.contentBase64,'base64');
        need(bytes.length===packed.bytes&&bytes.toString('base64')===packed.contentBase64&&digest(bytes)===packed.sha256,
          'RECEIVING_PROCESSING_PACK_CHANGED');
        await retainBytes(paths.processingExport,bytes);
        journal.processingExport={path:paths.processingExport,bytes:bytes.length,sha256:packed.sha256,
          digest:packed.manifest.digest,files:packed.manifest.files.length,exportId:journal.processingExportId};
      }
      journal.steps.exported=true;await checkpoint('EXPORTED',{imageryFiles:journal.imageryExport.files,
        processingFiles:journal.processingExport?.files??0});
      await stopRun(record);journal.steps.initialStopped=true;await checkpoint('INITIAL_STOP_COMPLETE');
    }else if(!journal.steps.initialStopped){
      const record=journal.runs.filter(run=>run.slot==='initial').at(-1);
      if(record)await stopRun(record);journal.steps.initialStopped=true;await checkpoint('INITIAL_STOP_COMPLETE');
    }
    if(!journal.steps.complete){
      await manager.close();manager=await modelApi.openRuntimeWorkspace({directory:paths.manager});
      await verifyCopies();await checkpoint('WORKSPACES_REOPENED',{...journal.baseline.imagery.summary});
      const {record,client}=await ensureRun('reopened');
      const observed=await inspectHost(client,journal.baseline.imagery,journal.baseline.processing);
      need(hash(observed)===hash(journal.initialObservation),'RECEIVING_RESTART_CONTENT_CHANGED');
      const reexport=await client.json('/api/handover/export',{method:'POST',value:{includeAssets:true}});
      need(reexport.digest===journal.imageryExport.digest,'RECEIVING_RESTART_EXPORT_CHANGED');
      await checkpoint('RESTART_INSPECTED',{runId:record.requestId,...journal.baseline.imagery.summary});
      if(!journal.steps.received){
        const bytes=await readBytes(paths.imageryExport);
        need(digest(bytes)===journal.imageryExport.sha256,'RECEIVING_EXPORTED_IMAGERY_CHANGED');
        const bundle=JSON.parse(bytes.toString('utf8'));
        journal.receivingIntent??={imagery:randomUUID(),processing:'managed-import-'+randomUUID()};
        await checkpoint('RECEIVING_IMPORT_INTENT',{requestId:journal.receivingIntent.imagery});
        let imagery=await openStacWorkspace({directory:paths.imageryReceiver}),processingImagery=null,processing=null;
        try{
          const receipt=await imagery.importHandover(bundle),received=await inspectImagery(imagery);
          need(received.workspaceId!==journal.baseline.imagery.workspaceId&&
            hash(received.content)===hash(journal.expectedImageryReceiving),'RECEIVING_INDEPENDENT_IMAGERY_CHANGED');
          const revision=(await imagery.getState()).revision;
          need(hash(await imagery.importHandover(bundle))===hash(receipt)&&(await imagery.getState()).revision===revision,
            'RECEIVING_IMAGERY_REPLAY_CHANGED');
          journal.imageryReceipt={...receipt,workspaceId:received.workspaceId,revision,...received.summary};
          if(sourceProcessingWorkspace){
            const packed=await readBytes(paths.processingExport);
            need(digest(packed)===journal.processingExport.sha256,'RECEIVING_EXPORTED_PROCESSING_CHANGED');
            const opened=await portable.unpackProcessingHandover({body:packed,directory:paths.processingUnpacked});
            need(opened.manifest.digest===journal.processingExport.digest,'RECEIVING_PROCESSING_MANIFEST_CHANGED');
            processingImagery=await openStacWorkspace({directory:paths.processingImageryReceiver});
            processing=await processingApi.openProcessingWorkspace({directory:paths.processingReceiver,stacWorkspace:processingImagery});
            const receipt=await processing.importHandover({directory:opened.directory,operationId:journal.receivingIntent.processing});
            const received=await inspectProcessing(processing);
            need(received.workspaceId!==journal.baseline.processing.workspaceId&&
              hash(received.content)===hash(exportedProcessingContent(journal.baseline.processing,opened.payload)),'RECEIVING_INDEPENDENT_PROCESSING_CHANGED');
            const revision=(await processing.getState()).revision;
            need(hash(await processing.importHandover({directory:opened.directory,operationId:journal.receivingIntent.processing}))===hash(receipt)&&
              (await processing.getState()).revision===revision,'RECEIVING_PROCESSING_REPLAY_CHANGED');
            const embedded=await inspectImagery(processingImagery);
            if(opened.stac){
              need(embedded.content.editions.length===opened.stac.editions.length&&
                embedded.content.assets.length===opened.stac.assets.length,'RECEIVING_PROCESSING_IMAGERY_INCOMPLETE');
              for(const edition of embedded.content.editions){
                const original=exportedImageryContent(journal.baseline.imagery,opened.stac).editions.find(e=>e.edition.id===edition.edition.id);
                need(original&&hash(original)===hash(edition),'RECEIVING_PROCESSING_SCENE_CHANGED');
              }
              for(const asset of embedded.content.assets)need(journal.baseline.imagery.content.assets.some(original=>hash(original)===hash(asset)),
                'RECEIVING_PROCESSING_ASSET_CHANGED');
            }
            journal.processingReceipt={...receipt,workspaceId:received.workspaceId,revision,...received.summary,
              imageryWorkspaceId:embedded.workspaceId,embeddedImagery:embedded.summary};
          }
        }finally{await processing?.close();await processingImagery?.close();await imagery.close();}
        imagery=await openStacWorkspace({directory:paths.imageryReceiver,create:false});
        try{
          const reopened=await inspectImagery(imagery);
          need(reopened.revision===journal.imageryReceipt.revision&&
            reopened.summary.contentSha256===journal.imageryReceipt.contentSha256,'RECEIVING_NATIVE_REOPEN_CHANGED');
        }finally{await imagery.close();}
        if(sourceProcessingWorkspace){
          processingImagery=await openStacWorkspace({directory:paths.processingImageryReceiver,create:false});
          processing=await processingApi.openProcessingWorkspace({directory:paths.processingReceiver,stacWorkspace:processingImagery,create:false});
          try{
            const reopened=await inspectProcessing(processing);
            need(reopened.revision===journal.processingReceipt.revision&&
              reopened.summary.contentSha256===journal.processingReceipt.contentSha256,'RECEIVING_PROCESSING_REOPEN_CHANGED');
          }finally{await processing.close();await processingImagery.close();}
        }
        journal.steps.received=true;await checkpoint('INDEPENDENT_RECEIVING_COMPLETE',{
          imagery:journal.imageryReceipt.contentSha256,processing:journal.processingReceipt?.contentSha256??null});
      }
      await stopRun(record);journal.steps.complete=true;journal.completedAt=timestamp();
      await checkpoint('COMPLETE',{applicationId:journal.applicationId});
    }
    for(const record of journal.runs){
      const current=runFor(await app(),record.requestId);
      need(!current?.active&&(!current||terminal(current)),'RECEIVING_APPLICATION_STILL_ACTIVE');
    }
    const result={schema:SCHEMA,status:'COMPLETE',completedAt:journal.completedAt,directory,
      runtime:journal.runtime,applicationId:journal.applicationId,sourceSha256:journal.hostSourceSha256,
      ...(journal.originalClientSource?{originalClientSource:journal.originalClientSource}:{}),
      runs:journal.runs.map(run=>({id:run.requestId,slot:run.slot,reviewId:run.reviewId,
        recoveries:run.recoveries.length,phase:run.finalPhase,state:run.finalState,connection:run.connection,...(run.originalClient?{originalClient:run.originalClient}:{})})),
      imagery:journal.baseline.imagery.summary,processing:journal.baseline.processing?.summary??null,
      exports:{imagery:journal.imageryExport,processing:journal.processingExport??null},
      receiving:{imagery:journal.imageryReceipt,processing:journal.processingReceipt??null},
      journal:journalPath};
    await atomicJSON(join(directory,'managed-applications-result.json'),result);
    return result;
  }catch(error){
    journal.error={...safeError(error),at:timestamp()};await checkpoint('INCOMPLETE',{error:journal.error.code}).catch(()=>{});
    if(manager&&journal.applicationId){
      for(const record of journal.runs){
        try{const current=runFor(await app(),record.requestId);if(current?.active)await stopRun(record);}
        catch(stopError){journal.stopError=safeError(stopError);await atomicJSON(journalPath,journal).catch(()=>{});}
      }
    }
    throw error;
  }finally{originalClient?.close();await manager?.close();}
  }finally{await receivingLease.close();}
}

const HELP='Run the original managed STAC receiving lifecycle:\n'+
  '  node managed-applications-receiving.mjs --input /absolute/private-receiving-input.json\n'+
  '  node managed-applications-receiving.mjs --runtime /absolute/ready-runtime --workspace /absolute/closed-imagery'+
  ' --directory /absolute/private-receiving [--processing-workspace /absolute/closed-processing] [--timeout-ms 180000]\n\n'+
  'Run the same command and receiving directory to resume recorded application requests.\n'+
  'The runtime is attached through the original Applications manager. Complete private exports and receiving results stay in --directory.\n';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags=Object.create(null),args=process.argv.slice(2);
  if(args.includes('--help'))process.stdout.write(HELP);
  else{
    try{
      const allowed=new Set(['input','runtime','workspace','processing-workspace','directory','timeout-ms','label']);
      for(let i=0;i<args.length;i+=2){
        need(args[i].startsWith('--')&&allowed.has(args[i].slice(2))&&args[i+1]!==undefined&&!args[i+1].startsWith('--'),
          'RECEIVING_ARGUMENT_INVALID',HELP);
        const key=args[i].slice(2);need(!own.call(flags,key),'RECEIVING_ARGUMENT_REPEATED');flags[key]=args[i+1];
      }
      let input;
      if(flags.input){
        need(Object.keys(flags).length===1,'RECEIVING_INPUT_EXCLUSIVE');
        const path=absolute(flags.input),info=await lstat(path);
        need(info.isFile()&&!info.isSymbolicLink()&&await realpath(dirname(path))===dirname(path)&&
          !(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),'RECEIVING_PRIVATE_INPUT_REQUIRED');
        input=await readJSON(path);
        const keys=new Set(['schema','runtimeDirectory','sourceWorkspace','sourceProcessingWorkspace','directory','label','timeoutMs','pollMs']);
        need(input?.schema===MANAGED_STAC_RECEIVING_INPUT&&Object.keys(input).every(key=>keys.has(key)),
          'RECEIVING_INPUT_SCHEMA_INVALID');
        const {schema,...request}=input;input=request;
      }else input={runtimeDirectory:flags.runtime,sourceWorkspace:flags.workspace,
        sourceProcessingWorkspace:flags['processing-workspace']??null,directory:flags.directory,
        label:flags.label??'Satellite imagery and processing receiving',
        timeoutMs:flags['timeout-ms']===undefined?180000:Number(flags['timeout-ms'])};
      const result=await runManagedStacReceiving({...input,
        onStage:stage=>process.stdout.write(JSON.stringify({managedReceiving:stage})+'\n')});
      process.stdout.write(JSON.stringify(result)+'\n');
    }catch(error){process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;}
  }
}
