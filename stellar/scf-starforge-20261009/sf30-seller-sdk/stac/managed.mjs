// MIT. Managed startup for the original STAC, eoAPI and Prescient hosts.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

export const STAC_MANAGED_SELECTION='stellar-forge.stac-managed-selection.v1';
export const STAC_MANAGED_STARTUP='stellar-forge.stac-managed-startup.v1';
export const STAC_MANAGED_COMMANDS=Object.freeze(['serve','eoapi-serve','prescient-serve']);
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const HASH=/^[a-f0-9]{64}$/, ID=/^stac-[a-f0-9]{24}$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,message=code)=>{throw Object.assign(new Error(message),{code});};
const need=(v,code,message)=>{if(!v)fail(code,message);};
const digest=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):plain(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const stacSelectionDigest=v=>digest(JSON.stringify(canonical(v)));
const sourceFiles=['managed.mjs','cli.mjs','server.mjs','workspace.mjs','provider.mjs','ui.mjs','ui.html','ui.css'];
const optionFiles=Object.freeze({transport:false,'source-config':true,deployment:true,'processing-config':false});
const knownFlags=new Set(['workspace','port','transport','source-config','deployment','profile-sha256',
  'processing-workspace','processing-config','max-request-bytes','startup-json','managed-selection']);

function absolute(v){
  need(typeof v==='string'&&v===resolve(v)&&!v.includes('\0'),'STAC_MANAGED_ABSOLUTE_PATH_REQUIRED');
  return v;
}
async function privateIdentity(path){
  absolute(path);const info=await lstat(path,{bigint:true});
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(!(Number(info.mode)&0o077)&&
      (!process.getuid||Number(info.uid)===process.getuid()))),
    'STAC_MANAGED_PRIVATE_DIRECTORY_REQUIRED','Select the original private workspace directory.');
  return {directory:path,device:info.dev.toString(),inode:info.ino.toString()};
}
async function fileRecord(path,{privateOnly=false,json=false}={}){
  absolute(path);need(await realpath(dirname(path))===dirname(path),'STAC_MANAGED_REAL_PARENT_REQUIRED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true}),maximum=json?1024*1024:4*1024*1024;
    need(before.isFile()&&before.size<=BigInt(maximum)&&(!privateOnly||process.platform==='win32'||
      (!(Number(before.mode)&0o077)&&(!process.getuid||Number(before.uid)===process.getuid()))),
      'STAC_MANAGED_FILE_REQUIRED','Select a complete original configuration or installed source file.');
    const bytes=await handle.readFile(),after=await handle.stat({bigint:true});
    need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs&&
      BigInt(bytes.length)===before.size,'STAC_MANAGED_FILE_CHANGED',
      'The selected file changed while it was being reviewed.');
    if(json){
      let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{fail('STAC_MANAGED_CONFIGURATION_JSON_REQUIRED');}
      need(plain(value),'STAC_MANAGED_CONFIGURATION_OBJECT_REQUIRED');
    }
    return {path,bytes:bytes.length,sha256:digest(bytes),device:before.dev.toString(),inode:before.ino.toString()};
  }finally{await handle.close();}
}
function portValue(v){
  const port=v===undefined?0:Number(v);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'STAC_MANAGED_PORT_INVALID');return port;
}
export async function readStacLaunchSource({sourceDirectory=ROOT,command,processing=false}={}){
  sourceDirectory=resolve(sourceDirectory);need(STAC_MANAGED_COMMANDS.includes(command),'STAC_MANAGED_COMMAND_INVALID');
  const names=[...sourceFiles];
  if(processing)names.push('processing/workspace.mjs','processing/provider.mjs','processing/cirrus.mjs',
    'processing/associations.mjs','processing/portable.mjs','processing/view.mjs');
  if(command==='eoapi-serve')names.push('eoapi/cli.mjs','eoapi/runtime.mjs','eoapi/controller.mjs');
  if(command==='prescient-serve')names.push('prescient/cli.mjs','prescient/runtime.mjs',
    'prescient/configuration.mjs','prescient/source-auth.mjs','prescient/asset-access.mjs');
  const files=[];
  for(const name of names){const file=await fileRecord(join(sourceDirectory,name));files.push({name,bytes:file.bytes,sha256:file.sha256});}
  return {files,sha256:stacSelectionDigest(files)};
}
/** Read the original workspace and selected files; no provider or SDK session is opened. */
export async function inspectStacManagedSelection({command,flags,sourceDirectory=ROOT}={}){
  need(STAC_MANAGED_COMMANDS.includes(command)&&plain(flags)&&Object.keys(flags).every(n=>knownFlags.has(n)),
    'STAC_MANAGED_SELECTION_INVALID');
  const directory=absolute(flags.workspace),identity=await privateIdentity(directory);
  const workspaceDirectory=command==='prescient-serve'?join(directory,'stac'):directory;
  const workspaceIdentity=await privateIdentity(workspaceDirectory);sourceDirectory=resolve(sourceDirectory);
  const module=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
  need(typeof module.openStacWorkspace==='function','STAC_MANAGED_WORKSPACE_READER_REQUIRED');
  const workspace=await module.openStacWorkspace({directory:workspaceDirectory,create:false});
  let state;try{state=await workspace.getState();}finally{await workspace.close?.();}
  need(state.schema==='scf-stac-workspace/v1'&&ID.test(state.id??'')&&typeof state.endpoint==='string',
    'STAC_MANAGED_WORKSPACE_INVALID');
  need(!flags['processing-config']||flags['processing-workspace'],'STAC_MANAGED_PROCESSING_WORKSPACE_REQUIRED');
  need(command==='eoapi-serve'||!flags['source-config'],'STAC_MANAGED_SOURCE_CONFIGURATION_MODE');
  need(command==='prescient-serve'||(!flags.deployment&&!flags['profile-sha256']),'STAC_MANAGED_PRESCIENT_CONFIGURATION_MODE');
  need(command!=='prescient-serve'||(flags.deployment&&!flags['processing-workspace']&&
    !flags['processing-config']&&!flags.transport),'STAC_MANAGED_PRESCIENT_DEPLOYMENT_REQUIRED');
  const configurations=[];
  for(const [name,privateOnly]of Object.entries(optionFiles)){
    if(flags[name])configurations.push({option:name,...await fileRecord(absolute(flags[name]),{privateOnly,json:true})});
  }
  const options={port:portValue(flags.port),maxRequestBytes:flags['max-request-bytes']===undefined?
    128*1024*1024:Number(flags['max-request-bytes'])};
  need(Number.isSafeInteger(options.maxRequestBytes)&&options.maxRequestBytes>0,'STAC_MANAGED_REQUEST_LIMIT_INVALID');
  const processing=flags['processing-workspace']?await privateIdentity(absolute(flags['processing-workspace'])):null;
  if(command==='prescient-serve'){
    const native=await import(pathToFileURL(join(sourceDirectory,'prescient/configuration.mjs')).href);
    need(typeof native.openPrescientConfiguration==='function','STAC_MANAGED_PRESCIENT_READER_REQUIRED');
    const configuration=await native.openPrescientConfiguration({directory:join(directory,'operator'),create:false});
    const current=await configuration.getState();
    const chosen=current.profiles.find(row=>row.sha256===(flags['profile-sha256']??current.approvedProfileSha256))??current.profiles.at(-1);
    need(chosen&&HASH.test(chosen.sha256??'')&&(!flags['profile-sha256']||chosen.sha256===flags['profile-sha256']),
      'STAC_MANAGED_PRESCIENT_PROFILE_REQUIRED');
    options.profileSha256=chosen.sha256;
  }
  return {schema:STAC_MANAGED_SELECTION,command,directory,identity,
    workspace:{directory:workspaceDirectory,identity:workspaceIdentity,id:state.id,endpoint:state.endpoint},
    processing,configurations,options,source:await readStacLaunchSource({sourceDirectory,command,processing:Boolean(processing)})};
}
export function parseStacManagedSelection(value){
  need(typeof value==='string'&&Buffer.byteLength(value)<=32768,'STAC_MANAGED_SELECTION_INVALID');
  let selected;try{selected=JSON.parse(value);}catch{fail('STAC_MANAGED_SELECTION_INVALID');}
  need(plain(selected)&&selected.schema===STAC_MANAGED_SELECTION&&STAC_MANAGED_COMMANDS.includes(selected.command)&&
    plain(selected.workspace)&&ID.test(selected.workspace.id??'')&&plain(selected.source)&&HASH.test(selected.source.sha256??''),
    'STAC_MANAGED_SELECTION_INVALID');
  return selected;
}
export async function prepareStacManagedStartup({command,flags}={}){
  need(flags?.['startup-json']===true||flags?.['startup-json']==='true','STAC_MANAGED_STARTUP_FLAG_REQUIRED');
  const actual=await inspectStacManagedSelection({command,flags});
  if(flags['managed-selection']){
    const expected=parseStacManagedSelection(flags['managed-selection']);
    need(stacSelectionDigest(actual)===stacSelectionDigest(expected),'STAC_MANAGED_SELECTION_CHANGED',
      'Review the current workspace, runtime and configuration before starting.');
  }
  return actual;
}
function localUrl(value,selectedPort){
  let url;try{url=new URL(value);}catch{fail('STAC_MANAGED_STARTUP_URL_INVALID');}
  const port=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname==='/'&&/^#session=[A-Za-z0-9_-]{43}$/.test(url.hash)&&port>=1&&port<=65535&&
    (!selectedPort||port===selectedPort),'STAC_MANAGED_STARTUP_URL_INVALID','Use the original local STAC operator session.');
  return url;
}
async function responseJSON(response,maximum){
  need(response.ok&&response.body,'STAC_MANAGED_HOST_NOT_READY');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
      need(size<=maximum,'STAC_MANAGED_HOST_RESPONSE_TOO_LARGE');parts.push(next.value);}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,size)));
  }finally{await reader.cancel().catch(()=>{});}
}
async function sameDirectories(selection){
  for(const expected of [selection.identity,selection.workspace.identity,selection.processing].filter(Boolean))
    need(stacSelectionDigest(await privateIdentity(expected.directory))===stacSelectionDigest(expected),
      'STAC_MANAGED_WORKSPACE_CHANGED','The reviewed workspace directory was replaced.');
}
/** Use the host's existing bootstrap and cookie; never contact a source provider. */
export async function verifyStacManagedHost({url:value,selection}={}){
  await sameDirectories(selection);const url=localUrl(value,selection.options.port);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const session=await fetch(new URL('/api/session',url.origin),{method:'POST',redirect:'error',signal:controller.signal,
      headers:{'content-type':'application/json',origin:url.origin},
      body:JSON.stringify({token:url.hash.slice('#session='.length)})});
    await responseJSON(session,16384);const cookie=session.headers.get('set-cookie')?.split(';')[0];
    need(typeof cookie==='string'&&cookie.length<=4096&&cookie.includes('='),'STAC_MANAGED_SESSION_REQUIRED');
    const state=await responseJSON(await fetch(new URL('/api/state',url.origin),{redirect:'error',signal:controller.signal,
      headers:{cookie,accept:'application/json'}}),128*1024*1024);
    need(state.workspace?.id===selection.workspace.id&&state.workspace.endpoint===selection.workspace.endpoint,
      'STAC_MANAGED_WORKSPACE_CHANGED');
    if(selection.processing)need(state.capabilities?.processing?.enabled===true,'STAC_MANAGED_PROCESSING_NOT_READY');
    if(selection.command==='eoapi-serve')need(state.eoapi===true,'STAC_MANAGED_EOAPI_NOT_READY');
    if(selection.command==='prescient-serve')need(state.capabilities?.prescient?.enabled===true,'STAC_MANAGED_PRESCIENT_NOT_READY');
    await sameDirectories(selection);
    return {url:url.href,workspaceId:state.workspace.id,revision:state.workspace.revision};
  }finally{clearTimeout(timer);controller.abort();}
}
export async function createStacManagedStartup({selection,result}={}){
  need(plain(selection)&&plain(result)&&typeof result.url==='string','STAC_MANAGED_STARTUP_RESULT_REQUIRED');
  if(result.workspaceId!==undefined)need(result.workspaceId===selection.workspace.id,'STAC_MANAGED_WORKSPACE_CHANGED');
  if(result.directory!==undefined)need(result.directory===selection.directory||result.directory===selection.workspace.directory,
    'STAC_MANAGED_WORKSPACE_CHANGED');
  if(selection.command==='prescient-serve')need(result.profileSha256===selection.options.profileSha256,
    'STAC_MANAGED_PRESCIENT_PROFILE_CHANGED');
  const live=await verifyStacManagedHost({url:result.url,selection});
  return {schema:STAC_MANAGED_STARTUP,status:'STAC_READY',command:selection.command,url:live.url,
    directory:selection.directory,workspaceDirectory:selection.workspace.directory,workspaceId:live.workspaceId,
    workspaceRevision:live.revision,selectionSha256:stacSelectionDigest(selection),sourceSha256:selection.source.sha256,
    processingDirectory:selection.processing?.directory??null,profileSha256:selection.options.profileSha256??null,
    instanceId:randomUUID(),pid:process.pid,createdAt:new Date().toISOString()};
}
