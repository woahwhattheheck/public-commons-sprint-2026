#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readdir,lstat,unlink} from 'node:fs/promises';
import {acquireWorkspaceLease} from './workbench/vendor/stellar-expert/store.mjs';
import {CONNECTION_SCHEMA,STARTUP_SCHEMA,need,absolute,integer,hash,readFile,readJson,
  writeJson,privateDirectory,readLaunchConfiguration,CollaborativeClient,inside} from './connection.mjs';

export const WORKBENCH_ROOT=fileURLToPath(new URL('./workbench/',import.meta.url));
export const ORIGINAL_MANIFEST_SHA256='7f99b944d4cc09f589bc04d189db492ad172501b181f6d3404be027e3d0255b8';
export async function inspectOriginalSource({directory=WORKBENCH_ROOT}={}){
  const sourceRoot=absolute(directory);
  const selected=await readJson(fileURLToPath(new URL('./original-source.json',import.meta.url)),1024*1024,{privateOnly:false});
  need(selected.sha256===ORIGINAL_MANIFEST_SHA256&&selected.value.schema==='stellar-forge.collaborative-documents-original-source.v1'&&
    selected.value.commit==='fce1f8b787822513fb1b8a1ed77f41c5f2322fae'&&selected.value.files.length===50,
    'COLLABORATION_SOURCE_SELECTION','Select the complete published original workbench source.',409);
  const names=new Set();
  for(const entry of selected.value.files){
    need(typeof entry.path==='string'&&!entry.path.includes('\\')&&entry.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&
      !names.has(entry.path),'COLLABORATION_SOURCE_MANIFEST','The original source path selection changed.',409);
    names.add(entry.path);
    const file=await readFile(join(sourceRoot,entry.path),32*1024*1024,{privateOnly:false});
    need(file.bytes.length===entry.bytes&&file.sha256===entry.sha256,'COLLABORATION_SOURCE_CHANGED','Original source differs: '+entry.path,409);
  }
  const actual=[];
  async function walk(directory,prefix=''){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      // These are the unchanged original installer's dependency, receipt and browser-build outputs.
      if(prefix===''&&['node_modules','.runtime','dist'].includes(entry.name))continue;
      const path=prefix+entry.name;
      need(!entry.isSymbolicLink(),'COLLABORATION_SOURCE_CHANGED','Original source contains a symlink: '+path,409);
      if(entry.isDirectory())await walk(join(directory,entry.name),path+'/');
      else{need(entry.isFile(),'COLLABORATION_SOURCE_CHANGED','Original source is not a regular member: '+path,409);actual.push(path);}
    }
  }
  await walk(sourceRoot);
  need(actual.length===50&&actual.every(path=>names.has(path)),'COLLABORATION_SOURCE_CHANGED','Use the full unchanged 50-file original application.',409);
  return{root:sourceRoot,manifestSha256:selected.sha256,files:50,bytes:selected.value.files.reduce((n,f)=>n+f.bytes,0)};
}
export function managedOptions(argv){
  const raw={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i];need(['--configuration','--configuration-sha256','--port'].includes(key)&&!Object.hasOwn(raw,key)&&
      typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--'),'COLLABORATION_ARGUMENT','Use each documented option once with its complete value.');
    raw[key]=argv[i+1];
  }
  need(raw['--configuration'],'COLLABORATION_ARGUMENT','Select the private launch configuration.');
  need(raw['--configuration-sha256']===undefined||/^[a-f0-9]{64}$/.test(raw['--configuration-sha256']),
    'COLLABORATION_ARGUMENT','Retain the complete reviewed configuration SHA-256.');
  need(/^\d+$/.test(raw['--port']??'0'),'COLLABORATION_ARGUMENT','Choose a whole loopback port.');
  return{configuration:absolute(raw['--configuration']),expectedConfigurationSha256:raw['--configuration-sha256'],
    port:integer(Number(raw['--port']??0),'port',65535)};
}
export async function startManagedCollaborative(options){
  const configuration=await readLaunchConfiguration(options.configuration),v=configuration.value;
  need(!options.expectedConfigurationSha256||configuration.sha256===options.expectedConfigurationSha256,
    'COLLABORATION_CONFIGURATION_CHANGED','Review the current complete launch configuration.',409);
  need(!inside(v.applicationDirectory,v.directory),'COLLABORATION_WORKSPACE_LAYOUT','Keep the editable workspace beside the installed application.');
  need(!inside(v.applicationDirectory,v.connectionFile),
    'COLLABORATION_CONNECTION_LAYOUT','Keep the generated connection beside its launch configuration, outside installed source.');
  const source=await inspectOriginalSource({directory:v.applicationDirectory});
  let original=null,connection=null,connectionLease=null,closed=false,closing=null;
  async function close(){
    if(closed)return;if(closing)return closing;
    closing=(async()=>{
      if(connection){
        try{
          const current=await readJson(connection.path,65536);
          if(current.sha256===connection.sha256)await unlink(connection.path);
        }catch(e){if(e.code!=='ENOENT')throw e;}
      }
      if(original)await original.close();
      if(connectionLease)await connectionLease.close();
      closed=true;
    })();
    try{return await closing;}finally{closing=null;}
  }
  try{
    connectionLease=await acquireWorkspaceLease(join(dirname(v.connectionFile),basename(v.connectionFile)+'.lock'));
    try{
      const {createApplicationServer}=await import(pathToFileURL(join(source.root,'server.mjs')).href);
      original=await createApplicationServer({directory:v.directory,authFile:v.authFile,
        runtimeReadyFile:v.runtimeReadyFile,host:'127.0.0.1',port:options.port??0});
    }catch(error){
      // The original factory may still own its exact listener/runtime/SQLite lease when cleanup failed.
      original=error.application??(typeof error.closeFailedApplication==='function'?{close:error.closeFailedApplication}:null);
      throw error;
    }
    const started=original;
    const selected=await privateDirectory(v.directory),value={schema:CONNECTION_SCHEMA,launchId:randomUUID(),
      instanceId:started.instanceId,directory:v.directory,applicationDirectory:source.root,directoryIdentity:{dev:selected.dev,ino:selected.ino},
      authFile:v.authFile,actorId:v.actorId,runtimeReadyFile:v.runtimeReadyFile,origin:started.origin,
      pid:process.pid,startedAt:new Date().toISOString(),sourceManifestSha256:source.manifestSha256,
      runtimeSelectionSha256:original.identity.runtime.selectionSha256};
    connection={...(await writeJson(v.connectionFile,value,{replace:true})),value};
    const client=await CollaborativeClient.connect(connection.path);
    try{await client.info();}finally{await client.close();}
    return{configuration,connection,source,original,origin:started.origin,close};
  }catch(error){
    try{await close();}catch(closeError){
      // Retain the actual owner for an in-process caller to drain after a failed startup.
      error.collaborationOwner={close,configuration:configuration.path};
      error.closeError={code:closeError.code??'COLLABORATION_CLOSE_FAILED',message:closeError.message};
    }
    throw error;
  }
}
export function collaborationStartup(service){
  const v=service.connection.value;
  return{schema:STARTUP_SCHEMA,status:'COLLABORATIVE_DOCUMENTS_READY',directory:v.directory,
    launchId:v.launchId,instanceId:v.instanceId,pid:v.pid,origin:v.origin,url:v.origin+'/',applicationDirectory:v.applicationDirectory,
    connectionFile:service.connection.path,connectionSha256:service.connection.sha256,
    configurationFile:service.configuration.path,configurationSha256:service.configuration.sha256,
    sourceManifestSha256:v.sourceManifestSha256,runtimeSelectionSha256:v.runtimeSelectionSha256};
}
const HELP='Collaborative Document Workbench\n\n'+
  'starforge collaborative-documents-managed --configuration /private/collaboration/launch.json [--port 0]\n'+
  'Launch the complete original application with its selected runtime and private installation authentication.\n'+
  'Applications Review/Save freezes the configuration; Start opens the original workspace; Stop drains its writer.\n';
