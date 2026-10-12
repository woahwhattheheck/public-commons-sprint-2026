// MIT. Python cohorts inside the original runtime workspace and operation worker.
import { constants } from 'node:fs';
import { open, readdir, lstat, realpath, access, unlink, link } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { verifyRuntimeProfile } from '../runtime-profile.mjs';
import { absolute, canonical, digest, json, makePrivate, privateDirectory, need, plain,
  readJSON, regular, saveJSON, recordId, operationId, operationLease, operationRunning,
  now, processIdentity } from '../runtime-workspace/storage.mjs';

export const PYTHON_PROJECT = 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python';
export const PYTHON_SCHEMA = 'stellar-forge.python-workspace.v1';
export const MAX_PYTHON_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const ENGINE = fileURLToPath(new URL('./engine.py', import.meta.url));
const PROBE = "import importlib.metadata,json,platform,sys,sysconfig,tomllib\nfrom pathlib import Path\np=Path(sys.argv[1])\nd=tomllib.loads(p.read_text(encoding=\"utf-8\"))\nproject=d.get(\"project\",{})\ntry: pip_version=importlib.metadata.version(\"pip\")\nexcept importlib.metadata.PackageNotFoundError: pip_version=None\nprint(json.dumps({\"interpreter\":{\"version\":list(sys.version_info[:3]),\"executable\":sys.executable,\"prefix\":sys.prefix,\"basePrefix\":sys.base_prefix,\"implementation\":sys.implementation.name,\"cacheTag\":sys.implementation.cache_tag,\"platform\":sysconfig.get_platform(),\"pip\":pip_version},\"project\":{\"name\":project.get(\"name\"),\"version\":project.get(\"version\"),\"requiresPython\":project.get(\"requires-python\"),\"extras\":project.get(\"optional-dependencies\",{}),\"scripts\":project.get(\"scripts\",{}),\"build\":d.get(\"build-system\",{})}},sort_keys=True))\n";
const HASH = /^[a-f0-9]{64}$/;
const hashId = value => { need(typeof value === 'string' && HASH.test(value), 'PYTHON_RUNTIME_ID_REQUIRED'); return value; };
const errorView = error => ({code:error.code ?? 'PYTHON_RUNTIME_ERROR',message:String(error.message ?? error).slice(0,2000)});
const hashValue = value => digest(json(canonical(value)));
const operationPath = (root,id) => join(root,'operations',operationId(id));
const reviewPath = (root,id) => join(root,'python-reviews',recordId(id)+'.json');
const viewPath = runtimeDirectory => join(runtimeDirectory,'python-runtime','workspace-observation.json');
const bindingPath = runtimeDirectory => join(runtimeDirectory,'python-runtime','workspace-binding.json');

