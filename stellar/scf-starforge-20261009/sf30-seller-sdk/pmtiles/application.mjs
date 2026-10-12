#!/usr/bin/env node
// MIT. Managed Applications use the original saved PMTiles workspace and server.
import {DatabaseSync} from 'node:sqlite';
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {SCHEMA,need,identifier,plain,clone,hash,digest} from './model.mjs';
import {MAX_METADATA_BYTES} from './files.mjs';
import {readRuntime} from './native.mjs';
import {servePMTilesWorkspace} from './server.mjs';

export const PMTILES_MANAGED_APPLICATION_SCHEMA='stellar-forge.pmtiles-managed-application.v1';
const STARTUP_SCHEMA='stellar-forge.pmtiles-workspace-ready.v1';
function absolute(value,name){
  need(typeof value==='string'&&!value.includes('\0')&&isAbsolute(value),'PMTILES_APPLICATION_PATH_REQUIRED',name);
  return resolve(value);
}
async function originalDirectory(value){
  const path=absolute(value,'workspace'),info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0&&
    (typeof process.getuid!=='function'||info.uid===process.getuid()),
    'PMTILES_APPLICATION_PRIVATE_WORKSPACE_REQUIRED');
  need(await realpath(path)===path,'PMTILES_APPLICATION_CANONICAL_WORKSPACE_REQUIRED');
  return path;
}
async function originalJson(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&(before.mode&0o077n)===0n&&before.size<=BigInt(MAX_METADATA_BYTES)&&
      (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid())),
      'PMTILES_APPLICATION_PRIVATE_JSON_REQUIRED');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&BigInt(bytes.length)===before.size,
      'PMTILES_APPLICATION_JSON_CHANGED');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    need(plain(value),'PMTILES_APPLICATION_JSON_OBJECT_REQUIRED');
    return {value,sha256:hash(bytes),bytes:bytes.length};
  }finally{await file.close();}
}
async function optionalJson(path){
  try{return await originalJson(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/** Read the original metadata transaction without creating or opening a writer. */
export async function inspectPMTilesApplicationWorkspace({directory,expectedWorkspaceId=null}={}){
  directory=await originalDirectory(directory);
  const requested=await optionalJson(join(directory,'receiving-request.json'));
  if(requested){
    const completed=await optionalJson(join(directory,'receiving-complete.json'));
    need(completed?.value?.requestSha256===digest(requested.value),'PMTILES_RECEIVING_INCOMPLETE',
      'Resume this workspace’s original receiving request before selecting it in Applications.');
  }
  const path=join(directory,'workspace.sqlite3'),before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink()&&(before.mode&0o077)===0,
    'PMTILES_PRIVATE_DATABASE_REQUIRED');
  const db=new DatabaseSync(path,{readOnly:true,timeout:5000});
  let metadata;
  try{
    db.exec('BEGIN');
    metadata=JSON.parse(db.prepare('SELECT document FROM metadata WHERE id=1').get()?.document??'null');
    need(metadata?.schema===SCHEMA,'PMTILES_WORKSPACE_SCHEMA_CHANGED');
    identifier(metadata.id);
    need(Number.isSafeInteger(metadata.revision)&&metadata.revision>=0&&typeof metadata.title==='string',
      'PMTILES_APPLICATION_METADATA_CHANGED');
    need(metadata.authoringPort===null||(Number.isInteger(metadata.authoringPort)&&metadata.authoringPort>=1&&metadata.authoringPort<=65535),
      'PMTILES_AUTHORING_PORT_CHANGED');
    need(metadata.currentRelease===null||typeof metadata.currentRelease==='string','PMTILES_CURRENT_RELEASE_CHANGED');
    if(expectedWorkspaceId!==null)need(metadata.id===expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
    db.exec('COMMIT');
  }finally{db.close();}
  const after=await lstat(path);
  need(after.isFile()&&!after.isSymbolicLink()&&before.dev===after.dev&&before.ino===after.ino,
    'PMTILES_APPLICATION_DATABASE_REPLACED');
  return {schema:'stellar-forge.pmtiles-application-workspace.v1',directory,
    workspaceId:metadata.id,title:metadata.title,revision:metadata.revision,
    authoringPort:metadata.authoringPort,currentRelease:metadata.currentRelease,
    receivedFrom:clone(metadata.receivedFrom??null)};
}

/** Select and fully verify the original content-producing runtime, without launching it. */
export async function inspectPMTilesApplicationRuntime({runtimeProfile,expectedRuntimeSha256=null,expectedProfileSha256=null}={}){
  const path=absolute(runtimeProfile,'runtime profile');
  need(await realpath(path)===path,'PMTILES_APPLICATION_CANONICAL_RUNTIME_REQUIRED');
  const selected=await originalJson(path),runtime=await readRuntime(selected.value);
  if(expectedProfileSha256!==null)need(selected.sha256===expectedProfileSha256,'PMTILES_APPLICATION_RUNTIME_PROFILE_CHANGED');
  if(expectedRuntimeSha256!==null)need(runtime.runtimeSha256===expectedRuntimeSha256,'PMTILES_APPLICATION_RUNTIME_CHANGED');
  return {schema:'stellar-forge.pmtiles-application-runtime.v1',runtimeProfile:path,
    profileSha256:selected.sha256,profileBytes:selected.bytes,runtimeSha256:runtime.runtimeSha256,
    pmtilesVersion:runtime.pmtilesVersion,martinVersion:runtime.martinVersion,
    packages:clone(runtime.packages),pythonHostContract:runtime.pythonHostContract};
}

/** One original authoring server; its controller owns and drains every native child. */
export async function startPMTilesManagedWorkspace(options={}){
  options=clone(options);
  const {directory,expectedWorkspaceId,runtimeProfile,expectedRuntimeSha256=null,
    expectedProfileSha256=null,port=0}=options;
  identifier(expectedWorkspaceId);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'PMTILES_PORT_INVALID');
  const selectedWorkspace=await inspectPMTilesApplicationWorkspace({directory,expectedWorkspaceId});
  const expectedAuthoringPort=Object.hasOwn(options,'expectedAuthoringPort')?options.expectedAuthoringPort:selectedWorkspace.authoringPort;
  need(expectedAuthoringPort===null||(Number.isInteger(expectedAuthoringPort)&&expectedAuthoringPort>=1&&expectedAuthoringPort<=65535),
    'PMTILES_EXPECTED_AUTHORING_PORT_INVALID');
  need(selectedWorkspace.authoringPort===expectedAuthoringPort,'PMTILES_AUTHORING_PORT_CHANGED',
    'Review this workspace’s current saved browser port before starting.');
  const profilePath=absolute(runtimeProfile,'runtime profile');
  need(await realpath(profilePath)===profilePath,'PMTILES_APPLICATION_CANONICAL_RUNTIME_REQUIRED');
  const selectedProfile=await originalJson(profilePath),runtime=await readRuntime(selectedProfile.value);
  if(expectedProfileSha256!==null)need(selectedProfile.sha256===expectedProfileSha256,'PMTILES_APPLICATION_RUNTIME_PROFILE_CHANGED');
  if(expectedRuntimeSha256!==null)need(runtime.runtimeSha256===expectedRuntimeSha256,'PMTILES_APPLICATION_RUNTIME_CHANGED');
  const selectedPort=port||selectedWorkspace.authoringPort||0;
  const server=await servePMTilesWorkspace({directory:selectedWorkspace.directory,expectedWorkspaceId,
    runtime,port:selectedPort,expectedAuthoringPort});
  try{
    need(server.workspaceId===expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
    const current=await inspectPMTilesApplicationWorkspace({directory:selectedWorkspace.directory,expectedWorkspaceId});
    const actual=server.controller.runtime;
    need(actual.runtimeSha256===runtime.runtimeSha256&&current.authoringPort===server.port,
      'PMTILES_APPLICATION_STARTUP_CHANGED');
    const url=new URL(server.url);
    need(url.origin===server.origin&&url.hostname==='127.0.0.1'&&Number(url.port)===server.port&&
      url.protocol==='http:'&&!url.username&&!url.password&&!url.search&&url.pathname==='/'&&
      /^#token=[a-f0-9]{64}$/.test(url.hash),
      'PMTILES_APPLICATION_STARTUP_URL_CHANGED');
    const ready={schema:STARTUP_SCHEMA,workspaceId:expectedWorkspaceId,
      workspaceDirectory:selectedWorkspace.directory,title:current.title,revision:current.revision,
      currentRelease:current.currentRelease,origin:server.origin,url:server.url,port:server.port,
      runtimeProfile:profilePath,profileSha256:selectedProfile.sha256,runtimeSha256:actual.runtimeSha256,
      previousAuthoringPort:expectedAuthoringPort};
    return Object.freeze({...server,ready:Object.freeze(ready)});
  }catch(error){await server.close();throw error;}
}

export async function runPMTilesManagedCommand(argv,{signal,onReady}={}){
  const {values}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    workspace:{type:'string'},'workspace-id':{type:'string'},runtime:{type:'string'},
    'runtime-sha256':{type:'string'},'runtime-profile-sha256':{type:'string'},'expected-authoring-port':{type:'string'},port:{type:'string',default:'0'}
  }});
  need(/^\d+$/.test(values.port),'PMTILES_PORT_INVALID');
  const port=Number(values.port);
  let authoringSelection={};
  if(values['expected-authoring-port']!==undefined){
    need(/^\d+$/.test(values['expected-authoring-port']),'PMTILES_EXPECTED_AUTHORING_PORT_INVALID');
    const selected=Number(values['expected-authoring-port']);
    need(Number.isInteger(selected)&&selected>=0&&selected<=65535,'PMTILES_EXPECTED_AUTHORING_PORT_INVALID');
    authoringSelection={expectedAuthoringPort:selected||null};
  }
  signal?.throwIfAborted();
  const server=await startPMTilesManagedWorkspace({directory:values.workspace,
    expectedWorkspaceId:values['workspace-id'],runtimeProfile:values.runtime,port,...authoringSelection,
    expectedRuntimeSha256:values['runtime-sha256']??null,expectedProfileSha256:values['runtime-profile-sha256']??null});
  const stop=()=>{server.close().catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  try{
    signal?.throwIfAborted();
    if(onReady)await onReady(server.ready);
    else await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(server.ready)+'\n',error=>error?reject(error):resolve()));
    await server.closed;
    return {schema:'stellar-forge.pmtiles-workspace-stopped.v1',workspaceId:server.workspaceId};
  }finally{signal?.removeEventListener('abort',stop);await server.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('PMTILES_APPLICATION_STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await runPMTilesManagedCommand(process.argv.slice(2),{signal:controller.signal});}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'PMTILES_APPLICATION_FAILED',message:String(error.message??error)}})+'\n');process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