async function waitForStop(owner){
  await new Promise(accept=>{
    let closing=false;
    const stop=async()=>{
      if(closing)return;closing=true;
      try{await owner.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);accept();}
      catch(error){closing=false;process.stderr.write(JSON.stringify({error:{code:error.code??'COLLABORATION_CLOSE_FAILED',
        message:'The original application is still closing. Keep this owner and retry Stop.'}})+'\n');}
    };
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
  });
}
export async function main(argv=process.argv.slice(2),{stdout=process.stdout,waitForClose=true}={}){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){stdout.write(HELP);return{help:true};}
  let service;
  try{service=await startManagedCollaborative(managedOptions(argv));}
  catch(error){
    if(error.collaborationOwner){
      if(!waitForClose)throw error;
      process.stderr.write(JSON.stringify({error:{code:error.code??'COLLABORATION_START_FAILED',
        message:'Startup failed and the original application is still owned. Stop this same process to finish closing.'}})+'\n');
      await waitForStop(error.collaborationOwner);
    }
    throw error;
  }
  try{stdout.write(JSON.stringify(collaborationStartup(service))+'\n');}
  catch(error){
    try{await service.close();}catch(closeError){
      error.collaborationOwner=service;
      if(waitForClose)await waitForStop(service);
    }
    throw error;
  }
  if(!waitForClose)return service;
  await waitForStop(service);
  return{status:'CLOSED',launchId:service.connection.value.launchId};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'COLLABORATION_MANAGED_FAILED',
    message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
