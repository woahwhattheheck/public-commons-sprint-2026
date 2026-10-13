#!/usr/bin/env node
// MIT. Complete the installed original Conapi supplier project and independent receiver.
import {readFile,writeFile,mkdir,lstat,realpath,rename,open,stat,access} from 'node:fs/promises';
import {createWriteStream,constants} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {finished} from 'node:stream/promises';

const REF='e5520a2a962ccebc461d478edf6aebb4b6c7fb20';
const DIST='stellar/scf-starforge-20261009/distribution/';
const SDK='stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/';
const ANALYSIS='stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/';
const WRI=SDK+'sources/wri-geothermal-20261012/wri-geothermal.sfds.gz';
const WRI_SHA='53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0';
const EDITION_SHA='ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616';
const A='conapi-supplier-a-20261012',B='conapi-wri-b-20261012',C='conapi-supplier-c-20261012';
const SUCCESSOR='conapi-supplier-received-successor-20261012';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const need=(value,code,detail)=>{if(!value)throw Object.assign(new Error(code),{code,detail});};
const stamp=()=>new Date().toISOString();
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const moduleAt=async(root,path)=>import(pathToFileURL(join(root,path)).href);
const issue=error=>({code:error.code??error.name,message:error.message,...(error.detail===undefined?{}:{detail:error.detail})});
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'CONAPI_CANONICAL_PATH',path);return path;}
async function save(path,value,{original=false}={}){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(original&&await exists(path)){need(same(await read(path),value),'CONAPI_ORIGINAL_INPUT_CHANGED',path);return value;}
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await rename(temporary,path);return value;
}
async function file(path){
  const handle=await open(path,'r'),digest=createHash('sha256');let bytes=0;
  try{const before=await handle.stat();for await(const block of handle.createReadStream({autoClose:false})){digest.update(block);bytes+=block.length;}
    const after=await handle.stat();need(before.size===after.size&&before.mtimeMs===after.mtimeMs&&bytes===after.size,'CONAPI_FILE_CHANGED',path);
  }finally{await handle.close();}
  return {path,bytes,sha256:digest.digest('hex')};
}
async function wait(readValue,ready,label,ms=300000){
  const deadline=Date.now()+ms;let last;
  do{last=await readValue();if(ready(last))return last;await sleep(350);}while(Date.now()<deadline);
  throw Object.assign(new Error(label),{code:'CONAPI_OPERATION_PENDING',detail:last});
}
function loggedChild(executable,args,{cwd,logs,label}={}){
  const name=label??'command-'+randomUUID(),errors=[];
  const out=logs?createWriteStream(join(logs,name+'.stdout'),{flags:'a',mode:0o600}):null;
  const err=logs?createWriteStream(join(logs,name+'.stderr'),{flags:'a',mode:0o600}):null;
  const flushes=[['stdout',out],['stderr',err]].filter(([,stream])=>stream).map(([channel,stream])=>
    finished(stream,{cleanup:true}).catch(error=>{errors.push({stage:'log-close',channel,...issue(error)});}));
  let child;
  try{child=spawn(executable,args,{cwd,env:process.env,stdio:['ignore','pipe','pipe']});}
  catch(error){out?.end();err?.end();throw error;}
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk.toString()).slice(-1024*1024);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-1024*1024);});
  for(const [channel,stream] of [['stdout',child.stdout],['stderr',child.stderr]])
    stream.on('error',error=>errors.push({stage:'child-output',channel,...issue(error)}));
  if(out)child.stdout.pipe(out);
  if(err)child.stderr.pipe(err);
  child.once('error',error=>errors.push({stage:'spawn',...issue(error)}));
  // Retain this promise at spawn. A later stop must observe the original close,
  // including all stdio and log writes, even when the child has already exited.
  const completion=new Promise(done=>child.once('close',(code,signal)=>done({code,signal}))).then(async exit=>{
    if(out&&!out.writableEnded&&!out.destroyed)out.end();
    if(err&&!err.writableEnded&&!err.destroyed)err.end();
    await Promise.all(flushes);
    return {...exit,stdout,stderr,errors,completedAt:stamp()};
  });
  return {child,completion,name};
}
async function closeChild(native){
  const child=native.child,alive=()=>child.exitCode===null&&child.signalCode===null;
  if(alive())child.kill('SIGTERM');
  const timer=setTimeout(()=>{if(alive())child.kill('SIGKILL');},10000);
  try{return await native.completion;}finally{clearTimeout(timer);}
}
async function command(executable,args,{cwd,logs,label,acceptFailure=false}={}){
  if(logs)await mkdir(logs,{recursive:true,mode:0o700});
  const native=loggedChild(executable,args,{cwd,logs,label}),value=await native.completion;
  need(value.errors.length===0,'CONAPI_NATIVE_OUTPUT_FAILED',value);
  need(value.code===0||acceptFailure,'CONAPI_NATIVE_COMMAND_FAILED',{name:native.name,...value});
  return value;
}
async function availablePort(){
  const listener=createServer();
  await new Promise((done,fail)=>{listener.once('error',fail);listener.listen(0,'127.0.0.1',done);});
  const port=listener.address().port;await new Promise(done=>listener.close(done));return port;
}


