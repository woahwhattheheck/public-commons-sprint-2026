#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readdir,lstat,open,mkdir,chmod} from 'node:fs/promises';
import {STARTUP_SCHEMA,need,absolute,integer,hash,readFile,readJson,writeJson,privateDirectory,
  readLaunchConfiguration,PipelineDeliveryClient,inside,ownedDirectory} from './connection.mjs';
import {inspectPipelineDeliveryRuntime} from './prepare.mjs';
import {acquirePrivateDirectoryWriter} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/operations/history.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
export async function acquireLease(path){
  path=absolute(path);await privateDirectory(dirname(path));
  const directory=path+'.lease';await privateDirectory(directory,{create:true});
  const held=await acquirePrivateDirectoryWriter(directory);let closed=false,closing=null;
  return{async close(){
    if(closed)return;if(closing)return closing;
    closing=(async()=>{await held.release();closed=true;})();
    try{return await closing;}finally{closing=null;}
  }};
}
export const WORKBENCH_ROOT=join(HERE,'workbench'),PROGRAMME_ROOT=join(HERE,'original-programme');
export const ORIGINAL_MANIFEST_SHA256='fec97f70237e18e5332fda2eb957dd91c96be9f7561be928e3cc724031047573';
const SOURCE_MANIFEST=join(HERE,'original-source.json'),BRIDGE=join(HERE,'managed_host.py');
export async function inspectOriginalSource({directory=WORKBENCH_ROOT,programmeDirectory=PROGRAMME_ROOT}={}){
  const roots={workbench:absolute(directory),'original-programme':absolute(programmeDirectory)},
    selected=await readJson(SOURCE_MANIFEST,1024*1024,{privateOnly:false});
  need(selected.sha256===ORIGINAL_MANIFEST_SHA256&&selected.value.schema==='stellar-forge.pipeline-delivery-workbench-original-source.v1'&&
    selected.value.commit==='3cf4363327938957e886c891a13673064d0206dc'&&selected.value.files.length===40,
    'PIPELINE_DELIVERY_SOURCE_AUTHORITY','Select the complete published original application and programme.',409);
  const names=new Set();
  for(const row of selected.value.files){
    need(typeof row.path==='string'&&!row.path.includes('\\')&&row.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!names.has(row.path),
      'PIPELINE_DELIVERY_SOURCE_PATH','Use the exact original source member.',409);
    names.add(row.path);const split=row.path.indexOf('/'),prefix=row.path.slice(0,split),relative=row.path.slice(split+1);
    need(roots[prefix]&&relative,'PIPELINE_DELIVERY_SOURCE_PATH','Select the original application or programme group.',409);
    const file=await readFile(join(roots[prefix],relative),32*1024*1024,{privateOnly:false});
    need(file.bytes.length===row.bytes&&file.sha256===row.sha256,'PIPELINE_DELIVERY_SOURCE_CHANGED','Original source differs: '+row.path,409);
  }
  const actual=[];
  async function walk(directory,prefix){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const path=prefix+entry.name;need(!entry.isSymbolicLink(),'PIPELINE_DELIVERY_SOURCE_CHANGED','Original source contains a linked member.',409);
      if(entry.isDirectory()&&entry.name==='__pycache__')continue;
      if(entry.isDirectory())await walk(join(directory,entry.name),path+'/');
      else{need(entry.isFile(),'PIPELINE_DELIVERY_SOURCE_CHANGED','Use original regular source members.',409);actual.push(path);}
    }
  }
  for(const[prefix,root]of Object.entries(roots))await walk(root,prefix+'/');
  need(actual.length===40&&actual.every(p=>names.has(p)),'PIPELINE_DELIVERY_SOURCE_CHANGED','Retain the full exact forty-file application/programme.',409);
  return{root:roots.workbench,programmeDirectory:roots['original-programme'],manifestSha256:selected.sha256,files:40,
    bytes:selected.value.files.reduce((n,f)=>n+f.bytes,0)};
}
export function managedOptions(argv){
  const raw={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i];need(['--configuration','--configuration-sha256','--port'].includes(key)&&!Object.hasOwn(raw,key)&&
      typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),'PIPELINE_DELIVERY_ARGUMENT','Use each complete documented option once.');raw[key]=argv[i+1];
  }
  need(raw['--configuration'],'PIPELINE_DELIVERY_ARGUMENT','Select the private launch configuration.');
  need(raw['--configuration-sha256']===undefined||/^[a-f0-9]{64}$/.test(raw['--configuration-sha256']),
    'PIPELINE_DELIVERY_ARGUMENT','Retain the full reviewed configuration digest.');
  need(/^\d+$/.test(raw['--port']??'0'),'PIPELINE_DELIVERY_ARGUMENT','Choose a complete loopback port.');
  return{configuration:absolute(raw['--configuration']),expectedConfigurationSha256:raw['--configuration-sha256'],port:integer(Number(raw['--port']??0),'port',65535)};
}
function environment(python,dbt){
  const env={...process.env};
  for(const key of['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[key];
  env.PYTHONDONTWRITEBYTECODE='1';env.PATH=[dirname(dbt),dirname(python),process.env.PATH??''].join(':');return env;
}
const delay=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));
export async function startManagedPipelineDelivery(options){
  const configuration=await readLaunchConfiguration(options.configuration),v=configuration.value;
  need(!options.expectedConfigurationSha256||configuration.sha256===options.expectedConfigurationSha256,
    'PIPELINE_DELIVERY_CONFIGURATION_CHANGED','Review the current complete launch configuration.',409);
  const source=await inspectOriginalSource({directory:v.applicationDirectory,programmeDirectory:v.programmeDirectory});
  const runtime=await inspectPipelineDeliveryRuntime({runtimeReadyFile:v.runtimeReadyFile,applicationDirectory:v.applicationDirectory,python:v.python});
  need(runtime.programmeDirectory===v.programmeDirectory,'PIPELINE_DELIVERY_PROGRAMME_CHANGED','Use the prepared original operator programme.',409);
  const runtimeRecord=await readFile(v.runtimeReadyFile,1024*1024),launchId=randomUUID();
  for(const path of[v.directory,v.controlDirectory]){
    await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await ownedDirectory(path);const state=await lstat(path);
    need((state.mode&0o700)===0o700,'PIPELINE_DELIVERY_DIRECTORY_ACCESS','The selected original directory must be readable, writable and searchable by its owner.');
    if(state.mode&0o077)await chmod(path,state.mode&0o700);
    await privateDirectory(path);
  }
  const records=join(dirname(v.connectionFile),basename(v.connectionFile)+'.runs');await privateDirectory(records,{create:true});
  const run=join(records,launchId);await privateDirectory(run,{create:true});
  const request={schema:'stellar-forge.pipeline-delivery-managed-request.v1',launchId,configurationFile:configuration.path,
    configurationSha256:configuration.sha256,configuration:v,sourceAuthority:SOURCE_MANIFEST,sourceManifestSha256:source.manifestSha256,
    runtimeId:runtime.runtimeId,runtimeSelectionSha256:runtimeRecord.sha256,port:options.port??0,startedAt:new Date().toISOString(),
    bridge:{path:BRIDGE,...await (async()=>{const r=await readFile(BRIDGE,1024*1024,{privateOnly:false});return{bytes:r.bytes.length,sha256:r.sha256};})()}};
  const requestFile=join(run,'request.json'),recordFile=join(run,'process.json');
  await writeJson(requestFile,request);await writeJson(recordFile,{schema:'stellar-forge.pipeline-delivery-managed-process.v1',launchId,state:'prepared',requestFile});
  let out=null,err=null,child=null,exited=null,exitResult=null,spawnError=null,connection=null,closing=null,closed=false,startupStopping=false;
  async function close(){
    if(closed)return;
    if(closing){
      if(child&&exitResult===null&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
      return closing;
    }
    closing=(async()=>{
      const failures=[];
      const attempt=async(step,action)=>{try{return await action();}catch(error){failures.push({step,error});return undefined;}};
      // The managed listener owns its child. Finish that lifetime before closing
      // the log descriptors; a failed log/record operation must not skip another.
      if(child&&exited){
        if(exitResult===null&&child.pid&&child.exitCode===null&&child.signalCode===null)
          await attempt('terminate',async()=>{child.kill('SIGTERM');});
        await attempt('reap',async()=>{exitResult=await exited;});
      }
      if(out)await attempt('stdout-sync',()=>out.sync());
      if(err)await attempt('stderr-sync',()=>err.sync());
      if(out)await attempt('stdout-close',async()=>{await out.close();out=null;});
      if(err)await attempt('stderr-close',async()=>{await err.close();err=null;});
      const logs={};
      for(const[key,file]of[['stdout',join(run,'stdout.log')],['stderr',join(run,'stderr.log')]]){
        await attempt(key+'-identity',async()=>{try{logs[key]=await retainedLog(file);}catch(error){if(error.code!=='ENOENT')throw error;}});
      }
      await attempt('closed-record',()=>writeJson(recordFile,{
        schema:'stellar-forge.pipeline-delivery-managed-process.v1',launchId,
        state:failures.length?'close-incomplete':'closed',requestFile,
        pid:child?.pid??null,exitCode:exitResult?.code??null,signal:exitResult?.signal??null,
        spawnError:spawnError?{code:spawnError.code??null,message:spawnError.message}:null,
        cleanupErrors:failures.map(({step,error})=>({step,code:error.code??null,message:error.message})),
        logs,completedAt:new Date().toISOString()
      },{replace:true}));
      if(failures.length)throw Object.assign(new AggregateError(failures.map(x=>x.error),
        'The original Staff close needs its retained owner to finish.'),{
        code:'PIPELINE_DELIVERY_CLOSE',details:failures.map(({step,error})=>({step,code:error.code??null,message:error.message}))
      });
      closed=true;
    })();try{return await closing;}finally{closing=null;}
  }
  const owner={configuration,source,runtime,launchId,recordDirectory:run,close,get exited(){return exited;},get connection(){return connection;}};
  const startupStop=()=>{startupStopping=true;if(child&&exitResult===null&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
  process.on('SIGINT',startupStop);process.on('SIGTERM',startupStop);
  try{
    out=await open(join(run,'stdout.log'),'wx',0o600);err=await open(join(run,'stderr.log'),'wx',0o600);
    need(!startupStopping,'PIPELINE_DELIVERY_START_STOPPED','The managed launch was stopped before dispatch.',409);
    child=spawn(v.python,['-I','-B',BRIDGE,'--request',requestFile],{cwd:run,env:environment(v.python,runtime.dbt),stdio:['ignore',out.fd,err.fd]});
    exited=new Promise(resolveExit=>{child.on('error',e=>{spawnError=e;});child.once('close',(code,signal)=>{exitResult={code,signal};resolveExit(exitResult);});});
    await writeJson(recordFile,{schema:'stellar-forge.pipeline-delivery-managed-process.v1',launchId,state:'starting',requestFile,pid:child.pid??null},{replace:true});
    const deadline=Date.now()+30000;
    while(true){
      need(!startupStopping,'PIPELINE_DELIVERY_START_STOPPED','The original Staff launch was stopped.',409);
      if(exitResult!==null)throw spawnError??Object.assign(new Error('The original Staff launch closed before becoming ready; retain '+recordFile),{code:'PIPELINE_DELIVERY_START_CLOSED'});
      try{const c=await readJson(v.connectionFile,65536);if(c.value.launchId===launchId){connection=c;break;}}
      catch(e){if(e.code!=='ENOENT')throw e;}
      need(Date.now()<deadline,'PIPELINE_DELIVERY_START_PENDING','The original Staff did not produce its matching connection before the startup deadline.',504);
      await delay(100);
    }
    const client=await PipelineDeliveryClient.connect(v.connectionFile,{directory:v.directory,controlDirectory:v.controlDirectory,expectedLaunchId:launchId});
    try{await client.info();}finally{await client.close();}
    need(exitResult===null&&!startupStopping,'PIPELINE_DELIVERY_START_CLOSED','The original Staff closed during startup.',409);
    await writeJson(recordFile,{schema:'stellar-forge.pipeline-delivery-managed-process.v1',launchId,state:'ready',requestFile,
      pid:child.pid,connection:{path:connection.path,sha256:connection.sha256},startedAt:request.startedAt},{replace:true});
    return owner;
  }catch(error){
    try{await close();}catch(closeError){error.pipelineDeliveryOwner=owner;error.closeError={code:closeError.code??'PIPELINE_DELIVERY_CLOSE',message:closeError.message};}
    throw error;
  }finally{process.off('SIGINT',startupStop);process.off('SIGTERM',startupStop);}
}
async function retainedLog(path){
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid()),
      'PIPELINE_DELIVERY_LOG','Keep the original owned private process log.');
    const sha=createHash('sha256'),chunk=Buffer.alloc(1024*1024);let bytes=0;
    while(true){const r=await fd.read(chunk,0,chunk.length,null);if(!r.bytesRead)break;sha.update(chunk.subarray(0,r.bytesRead));bytes+=r.bytesRead;}
    const last=await fd.stat();
    need(bytes===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'PIPELINE_DELIVERY_LOG_CHANGED','The retained closed process log changed during observation.',409);
    return{path,bytes,sha256:sha.digest('hex')};
  }finally{await fd.close();}
}
export function pipelineDeliveryStartup(service){
  const v=service.connection.value;
  return{schema:STARTUP_SCHEMA,status:'PIPELINE_DELIVERY_WORKBENCH_READY',directory:v.directory,controlDirectory:v.controlDirectory,
    launchId:v.launchId,instanceId:v.instanceId,pid:v.pid,origin:v.origin,url:v.origin+'/',applicationDirectory:v.applicationDirectory,
    programmeDirectory:v.programmeDirectory,connectionFile:service.connection.path,connectionSha256:service.connection.sha256,
    configurationFile:service.configuration.path,configurationSha256:service.configuration.sha256,
    sourceManifestSha256:v.sourceManifestSha256,runtimeId:v.runtimeId,runtimeSelectionSha256:v.runtimeSelectionSha256};
}
async function waitForStop(owner){
  let stopped=false;
  const stop=()=>{stopped=true;void owner.close().catch(e=>process.stderr.write(JSON.stringify({error:{code:e.code??'PIPELINE_DELIVERY_CLOSE',
    message:'The original Staff is still owned. Repeat Stop to finish closing.'}})+'\n'));};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{
    const result=await owner.exited;
    await owner.close();
    need(stopped||result?.code===0,'PIPELINE_DELIVERY_PROCESS_CLOSED','The original Staff closed unexpectedly; its retained process record has the actual outcome.',409);
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,waitForClose=true}={}){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    const result={command:'pipeline-delivery-workbench-managed',
      usage:'--configuration /private/pipeline/launch.json [--port 0]',
      operation:'Start the original Staff workspace. Stop drains HTTP and closes this writer; accepted original Dagster/dbt workers retain their own native lease.'};
    stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  let service;
  try{service=await startManagedPipelineDelivery(managedOptions(argv));}
  catch(error){if(error.pipelineDeliveryOwner&&waitForClose)await waitForStop(error.pipelineDeliveryOwner);throw error;}
  try{stdout.write(JSON.stringify(pipelineDeliveryStartup(service))+'\n');}
  catch(error){try{await service.close();}catch{if(waitForClose)await waitForStop(service);else error.pipelineDeliveryOwner=service;}throw error;}
  if(!waitForClose)return service;
  await waitForStop(service);return{status:'CLOSED',launchId:service.launchId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'PIPELINE_DELIVERY_MANAGED_FAILED',message:error.message}})+'\n');process.exitCode=1;});
