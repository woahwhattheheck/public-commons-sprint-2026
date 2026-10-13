// SPDX-License-Identifier: MIT
// Client and private host configuration for the original Hive routing application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONNECTION_SCHEMA='stellar-forge.hive-routing-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.hive-routing-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.hive-routing-workbench-startup.v1';
export const MAX_JSON=32*1024*1024,MAX_FILE=2*1024*1024*1024,CHUNK=8*1024*1024;
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'HIVE_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'HIVE_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export function identifier(v,label='identifier'){need(typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v),'HIVE_IDENTIFIER','Use a plain stable '+label+'.');return v;}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'HIVE_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'HIVE_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'HIVE_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'HIVE_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'HIVE_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'HIVE_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.hive-'+randomUUID()),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}catch(e){await unlink(temporary).catch(()=>{});throw e;}finally{await fd.close();}
  try{
    if(replace)await rename(temporary,path);else{await link(temporary,path);await unlink(temporary);}
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }catch(e){await unlink(temporary).catch(()=>{});throw e;}
  return{path,bytes:bytes.length,sha256:hash(bytes)};
}
export const writeJson=(path,value,options)=>writePrivate(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),options);

export const RUNTIME_SCHEMA='stellar-forge.hive-routing-runtime.v1';
export async function readRuntime(path){
  const r=await readJson(path,MAX_JSON),v=r.value;
  need(v.schema===RUNTIME_SCHEMA&&v.state==='READY'&&v.platform==='linux'&&['x64','arm64'].includes(v.architecture),
    'HIVE_RUNTIME','Select the complete prepared native Hive runtime.',409);
  need(v.yaml?.version==='6.0.3'&&Array.isArray(v.yaml.files)&&v.yaml.files.length>0,
    'HIVE_RUNTIME','Select the installed exact PyYAML dependency.',409);
  for(const item of [v.python,v.router,v.wheel,...v.yaml.files]){
    need(plain(item)&&typeof item.path==='string','HIVE_RUNTIME','Keep the complete selected runtime files.',409);
    const found=await readFile(item.path,MAX_FILE,{privateOnly:false});
    need(found.bytes.length===item.bytes&&found.sha256===item.sha256,'HIVE_RUNTIME_CHANGED','A prepared native file changed: '+item.path,409);
  }
  const known={x64:{bytes:70274296,sha256:'d59fc37101f1ae9c78dffc7a62dafd1ab7e4905aaa300e692661067b32670af6'},
    arm64:{bytes:63567664,sha256:'b4e5e0c36a08f1e3bf25946228de2f00c99c672945358facdf1f6c2dc28b3bb3'}};
  need(process.platform===v.platform&&process.arch===v.architecture&&v.router.bytes===known[v.architecture].bytes&&v.router.sha256===known[v.architecture].sha256,
    'HIVE_RUNTIME_PLATFORM','Use the exact published Hive v0.3.4 binary for this Linux host.',409);
  return r;
}
export async function readLaunchConfiguration(path){
  const r=await readJson(path,65536),v=r.value,base=dirname(r.path);
  exact(v,['schema','directory','applicationDirectory','python','runtimeReadyFile','connectionFile'],
    ['schema','directory','applicationDirectory','python','runtimeReadyFile','connectionFile']);
  need(v.schema===LAUNCH_SCHEMA,'HIVE_LAUNCH_SCHEMA','Select the complete Hive Routing Workbench launch configuration.');
  const at=p=>absolute(isAbsolute(p)?p:resolve(base,p));
  const value={schema:LAUNCH_SCHEMA,...Object.fromEntries(['directory','applicationDirectory','python','runtimeReadyFile','connectionFile'].map(k=>[k,at(v[k])]))};
  need(!inside(value.directory,value.applicationDirectory)&&!inside(value.applicationDirectory,value.directory)&&
    ![r.path,value.connectionFile,value.runtimeReadyFile].some(p=>inside(value.directory,p)||inside(value.applicationDirectory,p))&&
    ![r.path,value.runtimeReadyFile,value.python].includes(value.connectionFile),
    'HIVE_PRIVATE_LAYOUT','Keep source, customer workspace, prepared runtime and private launch/connection files separate.');
  await privateDirectory(dirname(value.directory));await privateDirectory(dirname(value.connectionFile));
  const runtime=await readRuntime(value.runtimeReadyFile);
  need(runtime.value.python.path===value.python,'HIVE_PYTHON','The launch must use its independently installed runtime Python.',409);
  return{path:r.path,sha256:r.sha256,value,runtime};
}
export async function readConnection(path,{directory}={}){
  const r=await readJson(path,65536),v=r.value;
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&/^[a-f0-9]{32}$/.test(v.instanceId??'')&&
    /^[a-f0-9]{64}$/.test(v.nonce??''),'HIVE_CONNECTION','Select the complete current managed connection.');
  const selected=await privateDirectory(v.directory);
  need(!directory||selected.path===absolute(directory),'HIVE_DIRECTORY_CHANGED','The connection selects another original workspace.',409);
  need(v.directoryIdentity?.dev===selected.dev&&v.directoryIdentity?.ino===selected.ino,'HIVE_DIRECTORY_CHANGED','The original workspace directory changed.',409);
  for(const key of ['applicationDirectory','python','runtimeReadyFile','configurationFile'])absolute(v[key]);
  need(!inside(v.directory,r.path)&&!inside(v.applicationDirectory,r.path),'HIVE_PRIVATE_LAYOUT','Keep the private launch connection outside exported source and customer data.');
  const u=new URL(v.origin);
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.origin===v.origin&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash&&Number(u.port)>0,
    'HIVE_ORIGIN','Use this managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);integer(v.ownerPid,'Applications owner PID',Number.MAX_SAFE_INTEGER,1);
  digest(v.sourceManifestSha256);digest(v.runtimeSelectionSha256);digest(v.configurationSha256);
  return{path:r.path,sha256:r.sha256,value:v};
}
export function connectionView(c){
  const {nonce,...v}=c.value;
  return {...v,connectionFile:c.path,connectionSha256:c.sha256};
}
function filename(response){
  const h=response.headers.get('content-disposition');if(h===null)return null;
  const m=/^attachment;\s*filename\*=UTF-8''(.+)$/i.exec(h);
  need(m,'HIVE_DOWNLOAD_NAME','The original download filename is invalid.',502);
  let name;try{name=decodeURIComponent(m[1]);}catch{throw fault('HIVE_DOWNLOAD_NAME','The original download filename is invalid.',502);}
  need(name&&name.length<=4096&&!/[\\/\x00-\x1f\x7f]/.test(name)&&name!=='.'&&name!=='..',
    'HIVE_DOWNLOAD_NAME','The original download must use a plain filename.',502);return name;
}
async function request(c,path,{method='GET',body,maximum=MAX_JSON,raw=false,sink,signal,acceptError=false}={}){
  const url=new URL(path,c.value.origin);
  need(url.origin===c.value.origin&&url.pathname.startsWith('/api/')&&!url.username&&!url.password&&!url.hash&&['GET','POST'].includes(method),
    'HIVE_ROUTE','Choose an original Hive API route.');
  const sent=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  need(!sent||sent.length<=MAX_JSON,'HIVE_REQUEST_SIZE','The complete JSON request exceeds the installed limit.',413);
  let response,dispatched=false;
  try{
    dispatched=true;response=await fetch(url,{method,body:sent,redirect:'error',
      headers:{connection:'close','x-hive-managed-launch':c.value.nonce,...(sent?{'content-type':'application/json'}:{})},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1800000)]):AbortSignal.timeout(1800000)});
    const advertised=response.headers.get('content-length');
    need(advertised===null||/^\d+$/.test(advertised)&&Number(advertised)<=maximum,
      'HIVE_RESPONSE_SIZE','The complete response exceeds this installed operation limit.',413);
    const chunks=[],hasher=createHash('sha256');let length=0;
    for await(const chunk of response.body??[]){
      length+=chunk.length;need(length<=maximum,'HIVE_RESPONSE_SIZE','The complete response exceeds this operation limit.',413);
      hasher.update(chunk);if(sink&&response.ok)await sink(chunk);else chunks.push(chunk);
    }
    need(advertised===null||Number(advertised)===length,'HIVE_RESPONSE_INCOMPLETE','The original response ended before its declared size.',502);
    const bytes=Buffer.concat(chunks),sha256=hasher.digest('hex'),mediaType=response.headers.get('content-type');
    if(!response.ok&&!acceptError){
      let value=null;try{value=parse(bytes);}catch{}
      throw fault('HIVE_ORIGINAL_ERROR',String(value?.message??value?.error??'Original Hive operation failed.').slice(0,4000),response.status,
        {originalResponse:true,dispatch:method==='POST'?'completed-response':'read',value,bytesBase64:bytes.toString('base64'),sha256});
    }
    const result={ok:response.ok,status:response.status,sha256,mediaType,contentType:mediaType,filename:filename(response)};
    return sink?{...result,bytes:length}:raw?{...result,bytes}:{...result,bytes,value:parse(bytes)};
  }catch(error){
    if(error.details?.originalResponse)throw error;
    const details={dispatch:method==='GET'?'read':dispatched?'unknown':'not-dispatched',
      recovery:method==='GET'?'Repeat the same read.':'Read the retained request and original saved entity or programme before continuing this same mutation.'};
    if(String(error.code??'').startsWith('HIVE_')){error.details={...error.details,...details};throw error;}
    throw fault('HIVE_CONNECTION_UNAVAILABLE','The original listener response was incomplete.',503,details);
  }finally{if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
}
export class HiveClient{
  #selected;#closed=false;#active=new Set();#pending=new Set();
  constructor(selected){this.#selected=selected;}
  static async connect(path,{expectedLaunchId}={}){
    const selected=await readConnection(path);
    need(!expectedLaunchId||selected.value.launchId===expectedLaunchId,'HIVE_LAUNCH_CHANGED','Reconnect the selected Applications launch.',409);
    const client=new HiveClient(selected);try{await client.info();return client;}catch(error){await client.close();throw error;}
  }
  get connection(){return connectionView(this.#selected);}
  async #current(){
    need(!this.#closed,'HIVE_CLIENT_CLOSED','Reconnect this attachment.');
    const c=await readConnection(this.#selected.path);
    need(c.sha256===this.#selected.sha256,'HIVE_LAUNCH_CHANGED','The managed launch changed; reconnect its current connection.',409);
    return c;
  }
  #perform(path,options={}){
    const controller=new AbortController();this.#active.add(controller);
    const work=(async()=>request(await this.#current(),path,{...options,signal:controller.signal}))();
    const settled=work.finally(()=>{this.#active.delete(controller);this.#pending.delete(settled);});
    this.#pending.add(settled);return settled;
  }
  async info(){
    const r=await this.#perform('/api/merchant-info');
    const v=r.value,c=this.#selected.value;
    need(v.schema==='stellar-forge.hive-routing-live.v1'&&v.launchId===c.launchId&&v.pid===c.pid&&v.workspace.id===c.instanceId&&
      v.directory===c.directory&&v.applicationDirectory===c.applicationDirectory&&v.sourceManifestSha256===c.sourceManifestSha256&&
      v.runtimeSelectionSha256===c.runtimeSelectionSha256,'HIVE_LISTENER_CHANGED','The original managed listener differs from this attachment.',409);
    return r;
  }
  async state(){await this.info();return this.#perform('/api/state');}
  async action(action,data={}){
    need(typeof action==='string'&&/^[a-z][a-z.]{1,80}$/.test(action)&&plain(data),'HIVE_ACTION','Select an original Controller action and full data.');
    await this.info();return this.#perform('/api/action',{method:'POST',body:{action,data},acceptError:true});
  }
  async artifact(selector,{sink}={}){
    need(plain(selector),'HIVE_ARTIFACT','Select a complete original file.');
    const q=new URLSearchParams();let route;
    if(selector.kind==='edition'){identifier(selector.edition,'edition');need(typeof selector.path==='string'&&selector.path.length<=4096,'HIVE_ARTIFACT','Select an original edition file.');q.set('edition',selector.edition);q.set('path',selector.path);route='/api/edition-file';}
    else if(selector.kind==='response'){identifier(selector.programme,'programme');identifier(selector.operation,'operation');q.set('programme',selector.programme);q.set('operation',selector.operation);route='/api/response';}
    else if(selector.kind==='object'){route='/api/file/'+digest(selector.sha256);if(selector.name!==undefined){need(typeof selector.name==='string'&&selector.name.length<=4096,'HIVE_ARTIFACT','Use the selected original name.');q.set('name',selector.name);}}
    else if(selector.kind==='native-log'){identifier(selector.deployment,'deployment');q.set('deployment',selector.deployment);route='/api/native-log';}
    else if(selector.kind==='archive'){q.set('path',absolute(selector.path));q.set('sha256',digest(selector.sha256));route='/api/archive';}
    else throw fault('HIVE_ARTIFACT','Choose an original edition, response, object, native-log or archive.');
    await this.info();const r=await this.#perform(route+(q.size?'?'+q:''),{raw:true,maximum:MAX_FILE,sink});
    if(['object','archive'].includes(selector.kind))need(r.sha256===selector.sha256,'HIVE_ARTIFACT_CHANGED','The full original artifact differs from its selected digest.',409);
    return r;
  }
  async close(){this.#closed=true;for(const controller of this.#active)controller.abort();await Promise.allSettled([...this.#pending]);}
}