const executionInputKeys=['npm','npmCache','browserExecutable','playwrightModule'];
const semanticInput=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!executionInputKeys.includes(key)));
const executionInput=value=>Object.fromEntries(executionInputKeys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
async function observeHostBinding(input){
  const result={node:{path:process.execPath,version:process.versions.node},values:executionInput(input),files:{}};
  for(const [key,value] of Object.entries({node:process.execPath,python:input.python,
      browserExecutable:input.browserExecutable,playwrightModule:input.playwrightModule})){
    absolute(value);const resolved=await realpath(value),info=await stat(resolved);
    need(info.isFile(),'CONAPI_HOST_BINDING_FILE_REQUIRED',{key,path:value});
    await access(resolved,key==='playwrightModule'?constants.R_OK:constants.X_OK);
    result.files[key]={path:value,resolved,bytes:info.size,mtimeMs:info.mtimeMs};
  }
  absolute(input.npmCache);await mkdir(input.npmCache,{recursive:true,mode:0o700});
  need((await stat(input.npmCache)).isDirectory(),'CONAPI_NPM_CACHE_DIRECTORY_REQUIRED');
  return result;
}

export async function runConapiDelivery(input){
  for(const key of ['repository','outputDirectory','publisherProgrammeDirectory','completedDatasetteReport',
                    'supplierProgramme','python','npmCache','browserExecutable','playwrightModule'])absolute(input[key]);
  need(Number(process.versions.node.split('.')[0])>=24,'CONAPI_NODE_24_REQUIRED');
  const output=input.outputDirectory,logs=join(output,'logs'),stateFile=join(output,'conapi-operating-programme.json');
  await mkdir(output,{recursive:true,mode:0o700});
  need(await realpath(output)===output,'CONAPI_ORIGINAL_DIRECTORY_CHANGED');
  const originalDatasette=await read(input.completedDatasetteReport);
  need(originalDatasette.phase==='COMPLETE','CONAPI_ORIGINAL_DATASETTE_CONTINUATION_REQUIRED');
  const publisher=await read(join(input.publisherProgrammeDirectory,'publisher-programme-result.json'));
  const publisherState=await read(join(input.publisherProgrammeDirectory,'publisher-programme-state.json'));
  need(publisherState.phase==='COMPLETE'&&publisher.sourceRefresh?.state==='COMPLETE'&&publisher.mcpReceiving?.passed,
    'CONAPI_COMPLETE_PUBLISHER_REQUIRED');
  const {transportProgramme,transportMetadata,...originalInput}=input;
  const retainedInput={...originalInput,sourceRef:REF};
  let state=await exists(stateFile)?await read(stateFile):null;
  if(state)need(same(semanticInput(state.input),semanticInput(retainedInput)),'CONAPI_ORIGINAL_PROGRAMME_INPUT_CHANGED');
  else state={schema:'commons.conapi-installed-receiving.v1',operation:'SCF-CONAPI-SUPPLIER-RECEIVING-20261012',
    id:randomUUID(),input:retainedInput,startedAt:stamp(),phase:'CREATED',runtimes:{},applications:{},python:{},runs:[],files:[],checks:{},errors:[]};
  const checkpoint=async phase=>{state.phase=phase;state.updatedAt=stamp();await save(stateFile,state);
    process.stdout.write(JSON.stringify({stage:'conapi_programme',phase,at:state.updatedAt,id:state.id})+'\n');};
  state.executionBindings??={originalInput:executionInput(state.input),attempts:[]};
  need(same(state.executionBindings.originalInput,executionInput(state.input)),'CONAPI_ORIGINAL_HOST_HISTORY_CHANGED');
  const observedBinding=await observeHostBinding(input);
  const previousBinding=state.executionBindings.attempts.at(-1)?.values??state.executionBindings.originalInput;
  const bindingAttempt={id:randomUUID(),at:stamp(),...observedBinding,
    changed:executionInputKeys.filter(key=>previousBinding[key]!==observedBinding.values[key])};
  state.executionBindings.attempts.push(bindingAttempt);
  state.updatedAt=stamp();await save(stateFile,state);
  const rememberFile=async path=>{const value=await file(path);state.files=state.files.filter(x=>x.path!==path);state.files.push(value);return value;};
  if(state.phase==='COMPLETE'){
    for(const selected of state.files){const actual=await file(selected.path);need(same(actual,selected),'CONAPI_DELIVERED_FILE_CHANGED');}
    return {state:'COMPLETE',reused:true,report:stateFile,files:state.files};
  }
  let apps,host,context,supplierProcess,supplierNative,failed=false;
  const active=new Map();
  try{
    await checkpoint('ORIGINAL_INPUTS_RETAINED');
    const repository=join(output,'repository');
    const git=(args,acceptFailure=false)=>command('git',args,{cwd:output,logs,label:'git-source',acceptFailure});
    if(!await exists(join(repository,'.git'))){
      const selected=await git(['-C',input.repository,'cat-file','-e',REF+'^{commit}'],true);
      if(selected.code!==0)await git(['-c','http.version=HTTP/1.1','-c','pack.threads=1','-c','pack.windowMemory=32m',
        '-C',input.repository,'fetch','--no-tags','origin',REF]);
      await git(['-C',input.repository,'worktree','add','--detach',repository,REF]);
    }
    const head=await git(['-C',repository,'rev-parse','HEAD']);
    need(head.stdout.trim()===REF,'CONAPI_SOURCE_COMMIT_CHANGED');
    const dirty=await git(['-C',repository,'status','--porcelain','--untracked-files=no']);
    need(!dirty.stdout.trim(),'CONAPI_ORIGINAL_SOURCE_WORKTREE_CHANGED');
    state.source={repository,commit:REF};
    await checkpoint('ORIGINAL_COMPLETE_SOURCE_SELECTED');
    const builder=await moduleAt(repository,DIST+'build.mjs'),installer=await moduleAt(repository,DIST+'runtime-install.mjs');
    const buildDirectory=join(output,'distribution');
    state.build=await builder.buildDistribution({repository,ref:REF,output:buildDirectory,selection:'datasette',
      offline:true,resume:await exists(buildDirectory),python:input.python,
      onProgress:value=>{if(['selected','materializing','packaged','reused'].includes(value.phase))
        process.stdout.write(JSON.stringify({stage:'conapi_source_build',...value})+'\n');}});
    need(state.build.sourceCommit===REF,'CONAPI_DISTRIBUTION_SOURCE_CHANGED');
    await rememberFile(state.build.archive);await checkpoint('COMPLETE_SOURCE_BUILT');

    const ensureRuntime=async(role,from=null)=>{
      let selection=state.runtimes[role];
      if(!selection){selection=state.runtimes[role]={attempts:[{directory:join(output,role+'-runtime'),from,createdAt:stamp()}]};await checkpoint('RUNTIME_INPUT_RETAINED');}
      let attempt=selection.attempts.at(-1),directory=attempt.directory;
      while(!await exists(join(directory,'runtime-install.json'))||!await exists(join(directory,'install-state.json'))){
        if(await exists(directory)){
          const recoverable=await exists(join(directory,'preparation.json'));
          attempt.observed={at:stamp(),preparation:recoverable,plan:await exists(join(directory,'runtime-install.json')),
            state:await exists(join(directory,'install-state.json'))};
          const previous=directory;
          directory=join(output,role+'-runtime-recovery-'+String(selection.attempts.length).padStart(4,'0'));
          attempt={directory,from:recoverable?previous:attempt.from,previous,createdAt:stamp()};
          selection.attempts.push(attempt);await checkpoint('RUNTIME_CONTINUATION_RETAINED');continue;
        }
        attempt.prepared=attempt.from
          ?await installer.recoverRuntime({from:attempt.from,directory,install:false,python:input.python,npm:input.npm??'npm',
             cache:input.npmCache,offline:role==='received'})
          :await installer.prepareRuntimeInstall({directory,archive:state.build.archive,sha256:state.build.sha256,
             native:false,features:[],operator:false,python:input.python,from:attempt.previous??null});
        need(attempt.prepared.sourceCommit===REF,'CONAPI_RUNTIME_SOURCE_CHANGED');await checkpoint('RUNTIME_PREPARED');
      }
      selection.installed=await installer.installRuntime({directory,offline:role==='received',npm:input.npm??'npm',cache:input.npmCache});
      selection.runtime=await installer.inspectRuntimeInstall({directory,load:true,source:true,python:input.python});
      need(selection.runtime.ready&&selection.runtime.status==='READY'&&selection.runtime.sourceCommit===REF,'CONAPI_RUNTIME_INCOMPLETE');
      await checkpoint('RUNTIME_INSTALLED');return selection.runtime;
    };
    const originalRuntime=await ensureRuntime('original');
    const model=await moduleAt(originalRuntime.sourceRoot,DIST+'runtime-workspace/model.mjs');
    let workspaceSelection=state.runtimeWorkspaceSelection;
    if(!workspaceSelection){
      const directory=state.runtimeWorkspace?.directory??join(output,'applications');
      workspaceSelection=state.runtimeWorkspaceSelection={directory,attempts:[{directory,retainedAt:stamp()}],
        ...(state.runtimeWorkspace?.workspaceId?{workspaceId:state.runtimeWorkspace.workspaceId}:{})};
      await checkpoint('APPLICATIONS_DIRECTORY_RETAINED');
    }
    let appsDirectory=absolute(workspaceSelection.directory);
    if(state.runtimeWorkspace)need(state.runtimeWorkspace.directory===appsDirectory,
      'CONAPI_ORIGINAL_APPLICATIONS_DIRECTORY_CHANGED');
    const declarationPath=()=>join(appsDirectory,'workspace.json');
    if(!await exists(declarationPath())){
      // createRuntimeWorkspace commits workspace.json last and requires a new
      // directory. Preserve an unfinished creation; never replace a workspace
      // that already owns saved applications or accepted native operations.
      need(!state.runtimeWorkspace&&!workspaceSelection.workspaceId&&
        Object.keys(state.applications).length===0&&Object.keys(state.python).length===0&&state.runs.length===0,
        'CONAPI_ORIGINAL_APPLICATIONS_WORKSPACE_MISSING',{directory:appsDirectory});
      if(await exists(appsDirectory)){
        const prior=workspaceSelection.attempts.at(-1);
        prior.preservedAt=stamp();prior.state='INITIALIZATION_INCOMPLETE';
        appsDirectory=join(output,'applications-recovery-'+randomUUID());
        need(!await exists(appsDirectory),'CONAPI_APPLICATIONS_TARGET_EXISTS',appsDirectory);
        workspaceSelection.directory=appsDirectory;
        workspaceSelection.attempts.push({directory:appsDirectory,retainedAt:stamp()});
        await checkpoint('APPLICATIONS_INITIALIZATION_RECOVERY_RETAINED');
      }
      await model.createRuntimeWorkspace({directory:appsDirectory});
    }
    const declaration=await read(declarationPath());
    if(workspaceSelection.workspaceId)need(workspaceSelection.workspaceId===declaration.workspaceId,
      'CONAPI_ORIGINAL_APPLICATIONS_ID_CHANGED');
    apps=await model.openRuntimeWorkspace({directory:appsDirectory});
    workspaceSelection.workspaceId=declaration.workspaceId;
    workspaceSelection.attempts.at(-1).state='CREATED';
    await checkpoint('APPLICATIONS_WORKSPACE_OPEN');
    const originalAttachment=await apps.attach({directory:originalRuntime.directory,label:'Conapi original complete supplier delivery'});
    const applicationCatalog=await apps.applicationsState();
    for(const kind of ['datasette','datasette-analysis','datasette-workflow'])
      need(applicationCatalog.catalog.some(item=>item.id===kind),'CONAPI_INSTALLED_APPLICATION_MISSING',kind);
    state.runtimeWorkspace={...state.runtimeWorkspace,directory:appsDirectory,workspaceId:declaration.workspaceId,
      sourceRoot:originalRuntime.sourceRoot,sourceCommit:REF};
    const server=await moduleAt(originalRuntime.sourceRoot,DIST+'runtime-workspace/server.mjs');
    host=await server.startRuntimeWorkspace({directory:appsDirectory,port:0});
    state.runtimeWorkspace.listener={url:host.url,origin:host.origin,at:stamp()};
    await checkpoint('FINAL_SOURCE_APPLICATIONS_OPEN');

    const pythonOperation=async(role,fields)=>{
      let operation=state.python[role];
      if(!operation){operation=state.python[role]={request:{requestId:randomUUID(),...fields},createdAt:stamp()};await checkpoint('PYTHON_OPERATION_RETAINED');}
      need(same({...operation.request,requestId:undefined},{...fields,requestId:undefined}),'CONAPI_PYTHON_SELECTION_CHANGED');
      operation.dispatch=await apps.begin(operation.request);await checkpoint('PYTHON_OPERATION_DISPATCHED');
      let current=(await apps.state()).operations.find(item=>item.id===operation.request.requestId);
      if(current&&!current.workerActive&&!current.commandActive&&current.displayPhase==='INTERRUPTED'){
        operation.recoveries??=[];operation.recoveries.push({at:stamp(),result:await apps.recoverPythonOperation(current.id)});
      }else if(current?.phase==='QUEUED'&&!current.workerActive){
        operation.recoveries??=[];operation.recoveries.push({at:stamp(),result:await apps.resumeQueued(current.id)});
      }else if(current?.phase==='FAILED'){
        operation.recoveries??=[];operation.recoveries.push({at:stamp(),result:await apps.recoverPythonOperation(current.id)});
      }
      current=await wait(async()=>(await apps.state()).operations.find(item=>item.id===operation.request.requestId),
        value=>['SUCCEEDED','FAILED','CANCELLED'].includes(value?.phase)||value?.displayPhase==='INTERRUPTED',
        'Complete the original '+fields.operation+' operation.',3600000);
      operation.observed=current;await checkpoint('PYTHON_OPERATION_RETURNED');
      need(current?.phase==='SUCCEEDED','CONAPI_PYTHON_OPERATION_INCOMPLETE',current);
      const receipt=current.result;
      need(receipt?.schema==='stellar-forge.python-operation-result.v1'&&receipt.operation===fields.operation,
        'CONAPI_PYTHON_RESULT_REQUIRED',receipt);
      operation.result=receipt.result;await checkpoint('PYTHON_RESULT_RETAINED');return receipt.result;
    };
    let originalReview=state.originalPythonReview;
    if(!originalReview){originalReview=state.originalPythonReview=await apps.pythonReview({runtimeId:originalAttachment.runtimeId,
      python:input.python,extras:['workbooks']});await checkpoint('PYTHON_REVIEWED');}
    const candidate=await pythonOperation('original-resolve',{operation:'python-resolve',runtimeId:originalAttachment.runtimeId,
      reviewId:originalReview.reviewId});
    const installedPython=await pythonOperation('original-install',{operation:'python-install',runtimeId:originalAttachment.runtimeId,
      candidateId:candidate.id,reviewId:originalReview.reviewId});
    need(isAbsolute(installedPython.python)&&/^[a-f0-9]{64}$/.test(installedPython.id),'CONAPI_INSTALLED_PYTHON_REQUIRED');
    state.originalPython=installedPython;await checkpoint('ORIGINAL_WORKBOOKS_INSTALLED');

    const unfinishedApplicationRun=value=>value.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(value.phase);
    const completeApplicationHistory=async applicationId=>{
      const runs=[],cursors=new Set();let cursor=null;
      do{
        const page=await apps.applicationsHistory({applicationId,limit:100,...(cursor?{cursor}:{})});
        need(page.applicationId===applicationId&&Array.isArray(page.runs),'CONAPI_APPLICATION_HISTORY_CHANGED');
        runs.push(...page.runs);cursor=page.nextCursor??null;
        if(cursor){need(!cursors.has(cursor),'CONAPI_APPLICATION_HISTORY_CURSOR_REPEATED');cursors.add(cursor);}
      }while(cursor);
      need(new Set(runs.map(value=>value.id)).size===runs.length,'CONAPI_APPLICATION_HISTORY_DUPLICATED');
      return runs;
    };
    const drainApplicationHistory=async(applicationId,change)=>{
      const original=await completeApplicationHistory(applicationId);
      change.runDrains??=[];
      for(const run of original.filter(unfinishedApplicationRun)){
        const selected={applicationId,operationId:run.id};
        const retained={...selected,at:stamp(),bindingAttemptId:bindingAttempt.id,original:run};
        change.runDrains.push(retained);await checkpoint('APPLICATION_HOST_STOP_RETAINED');
        retained.stop=await apps.applicationsStop(selected);await checkpoint('APPLICATION_HOST_STOP_REQUESTED');
        let recovered=false;
        retained.settled=await wait(async()=>{
          let rows=await completeApplicationHistory(applicationId);
          let current=rows.find(value=>value.id===run.id);
          need(current,'CONAPI_ORIGINAL_APPLICATION_RUN_MISSING',selected);
          if(!current.active&&unfinishedApplicationRun(current)&&!recovered){
            // The original Stop has cancelled PENDING, terminalized QUEUED or
            // retained stop.json. Existing Recover reuses this same run ID;
            // its native command checks that marker before any child launch.
            recovered=true;retained.recoveryRequestedAt=stamp();
            await checkpoint('APPLICATION_HOST_RECOVERY_RETAINED');
            retained.recovery=await apps.applicationsRecover(selected);
            await checkpoint('APPLICATION_HOST_RECOVERY_RETURNED');
            rows=await completeApplicationHistory(applicationId);
            current=rows.find(value=>value.id===run.id);
            need(current,'CONAPI_ORIGINAL_APPLICATION_RUN_MISSING',selected);
          }
          return current;
        },value=>!unfinishedApplicationRun(value),'Settle the original application run before rebinding its host.',120000);
        retained.completedAt=stamp();await checkpoint('APPLICATION_HOST_RUN_DRAINED');
      }
      const complete=await completeApplicationHistory(applicationId);
      need(!complete.some(unfinishedApplicationRun),'CONAPI_APPLICATION_HOST_RUNS_UNFINISHED',complete);
      change.settledHistory={at:stamp(),runs:complete};await checkpoint('APPLICATION_HOST_HISTORY_DRAINED');
    };

    const ensureApplication=async(role,runtimeId,kind,label,settings)=>{
      let item=state.applications[role];
      if(!item){item=state.applications[role]={role,runtimeId,kind,settings,label,saveRequestId:randomUUID(),createdAt:stamp()};await checkpoint('APPLICATION_INPUT_RETAINED');}
      need(same({runtimeId:item.runtimeId,kind:item.kind,label:item.label},{runtimeId,kind,label}),
        'CONAPI_APPLICATION_INPUT_CHANGED',role);
      // Reconcile earlier accepted saves before considering this host's desired
      // binding. An A -> B save may have reached the original application even
      // when its local checkpoint was lost before a later host selected C.
      for(const pending of item.executionBindingChanges??[]){
        if(pending.completedAt)continue;
        const applicationId=pending.applicationId??item.saved?.applicationId??hash(item.saveRequestId).slice(0,24);
        const actual=(await apps.applicationsState()).applications.find(value=>value.id===applicationId);
        if(pending.review&&actual?.saveRequestId===pending.id){
          const replay=await apps.applicationsSave({applicationId,requestId:pending.id,reviewId:pending.review.id});
          need(replay.replayed===true&&!replay.superseded&&actual.revision===replay.revision&&
            same(actual.settings,pending.to),'CONAPI_APPLICATION_HOST_REPLAY_CHANGED',actual);
          pending.saved=replay;pending.reconciledAt=stamp();pending.completedAt=stamp();
          pending.state='ACCEPTED_SAVE_RECONCILED';item.saved=replay;item.settings=pending.to;
          await checkpoint('APPLICATION_HOST_SAVED_RECEIPT_RECONCILED');
        }else if(!same(pending.to,settings)){
          if(actual){
            const knownSaves=new Set([item.saveRequestId,...(item.executionBindingChanges??[])
              .filter(value=>value.completedAt&&value.saved).map(value=>value.id)]);
            need(knownSaves.has(actual.saveRequestId)&&same(actual.settings,item.settings)&&
              (!pending.review||actual.revision===pending.previousRevision),
              'CONAPI_APPLICATION_HOST_REVISION_CHANGED',actual);
          }else need(!item.saved&&!pending.review,'CONAPI_ORIGINAL_APPLICATION_MISSING',applicationId);
          // Complete current state proves this review has not been saved. Retain
          // it without issuing a now-obsolete host B write.
          pending.completedAt=stamp();pending.state='SUPERSEDED_BEFORE_SAVE';
          pending.supersededByBindingAttempt=bindingAttempt.id;
          await checkpoint('APPLICATION_HOST_UNSAVED_REVIEW_RETAINED');
        }
      }
      if(!same(item.settings,settings)){
        const withoutNode=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='nodeExecutable'));
        need(kind==='datasette-analysis'&&same(withoutNode(item.settings),withoutNode(settings))&&
          settings.nodeExecutable===process.execPath,'CONAPI_APPLICATION_INPUT_CHANGED',role);
        item.originalSelection??={runtimeId:item.runtimeId,kind:item.kind,label:item.label,settings:item.settings,
          saveRequestId:item.saveRequestId,review:item.review??null,saved:item.saved??null};
        item.executionBindingChanges??=[];
        let change=item.executionBindingChanges.findLast(value=>!value.completedAt&&same(value.to,settings));
        if(!change){change={id:randomUUID(),at:stamp(),from:item.settings,to:settings};
          item.executionBindingChanges.push(change);await checkpoint('APPLICATION_HOST_BINDING_RETAINED');}
        const applicationId=item.saved?.applicationId??hash(item.saveRequestId).slice(0,24);
        const getExisting=async()=>(await apps.applicationsState()).applications.find(value=>value.id===applicationId);
        let current=await getExisting();
        if(!current){
          need(!item.saved&&!change.review,'CONAPI_ORIGINAL_APPLICATION_MISSING',applicationId);
          // Complete state enumeration proved the original creation has not saved.
          // Keep that same creation request; retain the earlier review in history.
          change.previousReview=item.review??null;
          item.settings=settings;delete item.review;
          change.completedAt=stamp();change.state='UNSAVED_INPUT_REBOUND';
          await checkpoint('APPLICATION_UNSAVED_HOST_BOUND');
        }else{
          need(current.settings&&current.runtimeId===runtimeId&&current.kind===kind&&current.label===label&&
            same(withoutNode(current.settings),withoutNode(settings)),
            'CONAPI_ORIGINAL_APPLICATION_BINDING_CHANGED',current);
          change.applicationId=applicationId;
          if(!change.review){
            need(same(current.settings,change.from),'CONAPI_APPLICATION_HOST_REVISION_CHANGED',current);
            await drainApplicationHistory(applicationId,change);
            current=await getExisting();
            need(current&&same(current.settings,change.from),'CONAPI_APPLICATION_HOST_REVISION_CHANGED',current);
            change.previousRevision=current.revision;
            change.review=await apps.applicationsReview({applicationId,expectedRevision:current.revision,
              runtimeId,kind,label,settings,homeId:current.homeId,providerId:current.providerId??null});
            await checkpoint('APPLICATION_HOST_REVIEWED');
          }
          change.saved=await apps.applicationsSave({applicationId,requestId:change.id,reviewId:change.review.id});
          current=await getExisting();
          need(current&&current.id===applicationId&&same(current.settings,settings)&&
            current.revision===change.saved.revision,'CONAPI_APPLICATION_HOST_SAVE_CHANGED',current);
          item.saved=change.saved;item.settings=settings;
          change.completedAt=stamp();change.state='SAME_APPLICATION_REBOUND';
          await checkpoint('APPLICATION_HOST_BOUND');
        }
      }
      if(!item.review){item.review=await apps.applicationsReview({runtimeId,kind,label,settings});await checkpoint('APPLICATION_REVIEWED');}
      if(!item.saved){item.saved=await apps.applicationsSave({requestId:item.saveRequestId,reviewId:item.review.id});await checkpoint('APPLICATION_SAVED');}
      const get=async()=>(await apps.applicationsState()).applications.find(value=>value.id===item.saved.applicationId);
      let selected=await get();
      if(!selected?.release){
        item.connection=await apps.applicationsConnect({applicationId:item.saved.applicationId});await checkpoint('APPLICATION_CONNECTING');
        selected=await wait(get,value=>Boolean(value?.release)||value?.phase==='UNAVAILABLE'||
          !value?.adoption?.active&&['FAILED','INTERRUPTED'].includes(value?.adoption?.phase),
          'The original Conapi managed runtime adoption must complete.');
      }
      need(selected?.release,'CONAPI_APPLICATION_ADOPTION_INCOMPLETE',selected);
      item.connected={at:stamp(),release:selected.release,home:selected.home};await checkpoint('APPLICATION_CONNECTED');return item;
    };
    const startApplication=async item=>{
      const applicationId=item.saved.applicationId;
      const get=async()=>(await apps.applicationsState()).applications.find(value=>value.id===applicationId);
      let selected=await get();need(selected,'CONAPI_APPLICATION_MISSING');
      if(selected.phase==='STOPPING')selected=await wait(get,value=>!value?.current?.active,'Complete original application stop.',120000);
      if(selected.phase!=='RUNNING'){
        if(selected.current&&(selected.current.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(selected.current.phase))){
          active.set(applicationId,{applicationId,operationId:selected.current.id});
          if(!selected.current.active){item.recoveries??=[];const recovery={applicationId,operationId:selected.current.id,at:stamp()};
            item.recoveries.push(recovery);await checkpoint('APPLICATION_RECOVERY_RETAINED');
            recovery.result=await apps.applicationsRecover({applicationId,operationId:selected.current.id});}
        }else{
          let run=state.runs.findLast(value=>value.applicationId===applicationId&&!value.dispatched&&value.requestId!==selected.current?.id);
          if(!run){const review=await apps.applicationsStartReview({applicationId});
            run={applicationId,requestId:randomUUID(),reviewId:review.id,createdAt:stamp()};state.runs.push(run);await checkpoint('APPLICATION_START_RETAINED');}
          active.set(applicationId,{applicationId,operationId:run.requestId});
          run.result=await apps.applicationsStart({applicationId,requestId:run.requestId,reviewId:run.reviewId});
          run.dispatched=stamp();await checkpoint('APPLICATION_START_DISPATCHED');
        }
        selected=await wait(get,value=>['RUNNING','FAILED','UNAVAILABLE','INTERRUPTED','STOPPED'].includes(value?.phase),
          'The original Conapi application must announce its actual listener.',300000);
      }
      need(selected.phase==='RUNNING'&&selected.current?.privateUrl,'CONAPI_APPLICATION_START_INCOMPLETE',selected);
      const url=new URL(selected.current.privateUrl);
      need(url.hostname==='127.0.0.1'&&url.protocol==='http:'&&url.hash,'CONAPI_PRIVATE_LISTENER_REQUIRED');
      active.set(applicationId,{applicationId,operationId:selected.current.id});
      item.starts??=[];item.starts.push({at:stamp(),operationId:selected.current.id,url:url.href,original:selected.current.url?.original??null});
      await checkpoint('APPLICATION_RUNNING');return {url:url.href,selected};
    };
    const stopApplication=async item=>{
      const applicationId=item.saved.applicationId;
      const selected=(await apps.applicationsState()).applications.find(value=>value.id===applicationId);
      if(!selected?.current?.active){active.delete(applicationId);return selected;}
      const original={applicationId,operationId:selected.current.id};
      await apps.applicationsStop(original);
      const stopped=await wait(async()=>(await apps.applicationsState()).applications.find(value=>value.id===applicationId),
        value=>!value?.current?.active,'The original application stop must settle.',120000);
      need(stopped.phase==='STOPPED','CONAPI_APPLICATION_STOP_INCOMPLETE',stopped);
      active.delete(applicationId);state.stops??=[];state.stops.push({at:stamp(),...original,result:stopped.current.result});
      await checkpoint('APPLICATION_STOPPED');return stopped;
    };

    const sourceDirectory=absolute(publisher.receiving.directory),sourceDeclaration=await read(join(sourceDirectory,'workspace.json'));
    const sourceApp=await ensureApplication('source',originalAttachment.runtimeId,'datasette','Conapi original publisher source',
      {workspaceDirectory:sourceDirectory,connectionFile:join(sourceDirectory,'conapi-source-connection.json'),port:0});
    const sourceListener=await startApplication(sourceApp);
    const {createDatasetteClient}=await moduleAt(originalRuntime.sourceRoot,SDK+'client.mjs');
    const sourceClient=createDatasetteClient({url:sourceListener.url,expectedWorkspaceId:sourceDeclaration.workspaceId});
    const archive=join(originalRuntime.sourceRoot,WRI);
    need((await file(archive)).sha256===WRI_SHA,'CONAPI_ORIGINAL_WRI_ARCHIVE_CHANGED');
    const received=await sourceClient.dispatch('source.receive',{archiveFile:archive,sha256:WRI_SHA,id:'wri-geothermal'});
    need(received.editionSha256===EDITION_SHA&&isAbsolute(received.editionFile),'CONAPI_WRI_NATIVE_RECEIVING_CHANGED',received);
    const handover={schema:'stellar-forge.datasette-analysis-handover.v1',
      delivery:{kind:'native-edition',edition:received.editionFile,sha256:received.editionSha256}};
    const project=join(output,'project'),handoverPath=join(project,'original-wri-handover.json');
    await save(handoverPath,handover,{original:true});state.wriSource=received;
    await stopApplication(sourceApp);
    state.analysisOperationId??=randomUUID().replaceAll('-','');await checkpoint('ANALYSIS_ORIGINAL_ID_RETAINED');
    const analysisDirectory=join(output,'analysis'),workflowDirectory=join(output,'workflow');
    const receivedAnalysis=join(output,'received-analysis'),receivedWorkflow=join(output,'received-workflow');
    const analysisApp=await ensureApplication('analysis',originalAttachment.runtimeId,'datasette-analysis','Conapi original supplier Analysis',
      {installationId:installedPython.id,databaseDirectory:analysisDirectory,operationId:state.analysisOperationId,
        nodeExecutable:process.execPath,port:0});
    await startApplication(analysisApp);
    const programmeInput={sourceRoot:originalRuntime.sourceRoot,project,analysis:analysisDirectory,workflow:workflowDirectory,
      analysisOperationId:state.analysisOperationId,sourceArchive:state.build.archive,wriHandover:handoverPath,
      receivedAnalysis,receivedWorkflow,...(input.flowDelivery?{flowDelivery:input.flowDelivery}:{})};
    const programmeInputPath=join(project,'programme-input.json');await save(programmeInputPath,programmeInput,{original:true});
    const runSupplier=async(phase,python=installedPython.python,selectedInput=programmeInputPath)=>{
      const attempt=randomUUID();const returned=await command(python,['-I',input.supplierProgramme,'--input',selectedInput,'--phase',phase],
        {cwd:output,logs,label:'supplier-'+phase+'-'+attempt});
      state.supplierPhases??=[];state.supplierPhases.push({phase,attempt,at:stamp(),...returned});
      await checkpoint('SUPPLIER_'+phase.toUpperCase()+'_RETURNED');return returned;
    };
    await runSupplier('original');
    state.original=await read(join(project,'original-programme-result.json'));
    need(state.original.state==='ORIGINAL_PROGRAMME_COMPLETE','CONAPI_ORIGINAL_SUPPLIER_INCOMPLETE');
    const workflowApp=await ensureApplication('workflow',originalAttachment.runtimeId,'datasette-workflow','Conapi original supplier requests',
      {installationId:installedPython.id,workflowDirectory,configurationFile:state.original.configuration,port:0});
    let workflowListener=await startApplication(workflowApp);

    // The separately owned complete messaging programme receives actual listeners,
    // original request/configuration, installed Java/JMS metadata and all result files.
    if(input.transportProgramme){
      const transportInput={schema:'commons.conapi-transport-input.v1',project,workflow:workflowDirectory,
        configuration:state.original.configuration,workflowUrl:workflowListener.url,sourceRoot:originalRuntime.sourceRoot,
        python:installedPython.python,node:process.execPath,requests:{original:A,wri:B,continued:C},
        original:state.original,metadata:input.transportMetadata??null};
      const source=await file(absolute(input.transportProgramme));
      const selected={source,metadata:input.transportMetadata??null};
      if(state.transportSelection)need(same(state.transportSelection,selected),'CONAPI_ORIGINAL_TRANSPORT_SELECTION_CHANGED');
      else {state.transportSelection=selected;await checkpoint('TRANSPORT_SELECTION_RETAINED');}
      const transportPath=join(project,'transport-input.json');await save(transportPath,transportInput);
      if(state.transport?.state!=='COMPLETE'){
        try{
          const extension=await import(pathToFileURL(source.path).href);
          need(typeof extension.runConapiTransport==='function','CONAPI_COMPLETE_TRANSPORT_ENTRYPOINT_REQUIRED');
          state.transport=await extension.runConapiTransport(transportInput);
        }catch(error){
          state.transport={state:'PRESERVED_FOR_CONTINUATION',error:issue(error),at:stamp()};
        }
        await save(join(project,'transport-result.json'),state.transport);await checkpoint('ORIGINAL_MESSAGING_RETURNED');
      }
    }else state.transport??={state:'AWAITING_DEPLOYMENT_INPUT'};
    // These fresh exports include all actual transport and callback history.
    await runSupplier('export');
    state.original=await read(join(project,'original-programme-result.json'));

    const receivedRuntime=await ensureRuntime('received',originalRuntime.directory);
    const receivingAttachment=await apps.attach({directory:receivedRuntime.directory,label:'Conapi independent receiving installation'});
    const pythonBundle=await pythonOperation('original-bundle',{operation:'python-bundle',runtimeId:originalAttachment.runtimeId,
      candidateId:candidate.id,python:input.python});
    need(isAbsolute(pythonBundle.archive)&&/^[a-f0-9]{64}$/.test(pythonBundle.archiveSha256),'CONAPI_COMPLETE_PYTHON_ARCHIVE_REQUIRED');
    await rememberFile(pythonBundle.archive);
    const receivedCandidate=await pythonOperation('received-receive',{operation:'python-receive',runtimeId:receivingAttachment.runtimeId,
      archive:pythonBundle.archive,sha256:pythonBundle.archiveSha256,python:input.python});
    let receivingReview=state.receivingPythonReview;
    if(!receivingReview){receivingReview=state.receivingPythonReview=await apps.pythonReview({runtimeId:receivingAttachment.runtimeId,
      python:input.python,extras:['workbooks']});await checkpoint('RECEIVING_PYTHON_REVIEWED');}
    const receivingPython=await pythonOperation('received-install',{operation:'python-install',runtimeId:receivingAttachment.runtimeId,
      candidateId:receivedCandidate.id,reviewId:receivingReview.reviewId});
    need(isAbsolute(receivingPython.python)&&/^[a-f0-9]{64}$/.test(receivingPython.id),'CONAPI_RECEIVED_PYTHON_REQUIRED');
    const receivingInput={...programmeInput,sourceRoot:receivedRuntime.sourceRoot};
    const receivingInputPath=join(project,'receiving-programme-input.json');await save(receivingInputPath,receivingInput,{original:true});
    await runSupplier('receive',receivingPython.python,receivingInputPath);
    state.receiving=await read(join(project,'independent-receiving.json'));
    const restoredOperationId=state.receiving.result?.analysis?.operationId;
    need(/^[a-f0-9]{32}$/.test(restoredOperationId)&&restoredOperationId===state.analysisOperationId,'CONAPI_RESTORED_ANALYSIS_ID_CHANGED');
    const receivedAnalysisApp=await ensureApplication('received-analysis',receivingAttachment.runtimeId,'datasette-analysis',
      'Conapi received customer Analysis',{installationId:receivingPython.id,databaseDirectory:receivedAnalysis,
        operationId:restoredOperationId,nodeExecutable:process.execPath,port:0});
    await startApplication(receivedAnalysisApp);
    await runSupplier('successor',receivingPython.python,receivingInputPath);
    state.successor=await read(join(project,'received-successor-result.json'));
    need(state.successor.state==='RECEIVED_SUCCESSOR_COMPLETE','CONAPI_RECEIVED_SUCCESSOR_INCOMPLETE');
    const receivedApp=await ensureApplication('received-workflow',receivingAttachment.runtimeId,'datasette-workflow','Conapi received original and free-pricing successor',
      {installationId:receivingPython.id,workflowDirectory:receivedWorkflow,configurationFile:state.successor.configuration,port:0});
    let receivedListener=await startApplication(receivedApp);
    await runSupplier('receive-current-edition',receivingPython.python,receivingInputPath);
    state.currentEdition=await read(join(project,'current-edition-receiving-result.json'));
    need(state.currentEdition.state==='CURRENT_EDITION_RECEIVED','CONAPI_CURRENT_COMPLETE_EDITION_REQUIRED');
    let finalEditionListener=null;
    if(!state.currentEdition.sameOriginalEdition){
      const edition=state.currentEdition.selection;
      const finalApp=await ensureApplication('received-final-'+edition.archive.sha256,receivingAttachment.runtimeId,
        'datasette-workflow','Conapi received complete transport edition',
        {installationId:receivingPython.id,workflowDirectory:edition.destination,port:0});
      finalEditionListener=await startApplication(finalApp);
    }
    await checkpoint('COMPLETE_INDEPENDENT_RECEIVING');

    const playwright=await import(pathToFileURL(input.playwrightModule).href),chromium=playwright.chromium??playwright.default?.chromium;
    need(chromium,'CONAPI_CHROMIUM_MODULE_REQUIRED');
    const browserAttempt={id:randomUUID(),at:stamp(),errors:[]};state.browserAttempts??=[];state.browserAttempts.push(browserAttempt);
    await checkpoint('BROWSER_INPUT_RETAINED');
    context=await chromium.launchPersistentContext(join(output,'browser-profile'),{headless:true,acceptDownloads:true,
      executablePath:input.browserExecutable,viewport:{width:1440,height:1000},args:['--disable-dev-shm-usage']});
    context.on('page',page=>page.on('pageerror',error=>browserAttempt.errors.push(issue(error))));
    const page=context.pages()[0]??await context.newPage();page.on('pageerror',error=>browserAttempt.errors.push(issue(error)));
    page.on('dialog',dialog=>dialog.accept());
    const screenshot=async name=>{const path=join(output,name);await page.screenshot({path,fullPage:true});await rememberFile(path);return path;};
    const workflowView=async(url,requestId)=>{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
      const select=page.locator('#requests button').filter({hasText:requestId}).first();
      await select.waitFor({state:'visible',timeout:120000});await select.click();
      await page.waitForFunction(id=>document.querySelector('#title')?.textContent?.includes(id),requestId,{timeout:120000});
      await page.locator('button[data-tab="result"]').click();
      await page.waitForFunction(()=>document.querySelector('#analysis')?.textContent?.includes('COMPLETE'),{},{timeout:120000});
      const actual=JSON.parse(await page.locator('#analysis').textContent());
      need(actual.status==='COMPLETE'&&actual.queries?.length===6,'CONAPI_RENDERED_NATIVE_REPORT_INCOMPLETE');
      const files=await page.locator('#result-files').innerText();
      need(files.trim().length>0,'CONAPI_RENDERED_DELIVERY_FILES_REQUIRED');
      const view={requestId,analysis:actual,resultFiles:files,
        supplier:await page.locator('#supplier-review').innerText(),at:stamp()};
      state.browserViews??=[];state.browserViews.push(view);return view;
    };
    await workflowView(workflowListener.url,A);await screenshot('Conapi_Original_Supplier_Desktop.png');
    if(finalEditionListener){
      await workflowView(finalEditionListener.url,A);
      await screenshot('Conapi_Received_Final_Transport_Edition.png');
      state.checks.currentTransportEditionBrowser=true;
    }
    await workflowView(receivedListener.url,SUCCESSOR);await screenshot('Conapi_Received_Successor_Desktop.png');
    await page.setViewportSize({width:390,height:844});await screenshot('Conapi_Received_Successor_Mobile.png');
    await page.setViewportSize({width:1440,height:1000});
    await stopApplication(receivedApp);receivedListener=await startApplication(receivedApp);
    await workflowView(receivedListener.url,A);await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#requests button').filter({hasText:A}).first().waitFor({state:'visible',timeout:120000});
    state.checks.receivedManagedRestartAndReopen=true;
    await page.goto(host.url,{waitUntil:'domcontentloaded',timeout:120000});
    await page.locator('button[data-view="applications"]').click();
    await page.waitForFunction(()=>document.querySelector('#applications-workspace')?.textContent?.includes('Conapi'),{},{timeout:120000});
    await screenshot('Conapi_Installed_Applications.png');
    const analysisLaunch=await read(join(receivedAnalysis,'datasette-operator-launch.json'));
    await page.goto(analysisLaunch.url,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>document.body.textContent.includes('Analysis'),{},{timeout:120000});
    await screenshot('Conapi_Received_Analysis.png');

    // Reopen and edit the received complete native supplier workspace in its own
    // maintained browser application; export the new revision separately.
    const supplier=join(receivedWorkflow,'received/delivery/supplier');
    let supplierUrl,supplierExit;
    state.supplierBrowserAttempts??=[];
    for(;;){
      state.supplierBrowserPort??=await availablePort();
      const script=join(supplier,'supplier-report-cli.mjs');
      const attempt={id:randomUUID(),port:state.supplierBrowserPort,script:await file(script),createdAt:stamp()};
      state.supplierBrowserAttempts.push(attempt);await checkpoint('SUPPLIER_BROWSER_INPUT_RETAINED');
      supplierUrl='http://127.0.0.1:'+attempt.port+'/';
      supplierNative=loggedChild(process.execPath,[script,'serve','--port',String(attempt.port)],
        {cwd:supplier,logs,label:'supplier-editor-'+attempt.id});
      supplierProcess=supplierNative.child;supplierExit=supplierNative.completion;
      attempt.pid=supplierProcess.pid;
      let observedOut='',observedErr='';
      supplierProcess.stderr.on('data',bytes=>{observedErr=(observedErr+bytes.toString()).slice(-65536);});
      try{
        await new Promise((done,fail)=>{
          const deadline=setTimeout(()=>fail(Object.assign(new Error('The original supplier child has not announced its listener.'),
            {code:'CONAPI_SUPPLIER_LISTENER_PENDING'})),60000);
          const reject=error=>{clearTimeout(deadline);fail(error);};
          supplierProcess.stdout.on('data',bytes=>{
            observedOut=(observedOut+bytes.toString()).slice(-65536);
            if(observedOut.split(/\r?\n/).includes('Supplier review: '+supplierUrl)){
              clearTimeout(deadline);done();
            }
          });
          supplierProcess.once('error',reject);
          supplierProcess.once('exit',(code,signal)=>reject(Object.assign(new Error('The original supplier listener exited before receiving.'),
            {code:/EADDRINUSE/.test(observedErr)?'EADDRINUSE':'CONAPI_SUPPLIER_LISTENER_EXITED',
             detail:{code,signal,stderr:observedErr}})));
        });
        need(supplierProcess.exitCode===null&&supplierProcess.signalCode===null,'CONAPI_SUPPLIER_LISTENER_EXITED');
        attempt.announcement={url:supplierUrl,pid:supplierProcess.pid,at:stamp()};await checkpoint('SUPPLIER_BROWSER_LISTENING');break;
      }catch(error){
        attempt.error=issue(error);await checkpoint('SUPPLIER_BROWSER_ATTEMPT_RETURNED');
        if(error.code!=='EADDRINUSE')throw error;
        attempt.completion=await supplierExit;
        need(attempt.completion.errors.length===0,'CONAPI_NATIVE_OUTPUT_FAILED',attempt.completion);
        supplierProcess=null;supplierNative=null;state.supplierBrowserPort=await availablePort();
      }
    }
    await page.goto(supplierUrl,{waitUntil:'domcontentloaded',timeout:120000});
    await page.locator('#shell-workspace-file').waitFor({state:'attached'});
    await page.waitForFunction(()=>!document.querySelector('#shell-workspace-file')?.disabled,{},{timeout:120000});
    await page.locator('#shell-workspace-file').setInputFiles(join(supplier,'original-supplier-workspace.json'));
    await page.waitForFunction(()=>document.querySelector('#shell-current')?.textContent?.includes('revision 23'),{},{timeout:120000});
    await screenshot('Conapi_Received_Supplier_Review.png');
    const edited=join(project,'Received_Supplier_Review_r24.workspace.json');
    let downloadFilename=null;
    if(!await exists(edited)){
      await page.getByLabel('Reviewer',{exact:true}).fill('Commons Conapi programme');
      await page.getByLabel('Decision reason',{exact:true}).fill('Received the original paired pricing and catalogue package; retained this accepted source decision during the complete supplier handover.');
      await page.getByRole('button',{name:'Save decision',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#shell-current')?.textContent?.includes('revision 24'),{},{timeout:120000});
      const pending=page.waitForEvent('download');await page.locator('#shell-save').click();const downloaded=await pending;
      await downloaded.saveAs(edited);downloadFilename=downloaded.suggestedFilename();
    }else if(state.supplierEdit){
      need(same(await file(edited),state.supplierEdit.file),'CONAPI_RETAINED_SUPPLIER_EDIT_CHANGED');
      downloadFilename=state.supplierEdit.downloadFilename;
    }
    const domain=await moduleAt(supplier,'supplier-report.mjs'),editedReport=domain.reopenWorkspace(await readFile(edited,'utf8'));
    need(editedReport.revision===24&&editedReport.requestId==='conapi-elite-initial-import-20261012',
      'CONAPI_RECEIVED_SUPPLIER_EDIT_CHANGED');
    need(supplierProcess.exitCode===null&&supplierProcess.signalCode===null,'CONAPI_SUPPLIER_LISTENER_EXITED');
    await rememberFile(edited);
    await page.locator('#shell-workspace-file').setInputFiles(edited);
    await page.waitForFunction(()=>document.querySelector('#shell-current')?.textContent?.includes('revision 24'),{},{timeout:120000});
    await screenshot('Conapi_Received_Supplier_Edit.png');
    state.supplierEdit={file:await file(edited),requestId:editedReport.requestId,comparisonId:editedReport.comparisonId,
      revision:editedReport.revision,status:editedReport.status,originalRevision:23,downloadFilename};
    state.supplierEditorExit=await closeChild(supplierNative);supplierProcess=null;supplierNative=null;
    need(state.supplierEditorExit.errors.length===0,'CONAPI_NATIVE_OUTPUT_FAILED',state.supplierEditorExit);
    need(browserAttempt.errors.length===0,'CONAPI_BROWSER_APPLICATION_ERRORS',browserAttempt.errors);
    browserAttempt.completedAt=stamp();await context.close();context=null;
    const preparedContinuation=await read(join(project,'supplier-c-prepared-continuation.json'));
    const pausedAfterPrepare=preparedContinuation.nativePrepare?.some(event=>event.phase==='PREPARE'&&event.status==='COMPLETE')===true;
    state.checks={...state.checks,finalSourceInstalled:true,workbooksPythonInstalled:true,originalSupplierComplete:true,
      pausedSupplierAfterPrepare:pausedAfterPrepare,wriOnSameAnalysis:true,continuedSupplierComplete:true,originalDeliveryStable:true,
      fullProjectExported:true,independentRuntimeInstalled:true,originalWheelsReceived:true,completeProjectReceived:true,
      currentPublicationEditionReceived:state.currentEdition.state==='CURRENT_EDITION_RECEIVED',
      receivedFreePricingSuccessor:true,receivedSupplierBrowserEdit:true,desktopAnd390Mobile:true,managedApplicationsBrowser:true};
    await checkpoint('BROWSER_AND_EDITABLE_HANDOVER_COMPLETE');
    for(const original of Object.values(state.original.exports??{}))if(original.archive?.path)await rememberFile(original.archive.path);
    for(const original of Object.values(state.successor.exports??{}))if(original.archive?.path)await rememberFile(original.archive.path);
    for(const name of ['original-programme-result.json','independent-receiving.json','received-successor-result.json','current-edition-receiving-result.json'])
      await rememberFile(join(project,name));
    for(const item of Object.values(state.applications))await stopApplication(item);
    await host.close();host=null;
    const completed=state.transport?.state==='COMPLETE'?'COMPLETE':'SUPPLIER_RECEIVING_COMPLETE';
    await checkpoint(completed);
    return {state:completed,report:stateFile,checks:state.checks,files:state.files,sourceCommit:REF,transport:state.transport};
  }catch(error){
    failed=true;state.errors.push({at:stamp(),...issue(error)});await checkpoint('PRESERVED_FOR_CONTINUATION');throw error;
  }finally{
    const cleanupErrors=[],retainCleanup=record=>{cleanupErrors.push(record);state.errors.push({at:stamp(),...record});};
    if(context)await context.close().catch(error=>retainCleanup({stage:'browser-close',...issue(error)}));
    if(supplierNative){
      try{
        const closed=await closeChild(supplierNative);
        state.supplierCleanup??=[];state.supplierCleanup.push({at:stamp(),pid:supplierProcess.pid,result:closed});
        need(closed.errors.length===0,'CONAPI_NATIVE_OUTPUT_FAILED',closed);
      }catch(error){retainCleanup({stage:'supplier-close',...issue(error)});}
    }
    // Drain only this programme's selected listeners. Original detached native
    // jobs keep their existing journals and operation identities for recovery.
    if(apps)for(const selected of active.values()){
      try{
        const get=async()=>(await apps.applicationsState()).applications.find(item=>item.id===selected.applicationId);
        const current=await get();
        if(current?.current?.active&&current.current.id===selected.operationId){
          await apps.applicationsStop(selected);
          await wait(get,value=>!value?.current?.active||value.current.id!==selected.operationId,
            'The original Conapi listener must close before workspace capture.',120000);
        }
      }catch(error){retainCleanup({stage:'managed-stop',...selected,...issue(error)});}
    }
    if(host)await host.close().catch(error=>retainCleanup({stage:'host-close',...issue(error)}));
    if(cleanupErrors.length)state.phase='PRESERVED_FOR_CONTINUATION';
    if(failed||cleanupErrors.length||state.supplierCleanup?.length){state.updatedAt=stamp();await save(stateFile,state);}
    need(cleanupErrors.length===0,'CONAPI_NATIVE_CLEANUP_INCOMPLETE',cleanupErrors);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const index=process.argv.indexOf('--input');need(index>=0&&process.argv[index+1],'CONAPI_INPUT_FILE_REQUIRED');
  runConapiDelivery(await read(absolute(process.argv[index+1]))).then(value=>process.stdout.write(JSON.stringify(value)+'\n'))
    .catch(error=>{process.stderr.write(JSON.stringify(issue(error))+'\n');process.exitCode=1;});
}
