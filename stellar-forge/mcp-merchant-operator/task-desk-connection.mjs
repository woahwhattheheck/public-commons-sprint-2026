// MIT. Bind authenticated Merchant tools to an existing original InboxTask desk.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {dirname,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {TaskDeskClient,TaskDeskError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/agents/task-desk/client.mjs';

export const TASK_DESK_CONNECTION_SCHEMA='stellar-forge.task-desk-connections.v1';
export const TASK_DESK_ALIAS=/^[a-z][a-z0-9_-]{0,63}$/;
export const TASK_DESK_SHA=/^[a-f0-9]{64}$/;
export const TASK_DESK_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const TASK_DESK_ROOT_KEYS=['inbox','tasks','outputs','existingTask','existingOutput','commerce','customerDelivery'];
export const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const failure=(code,message,details)=>Object.assign(new Error(message),{code,...(details===undefined?{}:{details})});
export const canonical=value=>JSON.stringify(value,(_,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function exact(value,keys,required=[]){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))
    throw failure('INVALID_PARAMS','Use the declared original fields and include every required field.');
}
export function checked(value,pattern,label){
  if(typeof value!=='string'||!pattern.test(value))throw failure('INVALID_PARAMS','Select a valid '+label+'.');
  return value;
}
export async function privateJson(path,maximum=1024*1024){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(maximum)||typeof process.getuid!=='function'||
       before.uid!==BigInt(process.getuid())||(before.mode&0o077n)!==0n)
      throw failure('TASK_DESK_CONNECTION_FILE','Use an owned private regular connection file within its original size limit.');
    const bytes=await file.readFile(),after=await file.stat({bigint:true});
    if(bytes.length>maximum||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
      throw failure('TASK_DESK_CONNECTION_CHANGED','The original connection file changed while it was read.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{await file.close();}
}
function roots(value){
  exact(value,TASK_DESK_ROOT_KEYS,['inbox','tasks','outputs']);
  const result={};
  for(const key of Object.keys(value)){
    if(typeof value[key]!=='string'||!isAbsolute(value[key])||resolve(value[key])!==value[key]||value[key].includes('\0'))
      throw failure('TASK_DESK_CONNECTION_ROOT','Select each original absolute desk root.');
    result[key]=value[key];
  }
  if(Object.hasOwn(result,'existingTask')!==Object.hasOwn(result,'existingOutput'))
    throw failure('TASK_DESK_CONNECTION_ROOT','Retain both original task and output locations.');
  return result;
}
export async function readTaskDeskConfiguration(path){
  path=resolve(path);const data=await privateJson(path);
  exact(data,['schema','desks'],['schema','desks']);
  if(data.schema!==TASK_DESK_CONNECTION_SCHEMA||!plain(data.desks)||Object.keys(data.desks).length<1||Object.keys(data.desks).length>32)
    throw failure('CONFIGURATION_ERROR','Select one through 32 configured original task desks.');
  const desks=Object.create(null);
  for(const [alias,entry]of Object.entries(data.desks)){
    checked(alias,TASK_DESK_ALIAS,'desk alias');
    exact(entry,['label','connectionFile','roots','maxFileBytes'],['connectionFile','roots']);
    if(typeof entry.connectionFile!=='string'||!entry.connectionFile||entry.connectionFile.includes('\0'))
      throw failure('CONFIGURATION_ERROR','Declare the original private launch or Applications URL file.');
    const maximum=entry.maxFileBytes??256*1024*1024;
    if(!Number.isSafeInteger(maximum)||maximum<1||maximum>8*1024*1024*1024)
      throw failure('CONFIGURATION_ERROR','Choose a full-file receiving limit from 1 byte through 8 GiB.');
    const label=entry.label??alias;
    if(typeof label!=='string'||!label.trim()||label.length>160)throw failure('CONFIGURATION_ERROR','Use a short desk label.');
    desks[alias]={label,connectionFile:resolve(dirname(path),entry.connectionFile),roots:roots(entry.roots),maxFileBytes:maximum};
  }
  return {schema:TASK_DESK_CONNECTION_SCHEMA,desks};
}
function launch(value){
  if(value?.schema==='stellar-forge.inbox-task-desk-launch.v1')return value;
  if(value?.schema==='stellar-forge.application-url.v1'&&value.command==='buyer-task-desk'&&
      value.source==='original-command-stdout'&&value.original?.schema==='stellar-forge.inbox-task-desk-launch.v1'){
    const v=value.original;
    return {schema:v.schema,url:value.url,instanceId:v.instanceId,inbox:v.inboxDirectory,
      tasks:v.tasksDirectory,outputs:v.outputsDirectory,...Object.fromEntries([
        ['existingTask','existingTaskDirectory'],['existingOutput','existingOutputDirectory'],
        ['commerce','commerceDirectory'],['customerDelivery','customerDeliveryDirectory']
      ].filter(([,from])=>v[from]!==undefined).map(([to,from])=>[to,v[from]]))};
  }
  throw failure('TASK_DESK_CONNECTION_INVALID','Select the complete original desk launch JSON or its saved Applications URL record.');
}
async function limited(response,maximum){
  const parts=[];let size=0;
  try{for await(const chunk of response.body??[]){size+=chunk.length;if(size>maximum)
    throw failure('TASK_DESK_RESPONSE_LIMIT','The complete original metadata exceeds 32 MiB; use its original full-file path.');parts.push(chunk);}}
  catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return new Response(Buffer.concat(parts,size),{status:response.status,statusText:response.statusText,headers:response.headers});
}
/** Reopens the actual saved launch each time; mutations bind the caller's observed instance. */
export async function connectTaskDesk(definition,{expectedInstanceId,fetchImpl=globalThis.fetch}={}){
  const announced=launch(await privateJson(definition.connectionFile,65536));
  checked(announced.instanceId,TASK_DESK_UUID,'original instance');
  const selected=Object.fromEntries(TASK_DESK_ROOT_KEYS.filter(key=>announced[key]!==undefined).map(key=>[key,announced[key]]));
  if(canonical(selected)!==canonical(definition.roots))
    throw failure('TASK_DESK_ROOTS_CHANGED','The original launch no longer names the configured task/Inbox/result roots.');
  let url;try{url=new URL(announced.url);}catch{}
  if(!url||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||
      url.pathname!=='/'||url.search||url.hash||Number(url.port||80)<1||Number(url.port||80)>65535)
    throw failure('TASK_DESK_CONNECTION_INVALID','Use the original loopback address announced by the existing task desk.');
  if(expectedInstanceId!==undefined&&expectedInstanceId!==announced.instanceId)
    throw failure('TASK_DESK_INSTANCE_CHANGED','Read the original desk status and review its current instance before another command.',
      {expectedInstanceId,instanceId:announced.instanceId});
  const boundFetch=async(target,options={})=>{
    if(new URL(target).origin!==url.origin)throw failure('TASK_DESK_CONNECTION_INVALID','Use only this original desk origin.');
    const response=await fetchImpl(target,{...options,redirect:'error',
      signal:options.signal??AbortSignal.timeout(240000)});
    if(response.headers.get('x-task-desk-instance')!==announced.instanceId){
      await response.body?.cancel().catch(()=>{});
      throw new TaskDeskError('This address no longer serves the selected original desk instance.',{
        code:'TASK_DESK_INSTANCE_CHANGED',status:409,details:{expectedInstanceId:announced.instanceId,
          instanceId:response.headers.get('x-task-desk-instance')}});
    }
    return new Headers(options.headers).get('accept')==='*/*'?response:limited(response,32*1024*1024);
  };
  const client=new TaskDeskClient(url.origin,{fetchImpl:boundFetch});
  const status=await client.getStatus({signal:AbortSignal.timeout(10000)});
  if(status?.schema!=='stellar-forge.inbox-task-desk.v1'||status.instanceId!==announced.instanceId||
      canonical(status.roots)!==canonical(definition.roots)||typeof status.csrfToken!=='string'||!status.csrfToken)
    throw failure('TASK_DESK_CONNECTION_CHANGED','The live original desk differs from the saved launch and selected roots.');
  const {csrfToken,...visible}=status;
  return {client,status:visible,instanceId:status.instanceId,bindingSha256:hash(canonical({
    origin:url.origin,instanceId:status.instanceId,roots:status.roots}))};
}
