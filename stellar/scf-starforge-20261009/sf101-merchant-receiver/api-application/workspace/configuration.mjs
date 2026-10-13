// MIT. Merchant workspace selection; original compilers own application and checkout terms.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJobMerchant,canonical,digest,plain,jobError} from '../../../sf30-seller-sdk/jobs/config.mjs';
import {compileCheckout} from '../../checkout-config.mjs';
import {privateDirectory,writeBytes,readBytes} from '../../../sf88-operator-buyer-cli/node/store.mjs';

export {canonical,digest,plain};
export const SCHEMA='stellar-forge.sf101.api-merchant-workspace.v1';
export const STATE_SCHEMA='stellar-forge.sf101.api-merchant-workspace-state.v1';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH=/^[a-f0-9]{64}$/;
export const REF=/^[A-Za-z0-9._:-]{1,80}$/;
export const REQUEST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_STATE=16*1024*1024;
export const now=()=>new Date().toISOString();
export const newId=()=>randomUUID();
export const need=(value,code,status=400)=>{if(!value)throw jobError(code,status);};
export const encoded=value=>Buffer.from(canonical(value)+'\n');
export const safeError=error=>({code:/^[A-Z][A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'API_MERCHANT_OPERATION_FAILED',
 status:Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:503});
export function text(value,limit,code){
 need(typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=limit&&!/[\x00-\x1f\x7f]/.test(value),code);
 return value;
}
export function absolute(value){
 need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!/[\x00-\x1f\x7f]/.test(value),'API_MERCHANT_ABSOLUTE_PATH_REQUIRED');
 return value;
}
export function integer(value,min,max,code){
 need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;
}
export function urlOrigin(value){
 let url;try{url=new URL(value);}catch{need(false,'API_MERCHANT_ORIGIN_REQUIRED');}
 need(url.origin===value&&!url.username&&!url.password&&(url.protocol==='https:'||
  url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)),'API_MERCHANT_ORIGIN_REQUIRED');
 return url.origin;
}
export async function ownedDirectory(path,{create=false}={}){
 absolute(path);
 if(create)await privateDirectory(path);
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path&&
  (!process.getuid||info.uid===process.getuid()),'API_MERCHANT_PRIVATE_DIRECTORY_REQUIRED');
 return path;
}
export async function ownedBytes(path,limit=1048576,{privateMode=true}={}){
 absolute(path);
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
 try{
  const before=await fd.stat();
  need(before.isFile()&&before.nlink===1&&before.size<=limit&&(!privateMode||!(before.mode&0o077))&&
   (!privateMode||!process.getuid||before.uid===process.getuid()),'API_MERCHANT_FILE_REQUIRED');
  const bytes=await fd.readFile(),after=await fd.stat();
  need(bytes.length===before.size&&bytes.length<=limit&&before.dev===after.dev&&before.ino===after.ino&&
   before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&await realpath(path)===path,
   'API_MERCHANT_SOURCE_CHANGED',409);
  return bytes;
 }finally{await fd.close();}
}
export function parse(bytes){
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{need(false,'API_MERCHANT_JSON_REQUIRED');}
}
/** Used only under the original workspace lease for this operation's private output. */
export async function writeExact(path,bytes){
 absolute(path);need(Buffer.isBuffer(bytes),'API_MERCHANT_BYTES_REQUIRED');
 try{
  const old=await ownedBytes(path,Math.max(bytes.length,1));
  need(old.equals(bytes),'API_MERCHANT_RETAINED_FILE_CHANGED',409);return {reused:true};
 }catch(error){if(error.code!=='ENOENT')throw error;}
 try{await writeBytes(path,bytes);}catch(error){
  try{if((await ownedBytes(path,Math.max(bytes.length,1))).equals(bytes))return {reused:true};}catch{}
  throw error;
 }
 need((await ownedBytes(path,Math.max(bytes.length,1))).equals(bytes),'API_MERCHANT_RETAINED_FILE_CHANGED',409);
 return {reused:false};
}
function backupSelection(raw){
 if(raw===undefined||raw===null)return null;
 need(plain(raw)&&Object.keys(raw).every(k=>['applicationRoot','dataRoots','environmentBindings','passEnv'].includes(k)),
  'API_MERCHANT_BACKUP_SELECTION_REQUIRED');
 const applicationRoot=absolute(raw.applicationRoot),dataRoots=raw.dataRoots??[],environmentBindings=raw.environmentBindings??[];
 need(Array.isArray(dataRoots)&&dataRoots.length<=16&&Array.isArray(environmentBindings)&&environmentBindings.length<=64,
  'API_MERCHANT_BACKUP_SELECTION_REQUIRED');
 const names=new Set();
 for(const root of dataRoots){
  need(plain(root)&&Object.keys(root).every(k=>['name','path'].includes(k))&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(root.name??'')&&!names.has(root.name),
   'API_MERCHANT_BACKUP_ROOT_REQUIRED');names.add(root.name);absolute(root.path);
 }
 for(const binding of environmentBindings)need(plain(binding)&&Object.keys(binding).every(k=>['environment','path','dataRoot'].includes(k))&&typeof binding.environment==='string'&&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding.environment)&&typeof binding.path==='string'&&
  typeof binding.dataRoot==='string'&&names.has(binding.dataRoot)&&
  !binding.path.startsWith('/')&&!binding.path.split('/').some(x=>x==='..')&&!binding.path.includes('\\'),
  'API_MERCHANT_BACKUP_BINDING_REQUIRED');
 need(/^[A-Z][A-Z0-9_]{4,63}$/.test(raw.passEnv??''),'API_MERCHANT_BACKUP_ENV_REQUIRED');
 return {applicationRoot,dataRoots:structuredClone(dataRoots),environmentBindings:structuredClone(environmentBindings),passEnv:raw.passEnv};
}
export async function readConfiguration(file,{expectedSha256}={}){
 file=absolute(file);const bytes=await ownedBytes(file),raw=parse(bytes);
 need(plain(raw)&&raw.schema===SCHEMA&&Object.keys(raw).every(k=>
  ['schema','directory','merchant','checkout','gatewayBaseUrl','actor','python','backup','links'].includes(k)),
  'API_MERCHANT_CONFIGURATION_REQUIRED');
 const configuration={file,sha256:digest(bytes),raw:structuredClone(raw),directory:absolute(raw.directory),
  merchant:absolute(raw.merchant),checkout:absolute(raw.checkout),gatewayBaseUrl:urlOrigin(raw.gatewayBaseUrl),
  actor:text(raw.actor??'merchant-operator',120,'API_MERCHANT_ACTOR_REQUIRED'),backup:backupSelection(raw.backup),
  python:raw.python??process.env.PYTHON??'python3',links:{}};
 need(typeof configuration.python==='string'&&configuration.python.length>0&&configuration.python.length<=4096&&
  !/[\x00-\x1f\x7f]/.test(configuration.python),'API_MERCHANT_PYTHON_REQUIRED');
 if(expectedSha256!==undefined)need(expectedSha256===configuration.sha256,'API_MERCHANT_REVIEWED_CONFIGURATION_CHANGED',409);
 if(raw.links!==undefined){
  need(plain(raw.links)&&Object.keys(raw.links).every(k=>['checkout','delivery','accounting','jobs'].includes(k)),
   'API_MERCHANT_LINKS_REQUIRED');
  for(const [name,value]of Object.entries(raw.links)){
   let selected;try{selected=new URL(value);}catch{need(false,'API_MERCHANT_LINK_REQUIRED');}
   need(typeof value==='string'&&value.length<=8192&&!selected.username&&!selected.password&&
    (selected.protocol==='https:'||selected.protocol==='http:'&&['127.0.0.1','[::1]'].includes(selected.hostname)),
    'API_MERCHANT_LINK_REQUIRED');
   configuration.links[name]=selected.href;
  }
 }
 return configuration;
}
export async function readSelectedSource(configuration){
 const merchant=await readJobMerchant(configuration.merchant);
 const checkoutBytes=await ownedBytes(configuration.checkout,131072,{privateMode:false});
 const checkoutRaw=parse(checkoutBytes),checkout=compileCheckout(checkoutRaw);
 const roots=[configuration.directory,checkout.state,checkout.outbox];
 need(new Set(roots).size===roots.length&&!roots.slice(1).some(p=>p.startsWith(configuration.directory+'/')||
  configuration.directory.startsWith(p+'/')),'API_MERCHANT_STATE_DIRECTORIES_OVERLAP');
 const sha256=digest(canonical({configurationSha256:configuration.sha256,merchant:merchant.identity,
  checkoutSha256:digest(checkoutBytes)}));
 const functions=Object.values(merchant.compiled.functions).map(f=>({id:f.id,path:f.path,description:f.description??f.id,
  inputSchema:f.inputSchema,example:f.example,maxInputBytes:f.maxInputBytes,maxOutputBytes:f.maxOutputBytes,
  timeoutMs:f.timeoutMs,output:f.output,apiCompatible:!f.inputFiles,
  ...(f.inputFiles?{intake:'ORIGINAL_PAID_JOB_FILE_INTAKE'}:{})}));
 const view={sha256,merchantPath:configuration.merchant,applicationPath:merchant.identity.application,
  serviceName:merchant.compiled.serviceName,functions,
  checkout:{payment:checkout.terms,purchaseOrigin:new URL(checkoutRaw.publicOrigin).origin,path:checkoutRaw.path,
   routeId:checkoutRaw.routeId,state:checkout.state,outbox:checkout.outbox},
  backup:configuration.backup?{configured:true,...configuration.backup}:{configured:false},
  gatewayBaseUrl:configuration.gatewayBaseUrl,links:configuration.links};
 return {sha256,merchant,checkout,checkoutRaw,checkoutBytes,view};
}
/** A directly advertised loopback API must listen at the same customer destination. */
export function selectedApiPort(value,gatewayBaseUrl){
 const requested=integer(value,0,65535,'API_MERCHANT_API_PORT_REQUIRED');
 const publicUrl=new URL(gatewayBaseUrl);
 if(publicUrl.protocol==='http:'&&publicUrl.hostname==='127.0.0.1'){
  const selected=Number(publicUrl.port||80);
  need(requested===0||requested===selected,'API_MERCHANT_API_DESTINATION_PORT_CHANGED');
  return selected;
 }
 return requested;
}
export function offerDraft(raw,source){
 need(plain(raw),'API_MERCHANT_OFFER_REQUIRED');
 const title=text(raw.title,160,'API_MERCHANT_TITLE_REQUIRED');
 const allowanceUnits=integer(raw.allowanceUnits,1,9007199254740991,'API_MERCHANT_ALLOWANCE_REQUIRED');
 const workerPort=integer(raw.workerPort,1,65535,'API_MERCHANT_WORKER_PORT_REQUIRED');
 const apiPort=selectedApiPort(raw.apiPort,source.view.gatewayBaseUrl);
 need(apiPort===0||apiPort!==workerPort,'API_MERCHANT_PORTS_MUST_DIFFER');
 need(Array.isArray(raw.routes)&&raw.routes.length>0&&raw.routes.length<=64,'API_MERCHANT_ROUTES_REQUIRED');
 const ids=new Set(),functions=new Set();
 const routes=raw.routes.map(r=>{
  need(plain(r)&&/^[A-Za-z0-9_-]{1,80}$/.test(r.id??'')&&!ids.has(r.id),
   'API_MERCHANT_ROUTE_ID_REQUIRED');
  const f=source.merchant.compiled.functions[r.functionId];
  need(f&&!functions.has(f.id),'API_MERCHANT_FUNCTION_REQUIRED');
  need(!f.inputFiles,'API_MERCHANT_ORIGINAL_FILE_INTAKE_REQUIRED');
  ids.add(r.id);functions.add(f.id);
  return {id:r.id,functionId:f.id,method:'POST',path:f.path,
   units:integer(r.units,1,allowanceUnits,'API_MERCHANT_ROUTE_UNITS_REQUIRED'),
   timeoutSeconds:integer(r.timeoutSeconds,1,120,'API_MERCHANT_TIMEOUT_REQUIRED'),
   maxRequestBytes:f.maxInputBytes,maxResponseBytes:Math.min(f.maxOutputBytes,4*1024*1024)};
 });
 return {title,allowanceUnits,workerPort,apiPort,routes};
}
