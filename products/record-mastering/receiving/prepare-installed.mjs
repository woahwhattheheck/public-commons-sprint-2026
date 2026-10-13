#!/usr/bin/env node
// MIT. Prepare one original installed product and retain every native build/install outcome.
import { mkdir, readFile, open, rename, lstat, cp, readdir, realpath, unlink } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--request')throw Error('Use --request ABSOLUTE_PRIVATE_JSON');
const requestPath=resolve(args[1]),original=await readFile(requestPath),request=JSON.parse(original);
const need=(x,message)=>{if(!x)throw Error(message);},sha=b=>createHash('sha256').update(b).digest('hex'),json=x=>JSON.stringify(x,null,2)+'\n';
need(request.schema==='stellar-forge.record-mastering-installed-preparation.v1','Use the complete original preparation request');
for(const k of ['directory','sourceDirectory','gitRepository','buildDirectory','runtimeDirectory','receivingDirectory','playwright','chromium'])
 need(typeof request[k]==='string'&&request[k]===resolve(request[k]),'Require absolute '+k);
need(/^[a-f0-9]{40}$/.test(request.sourceCommit)&&typeof request.operationId==='string','Pin the upstream commit and original operation');
need(typeof request.offline==='boolean','Choose the native package/network mode explicitly');
if(request.retainedDependencies)need(request.retainedDependencies.directory===resolve(request.retainedDependencies.directory)&&/^[a-f0-9]{64}$/.test(request.retainedDependencies.lockSha256),'Pin the complete original dependency donor');
function failure(error){
 const result={code:error.code??'PREPARATION_ERROR',message:error.message};
 // These fields come from the original Git source reader and identify the
 // exact selected objects or limits needed to continue the same build.
 for(const key of ['sourceCommit','gitBlob','paths','bytes','limitBytes','missingObjects','inspection'])
  if(error[key]!==undefined)result[key]=error[key];
 return result;
}
const root=request.directory,base='stellar/scf-starforge-20261009/distribution/';
await mkdir(root,{mode:0o700,recursive:true});need(await realpath(root)===root&&((await lstat(root)).mode&0o077)===0,'Use a private real operation directory');
const modulePath=p=>pathToFileURL(join(request.sourceDirectory,base+p)).href;
const storage=await import(modulePath('runtime-workspace/storage.mjs')),lease=await storage.operationLease(join(root,'prepare.lock'));
try{
const owner=await storage.processIdentity();
async function readJSON(path,optional=false){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
async function atomic(path,value){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temporary=path+'.pending-'+randomUUID();let fd=null,parent=null,owned=false,primary=null;
 const cleanup=[];
 try{
  fd=await open(temporary,'wx',0o600);owned=true;
  await fd.writeFile(typeof value==='string'?value:json(value));await fd.sync();
  await fd.close();fd=null;await rename(temporary,path);owned=false;
 }catch(error){primary=error;}
 finally{
  if(fd)try{await fd.close();}catch(error){cleanup.push(error);}
  if(owned)try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')cleanup.push(error);}
  try{parent=await open(dirname(path),'r');await parent.sync();}catch(error){cleanup.push(error);}
  finally{if(parent)try{await parent.close();}catch(error){cleanup.push(error);}}
 }
 if(primary){if(cleanup.length)primary.cleanupErrors=[...(primary.cleanupErrors??[]),...cleanup];throw primary;}
 if(cleanup.length===1)throw cleanup[0];if(cleanup.length)throw new AggregateError(cleanup,'Original receiving file cleanup failed.');
}
let record=await readJSON(join(root,'preparation.json'),true);
if(record)need(record.requestSha256===sha(original),'Retain the exact original preparation request');
else{record={schema:request.schema,operationId:request.operationId,requestSha256:sha(original),request,createdAt:new Date().toISOString(),stages:{}};await atomic(join(root,'request.json'),original.toString('utf8'));}
const persist=async()=>{record.owner=owner;record.updatedAt=new Date().toISOString();await atomic(join(root,'preparation.json'),record);};
async function stage(name,input,work){
 let saved=record.stages[name];
 if(saved?.state==='COMPLETE')return saved.result;
 if(!saved){saved=record.stages[name]={input,sha256:sha(json(input)),state:'RETAINED'};await persist();}
 need(saved.sha256===sha(json(saved.input)),'Original stage changed');
 saved.state='RUNNING';saved.startedAt??=new Date().toISOString();await persist();
 try{saved.result=await work(saved.input);saved.state='COMPLETE';saved.completedAt=new Date().toISOString();delete saved.error;await persist();process.stdout.write(json({operation:request.operationId,stage:name,state:'COMPLETE'}));return saved.result;}
 catch(e){saved.state='INTERRUPTED';saved.error=failure(e);await persist();throw e;}
}
try{
 await persist();
 const {buildDistribution}=await import(modulePath('build.mjs'));
 const {prepareRuntimeInstall,recoverRuntime,installRuntime,inspectRuntimeInstall}=await import(modulePath('runtime-install.mjs'));
 const built=await stage('original-source-build',{repository:request.gitRepository,ref:request.sourceCommit,output:request.buildDirectory,selection:'record-mastering-workspace',offline:request.offline,resume:true},async q=>{
  const r=await buildDistribution({...q,onProgress:e=>process.stdout.write(json({operation:request.operationId,build:e.phase??e}))});
  need(r.status==='PACKAGED'&&r.sourceCommit===request.sourceCommit&&r.sourceSelection?.id==='record-mastering-workspace','Original builder selected different source');return r;
 });
 const prepared=await stage('original-runtime-prepare',{directory:request.runtimeDirectory,archive:built.archive,sha256:built.sha256,operator:true,features:['mcp']},async q=>{
  let directory=q.directory,previous=null;
  for(let n=0;existsSync(directory)&&!existsSync(join(directory,'runtime-install.json'));n++){
   need(existsSync(join(directory,'preparation.json')),'An unrelated directory occupies the original runtime selection');
   previous=directory;directory=q.directory+'-recovered-'+(n+1);
  }
  if(existsSync(join(directory,'runtime-install.json'))){
   const plan=await readJSON(join(directory,'runtime-install.json'));
   need(plan.archiveSha256===q.sha256&&plan.source.sourceCommit===request.sourceCommit,'Retained runtime selects different source');return plan;
  }
  record.runtimeCandidate={directory,previousDirectory:previous};await persist();
  return previous?recoverRuntime({from:previous,directory,install:false}):prepareRuntimeInstall(q);
 });
 const runtimeDirectory=prepared.directory;
 if(request.retainedDependencies)await stage('original-dependency-adoption',{directory:runtimeDirectory,donor:request.retainedDependencies},async q=>{
  const originalLock=await readFile(join(q.donor.directory,'package-lock.json'));
  need(sha(originalLock)===q.donor.lockSha256,'Original donor lock differs from selected identity');
  const target=join(q.directory,'node_modules'),stagePath=join(q.directory,'retained-node-modules');
  if(!existsSync(target)){
   await cp(join(q.donor.directory,'node_modules'),stagePath,{recursive:true,dereference:false,preserveTimestamps:true,mode:constants.COPYFILE_FICLONE});
   await rename(stagePath,target);
  }
  const targetLock=join(q.directory,'package-lock.json');
  if(existsSync(targetLock))need(sha(await readFile(targetLock))===q.donor.lockSha256,'Retained target lock differs');
  else await atomic(targetLock,originalLock.toString('utf8'));
  return{donor:q.donor,selected:target,lockSha256:sha(originalLock)};
 });
 const installed=await stage('original-runtime-install',{directory:runtimeDirectory,offline:request.offline,cache:request.npmCache??null,nodeHeaders:request.nodeHeaders??null,adoptExisting:Boolean(request.retainedDependencies)},q=>installRuntime(q));
 need(installed.ready===true||installed.status==='READY','Original runtime is not ready');
 const finalInspection=await inspectRuntimeInstall({directory:runtimeDirectory,load:true,source:true});
 need(finalInspection.ready===true,'Original READY runtime changed');
 const receiving={schema:'stellar-forge.record-mastering-installed-receiving.v1',operationId:request.operationId,directory:request.receivingDirectory,runtimeDirectory,
  sourceCommit:request.sourceCommit,playwright:request.playwright,chromium:request.chromium};
 const casePath=join(root,'receiving-case.json'),previousCase=await readJSON(casePath,true);
 if(previousCase)need(sha(json(previousCase))===sha(json(receiving)),'Original receiving inputs changed');
 else await atomic(casePath,receiving);
 record.state='READY';record.result={sourceBuild:built,runtimeDirectory,inspection:finalInspection,receivingCase:casePath};await persist();
 process.stdout.write(json({operation:request.operationId,state:'READY',sourceCommit:request.sourceCommit,runtimeDirectory,receivingCase:casePath}));
}catch(e){record.state='INTERRUPTED';record.error={...failure(e),stack:e.stack};
 try{await persist();}catch(error){record.error.persistenceError=failure(error);}
 try{process.stderr.write(json({operation:request.operationId,state:record.state,error:record.error}));}catch{}
 process.exitCode=1;}
}finally{await lease.close();}