export const pythonOperationFields = Object.freeze({
  'python-resolve':['runtimeId','reviewId'],
  'python-install':['runtimeId','candidateId','reviewId'],
  'python-inspect':['runtimeId','python','candidateId','installationId'],
  'python-bundle':['runtimeId','candidateId','python'],
  'python-receive':['runtimeId','archive','sha256','python'],
  'python-activate':['runtimeId','installationId','expectedInstallationId','python'],
});
export async function initializePythonWorkspace(root) {
  for (const name of ['python-reviews','python-incoming']) {
    try { await makePrivate(join(root,name)); }
    catch(error) { if(error.code!=='EEXIST')throw error; await privateDirectory(join(root,name)); }
  }
}
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function fileDigest(path,maximum=MAX_PYTHON_ARCHIVE_BYTES) {
  const handle=await open(absolute(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();
    need(before.isFile() && before.size<=maximum,'PYTHON_FILE_INVALID');
    const hash=createHash('sha256'); let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})) {hash.update(chunk);bytes+=chunk.length;}
    const after=await handle.stat();
    need(bytes===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs &&
      before.ctimeMs===after.ctimeMs,'PYTHON_FILE_CHANGED',path,409);
    return {sha256:hash.digest('hex'),bytes};
  } finally {await handle.close();}
}
async function retainedBytes(path,bytes,expectedSha256) {
  need(digest(bytes)===expectedSha256,'PYTHON_RETAINED_BYTES_CHANGED');
  try {const existing=await regular(path,4*1024*1024);need(digest(existing)===expectedSha256,'PYTHON_RETAINED_BYTES_CHANGED');return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.pending-'+randomUUID(), handle=await open(temporary,'wx',0o600);
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
  try {await link(temporary,path);}
  catch(error){if(error.code!=='EEXIST')throw error;need(digest(await regular(path))===expectedSha256,'PYTHON_RETAINED_BYTES_CHANGED');}
  finally {await unlink(temporary).catch(()=>{});}
  await syncDirectory(dirname(path));
}
export async function pythonRuntimeBinding(runtimeDirectory,runtimeId) {
  const directory=await privateDirectory(absolute(runtimeDirectory)),id=recordId(runtimeId);
  need(digest(directory).slice(0,24)===id,'PYTHON_RUNTIME_DIRECTORY_CHANGED');
  const plan=await readJSON(join(directory,'runtime-install.json'));
  need(plan.schema==='stellar-forge.runtime-install.v1' && plan.directory===directory && plan.sourceRoot===join(directory,'package','source') &&
    plan.archivePath===join(directory,'source.tgz') && HASH.test(plan.archiveSha256??'') &&
    HASH.test(plan.profileId??'') && HASH.test(plan.source?.manifestSha256??'') &&
    /^[a-f0-9]{40}$/.test(plan.source?.sourceCommit??''),'PYTHON_ORIGINAL_RUNTIME_REQUIRED');
  const profileBytes=await regular(join(directory,'runtime-profile.json'));
  need(digest(profileBytes)===plan.profileSha256,'PYTHON_ORIGINAL_PROFILE_CHANGED',undefined,409);
  const profile=JSON.parse(profileBytes);await verifyRuntimeProfile(profile);
  need(profile.profileId===plan.profileId &&
    digest(json({archiveSha256:plan.archiveSha256,profileId:plan.profileId}))===plan.installationId,
    'PYTHON_ORIGINAL_PROFILE_CHANGED',undefined,409);
  const manifestBytes=await regular(join(directory,'package','manifest.json'),16*1024*1024);
  need(digest(manifestBytes)===plan.source.manifestSha256,'PYTHON_ORIGINAL_SOURCE_MANIFEST_CHANGED',undefined,409);
  const manifest=JSON.parse(manifestBytes);
  need(manifest.schema==='stellar-forge.merchant-distribution-manifest.v1' &&
    manifest.sourceCommit===plan.source.sourceCommit && Array.isArray(manifest.files),
    'PYTHON_ORIGINAL_SOURCE_MANIFEST_INVALID');
  const projectPath=PYTHON_PROJECT+'/pyproject.toml';
  const project=manifest.files.find(file=>file.path===projectPath);
  need(project && HASH.test(project.sha256??'') && Number.isSafeInteger(project.bytes),
    'PYTHON_PROJECT_NOT_INCLUDED','This source release does not contain the original buyer Python project.');
  const pyproject=await regular(join(plan.sourceRoot,projectPath));
  need(pyproject.length===project.bytes && digest(pyproject)===project.sha256,'PYTHON_PROJECT_CHANGED',undefined,409);
  return {runtimeId:id,directory,installationId:plan.installationId,archiveSha256:plan.archiveSha256,
    profileId:plan.profileId,profileSha256:plan.profileSha256,sourceCommit:plan.source.sourceCommit,
    sourceManifestSha256:plan.source.manifestSha256,sourceRoot:plan.sourceRoot,
    projectDirectory:join(plan.sourceRoot,PYTHON_PROJECT),pyprojectSha256:project.sha256};
}
async function verifyProject(binding) {
  const manifest=await readJSON(join(binding.directory,'package','manifest.json'));
  const prefix=PYTHON_PROJECT+'/';
  for(const file of manifest.files.filter(file=>file.path.startsWith(prefix))) {
    need(!file.path.split('/').some(part=>!part || part==='.' || part==='..') &&
      HASH.test(file.sha256??'') && Number.isSafeInteger(file.bytes),'PYTHON_SOURCE_MEMBER_INVALID');
    const value=await fileDigest(join(binding.sourceRoot,file.path),Math.max(file.bytes,1));
    need(value.sha256===file.sha256 && value.bytes===file.bytes,'PYTHON_PROJECT_CHANGED',file.path,409);
  }
}
async function interpreterPath(value) {
  const python=absolute(value);
  // Venv executables are commonly symlinks. Retain and execute the lexical path;
  // the actual interpreter probe records its separate base and prefix identity.
  await access(python,constants.X_OK);
  const target=await realpath(python),info=await lstat(target);
  need(info.isFile(),'PYTHON_INTERPRETER_INVALID');
  return {python,target,dev:info.dev,ino:info.ino,bytes:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs};
}
async function smallJSON(python,args,{leaseFd,timeoutMs=15000}={}) {
  const stdio=['ignore','pipe','pipe'];if(leaseFd!==undefined)stdio.push(leaseFd);
  const child=spawn(python,args,{shell:false,stdio,env:{...process.env,PYTHONNOUSERSITE:'1'}});
  let out='',err='',bytes=0,limited=false,timedOut=false;
  child.stdout.on('data',data=>{bytes+=data.length;if(bytes>2*1024*1024){limited=true;child.kill('SIGKILL');}else out+=data.toString('utf8');});
  child.stderr.on('data',data=>{err=(err+data.toString('utf8')).slice(-8192);});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  let code;
  try {code=await new Promise((accept,reject)=>{child.once('error',reject);child.once('close',accept);});}
  finally {clearTimeout(timer);}
  need(!timedOut,'PYTHON_INSPECTION_TIMEOUT','The selected interpreter did not finish its inspection.');
  need(!limited,'PYTHON_INSPECTION_TOO_LARGE');
  let value;try{value=JSON.parse(out);}catch{need(false,'PYTHON_INSPECTION_FAILED',err||'The selected interpreter did not return its original inspection.');}
  need(code===0 && !value.error,'PYTHON_INSPECTION_FAILED',typeof value.message==='string'?value.message:err||'Python inspection failed.');
  return value;
}
export async function reviewPythonRuntime(root,{runtimeId,runtimeDirectory,python,extras=['workbooks']}={}) {
  await initializePythonWorkspace(root);
  const binding=await pythonRuntimeBinding(runtimeDirectory,runtimeId),selected=await interpreterPath(python);
  need(Array.isArray(extras) && extras.every(x=>typeof x==='string'),'PYTHON_EXTRAS_INVALID');
  const chosen=[...new Set(extras)].sort(),probe=await smallJSON(selected.python,['-I','-c',PROBE,join(binding.projectDirectory,'pyproject.toml')]);
  need(Array.isArray(probe.interpreter?.version) && (probe.interpreter.version[0]>3 ||
    probe.interpreter.version[0]===3 && probe.interpreter.version[1]>=11),'PYTHON_311_REQUIRED');
  need(probe.project?.name==='stellar-forge-buyer' && plain(probe.project.extras) &&
    chosen.every(extra=>Object.hasOwn(probe.project.extras,extra)),'PYTHON_EXTRA_NOT_DECLARED');
  const body={schema:'stellar-forge.python-selection.v1',binding,python:selected.python,
    interpreter:{...selected,...probe.interpreter,python:selected.python},
    extras:chosen,project:probe.project,engineSha256:digest(await regular(ENGINE,2*1024*1024))};
  const reviewId=hashValue(body).slice(0,24),value={...body,reviewId,reviewedAt:now()};
  try {await saveJSON(reviewPath(root,reviewId),value);}catch(error){if(error.code!=='EEXIST')throw error;}
  return readJSON(reviewPath(root,reviewId));
}
async function sourceMatches(result,binding) {
  const source=result?.source;
  need(plain(source) && HASH.test(source.id??'') &&
    source.releaseId===binding.sourceCommit && source.releaseDigest===binding.sourceManifestSha256,
    'PYTHON_SOURCE_RELEASE_MISMATCH','Choose the original merchant runtime that contains this Python source release.',409);
  return result;
}
async function retainArchive(root,{body,file,sha256}) {
  hashId(sha256);await initializePythonWorkspace(root);
  const target=join(root,'python-incoming',sha256+'.zip'),lock=await operationLease(target+'.lock');
  try {
    try {const previous=await fileDigest(target);need(previous.sha256===sha256,'PYTHON_ARCHIVE_CHANGED');if(body?.resume)body.resume();return {archive:target,...previous,reused:true};}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const temporary=target+'.pending-'+randomUUID(),out=await open(temporary,'wx',0o600);
    let input,bytes=0;const hash=createHash('sha256');
    try {
      if(file){input=await open(absolute(file),constants.O_RDONLY|constants.O_NOFOLLOW);const st=await input.stat();need(st.isFile(),'PYTHON_ARCHIVE_INVALID');body=input.createReadStream({autoClose:false});}
      need(body && body[Symbol.asyncIterator],'PYTHON_ARCHIVE_BODY_REQUIRED');
      for await(const chunk of body){bytes+=chunk.length;need(bytes<=MAX_PYTHON_ARCHIVE_BYTES,'PYTHON_ARCHIVE_TOO_LARGE',undefined,413);hash.update(chunk);await out.writeFile(chunk);}
      need(bytes>0 && hash.digest('hex')===sha256,'PYTHON_ARCHIVE_HASH_MISMATCH');
      await out.sync();
    }catch(error){await unlink(temporary).catch(()=>{});throw error;}
    finally{await out.close();if(input)await input.close();}
    try{await link(temporary,target);}finally{await unlink(temporary).catch(()=>{});}
    await syncDirectory(dirname(target));
    return {archive:target,sha256,bytes,reused:false};
  }finally{await lock.close();}
}
export async function receivePythonArchive(root,input){return retainArchive(root,input);}
async function bindingRoot(binding) {
  const path=join(binding.directory,'python-runtime');
  try{await makePrivate(path);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(path);}
  const old=await readJSON(bindingPath(binding.directory),true);
  if(old)need(hashValue(old)===hashValue(binding),'PYTHON_RUNTIME_BINDING_CHANGED',undefined,409);
  else {try{await saveJSON(bindingPath(binding.directory),binding);}catch(error){if(error.code!=='EEXIST')throw error;
    need(hashValue(await readJSON(bindingPath(binding.directory)))===hashValue(binding),'PYTHON_RUNTIME_BINDING_CHANGED');}}
  return path;
}
export async function normalizePythonOperation(root,request,id) {
  need(Object.hasOwn(pythonOperationFields,request.operation),'PYTHON_OPERATION_INVALID');
  operationId(id);
  const binding=await pythonRuntimeBinding(request.runtimeDirectory,request.runtimeId);
  request.pythonBinding=binding;request.pythonRoot=join(binding.directory,'python-runtime');
  request.pythonEngineSha256=digest(await regular(ENGINE,2*1024*1024));
  if(request.reviewId){
    const review=await readJSON(reviewPath(root,request.reviewId));
    need(review.reviewId===request.reviewId && hashValue(review.binding)===hashValue(binding) &&
      review.engineSha256===request.pythonEngineSha256,'PYTHON_SELECTION_REVIEW_CHANGED','Review this source and interpreter again.',409);
    const selected=await interpreterPath(review.python);
    for(const key of ['target','dev','ino','bytes','mtimeMs','ctimeMs'])need(selected[key]===review.interpreter[key],'PYTHON_INTERPRETER_CHANGED',undefined,409);
    request.python=review.python;request.pythonSelection=review;
  }else{request.pythonInterpreter=await interpreterPath(request.python);}
  if(request.candidateId!==undefined)hashId(request.candidateId);
  if(request.installationId!==undefined)hashId(request.installationId);
  if(request.operation==='python-inspect')need(!(request.candidateId && request.installationId),'PYTHON_INSPECT_ONE_ID_REQUIRED');
  if(['python-resolve','python-install'].includes(request.operation))need(request.pythonSelection,'PYTHON_SELECTION_REVIEW_REQUIRED');
  if(['python-install','python-bundle'].includes(request.operation))need(request.candidateId,'PYTHON_CANDIDATE_REQUIRED');
  if(request.operation==='python-activate'){
    need(request.installationId,'PYTHON_INSTALLATION_REQUIRED');
    need(Object.hasOwn(request,'expectedInstallationId'),'PYTHON_EXPECTED_ACTIVE_REQUIRED','Use the currently observed installation ID, or null for an empty runtime.');
    if(request.expectedInstallationId!==null)hashId(request.expectedInstallationId);
  }
  if(request.operation==='python-receive'){
    const input=await retainArchive(root,{file:request.archive,sha256:request.sha256});
    request.archive=input.archive;request.archiveBytes=input.bytes;
  }
  if(request.operation==='python-bundle')
    request.pythonArchive=join(operationPath(root,id),'python-'+request.candidateId+'.zip');
}
function engineArgs(request,progressFile) {
  const args=['--root',request.pythonRoot,'--lease-fd','3','--progress-file',progressFile];
  const operation=request.operation.slice('python-'.length);args.push(operation);
  if(operation==='resolve')args.push('--python',request.python,'--source',request.pythonBinding.projectDirectory,
    '--extras',request.pythonSelection.extras.join(','),'--release-id',request.pythonBinding.sourceCommit,
    '--release-digest',request.pythonBinding.sourceManifestSha256);
  if(operation==='install')args.push('--candidate',request.candidateId,'--python',request.python);
  if(operation==='inspect'){
    if(request.candidateId)args.push('--candidate',request.candidateId);
    if(request.installationId)args.push('--installation',request.installationId);
  }
  if(operation==='bundle')args.push('--candidate',request.candidateId,'--output',request.pythonArchive);
  if(operation==='receive')args.push('--archive',request.archive);
  if(operation==='activate'){
    args.push('--installation',request.installationId);
    args.push('--expected-installation',request.expectedInstallationId??'');
  }
  return args;
}
async function rememberResult(binding,request,result) {
  const path=viewPath(binding.directory),deadline=Date.now()+5000;
  let lease;
  while(!lease){
    try{lease=await operationLease(path+'.lock');}
    catch(error){
      if(error.code!=='RUNTIME_WORKSPACE_OPERATION_RUNNING' || Date.now()>=deadline)throw error;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  try{
    const value=await readJSON(path,true) ?? {schema:PYTHON_SCHEMA,binding,candidates:[],installations:[],active:null};
    need(hashValue(value.binding)===hashValue(binding),'PYTHON_RUNTIME_BINDING_CHANGED');
    const command=request.operation.slice('python-'.length);
    const upsert=(name,item)=>{value[name]=[...value[name].filter(old=>old.id!==item.id),item].sort((a,b)=>a.id.localeCompare(b.id));};
    if(command==='inspect' && !request.candidateId && !request.installationId){
      // Cohorts are append-only. An older completed inventory may be adopted
      // after a newer engine result without discarding that retained addition.
      for(const item of result.candidates??[])upsert('candidates',item);
      for(const item of result.installations??[])upsert('installations',item);
      value.active=result.active??null;
    }else if(['resolve','receive'].includes(command))upsert('candidates',result);
    else if(command==='install')upsert('installations',result);
    else if(command==='inspect' && request.candidateId)upsert('candidates',result);
    else if(command==='inspect' && request.installationId)upsert('installations',result);
    else if(command==='activate')value.active=result;
    value.observedAt=now();value.lastOperation=request.operation;value.python=request.python;
    await saveJSON(path,value,true);
  }finally{await lease.close();}
}
async function acceptResult(root,request,operationDirectory,result) {
  const command=request.operation.slice('python-'.length),binding=request.pythonBinding;
  if(['resolve','receive','install'].includes(command))await sourceMatches(result,binding);
  if(command==='inspect'){
    if(request.candidateId || request.installationId)await sourceMatches(result,binding);
    else need(Array.isArray(result.candidates) && Array.isArray(result.installations),'PYTHON_INSPECTION_INVALID');
  }
  if(command==='activate'){
    need(result.installation===request.installationId,'PYTHON_ACTIVATION_CHANGED');
    await sourceMatches(result,binding);
  }
  if(command==='bundle'){
    const file=await fileDigest(request.pythonArchive);
    need(file.bytes>0,'PYTHON_ARCHIVE_EMPTY');result={...result,archive:request.pythonArchive,archiveSha256:file.sha256,archiveBytes:file.bytes};
  }
  await rememberResult(binding,request,result);
  const receipt={schema:'stellar-forge.python-operation-result.v1',requestHash:request.requestHash,
    operation:request.operation,binding,result,completedAt:now()};
  const saved=join(operationDirectory,'python-result.json'),old=await readJSON(saved,true);
  if(old){need(old.requestHash===request.requestHash && hashValue(old.result)===hashValue(result),'PYTHON_OPERATION_RESULT_CHANGED');return old;}
  await saveJSON(saved,receipt);return receipt;
}
async function completedProgress(operationDirectory,request) {
  const receipt=await readJSON(join(operationDirectory,'python-result.json'),true);
  if(receipt){need(receipt.requestHash===request.requestHash,'PYTHON_OPERATION_RESULT_CHANGED');return receipt.result;}
  const names=(await readdir(operationDirectory)).filter(name=>/^python-progress-[0-9]+\.json$/.test(name)).sort((a,b)=>Number(b.match(/[0-9]+/)[0])-Number(a.match(/[0-9]+/)[0]));
  for(const name of names){
    const progress=await readJSON(join(operationDirectory,name),true);
    if(progress?.stage==='complete' && progress.state==='COMPLETED' &&
      progress.command===request.operation.slice('python-'.length) && plain(progress.result))return progress.result;
  }
  return null;
}
export async function executePythonOperation({root,request,operationDirectory,leaseFd,checkpoint}) {
  need(Object.hasOwn(pythonOperationFields,request.operation),'PYTHON_OPERATION_INVALID');
  need(Number.isInteger(leaseFd),'PYTHON_ORIGINAL_WORKER_LEASE_REQUIRED');
  const completed=await completedProgress(operationDirectory,request);
  if(completed)return acceptResult(root,request,operationDirectory,completed);
  const current=await pythonRuntimeBinding(request.runtimeDirectory,request.runtimeId);
  need(hashValue(current)===hashValue(request.pythonBinding),'PYTHON_RUNTIME_BINDING_CHANGED',undefined,409);
  await bindingRoot(current);
  const script=join(operationDirectory,'python-engine.py');
  try{await regular(script);}
  catch(error){if(error.code!=='ENOENT')throw error;await retainedBytes(script,await regular(ENGINE,2*1024*1024),request.pythonEngineSha256);}
  need(digest(await regular(script,2*1024*1024))===request.pythonEngineSha256,'PYTHON_ENGINE_CHANGED');
  if(request.operation==='python-resolve')await verifyProject(current);
  if(['python-install','python-bundle','python-activate'].includes(request.operation)){
    const choice=request.candidateId?['--candidate',request.candidateId]:['--installation',request.installationId];
    const selected=await smallJSON(request.python,['-I',script,'--root',request.pythonRoot,'--lease-fd','3','inspect',...choice],{leaseFd,timeoutMs:30000});
    await sourceMatches(selected,current);
    if(request.operation==='python-install')
      need(hashValue(selected.extras)===hashValue(request.pythonSelection.extras),'PYTHON_CANDIDATE_EXTRAS_CHANGED','Review the exact extras retained in this wheel candidate.',409);
  }
  const prior=await readJSON(join(operationDirectory,'state.json')),attempt=prior.attempt??1;
  const progressFile=join(operationDirectory,'python-progress-'+attempt+'.json');
  const output=await open(join(operationDirectory,'python-stdout-'+attempt+'.json'),'wx',0o600);
  let child,finished,timer,lastProgress='',progressTask=null,terminated=false;
  const stop=()=>{terminated=true;child?.kill('SIGTERM');};
  try {
    const args=engineArgs(request,progressFile);
    child=spawn(request.python,['-I',script,...args],{shell:false,cwd:request.runtimeDirectory,
      env:{...process.env,PYTHONNOUSERSITE:'1'},stdio:['ignore',output.fd,'inherit',leaseFd]});
    finished=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>accept({exitCode,signal}));});
    finished.catch(()=>{});
    await new Promise((accept,reject)=>{child.once('spawn',accept);child.once('error',reject);});
    await checkpoint({pythonProcess:{pid:child.pid,processStart:await processIdentity(child.pid),
      python:request.python,engineSha256:request.pythonEngineSha256},pythonStage:'STARTED'});
    timer=setInterval(()=>{
      if(progressTask)return;
      progressTask=(async()=>{
        try{const progress=await readJSON(progressFile,true);if(progress){const encoded=JSON.stringify(progress);
          if(encoded!==lastProgress){lastProgress=encoded;const {result,...status}=progress;await checkpoint({pythonStage:progress.stage,pythonProgress:status});}}}
        catch(error){process.stderr.write('Python progress: '+errorView(error).message+'\n');}
      })().finally(()=>{progressTask=null;});
    },750);
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
    const exit=await finished;clearInterval(timer);if(progressTask)await progressTask;await output.sync();
    const exitRecord={...exit,terminated,completedAt:now()};
    await saveJSON(join(operationDirectory,'python-exit-'+attempt+'.json'),exitRecord);
    const progress=await completedProgress(operationDirectory,request);
    if(progress)return acceptResult(root,request,operationDirectory,progress);
    let value;try{value=JSON.parse(await regular(join(operationDirectory,'python-stdout-'+attempt+'.json'),4*1024*1024));}catch{}
    need(exit.exitCode===0 && plain(value) && !value.error,'PYTHON_OPERATION_FAILED',
      typeof value?.message==='string'?value.message:'Open the original worker log and continue this retained operation.',409);
    return acceptResult(root,request,operationDirectory,value);
  }finally{
    clearInterval(timer);if(progressTask)await progressTask;process.off('SIGTERM',stop);process.off('SIGINT',stop);
    // Unexpected adapter failure cannot release custody while its child runs.
    if(child && child.exitCode===null && child.signalCode===null){child.kill('SIGTERM');if(finished)await finished.catch(()=>{});}
    await output.close();
  }
}
export async function recoverPythonOperation(root,id) {
  const directory=operationPath(root,id),lease=await operationLease(join(directory,'worker.lock'));
  try {
    const request=await readJSON(join(directory,'request.json'));
    need(Object.hasOwn(pythonOperationFields,request.operation),'PYTHON_OPERATION_INVALID');
    const {requestHash,createdAt,...intent}=request;
    need(hashValue(intent)===requestHash,'PYTHON_OPERATION_REQUEST_CHANGED');
    const state=await readJSON(join(directory,'state.json'));
    if(state.phase==='SUCCEEDED')return {operationId:id,resume:false,reused:true,state};
    const completed=await completedProgress(directory,request);
    if(completed){
      await bindingRoot(request.pythonBinding);
      const result=await acceptResult(root,request,directory,completed);
      const next={...state,phase:'SUCCEEDED',result,completedAt:result.completedAt,updatedAt:now()};
      await saveJSON(join(directory,'state.json'),next,true);
      return {operationId:id,resume:false,reused:true,state:next};
    }
    if(state.phase==='QUEUED')return {operationId:id,resume:true};
    need(['RUNNING','FAILED'].includes(state.phase),'PYTHON_OPERATION_STATE_INVALID');
    const attempts=await readJSON(join(directory,'python-attempts.json'),true) ?? [];
    attempts.push({attempt:state.attempt??1,state,recoveredAt:now()});
    await saveJSON(join(directory,'python-attempts.json'),attempts,true);
    await saveJSON(join(directory,'state.json'),{phase:'QUEUED',attempt:(state.attempt??1)+1,
      previousPhase:state.phase,updatedAt:now()},true);
    return {operationId:id,resume:true};
  }finally{await lease.close();}
}
export async function pythonWorkspaceState(root,{runtimeId,runtimeDirectory}={}) {
  const binding=await pythonRuntimeBinding(runtimeDirectory,runtimeId);
  const saved=await readJSON(viewPath(runtimeDirectory),true);
  const active=await readJSON(join(runtimeDirectory,'python-runtime','active.json'),true);
  if(active)await sourceMatches(active,binding);
  if(saved)need(hashValue(saved.binding)===hashValue(binding),'PYTHON_RUNTIME_BINDING_CHANGED');
  const names=(await readdir(join(root,'operations'))).filter(name=>/^[a-f0-9-]{36}$/.test(name));
  const operations=[];
  for(const id of names){
    const dir=operationPath(root,id),request=await readJSON(join(dir,'request.json'),true);
    if(!request || request.runtimeId!==runtimeId || !Object.hasOwn(pythonOperationFields,request.operation))continue;
    const state=await readJSON(join(dir,'state.json'),true)??{phase:'QUEUED'};
    const active=state.phase==='RUNNING' && await operationRunning(join(dir,'worker.lock'));
    operations.push({id,operation:request.operation,createdAt:request.createdAt,...state,workerActive:active,
      displayPhase:state.phase==='RUNNING' && !active?'INTERRUPTED':state.phase});
  }
  operations.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return {schema:PYTHON_SCHEMA,binding,project:PYTHON_PROJECT,
    candidates:saved?.candidates??[],installations:saved?.installations??[],active,
    observedAt:saved?.observedAt??null,python:saved?.python??null,operations};
}
export async function openPythonBundle(root,{operationId:id}={}) {
  const dir=operationPath(root,id),request=await readJSON(join(dir,'request.json'));
  need(request.operation==='python-bundle','PYTHON_BUNDLE_OPERATION_REQUIRED');
  const result=(await readJSON(join(dir,'python-result.json'))).result;
  const handle=await open(request.pythonArchive,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await handle.stat();need(first.isFile() && first.size===result.archiveBytes,'PYTHON_ARCHIVE_CHANGED');
    const hash=createHash('sha256');let bytes=0;
    for await(const part of handle.createReadStream({autoClose:false,start:0})){hash.update(part);bytes+=part.length;}
    const after=await handle.stat();
    need(hash.digest('hex')===result.archiveSha256 && bytes===result.archiveBytes &&
      first.size===after.size && first.mtimeMs===after.mtimeMs && first.ctimeMs===after.ctimeMs,'PYTHON_ARCHIVE_CHANGED',undefined,409);
    return {handle,bytes,sha256:result.archiveSha256,file:'python-'+request.candidateId+'.zip',type:'application/zip'};
  }catch(error){await handle.close();throw error;}
}
// This is a read-only engine inspection for the original Applications review
// and launch paths. Customer execution remains in their managed command runner.
export async function inspectPythonInstallation(root,{runtimeId,runtimeDirectory,installationId,leaseFd}={}) {
  hashId(installationId);
  const binding=await pythonRuntimeBinding(runtimeDirectory,runtimeId);
  const observed=await readJSON(viewPath(runtimeDirectory));
  const saved=observed.installations.find(item=>item.id===installationId);
  need(saved?.python && hashValue(observed.binding)===hashValue(binding),'PYTHON_INSTALLATION_INSPECTION_REQUIRED');
  const args=['-I',ENGINE,'--root',join(runtimeDirectory,'python-runtime')];
  if(leaseFd!==undefined)args.push('--lease-fd','3');
  args.push('inspect','--installation',installationId);
  const installation=await smallJSON(saved.python,args,{leaseFd,timeoutMs:30000});
  await sourceMatches(installation,binding);
  need(installation.id===installationId,'PYTHON_INSTALLATION_CHANGED');
  return {binding,installation};
}
