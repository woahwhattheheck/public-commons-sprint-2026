// SPDX-License-Identifier: MIT
// Original Measurements source selection and private managed launch records.
import {constants} from 'node:fs';
import {open,lstat,realpath,readFile} from 'node:fs/promises';
import {dirname,resolve,isAbsolute,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';
import {need,plain,canonical,saveJSON,privateDirectory,operationLease}
  from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export {need,plain,canonical,saveJSON,privateDirectory,operationLease};
export const CONFIG_SCHEMA='stellar-forge.measurement-workspace-launch.v1';
export const CONNECTION_SCHEMA='stellar-forge.measurement-workspace-connection.v1';
export const STARTUP_SCHEMA='stellar-forge.measurement-workspace-ready.v1';
export const SOURCE_ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const ENGINE_ROOT=join(SOURCE_ROOT,'opportunities/upstate_forever_2026/measurement_workspace/engine');
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function absolute(value){
  need(typeof value==='string'&&value.length>0&&value.length<=4096&&!value.includes('\0')&&isAbsolute(value)&&resolve(value)===value,
    'MEASUREMENTS_ABSOLUTE_PATH','Choose a complete normalized absolute path.');
  return value;
}
export function environmentName(value){
  need(typeof value==='string'&&/^[A-Z_][A-Z0-9_]{0,127}$/.test(value),'MEASUREMENTS_TOKEN_ENV','Choose an environment variable name, never a token value.');
  return value;
}
export function portNumber(value){
  const number=Number(value);need(String(value)!==''&&Number.isInteger(number)&&number>=0&&number<=65535,'MEASUREMENTS_PORT','Choose a whole port from 0 to 65535.');return number;
}
export function within(parent,child){const rel=relative(parent,child);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel));}
export async function regular(path,{maximum=1024*1024,privateOnly=false}={}){
  const original=absolute(path);
  need(await realpath(dirname(original))===dirname(original),'MEASUREMENTS_REAL_PARENT','Use the original physical parent directory.');
  const handle=await open(original,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat(),named=await lstat(original);
    need(before.isFile()&&!named.isSymbolicLink()&&before.dev===named.dev&&before.ino===named.ino&&before.size<=maximum,
      'MEASUREMENTS_REGULAR_FILE','Use the complete regular file within its documented bound.');
    if(privateOnly)need(!(before.mode&0o077)&&(process.getuid===undefined||before.uid===process.getuid()),
      'MEASUREMENTS_PRIVATE_FILE','Use a private file owned by the current operator.');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
      'MEASUREMENTS_FILE_CHANGED','The selected file changed while it was read.',409);
    return {path:original,bytes,sha256:hash(bytes),stat:after};
  }finally{await handle.close();}
}
export async function readJSON(path,options={}){
  const selected=await regular(path,options);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(selected.bytes));}
  catch{need(false,'MEASUREMENTS_JSON','Use complete UTF-8 JSON.');}
  return {...selected,value};
}
export async function readConfiguration(path){
  const selected=await readJSON(path,{maximum:65536,privateOnly:true}),v=selected.value;
  need(plain(v)&&v.schema===CONFIG_SCHEMA&&Object.keys(v).every(k=>['schema','workspaceDirectory','connectionFile','tokenEnv'].includes(k)),
    'MEASUREMENTS_CONFIGURATION','Use the documented Measurements launch configuration.');
  absolute(v.workspaceDirectory);absolute(v.connectionFile);environmentName(v.tokenEnv);
  need(!within(SOURCE_ROOT,v.workspaceDirectory)&&!within(SOURCE_ROOT,v.connectionFile)&&v.workspaceDirectory!==dirname(v.connectionFile),
    'MEASUREMENTS_PRIVATE_LAYOUT','Keep scientific data and the connection record outside installed source, in separately selected private directories.');
  await privateDirectory(dirname(v.connectionFile));
  return selected;
}
export async function inspectSource(){
  const manifest=await readJSON(fileURLToPath(new URL('./original-source.json',import.meta.url)),{maximum:4*1024*1024}),v=manifest.value;
  need(v.schema==='stellar-forge.measurement-workspace-source.v1'&&Array.isArray(v.files)&&v.files.length>0,'MEASUREMENTS_SOURCE_MANIFEST');
  const seen=new Set(),files=[];
  for(const item of v.files){
    need(plain(item)&&typeof item.path==='string'&&!item.path.includes('\\')&&item.path.split('/').every(x=>x&&x!=='.'&&x!=='..')&&
      (item.path.startsWith('opportunities/upstate_forever_2026/measurement_workspace/')||item.path.startsWith('opportunities/upstate_forever_2026/source_tools/')||item.path==='opportunities/upstate_forever_2026/source_data/wqp_eight_20261013/wqp_eight_native.csv')&&!seen.has(item.path)&&/^[a-f0-9]{64}$/.test(item.sha256)&&
      Number.isSafeInteger(item.bytes)&&item.bytes>=0,'MEASUREMENTS_SOURCE_MANIFEST');
    seen.add(item.path);const selected=await regular(join(SOURCE_ROOT,item.path),{maximum:Math.max(item.bytes,1)});
    need(selected.bytes.length===item.bytes&&selected.sha256===item.sha256,'MEASUREMENTS_SOURCE_CHANGED','Selected original source differs: '+item.path,409);
    files.push({path:selected.path,bytes:item.bytes,sha256:item.sha256});
  }
  need(seen.has('opportunities/upstate_forever_2026/measurement_workspace/engine/cli.mjs')&&seen.has('opportunities/upstate_forever_2026/measurement_workspace/web/workspace.js'),
    'MEASUREMENTS_SOURCE_CLOSURE','Retain the original scientific server and complete browser source.');
  return {manifest:manifest.path,manifestSha256:manifest.sha256,sourceRoot:SOURCE_ROOT,files};
}
export async function directoryIdentity(path){
  const directory=await privateDirectory(path),stat=await lstat(directory);
  return {directory,dev:String(stat.dev),ino:String(stat.ino)};
}
export async function readConnection(path){
  const selected=await readJSON(path,{maximum:65536,privateOnly:true}),v=selected.value;
  need(plain(v)&&v.schema===CONNECTION_SCHEMA&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.instanceId)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.workspaceId)&&
    /^[a-f0-9]{64}$/.test(v.workspaceBinding)&&/^[a-f0-9]{64}$/.test(v.configurationSha256)&&/^[a-f0-9]{64}$/.test(v.sourceManifestSha256),
    'MEASUREMENTS_CONNECTION','Use the original retained connection record.');
  const url=new URL(v.origin);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0&&url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password&&v.origin===url.origin,
    'MEASUREMENTS_CONNECTION_ORIGIN','Use the original private loopback origin.');
  environmentName(v.tokenEnv);absolute(v.directory);absolute(v.configurationFile);
  const physical=await directoryIdentity(v.directory);
  need(hash(canonical(physical))===v.workspaceBinding,'MEASUREMENTS_DIRECTORY_CHANGED','The physical workspace differs from its connection.',409);
  return selected;
}
export async function tokenFor(configuration,{environment=process.env}={}){
  const token=environment[configuration.tokenEnv];
  need(typeof token==='string'&&Buffer.byteLength(token)>=32&&Buffer.byteLength(token)<=4096&&!/[\r\n\0]/.test(token),
    'MEASUREMENTS_TOKEN_REQUIRED','Set the selected private token environment variable to 32–4096 bytes.');
  return token;
}
export async function connectionIdentity(connection,token){
  const c=typeof connection==='string'?await readConnection(connection):connection;
  const response=await fetch(c.value.origin+'/api/measurement-workspace/connection',{headers:{'x-measurement-internal-token':token,'X-Measurements-Instance-ID':c.value.instanceId},redirect:'error',signal:AbortSignal.timeout(10000)});
  need(response.ok&&response.headers.get('x-measurements-instance-id')===c.value.instanceId,'MEASUREMENTS_CONNECTION_UNAVAILABLE','The exact original managed listener is unavailable.',409);
  const reader=response.body?.getReader();need(reader,'MEASUREMENTS_CONNECTION_UNAVAILABLE');
  const chunks=[];let count=0;
  try{for(;;){const part=await reader.read();if(part.done)break;count+=part.value.length;need(count<=65536,'MEASUREMENTS_IDENTITY_SIZE');chunks.push(Buffer.from(part.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  need(['schema','instanceId','workspaceId','workspaceBinding','directory','origin','pid','childPid','configurationSha256','sourceManifestSha256'].every(k=>value[k]===c.value[k]),
    'MEASUREMENTS_CONNECTION_CHANGED','The managed listener does not match its retained connection.',409);
  return value;
}
