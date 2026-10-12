#!/usr/bin/env node
// MIT. One original Applications continuation inside native_receiving.py.
import { constants, fstatSync } from 'node:fs';
import { open, mkdir, readFile, rename, unlink, realpath } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const SCHEMA='stellar-forge.python-managed-receiving.v1';
const PREFIX='stellar/scf-starforge-20261009/distribution/';
export const REQUIRED_APPLICATION_FILES=Object.freeze([
  'runtime-workspace/model.mjs','runtime-workspace/worker.mjs','runtime-workspace/storage.mjs',
  'runtime-workspace/applications.mjs','runtime-workspace/application-command.mjs',
  'runtime-workspace/managed-workspace.mjs','runtime-workspace/managed-command.mjs',
  'python-runtime/workspace.mjs','python-runtime/command-binding.mjs',
  'python-runtime/application-lifecycle.mjs','python-runtime/engine.py',
].map(path=>PREFIX+path));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encoded=value=>JSON.stringify(canonical(value),null,2)+'\n';
const need=(value,code,detail)=>{if(!value)throw Object.assign(new Error(detail??code),{code});};
const absolute=value=>{need(typeof value==='string' && isAbsolute(value) && resolve(value)===value,'ABSOLUTE_NATIVE_PATH_REQUIRED');return value;};
const uuid=value=>{const h=hash(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
async function read(path,optional=false,max=4*1024*1024){
  let file;
  try{
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await file.stat();
    need(before.isFile() && before.size<=max,'RECEIVING_FILE_INVALID');
    const bytes=await file.readFile(),after=await file.stat();
    need(bytes.length===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs &&
      before.ctimeMs===after.ctimeMs,'RECEIVING_FILE_CHANGED');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(error){if(optional && error.code==='ENOENT')return null;throw error;}
  finally{await file?.close();}
}
async function privateDirectory(path){
  const h=await open(absolute(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const s=await h.stat();need(!(s.mode&0o077) && (!process.getuid || s.uid===process.getuid()),'PRIVATE_NATIVE_DIRECTORY_REQUIRED');}
  finally{await h.close();}
  return path;
}
async function ensurePrivate(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
async function save(path,value){
  const pending=path+'.pending-'+randomUUID(),h=await open(pending,'wx',0o600);
  try{await h.writeFile(encoded(value));await h.sync();}finally{await h.close();}
  try{
    await rename(pending,path);
    const d=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await d.sync();}finally{await d.close();}
  }catch(error){await unlink(pending).catch(()=>{});throw error;}
}
async function verifyController(selection){
  absolute(selection.sourceRoot);
  need(/^[a-f0-9]{40}$/.test(selection.sourceCommit??'') && Array.isArray(selection.files),
    'APPLICATIONS_SOURCE_SELECTION_REQUIRED');
  const declared=new Map();
  for(const file of selection.files){
    need(file && typeof file.path==='string' && !isAbsolute(file.path) &&
      file.path.split('/').every(part=>part && part!=='.' && part!=='..') &&
      /^[a-f0-9]{64}$/.test(file.sha256??'') && !declared.has(file.path),'APPLICATIONS_SOURCE_MEMBER_INVALID');
    declared.set(file.path,file.sha256);
  }
  for(const path of REQUIRED_APPLICATION_FILES)need(declared.has(path),'APPLICATIONS_SOURCE_MEMBER_REQUIRED',path);
  const files=[];
  for(const [path,expected] of declared){
    const handle=await open(join(selection.sourceRoot,path),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const s=await handle.stat();need(s.isFile() && s.size<=16*1024*1024,'APPLICATIONS_SOURCE_MEMBER_INVALID');
      const bytes=await handle.readFile(),after=await handle.stat();
      need(bytes.length===s.size && s.size===after.size && s.mtimeMs===after.mtimeMs &&
        hash(bytes)===expected,'APPLICATIONS_SOURCE_MEMBER_CHANGED',path);
      files.push({path,sha256:expected,bytes:bytes.length});
    }finally{await handle.close();}
  }
  return {sourceRoot:selection.sourceRoot,sourceCommit:selection.sourceCommit,
    files:files.sort((a,b)=>a.path.localeCompare(b.path)),filesSha256:hash(encoded(files.sort((a,b)=>a.path.localeCompare(b.path))))};
}
async function pause(ms=150){await new Promise(done=>setTimeout(done,ms));}
async function until(readValue,accept,{timeout=120000,cleanup=false}={}){
  const end=Date.now()+timeout;
  while(true){
    if(!cleanup)need(!stopping,'NATIVE_RECEIVING_STOP_REQUESTED');
    const value=await readValue();
    if(accept(value))return value;
    need(Date.now()<end,'NATIVE_APPLICATION_TIMEOUT');
    await pause();
  }
}
async function authenticatedState(url,workspaceId){
  const parsed=new URL(url);
  need(parsed.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) &&
    parsed.hash && !parsed.username && !parsed.password,'ORIGINAL_PRIVATE_APPLICATION_URL_REQUIRED');
  const token=decodeURIComponent(parsed.hash.slice(1));
  const response=await fetch(new URL('/api/state',parsed.origin),{
    headers:{'X-Analysis-Capability':token},redirect:'error',signal:AbortSignal.timeout(10000),
  });
  need(response.status===200,'ORIGINAL_ANALYSIS_HTTP_FAILED','Original /api/state returned '+response.status);
  const body=await response.json();
  need(body.schema==='stellar-forge.customer-analysis.v1' && body.workspace_id===workspaceId,
    'ORIGINAL_ANALYSIS_IDENTITY_CHANGED');
  const projection={workspace_id:body.workspace_id,sources:body.sources,queries:body.queries,
    views:body.views,workbooks:body.workbooks};
  return {workspaceId,projectionSha256:hash(encoded(projection)),httpStatus:response.status,
    sourceCount:Array.isArray(body.sources)?body.sources.length:null,
    workbookCount:Array.isArray(body.workbooks)?body.workbooks.length:null};
}
async function controllerWorkspace(api,directory,checkpoint,persist){
  for(;;){
    const selected=checkpoint.operatorDirectory??join(directory,'operator');
    checkpoint.operatorDirectory=selected;await persist();
    const config=await read(join(selected,'workspace.json'),true);
    if(config)return api.openRuntimeWorkspace({directory:selected});
    try{
      await api.createRuntimeWorkspace({directory:selected});
      return api.openRuntimeWorkspace({directory:selected});
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      // An interrupted empty bootstrap has admitted no product operation. Keep
      // its path and let the original constructor create one new complete home.
      need(!await read(join(selected,'workspace.json'),true),'OPERATOR_BOOTSTRAP_CHANGED');
      checkpoint.bootstrapRecoveries??=[];
      checkpoint.bootstrapRecoveries.push(selected);
      need(checkpoint.bootstrapRecoveries.length<=3,'OPERATOR_BOOTSTRAP_INCOMPLETE');
      checkpoint.operatorDirectory=join(directory,'operator-recovered-'+checkpoint.bootstrapRecoveries.length);
      await persist();
    }
  }
}
export async function runManagedReceiving(request){
  need(request && typeof request.operation_id==='string' && request.operation_id.length<=160,
    'ORIGINAL_NATIVE_OPERATION_REQUIRED');
  absolute(request.directory);absolute(request.node);absolute(request.customer?.database);
  need(Number.isInteger(request.lease_fd) && request.lease_fd>=3,'ORIGINAL_NATIVE_LEASE_REQUIRED');
  fstatSync(request.lease_fd);
  need(await realpath(process.execPath)===await realpath(request.node),'ORIGINAL_NODE_EXECUTABLE_CHANGED');
  const directory=await ensurePrivate(request.directory);
  const controller=await verifyController(request.applications);
  const source=request.source,installation=request.installation;
  need(source && installation && /^[a-f0-9]{40}$/.test(source.sourceCommit??'') &&
    /^[a-f0-9]{64}$/.test(source.sourceManifestSha256??'') &&
    /^[a-f0-9]{64}$/.test(installation.id??''),'ORIGINAL_RUNTIME_SELECTION_REQUIRED');
  await privateDirectory(source.directory);await privateDirectory(request.customer.database);
  need(installation.directory===join(source.directory,'python-runtime','installations',installation.id) ||
    installation.directory?.startsWith(join(source.directory,'python-runtime')+'/'),
    'INSTALLATION_MUST_USE_ORIGINAL_RUNTIME_ROOT');
  absolute(installation.python);
  const {lease_fd,...intent}=request,intentHash=hash(encoded(intent)),checkpointPath=join(directory,'managed-receiving.json');
  let checkpoint=await read(checkpointPath,true);
  need(!checkpoint || checkpoint.schema===SCHEMA && checkpoint.intentHash===intentHash,'NATIVE_RECEIVING_INTENT_CHANGED');
  checkpoint??={schema:SCHEMA,intentHash,operationId:request.operation_id,controller,createdAt:new Date().toISOString(),runs:[]};
  const persist=async()=>save(checkpointPath,checkpoint);
  if(checkpoint.result)return checkpoint.result;
  await persist();
  const api=await import(pathToFileURL(join(controller.sourceRoot,PREFIX,'runtime-workspace/model.mjs')).href);
  let model=await controllerWorkspace(api,directory,checkpoint,persist);
  let currentRun=null;
  const root=checkpoint.operatorDirectory;
  const operationId=stage=>uuid(request.operation_id+'\n'+directory+'\n'+stage);
  const appView=async()=>{const state=await model.applicationsState();return state.applications.find(app=>app.id===checkpoint.applicationId);};
  const rowFor=async id=>(await appView())?.runs.find(run=>run.id===id);
  const stopRun=async(id,cleanup=false)=>{
    const row=await rowFor(id);
    if(!row)return null;
    if(row.active || ['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(row.phase))
      await model.applicationsStop({applicationId:checkpoint.applicationId,operationId:id});
    return until(()=>rowFor(id),row=>row && !row.active && !['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(row.phase),
      {timeout:30000,cleanup});
  };
  try{
    if(!checkpoint.runtime){
      checkpoint.runtime=await model.attach({directory:source.directory,label:'Received workbook runtime'});await persist();
    }
    const runtimeId=checkpoint.runtime.runtimeId;
    need(runtimeId===hash(source.directory).slice(0,24),'ORIGINAL_RUNTIME_DIRECTORY_CHANGED');
    const inspectId=operationId('inspect-installed-python');
    if(!checkpoint.pythonInspected){
      const admitted=await model.begin({requestId:inspectId,operation:'python-inspect',runtimeId,
        python:installation.python,installationId:installation.id});
      if(admitted.reopened){
        const pending=(await model.state({runtimeId})).operations.find(item=>item.id===inspectId);
        if(pending?.phase==='QUEUED' && !pending.workerActive)await model.resumeQueued(inspectId);
        else if(pending?.phase==='RUNNING' && !pending.workerActive)await model.recoverPythonOperation(inspectId);
      }
      const job=await until(async()=>{
        const state=await model.state({runtimeId}),job=state.operations.find(item=>item.id===inspectId);
        if(job?.phase==='FAILED')throw Object.assign(new Error(job.error?.message??'Original Python inspection failed'),
          {code:job.error?.code??'ORIGINAL_PYTHON_INSPECTION_FAILED'});
        return job;
      },job=>job?.phase==='SUCCEEDED');
      const view=await model.pythonState({runtimeId}),saved=view.installations.find(item=>item.id===installation.id);
      need(saved?.python===installation.python && saved.source.releaseId===source.sourceCommit &&
        saved.source.releaseDigest===source.sourceManifestSha256,'ORIGINAL_PYTHON_INSTALLATION_CHANGED');
      checkpoint.pythonInspected={operationId:inspectId,installationId:installation.id,python:saved.python,
        sourceId:saved.source.id,lockSha256:saved.lockSha256};await persist();
    }
    if(!checkpoint.review){
      checkpoint.review=await model.applicationsReview({runtimeId,kind:'python-analysis',
        label:'Received customer analysis',settings:{installationId:installation.id,
          databaseDirectory:request.customer.database,nodeExecutable:request.node,port:0}});
      await persist();
    }
    if(!checkpoint.applicationId){
      const saved=await model.applicationsSave({requestId:operationId('save-analysis'),reviewId:checkpoint.review.id});
      checkpoint.applicationId=saved.applicationId;await persist();
    }
    let app=await appView();
    if(!app?.release)await model.applicationsConnect({applicationId:checkpoint.applicationId});
    await until(appView,value=>{
      if(value?.adoption?.phase==='FAILED')throw Object.assign(new Error(value.adoption.state?.error?.message??'Original managed adoption failed'),
        {code:value.adoption.state?.error?.code??'ORIGINAL_MANAGED_ADOPTION_FAILED'});
      return Boolean(value?.release);
    });
    for(let number=0;number<2;number++){
      let run=checkpoint.runs[number];
      if(run?.stopped && run.operatorReopened)continue;
      if(run){
        let retained=await rowFor(run.id);
        if(retained && !retained.active && retained.phase==='INTERRUPTED'){
          await model.applicationsRecover({applicationId:checkpoint.applicationId,operationId:run.id});
          retained=await rowFor(run.id);
        }
        if(retained && !retained.active && ['FAILED','SUCCEEDED','CANCELLED'].includes(retained.phase)){
          if(run.observed && run.operatorReopened && retained.result?.state==='STOPPED' && retained.result.exitCode===0){
            run.stopped={phase:retained.phase,state:retained.result.state,exitCode:retained.result.exitCode,
              signal:retained.result.signal,completedAt:retained.result.completedAt};
            await persist();continue;
          }
          // A confirmed ended command cannot be respawned by its original run
          // ID. Retain it and prepare one newly reviewed continuation for this
          // incomplete logical leg through the same application.
          checkpoint.endedRuns??=[];
          checkpoint.endedRuns.push({...run,logicalLeg:number,terminal:{phase:retained.phase,
            result:retained.result??null,error:retained.state?.error??null},
            originalOperation:join(root,'operations',run.id)});
          checkpoint.nextContinuations??={};
          checkpoint.nextContinuations[number]=(run.continuation??0)+1;
          checkpoint.runs[number]=null;run=null;await persist();
        }
      }
      if(!run){
        const continuation=checkpoint.nextContinuations?.[number]??0;
        const reviewed=await model.applicationsStartReview({applicationId:checkpoint.applicationId});
        run={id:operationId('analysis-start-'+number+'-'+continuation),continuation,reviewId:reviewed.id,
          bindingFingerprint:reviewed.command.pythonCommand.fingerprint};
        checkpoint.runs[number]=run;await persist();
      }
      currentRun=run.id;
      const admitted=await model.applicationsStart({applicationId:checkpoint.applicationId,requestId:run.id,reviewId:run.reviewId});
      if(admitted.reopened){
        const existing=await rowFor(run.id);
        if(existing && !existing.active && ['PENDING','QUEUED','INTERRUPTED'].includes(existing.phase))
          await model.applicationsRecover({applicationId:checkpoint.applicationId,operationId:run.id});
      }
      if(!run.observed){
        const row=await until(()=>rowFor(run.id),value=>{
          if(value && !value.active && ['FAILED','SUCCEEDED','CANCELLED'].includes(value.phase))
            throw Object.assign(new Error('Original Analysis ended before its ready observation; inspect '+join(root,'operations',run.id,'worker.log')),
              {code:'ORIGINAL_ANALYSIS_ENDED_BEFORE_READY'});
          return Boolean(value?.privateUrl);
        });
        const urlReceipt=await read(join(root,'operations',run.id,'application-url.json'));
        const nativeProcess=await read(join(root,'operations',run.id,'command-process.json'));
        const privateLaunch=await read(join(request.customer.database,'analysis-launch.json'),false,65536);
        need(urlReceipt.bindingFingerprint===run.bindingFingerprint &&
          urlReceipt.pythonInstallation===installation.id && urlReceipt.url===row.privateUrl &&
          urlReceipt.originalPid===nativeProcess.original.pid && privateLaunch.pid===urlReceipt.originalPid &&
          privateLaunch.workspace_id===request.customer.workspace_id && privateLaunch.url===row.privateUrl,
          'ORIGINAL_APPLICATION_CUSTODY_CHANGED');
        const state=await authenticatedState(row.privateUrl,request.customer.workspace_id);
        run.observed={...state,pid:urlReceipt.originalPid,readyReceipt:join(root,'operations',run.id,'application-url.json'),
          privateUrlSha256:hash(row.privateUrl),bindingFingerprint:run.bindingFingerprint};
        await persist();
      }
      if(!run.operatorReopened){
        await model.close();model=await api.openRuntimeWorkspace({directory:root});
        const reopened=await rowFor(run.id);
        need(reopened?.active && reopened.privateUrl && hash(reopened.privateUrl)===run.observed.privateUrlSha256,
          'ORIGINAL_OPERATOR_REOPEN_CHANGED');
        const again=await authenticatedState(reopened.privateUrl,request.customer.workspace_id);
        need(again.projectionSha256===run.observed.projectionSha256,'ORIGINAL_CUSTOMER_STATE_CHANGED');
        run.operatorReopened=true;await persist();
      }
      const stopped=await stopRun(run.id);
      need(stopped?.result?.state==='STOPPED' && stopped.result.exitCode===0,
        'ORIGINAL_ANALYSIS_DRAIN_FAILED');
      run.stopped={phase:stopped.phase,state:stopped.result.state,exitCode:stopped.result.exitCode,
        signal:stopped.result.signal,completedAt:stopped.result.completedAt};
      currentRun=null;await persist();
    }
    need(checkpoint.runs[0].observed.projectionSha256===checkpoint.runs[1].observed.projectionSha256,
      'CUSTOMER_RESTART_STATE_CHANGED');
    const final=await appView();
    need(final?.phase==='STOPPED' && final.runs.every(run=>!run.active),'ORIGINAL_APPLICATION_REMAINS_ACTIVE');
    const result={schema:SCHEMA,status:'COMPLETE',operationId:request.operation_id,operatorDirectory:root,
      controller:{sourceCommit:controller.sourceCommit,sourceRoot:controller.sourceRoot,filesSha256:controller.filesSha256},
      customerSource:{sourceCommit:source.sourceCommit,sourceManifestSha256:source.sourceManifestSha256,
        sourceRoot:source.sourceRoot,runtimeDirectory:source.directory},
      installation:checkpoint.pythonInspected,workspaceId:request.customer.workspace_id,
      applicationId:checkpoint.applicationId,applicationRevision:final.revision,
      endedRuns:checkpoint.endedRuns??[],
      runs:checkpoint.runs.map(run=>({id:run.id,reviewId:run.reviewId,...run.observed,
        operatorReopened:run.operatorReopened,stopped:run.stopped})),completedAt:new Date().toISOString()};
    checkpoint.result=result;await persist();return result;
  }finally{
    if(currentRun)await stopRun(currentRun,true);
    await model.close();
  }
}
async function main(){
  const args=process.argv.slice(2);
  need(args.length===2 && args[0]==='--request','EXPECTED_REQUEST_FILE');
  const request=await read(absolute(args[1]));
  const result=await runManagedReceiving(request);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'MANAGED_RECEIVING_FAILED',message:error.message})+'\n');process.exitCode=1;});
