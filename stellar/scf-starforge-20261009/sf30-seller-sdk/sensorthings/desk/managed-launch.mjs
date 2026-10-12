// MIT. Original private SensorThings identity and actual managed Desk startup.
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectWorkspaceIdentity,readOwned,atomicJSON} from '../../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA} from '../schema.mjs';
import {fault} from '../contract.mjs';
export const DESK_STARTUP_SCHEMA='stellar-forge.sensorthings-desk-startup.v1';
export const DESK_SOURCE_FILES=Object.freeze(['server.mjs','cli.mjs','inbox.mjs','managed-launch.mjs','browser-assets.json',
  'public/index.html','public/app.mjs','public/api.mjs','public/ui.mjs','public/views.mjs','public/style.css','../core.mjs','../schema.mjs','../contract.mjs','../provider.mjs',
  '../server.mjs','../files.mjs','../portable.mjs','../dataset.mjs','../domain.mjs']);
export const sourceDirectory=fileURLToPath(new URL('./',import.meta.url)).replace(/\/$/,'');
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function inspectSensorThingsWorkspace(directory,{allowMissing=false}={}){
  return inspectWorkspaceIdentity(directory,{allowMissing,schema:WORKSPACE_SCHEMA});
}
export async function deskSourceIdentity(directory=sourceDirectory){
  if(!isAbsolute(directory)||resolve(directory)!==directory)throw fault('DESK_SOURCE','Use the original selected Desk source directory.');
  const files=[];
  for(const path of DESK_SOURCE_FILES){const absolute=resolve(directory,path),stat=await lstat(absolute);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw fault('DESK_SOURCE','A selected original Desk source file changed.',409);
    const bytes=await readFile(absolute),after=await lstat(absolute);
    if(stat.size!==bytes.length||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs)throw fault('DESK_SOURCE_CHANGED','An original Desk source file changed during its read.',409);
    files.push({path,bytes:bytes.length,sha256:hash(bytes)});
  }
  return {sourceDirectory:directory,files,sha256:hash(Buffer.from(JSON.stringify(files)))};
}
export async function writeDeskLaunch(workspace,record){
  if(record.schema!==DESK_STARTUP_SCHEMA||record.workspaceId!==workspace.schema().workspaceId)throw fault('DESK_STARTUP','The original launch must bind this workspace.',409);
  await atomicJSON(join(workspace.directory,'desk-launch.json'),record);return record;
}
export async function readDeskLaunch({directory,expectedWorkspaceId,expectedSourceDirectory,expectedInstanceId}){
  const original=await inspectSensorThingsWorkspace(directory),record=JSON.parse((await readOwned(join(original.directory,'desk-launch.json'),65536)).toString('utf8'));
  if(record.schema!==DESK_STARTUP_SCHEMA||record.workspaceId!==original.workspaceId||
    expectedWorkspaceId&&record.workspaceId!==expectedWorkspaceId||record.directory!==original.directory||
    expectedInstanceId&&record.instanceId!==expectedInstanceId||record.sourceDirectory!==expectedSourceDirectory)
    throw fault('DESK_STARTUP_CHANGED','The retained Desk launch belongs to another original selection.',409);
  const source=await deskSourceIdentity(expectedSourceDirectory);
  if(source.sha256!==record.sourceSha256||JSON.stringify(source.files)!==JSON.stringify(record.sourceFiles))throw fault('DESK_SOURCE_CHANGED','The retained launch source changed.',409);
  let url;try{url=new URL(record.url);}catch{throw fault('DESK_STARTUP_CHANGED','The original private launch URL is invalid.',409);}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.username||url.password||!/^#[A-Za-z0-9_-]{32,200}$/.test(url.hash))
    throw fault('DESK_STARTUP_CHANGED','Use the original private loopback launch URL.',409);
  const headers={Authorization:'Bearer '+url.hash.slice(1),'X-SensorThings-Workspace':original.workspaceId};
  const response=await fetch(url.origin+'/api/desk/info',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw fault('DESK_STARTUP_NOT_READY','The original selected Desk listener did not return its authenticated identity.',409);
  const info=await response.json();
  if(info.schema!=='stellar-forge.sensorthings-desk-info.v1'||info.workspaceId!==original.workspaceId||info.instanceId!==record.instanceId)
    throw fault('DESK_STARTUP_CHANGED','A different listener answered the original application URL.',409);
  return record;
}
