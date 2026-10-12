// MIT. Complete publisher receiving through the original Applications manager.
import {constants} from 'node:fs';
import {open,mkdir,readdir,lstat,realpath,rename,unlink,rmdir,link} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectRuntimeInstall} from '../runtime-install.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {operationLease} from './storage.mjs';

export const MANAGED_PUBLISHER_RECEIVING_INPUT='stellar-forge.360giving-managed-receiving-input.v1';
const SCHEMA='stellar-forge.360giving-managed-receiving.v1';
const runFile=promisify(execFile), KIND='publisher-360giving';
const SOURCE='stellar/scf-starforge-20261009';
const MAX_JSON=128*1024*1024;
const own=Object.prototype.hasOwnProperty;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>digest(JSON.stringify(canonical(value)));
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const timestamp=()=>new Date().toISOString();
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const safeError=error=>({code:error.code??'MANAGED_PUBLISHER_RECEIVING_FAILED',
  message:String(error.message??error).replace(/#[A-Za-z0-9_-]{43}/g,'#[private]').slice(0,1600)});
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

const sorted=(items,key='id')=>[...items].sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
function content(state){
  need(state?.schema==='stellar-forge.360giving-operator.v1'&&
    ['datasets','editions','decisions','candidates'].every(key=>Array.isArray(state[key])),
    'RECEIVING_PUBLISHER_STATE_INVALID');
  return {datasets:sorted(state.datasets,'key'),editions:sorted(state.editions),
    decisions:[...state.decisions].sort((a,b)=>(a.editionId+'/'+a.id).localeCompare(b.editionId+'/'+b.id)),
    candidates:sorted(state.candidates)};
}
function selectionPlan(state){
  const result=[];
  for(const edition of content(state).editions){
    result.push({edition:edition.id,decision:null,candidate:null});
    const candidates=state.candidates.filter(item=>item.editionId===edition.id);
    for(const decision of state.decisions.filter(item=>item.editionId===edition.id)){
      const selected=candidates.filter(item=>item.decisionId===decision.id);
      for(const candidate of selected.length?selected:[null])
        result.push({edition:edition.id,decision:decision.id,candidate:candidate?.id??null});
    }
    need(candidates.every(candidate=>result.some(item=>item.candidate===candidate.id)),
      'RECEIVING_CANDIDATE_REVIEW_MISSING');
  }
  need(result.length>0,'RECEIVING_SAVED_EDITION_REQUIRED');
  return result;
}
async function recoverEmptyInitialization(path,allowed,intent){
  if(!await exists(path))return;
  need(intent,'RECEIVING_INITIALIZATION_INTENT_MISSING');
  await privateDirectory(path);
  const names=await readdir(path);
  for(const name of names){
    need(allowed.has(name),'RECEIVING_INITIALIZATION_HAS_RETAINED_FILES');
    const child=await privateDirectory(join(path,name));
    need((await readdir(child)).length===0,'RECEIVING_INITIALIZATION_HAS_RETAINED_FILES');
  }
  for(const name of names)await rmdir(join(path,name));
  await rmdir(path);
}

/** Reuse this receiving directory to continue its saved Applications and publisher requests. */
export async function runManagedPublisherReceiving({
  runtimeDirectory,sourceWorkspace,pythonExecutable,directory,
  label='360Giving publisher receiving',timeoutMs=180000,pollMs=500,queryPageSize=250,onStage=()=>{},
}={}){
  for(const path of [runtimeDirectory,sourceWorkspace,pythonExecutable,directory])absolute(path);
  need(typeof label==='string'&&label.trim()&&label.length<=100,'RECEIVING_LABEL_REQUIRED');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&Number.isSafeInteger(pollMs)&&pollMs>=50&&
    Number.isSafeInteger(queryPageSize)&&queryPageSize>=1&&queryPageSize<=1000,'RECEIVING_WAIT_OPTIONS_INVALID');
  need(separate(directory,runtimeDirectory)&&separate(directory,sourceWorkspace),
    'RECEIVING_SEPARATE_DIRECTORY_REQUIRED');
  await privateDirectory(sourceWorkspace);
  const input={runtimeDirectory,sourceWorkspace,pythonExecutable,label,queryPageSize};
  const journalPath=join(directory,'receiving-journal.json'),wasPresent=await exists(directory);
  await privateDirectory(directory,{create:!wasPresent});
  if(wasPresent&&!await exists(journalPath))
    need((await readdir(directory)).every(name=>name==='receiving.lock'),'RECEIVING_RECORDED_DIRECTORY_REQUIRED');
  const lease=await operationLease(join(directory,'receiving.lock'));
  let manager=null,cancelled=false,journal,paths,cli;
  const children=new Set();
  const signal=()=>{cancelled=true;for(const child of children)child.kill('SIGTERM');};
  process.on('SIGINT',signal);process.on('SIGTERM',signal);
  const checkCancelled=()=>need(!cancelled,'RECEIVING_INTERRUPTED','Continue this original receiving directory.');
  try{
    journal=await exists(journalPath)?await readJSON(journalPath):{
      schema:SCHEMA,id:randomUUID(),createdAt:timestamp(),input,stage:'PREPARED',
      steps:{},applications:{},runs:[],exports:[],events:[]};
    need(journal.schema===SCHEMA&&hash(journal.input)===hash(input),'RECEIVING_INPUT_CHANGED');
    const checkpoint=async(stage,details={})=>{
      journal.stage=stage;journal.updatedAt=timestamp();
      journal.events.push({stage,at:journal.updatedAt,...details});
      await atomicJSON(journalPath,journal);await onStage({stage,at:journal.updatedAt,...details});
    };
    const requestId=purpose=>'p-'+hash({receiving:journal.id,purpose}).slice(0,48);
    const waitFor=async(read,predicate,label)=>{
      const deadline=Date.now()+timeoutMs;
      while(true){
        checkCancelled();const value=await read();if(await predicate(value))return value;
        need(Date.now()<deadline,'RECEIVING_LIFECYCLE_TIMEOUT',
          'The original '+label+' remains saved; continue this receiving directory.');
        await delay(pollMs);
      }
    };
    paths={manager:join(directory,'applications'),exports:join(directory,'exports'),
      observations:join(directory,'observations'),receiver:join(directory,'publisher-received')};
    for(const name of ['exports','observations'])await privateDirectory(paths[name],{create:true});
    const checked=await inspectRuntimeInstall({directory:runtimeDirectory,load:false});
    need(checked.status==='READY'&&checked.ready===true,'RECEIVING_READY_RUNTIME_REQUIRED');
    const runtime={directory:checked.directory,installationId:checked.installationId,
      sourceCommit:checked.sourceCommit,profileId:checked.profileId,sourceRoot:checked.sourceRoot};
    if(journal.runtime)need(hash(journal.runtime)===hash(runtime),'RECEIVING_RUNTIME_CHANGED');
    else{journal.runtime=runtime;await checkpoint('RUNTIME_RETAINED',{sourceCommit:runtime.sourceCommit});}
    const packageRoot=join(checked.sourceRoot,SOURCE);
    cli=join(packageRoot,'sf30-seller-sdk','ndjson','360giving','operator','cli.py');
    const modelApi=await import(pathToFileURL(join(packageRoot,'distribution','runtime-workspace','model.mjs')).href);
    async function command(args){
      checkCancelled();
      const invocation=runFile(pythonExecutable,[cli,...args],{
        encoding:'utf8',maxBuffer:MAX_JSON,windowsHide:true,
        env:{...process.env,SF30_XML_NODE:process.env.SF30_XML_NODE||process.execPath,PYTHONDONTWRITEBYTECODE:'1'},
      });
      children.add(invocation.child);
      try{
        const result=await invocation;checkCancelled();return JSON.parse(result.stdout);
      }catch(error){
        if(error.stderr)error.message=String(error.stderr).trim();throw error;
      }finally{children.delete(invocation.child);}
    }
    const connected=(connection,args)=>command(['--connection',connection,...args]);
    const app=async role=>{
      const id=journal.applications[role]?.id;
      const result=(await manager.applicationsState()).applications.find(item=>item.id===id);
      need(result,'RECEIVING_SAVED_APPLICATION_MISSING');return result;
    };
    const runFor=(application,id)=>application.runs.find(run=>run.id===id);
    const terminal=run=>run&&!run.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase);
    async function stopRun(record){
      const saved=journal.applications[record.role];if(!saved?.id)return;
      let current=runFor(await app(record.role),record.requestId);if(!current)return;
      if(!terminal(current)){
        record.stopRequestedAt??=timestamp();await checkpoint('STOP_INTENT',{role:record.role,runId:record.requestId});
        await manager.applicationsStop({applicationId:saved.id,operationId:record.requestId});
        const deadline=Date.now()+timeoutMs;
        while(true){
          current=runFor(await app(record.role),record.requestId);
          if(terminal(current))break;
          need(Date.now()<deadline,'RECEIVING_STOP_PENDING','Continue the original Applications Stop operation.');
          await delay(pollMs);
        }
      }
      record.finalPhase=current.phase;record.finalState=current.result?.state??null;
      record.stoppedAt=timestamp();await checkpoint('STOPPED',{role:record.role,runId:record.requestId,phase:current.phase});
    }
    async function ensureApplication(role,workspace,workspaceId){
      const selected=journal.applications[role]??={workspace,workspaceId,saveRequestId:randomUUID()};
      need(selected.workspace===workspace&&selected.workspaceId===workspaceId,'RECEIVING_WORKSPACE_CHANGED');
      if(!selected.id){
        if(!selected.reviewId){
          await checkpoint('APPLICATION_REVIEW_INTENT',{role,requestId:selected.saveRequestId});
          const review=await manager.applicationsReview({runtimeId:journal.runtimeId,kind:KIND,
            label:label+' '+role,settings:{workspaceDirectory:workspace,pythonExecutable,port:0}});
          selected.reviewId=review.id;selected.connectionRequestId=review.adoption?.requestId??null;
          await checkpoint('APPLICATION_REVIEWED',{role,reviewId:review.id});
        }
        await checkpoint('APPLICATION_SAVE_INTENT',{role,requestId:selected.saveRequestId});
        const saved=await manager.applicationsSave({requestId:selected.saveRequestId,reviewId:selected.reviewId});
        selected.id=saved.applicationId;await checkpoint('APPLICATION_SAVED',{role,applicationId:saved.applicationId});
        if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
      }
      if(!(await app(role)).release){
        await checkpoint('CONNECT_INTENT',{role,applicationId:selected.id,operationId:selected.connectionRequestId});
        await manager.applicationsConnect({applicationId:selected.id});
        await waitFor(()=>app(role),value=>{
          need(!value.adoption||value.adoption.active||!['FAILED','INTERRUPTED'].includes(value.adoption.phase),
            'RECEIVING_CONNECTION_INTERRUPTED','Continue the original Applications connection operation.');
          return Boolean(value.release);
        },'runtime connection');
      }
      await checkpoint('CONNECTED',{role,applicationId:selected.id});
    }
    async function ensureRun(role,slot){
      const saved=journal.applications[role];
      let record=journal.runs.filter(item=>item.role===role&&item.slot===slot).at(-1),application=await app(role);
      need(!application.current?.active||application.current.id===record?.requestId,'RECEIVING_OTHER_RUN_ACTIVE');
      let current=record?runFor(application,record.requestId):null;
      if(record&&terminal(current)){record.finalPhase=current.phase;record=null;}
      if(!record){
        record={role,slot,requestId:randomUUID(),createdAt:timestamp(),recoveries:[]};
        journal.runs.push(record);await checkpoint('START_REVIEW_INTENT',{role,slot,runId:record.requestId});
      }
      if(!record.reviewId){
        const review=await manager.applicationsStartReview({applicationId:saved.id});
        record.reviewId=review.id;await checkpoint('START_REVIEWED',{role,slot,runId:record.requestId,reviewId:review.id});
      }
      current=runFor(await app(role),record.requestId);
      if(!current){
        await checkpoint('START_INTENT',{role,slot,runId:record.requestId});
        await manager.applicationsStart({applicationId:saved.id,requestId:record.requestId,reviewId:record.reviewId});
      }else if(!current.active&&['INTERRUPTED','PENDING','QUEUED'].includes(current.phase)){
        record.recoveries.push({at:timestamp(),phase:current.phase});
        await checkpoint('RECOVER_INTENT',{role,slot,runId:record.requestId});
        await manager.applicationsRecover({applicationId:saved.id,operationId:record.requestId});
      }
      const observed=await waitFor(()=>app(role),value=>{
        const active=runFor(value,record.requestId);
        need(!terminal(active),'RECEIVING_APPLICATION_FINISHED','The original application ended before startup; inspect its saved output.');
        need(active?.phase!=='INTERRUPTED','RECEIVING_APPLICATION_INTERRUPTED');
        return active?.active&&active.url?.url&&!active.stop;
      },'managed publisher startup');
      current=runFor(observed,record.requestId);
      const connectionFile=join(paths.manager,'applications',saved.id,'360giving-connection.json');
      need(current.url.connectionFile===connectionFile,'RECEIVING_CONNECTION_MISSING');
      const info=await lstat(connectionFile);
      need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
        (!process.getuid||info.uid===process.getuid()),'RECEIVING_CONNECTION_NOT_PRIVATE');
      const bytes=await readBytes(connectionFile,65536),connection=JSON.parse(bytes.toString('utf8'));
      need(connection.schema==='stellar-forge.application-url.v1'&&connection.applicationId===saved.id&&
        connection.operationId===record.requestId&&connection.workspaceId===saved.workspaceId&&
        connection.url===current.url.url&&hash(connection.original)===hash(current.url.original),
        'RECEIVING_CONNECTION_CHANGED');
      const previous=journal.runs.filter(item=>item.role===role&&item.requestId!==record.requestId&&item.connection).at(-1);
      const retained={path:connectionFile,workspaceId:saved.workspaceId,sha256:digest(bytes),
        urlSha256:digest(connection.url),bindingSha256:connection.original.bindingSha256,pid:connection.original.pid};
      if(previous)need(previous.connection.path===connectionFile&&previous.connection.workspaceId===saved.workspaceId&&
        previous.connection.urlSha256!==retained.urlSha256,'RECEIVING_CONNECTION_NOT_REPLACED');
      record.connection=retained;record.readyAt=timestamp();
      const state=await connected(connectionFile,['state']);
      need(state.id===saved.workspaceId,'RECEIVING_CONNECTED_WORKSPACE_CHANGED');
      await checkpoint('RUNNING',{role,slot,runId:record.requestId,workspaceId:saved.workspaceId});
      return {record,connection:connectionFile};
    }
    async function savedRequest(connection,purpose,args){
      const id=requestId(purpose),found=await connected(connection,['state']);
      const original=found.requests.find(item=>item.id===id);
      if(original?.status==='interrupted')return connected(connection,['resume','--id',id]);
      return connected(connection,[...args,'--request',id]);
    }
    async function queryAll(connection,dataset,build,output){
      const pending=output+'.pending-'+randomUUID(),handle=await open(pending,'wx',0o600);
      const checksum=createHash('sha256'),seen=new Set();
      let count=0,total=null,fields=null,cursor=null,first=null,bytes=0,pages=0;
      try{
        while(true){
          const query={limit:String(queryPageSize),...(cursor?{cursor}:{})};
          const answer=await connected(connection,['query','--dataset',dataset,'--build',build.id,'--params',JSON.stringify(query)]);
          need(answer.response?.status===200,'RECEIVING_NATIVE_QUERY_FAILED');
          const page=answer.response.body;
          need(Array.isArray(page.rows)&&page.page&&Number.isSafeInteger(page.page.total)&&
            page.page.returned===page.rows.length,'RECEIVING_NATIVE_PAGE_INVALID');
          if(total===null){total=page.page.total;fields=page.fields;}
          need(page.page.total===total&&hash(page.fields)===hash(fields),'RECEIVING_NATIVE_SELECTION_CHANGED');
          for(const row of page.rows){
            first??=row;const line=Buffer.from(JSON.stringify(canonical(row))+'\n');
            await handle.writeFile(line);checksum.update(line);bytes+=line.length;count++;
          }
          pages++;cursor=page.page.nextCursor;
          if(cursor===null)break;
          need(typeof cursor==='string'&&cursor&&!seen.has(cursor)&&page.rows.length>0,'RECEIVING_NATIVE_CURSOR_REPEATED');
          seen.add(cursor);
        }
        need(count===total&&count===build.rowCount,'RECEIVING_COMPLETE_ROWS_CHANGED');
        await handle.sync();await handle.close();
        const identity={bytes,sha256:checksum.digest('hex')};
        if(await exists(output)){
          need(hash(await fileDigest(output))===hash(identity),'RECEIVING_RETAINED_QUERY_CHANGED');await unlink(pending);
        }else{await rename(pending,output);await syncDirectory(dirname(output));}
        if(first&&Object.hasOwn(first,'grant_id')){
          const filtered=await connected(connection,['query','--dataset',dataset,'--build',build.id,
            '--params',JSON.stringify({limit:'2',where_grant_id:first.grant_id})]);
          need(filtered.response?.status===200&&filtered.response.body.rows.length===1&&
            hash(filtered.response.body.rows[0])===hash(first),'RECEIVING_NATIVE_FILTER_CHANGED');
        }
        return {fields,rowCount:count,bytes,sha256:identity.sha256,pages};
      }catch(error){await handle.close().catch(()=>{});await unlink(pending).catch(()=>{});throw error;}
    }
    async function observe(connection,phase,expected=null){
      const state=await connected(connection,['state']),metadata=content(state);
      if(expected)need(hash(metadata)===hash(expected.metadata),'RECEIVING_PUBLISHER_CONTENT_CHANGED');
      const folder=await privateDirectory(join(paths.observations,phase),{create:true});
      await retainBytes(join(folder,'publisher-state.json'),Buffer.from(json(state)));
      const datasets=[];
      for(const dataset of metadata.datasets){
        const place=await privateDirectory(join(folder,dataset.key),{create:true});
        const native=await connected(connection,['native-state','--dataset',dataset.key]),builds=[],comparisons=[];
        for(const build of sorted(native.builds)){
          const query=await queryAll(connection,dataset.key,build,join(place,build.id+'-rows.jsonl'));
          builds.push({build,query});
        }
        for(const comparison of sorted(native.comparisons)){
          const result=await connected(connection,['changes-file','--dataset',dataset.key,'--comparison',comparison.id,
            '--out',join(place,comparison.id+'-changes.jsonl')]);
          need(result.sha256===comparison.changesSha256&&hash(result.comparison)===hash(comparison),
            'RECEIVING_COMPLETE_CHANGES_CHANGED');
          comparisons.push({comparison,bytes:result.bytes,sha256:result.sha256});
        }
        datasets.push({key:dataset.key,builds,comparisons});
      }
      const result={workspaceId:state.id,metadata,datasets,sha256:hash({metadata,datasets})};
      if(expected)need(result.sha256===expected.sha256,'RECEIVING_NATIVE_CONTENT_CHANGED');
      await retainBytes(join(folder,'complete-observation.json'),Buffer.from(json(result)));
      return result;
    }
    async function replayComparisons(connection){
      for(const dataset of journal.baseline.datasets)
        for(const {comparison} of dataset.comparisons){
          const result=await savedRequest(connection,'comparison/'+dataset.key+'/'+comparison.id,
            ['compare','--dataset',dataset.key,'--before',comparison.before,'--after',comparison.after]);
          need(hash(result.result.comparison)===hash(comparison),'RECEIVING_COMPARISON_RECONSTRUCTION_CHANGED');
        }
    }
    try{
      if(!await exists(join(paths.manager,'workspace.json'))){
        await recoverEmptyInitialization(paths.manager,new Set(['runtimes','archives','entries','operations','observations','sources','incoming']),
          journal.managerCreateIntent);
        journal.managerCreateIntent??={id:randomUUID(),at:timestamp()};await checkpoint('MANAGER_CREATE_INTENT');
        await modelApi.createRuntimeWorkspace({directory:paths.manager});
      }
      manager=await modelApi.openRuntimeWorkspace({directory:paths.manager});
      need((await manager.applicationsState()).catalog.some(item=>item.id===KIND),'RECEIVING_PUBLISHER_PROVIDER_REQUIRED');
      if(!journal.runtimeId){
        await checkpoint('ATTACH_INTENT');const attached=await manager.attach({directory:runtimeDirectory,label:'360Giving native publisher runtime'});
        need(attached.status==='READY','RECEIVING_RUNTIME_NOT_READY');journal.runtimeId=attached.runtimeId;
        await checkpoint('ATTACHED',{runtimeId:attached.runtimeId});
      }
      const sourceMarker=await readJSON(join(sourceWorkspace,'workspace.json'));
      need(sourceMarker.schema==='stellar-forge.360giving-operator.v1','RECEIVING_ORIGINAL_PUBLISHER_REQUIRED');
      await ensureApplication('source',sourceWorkspace,sourceMarker.id);
      if(!journal.steps.exported){
        const {record,connection}=await ensureRun('source','original');
        const state=await connected(connection,['state']);
        if(!journal.exportPlan){journal.exportPlan=selectionPlan(state);journal.sourceContent=content(state);
          await checkpoint('EXPORT_PLAN_RETAINED',{archives:journal.exportPlan.length});}
        need(hash(content(state))===hash(journal.sourceContent),'RECEIVING_SOURCE_CHANGED_DURING_EXPORT');
        for(let index=0;index<journal.exportPlan.length;index++){
          const item=journal.exportPlan[index],output=join(paths.exports,String(index+1).padStart(4,'0')+'-complete-handoff.zip');
          const args=['export','--edition',item.edition,...(item.decision?['--decision',item.decision]:[]),
            ...(item.candidate?['--candidate',item.candidate]:[]),'--out',output];
          let result=await savedRequest(connection,'export/'+index,args);
          if(!await exists(output))result=await connected(connection,[...args,'--request',requestId('export/'+index)]);
          const expected={bytes:result.result.bytes,sha256:result.result.sha256};
          need(hash(await fileDigest(output))===hash(expected),'RECEIVING_COMPLETE_EXPORT_CHANGED');
          const exported={...item,requestId:requestId('export/'+index),file:output,...expected};
          if(journal.exports[index])need(hash(journal.exports[index])===hash(exported),'RECEIVING_EXPORT_IDENTITY_CHANGED');
          else{journal.exports[index]=exported;await checkpoint('COMPLETE_EXPORT_RETAINED',{index,sha256:expected.sha256});}
        }
        const baseline=await observe(connection,'source-original');
        need(hash(baseline.metadata)===hash(journal.sourceContent),'RECEIVING_EXPORTED_SOURCE_CHANGED');
        journal.baseline=baseline;journal.steps.exported=true;await checkpoint('EXPORTED',{archives:journal.exports.length});
        await stopRun(record);
      }
      if(!journal.steps.sourceReopened){
        for(const record of journal.runs.filter(item=>item.role==='source'&&item.slot==='original'))await stopRun(record);
        await manager.close();manager=await modelApi.openRuntimeWorkspace({directory:paths.manager});
        const {record,connection}=await ensureRun('source','reopened');
        journal.sourceReopened=await observe(connection,'source-reopened',journal.baseline);
        await stopRun(record);journal.steps.sourceReopened=true;await checkpoint('SOURCE_COLD_REOPEN_COMPLETE');
      }
      for(const record of journal.runs.filter(item=>item.role==='source'))await stopRun(record);
      if(!await exists(join(paths.receiver,'workspace.json'))){
        await recoverEmptyInitialization(paths.receiver,new Set(['objects','datasets','editions','decisions','candidates','native',
          'requests','deliveries','received','tmp']),journal.receiverCreateIntent);
        journal.receiverCreateIntent??={id:randomUUID(),at:timestamp()};await checkpoint('RECEIVER_CREATE_INTENT');
        await command(['--workspace',paths.receiver,'init']);
      }
      const receiverMarker=await readJSON(join(paths.receiver,'workspace.json'));
      need(receiverMarker.id!==sourceMarker.id,'RECEIVING_FRESH_WORKSPACE_REQUIRED');
      await ensureApplication('receiver',paths.receiver,receiverMarker.id);
      if(!journal.steps.received){
        const {record,connection}=await ensureRun('receiver','original');
        for(let index=0;index<journal.exports.length;index++){
          const item=journal.exports[index];
          need(hash(await fileDigest(item.file))===hash({bytes:item.bytes,sha256:item.sha256}),'RECEIVING_EXPORT_CHANGED');
          const result=await savedRequest(connection,'receive/'+index,['receive','--file',item.file]);
          need(result.result.archiveSha256===item.sha256&&result.result.sourceWorkspaceId===sourceMarker.id&&
            result.result.workspaceId===receiverMarker.id&&result.result.editionId===item.edition,'RECEIVING_ARCHIVE_IDENTITY_CHANGED');
        }
        await replayComparisons(connection);
        journal.received=await observe(connection,'receiver-original',journal.baseline);
        await stopRun(record);journal.steps.received=true;await checkpoint('COMPLETE_RECEIVING');
      }
      if(!journal.steps.receiverReopened){
        for(const record of journal.runs.filter(item=>item.role==='receiver'&&item.slot==='original'))await stopRun(record);
        await manager.close();manager=await modelApi.openRuntimeWorkspace({directory:paths.manager});
        const {record,connection}=await ensureRun('receiver','reopened');
        journal.receiverReopened=await observe(connection,'receiver-reopened',journal.baseline);
        await stopRun(record);journal.steps.receiverReopened=true;await checkpoint('RECEIVER_COLD_REOPEN_COMPLETE');
      }
      for(const record of journal.runs)await stopRun(record);
      journal.completedAt??=timestamp();journal.steps.complete=true;await checkpoint('COMPLETE');
      const result={schema:SCHEMA,status:'COMPLETE',completedAt:journal.completedAt,directory,runtime:journal.runtime,
        applications:journal.applications,runs:journal.runs,sourceWorkspaceId:sourceMarker.id,receiverWorkspaceId:receiverMarker.id,
        datasets:journal.baseline.metadata.datasets.length,editions:journal.baseline.metadata.editions.length,
        decisions:journal.baseline.metadata.decisions.length,candidates:journal.baseline.metadata.candidates.length,
        completeContentSha256:journal.baseline.sha256,exports:journal.exports,observations:paths.observations,journal:journalPath};
      await atomicJSON(join(directory,'managed-publisher-result.json'),result);return result;
    }catch(error){
      journal.error={...safeError(error),at:timestamp()};await checkpoint('INTERRUPTED',{error:journal.error.code}).catch(()=>{});
      if(manager)for(const record of journal.runs){
        try{const current=runFor(await app(record.role),record.requestId);if(current&&!terminal(current))await stopRun(record);}
        catch(stopError){journal.stopError=safeError(stopError);await atomicJSON(journalPath,journal).catch(()=>{});}
      }
      throw error;
    }
  }finally{
    for(const child of children)child.kill('SIGTERM');
    await manager?.close();process.off('SIGINT',signal);process.off('SIGTERM',signal);await lease.close();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--help'){
      process.stdout.write('node 360giving-receiving.mjs --input /absolute/private-receiving-input.json\n'+
        'Reuse that input and receiving directory to continue the complete original Applications lifecycle.\n');
    }else{
      need(args.length===2&&args[0]==='--input','RECEIVING_ARGUMENT_INVALID');
      const path=absolute(args[1]),info=await lstat(path);
      need(info.isFile()&&!info.isSymbolicLink()&&await realpath(dirname(path))===dirname(path)&&
        !(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()),'RECEIVING_PRIVATE_INPUT_REQUIRED');
      const raw=await readJSON(path),allowed=new Set(['schema','runtimeDirectory','sourceWorkspace','pythonExecutable',
        'directory','label','timeoutMs','pollMs','queryPageSize']);
      need(raw?.schema===MANAGED_PUBLISHER_RECEIVING_INPUT&&Object.keys(raw).every(key=>allowed.has(key)),
        'RECEIVING_INPUT_SCHEMA_INVALID');
      const {schema,...input}=raw;
      const result=await runManagedPublisherReceiving({...input,
        onStage:stage=>process.stdout.write(JSON.stringify({managedReceiving:stage})+'\n')});
      process.stdout.write(JSON.stringify(result)+'\n');
    }
  }catch(error){process.stderr.write(JSON.stringify({error:safeError(error)})+'\n');process.exitCode=1;}
}
