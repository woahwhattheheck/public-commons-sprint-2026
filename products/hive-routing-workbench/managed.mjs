#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {readdir,lstat,unlink,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {CONNECTION_SCHEMA,STARTUP_SCHEMA,need,absolute,integer,hash,readFile,readJson,readRuntime,
  writeJson,privateDirectory,readLaunchConfiguration,HiveClient,inside} from './connection.mjs';

export const WORKBENCH_ROOT=fileURLToPath(new URL('./workbench/',import.meta.url));
export const ORIGINAL_MANIFEST_SHA256='b73dcb02995c22d150159709f95bab37e1b2ddec604672aed0a9fc18cd9b5574';
export async function inspectOriginalSource({directory=WORKBENCH_ROOT}={}){
  const root=absolute(directory),selected=await readJson(fileURLToPath(new URL('./original-source.json',import.meta.url)),1024*1024,{privateOnly:false});
  need(selected.sha256===ORIGINAL_MANIFEST_SHA256&&selected.value.files.length===64,'HIVE_SOURCE_SELECTION','Select the complete maintained Hive workbench.',409);
  const names=new Set();
  for(const row of selected.value.files){
    need(typeof row.path==='string'&&!row.path.includes('\\')&&row.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!names.has(row.path),
      'HIVE_SOURCE_SELECTION','Select each complete original source path exactly once.',409);
    names.add(row.path);const found=await readFile(join(root,row.path),32*1024*1024,{privateOnly:false});
    need(found.bytes.length===row.bytes&&found.sha256===row.sha256,'HIVE_SOURCE_CHANGED','Original source changed: '+row.path,409);
  }
  const actual=[];
  async function walk(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      need(!entry.isSymbolicLink(),'HIVE_SOURCE_CHANGED','Original source contains a symbolic link.',409);
      if(entry.isDirectory()&&entry.name==='__pycache__')continue;
      const name=prefix+entry.name;
      if(entry.isDirectory())await walk(join(dir,entry.name),name+'/');
      else{need(entry.isFile(),'HIVE_SOURCE_CHANGED','Original source must contain regular files.',409);actual.push(name);}
    }
  }
  await walk(root);
  need(actual.length===64&&actual.every(p=>names.has(p)),'HIVE_SOURCE_CHANGED','Keep the complete selected 64-file workbench.',409);
  return{root,manifestSha256:selected.sha256,files:64,bytes:selected.value.files.reduce((n,f)=>n+f.bytes,0)};
}
export async function acquireLease(path){
  await privateDirectory(dirname(path));
  const fd=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{
    const st=await fd.stat();need(st.isFile()&&!(st.mode&0o077)&&(!process.getuid||st.uid===process.getuid()),
      'HIVE_LEASE','Use the original owned private operation lease.');
    await new Promise((accept,reject)=>{
      const child=spawn('flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','pipe',fd.fd]});
      let error='';child.stderr.on('data',chunk=>error+=chunk.toString());
      child.once('error',reject);child.once('close',code=>code===0?accept():reject(Object.assign(new Error('The original managed owner is active. '+error),{code:'HIVE_OWNER_ACTIVE',status:409})));
    });
    return fd;
  }catch(error){await fd.close();throw error;}
}
export function managedOptions(argv){
  const raw={};for(let i=0;i<argv.length;i+=2){
    const k=argv[i];need(['--configuration','--configuration-sha256','--port'].includes(k)&&!Object.hasOwn(raw,k)&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),
      'HIVE_ARGUMENT','Use each documented argument once with its complete value.');raw[k]=argv[i+1];
  }
  need(raw['--configuration'],'HIVE_ARGUMENT','Select the private launch configuration.');
  need(raw['--configuration-sha256']===undefined||/^[a-f0-9]{64}$/.test(raw['--configuration-sha256']),'HIVE_ARGUMENT','Use the complete configuration SHA-256.');
  need(/^\d+$/.test(raw['--port']??'0'),'HIVE_ARGUMENT','Use a whole loopback port.');
  return{configuration:absolute(raw['--configuration']),expectedConfigurationSha256:raw['--configuration-sha256'],port:integer(Number(raw['--port']??0),'port',65535)};
}
export async function startManagedHive(options){
  const configuration=await readLaunchConfiguration(options.configuration),v=configuration.value;
  need(!options.expectedConfigurationSha256||configuration.sha256===options.expectedConfigurationSha256,
    'HIVE_CONFIGURATION_CHANGED','The reviewed launch configuration changed.',409);
  const source=await inspectOriginalSource({directory:v.applicationDirectory});
  const runtime=await readRuntime(v.runtimeReadyFile);
  await privateDirectory(v.directory,{create:true});
  const workspaceLock=join(v.directory,'merchant-listener.lock'),connectionLock=join(dirname(v.connectionFile),basename(v.connectionFile)+'.lock');
  let workspaceLease=null,connectionLease=null,child=null,ended=null,connection=null,selectionFile=null,closing=null,closed=false;
  let childError=null,stopRequested=false;
  async function close(){
    if(closed)return;if(closing)return closing;
    closing=(async()=>{
      stopRequested=true;
      if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
      if(ended)await ended;
      if(connection){try{const old=await readJson(connection.path,65536);if(old.sha256===connection.sha256)await unlink(connection.path);}catch(error){if(error.code!=='ENOENT')throw error;}}
      if(selectionFile){await unlink(selectionFile).catch(error=>{if(error.code!=='ENOENT')throw error;});selectionFile=null;}
      if(connectionLease){await connectionLease.close();connectionLease=null;}
      if(workspaceLease){await workspaceLease.close();workspaceLease=null;}
      closed=true;
    })();try{return await closing;}finally{closing=null;}
  }
  try{
    workspaceLease=await acquireLease(workspaceLock);connectionLease=await acquireLease(connectionLock);
    const launchId=randomUUID(),nonce=randomBytes(32).toString('hex'),helper=fileURLToPath(new URL('./managed_host.py',import.meta.url));
    await readFile(helper,1024*1024,{privateOnly:false});
    selectionFile=join(dirname(v.connectionFile),'.hive-launch-'+launchId+'.json');
    await writeJson(selectionFile,{schema:'stellar-forge.hive-managed-selection.v1',launchId,nonce,ownerPid:process.pid,
      directory:v.directory,applicationDirectory:source.root,python:v.python,runtimeReadyFile:v.runtimeReadyFile,
      runtimeSelectionSha256:runtime.sha256,sourceManifestSha256:source.manifestSha256,port:options.port??0,workspaceLock,connectionLock});
    const environment={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONUNBUFFERED:'1'};
    for(const key of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete environment[key];
    child=spawn(v.python,['-I','-B',helper,'--selection',selectionFile],{
      cwd:source.root,env:environment,
      stdio:['ignore','pipe','pipe',workspaceLease.fd,connectionLease.fd]});
    ended=new Promise(accept=>{child.once('error',error=>{childError=error;});child.once('close',(code,signal)=>accept({code,signal}));});
    let buffer='',started=null,stderr='';
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-16000);process.stderr.write(chunk);});
    const startup=new Promise((accept,reject)=>{
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString();if(buffer.length>1024*1024){reject(new Error('Original server startup exceeded its complete record limit.'));return;}
        let index;while((index=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
          let value;try{value=JSON.parse(line);}catch{continue;}
          if(value.schema==='stellar-forge.hive-managed-child.v1'&&value.launchId===launchId){started=value;accept(value);}
        }
      });
      child.once('error',reject);child.once('close',(code,signal)=>{if(!started)reject(new Error('Original Hive server ended before readiness: '+(childError?.message??stderr??code??signal)));});
    });
    const signalStop=()=>{stopRequested=true;if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
    process.on('SIGTERM',signalStop);process.on('SIGINT',signalStop);
    try{
      const live=await startup;
      need(!stopRequested&&child.exitCode===null&&live.pid===child.pid,'HIVE_STARTUP_ENDED','The original server ended during startup.',409);
      const directoryIdentity=await privateDirectory(v.directory);
      const value={schema:CONNECTION_SCHEMA,launchId,nonce,instanceId:live.instanceId,origin:live.origin,pid:live.pid,ownerPid:process.pid,
        startedAt:new Date().toISOString(),directory:v.directory,applicationDirectory:source.root,directoryIdentity:{dev:directoryIdentity.dev,ino:directoryIdentity.ino},
        python:v.python,runtimeReadyFile:v.runtimeReadyFile,runtimeSelectionSha256:runtime.sha256,sourceManifestSha256:source.manifestSha256,
        configurationFile:configuration.path,configurationSha256:configuration.sha256};
      connection={...(await writeJson(v.connectionFile,value,{replace:true})),value};
      const client=await HiveClient.connect(connection.path);try{await client.info();}finally{await client.close();}
    }finally{process.off('SIGTERM',signalStop);process.off('SIGINT',signalStop);}
    return{configuration,connection,source,child,ended,origin:connection.value.origin,close};
  }catch(error){
    try{await close();}catch(closeError){error.hiveOwner={close,configuration:configuration.path};error.closeError=String(closeError);}
    throw error;
  }
}
export function hiveStartup(service){
  const v=service.connection.value;
  return{schema:STARTUP_SCHEMA,status:'HIVE_ROUTING_WORKBENCH_READY',directory:v.directory,applicationDirectory:v.applicationDirectory,
    launchId:v.launchId,instanceId:v.instanceId,pid:v.pid,ownerPid:v.ownerPid,origin:v.origin,url:v.origin+'/',
    connectionFile:service.connection.path,connectionSha256:service.connection.sha256,configurationFile:service.configuration.path,
    configurationSha256:service.configuration.sha256,sourceManifestSha256:v.sourceManifestSha256,runtimeSelectionSha256:v.runtimeSelectionSha256};
}
const HELP='Hive Routing Workbench\n\nstarforge hive-routing-workbench-managed --configuration /private/hive/launch.json [--port 0]\n'+
  'Open the complete original operator, selected native router lifecycle and retained GraphQL programme. Applications Stop joins the operator listener; use native.stop for each separately accepted original router.\n';
async function waitForStop(owner){
  await new Promise(accept=>{
    let closing=false;
    const stop=async()=>{
      if(closing)return;closing=true;
      try{await owner.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);accept();}
      catch(error){closing=false;process.stderr.write(JSON.stringify({error:{code:'HIVE_CLOSE_PENDING',message:String(error)}})+'\n');}
    };
    process.on('SIGINT',stop);process.on('SIGTERM',stop);owner.ended?.then(stop);
  });
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,waitForClose=true}={}){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){stdout.write(HELP);return{help:true};}
  let owner;
  try{owner=await startManagedHive(managedOptions(argv));}
  catch(error){if(error.hiveOwner&&waitForClose)await waitForStop(error.hiveOwner);throw error;}
  try{stdout.write(JSON.stringify(hiveStartup(owner))+'\n');}
  catch(error){try{await owner.close();}catch{if(waitForClose)await waitForStop(owner);}throw error;}
  if(!waitForClose)return owner;
  await waitForStop(owner);return{status:'CLOSED',launchId:owner.connection.value.launchId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'HIVE_MANAGED_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
