// SPDX-License-Identifier: MIT
// Client and private host configuration for the original replication application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Auth} from './workbench/core/auth.mjs';
import {id as originalId} from './workbench/core/common.mjs';

export const CONNECTION_SCHEMA='stellar-forge.replication-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.replication-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.replication-workbench-startup.v1';
export const MAX_JSON=32*1024*1024,MAX_FILE=2*1024*1024*1024,CHUNK=8*1024*1024;
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'REPLICATION_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'REPLICATION_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export const identifier=(v,label='identifier')=>originalId(v,label);
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'REPLICATION_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'REPLICATION_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'REPLICATION_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'REPLICATION_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'REPLICATION_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'REPLICATION_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.replication-'+randomUUID()),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}catch(e){await unlink(temporary).catch(()=>{});throw e;}finally{await fd.close();}
  try{
    if(replace)await rename(temporary,path);else{await link(temporary,path);await unlink(temporary);}
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }catch(e){await unlink(temporary).catch(()=>{});throw e;}
  return{path,bytes:bytes.length,sha256:hash(bytes)};
}
export const writeJson=(path,value,options)=>writePrivate(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),options);
export async function readLaunchConfiguration(path){
  const source=await readJson(path,65536),v=source.value,base=dirname(source.path);
  exact(v,['schema','directory','applicationDirectory','authFile','actorId','runtimeReadyFile','connectionFile','python','consumerRoot'],
    ['schema','directory','applicationDirectory','authFile','actorId','runtimeReadyFile','connectionFile','python']);
  need(v.schema===LAUNCH_SCHEMA,'REPLICATION_LAUNCH_SCHEMA','Select a complete Replication Workbench launch configuration.');
  const at=p=>absolute(isAbsolute(p)?p:resolve(base,p));
  const result={schema:v.schema,directory:at(v.directory),applicationDirectory:at(v.applicationDirectory),authFile:at(v.authFile),actorId:identifier(v.actorId,'host actor'),
    runtimeReadyFile:at(v.runtimeReadyFile),connectionFile:at(v.connectionFile),python:at(v.python),consumerRoot:v.consumerRoot==null?null:at(v.consumerRoot)};
  need(!inside(result.directory,result.authFile)&&!inside(result.directory,result.connectionFile)&&
    !inside(result.directory,source.path),'REPLICATION_PRIVATE_LAYOUT','Keep authentication and launch files beside the customer workspace.');
  need(![source.path,result.authFile,result.runtimeReadyFile].includes(result.connectionFile),
    'REPLICATION_PRIVATE_LAYOUT','The generated connection file must be distinct from the configuration, authentication and runtime inputs.');
  need(!inside(result.applicationDirectory,result.directory)&&!inside(result.directory,result.applicationDirectory)&&
    ![source.path,result.authFile,result.connectionFile].some(path=>inside(result.applicationDirectory,path)),
    'REPLICATION_PRIVATE_LAYOUT','Keep the workspace, authentication and connection outside the unchanged original application source.');
  await privateDirectory(dirname(result.directory));await privateDirectory(dirname(result.connectionFile));
  await readFile(result.authFile,1024*1024);await readFile(result.runtimeReadyFile,MAX_JSON);
  const pythonStat=await lstat(result.python);
  need(pythonStat.isFile()&&!pythonStat.isSymbolicLink()&&await realpath(result.python)===result.python&&(pythonStat.mode&0o111),
    'REPLICATION_PYTHON','Select the canonical original executable Python path.');
  if(result.consumerRoot){
    const stat=await lstat(result.consumerRoot);
    need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(result.consumerRoot)===result.consumerRoot&&
      (!process.getuid||stat.uid===process.getuid()),'REPLICATION_CONSUMER_ROOT','Select the existing owned original consumer directory.');
    need(!inside(result.consumerRoot,result.applicationDirectory)&&!inside(result.applicationDirectory,result.consumerRoot)&&
      ![source.path,result.authFile,result.connectionFile,result.runtimeReadyFile].some(path=>inside(result.consumerRoot,path)),
      'REPLICATION_CONSUMER_LAYOUT','Keep the original application and private launch credentials outside downstream editable files.');
  }
  const actors=Auth.prototype.config.call({authFile:result.authFile}).actors;
  need(actors.some(a=>a.id===result.actorId),'REPLICATION_HOST_ACTOR','Select an existing installation actor.');
  return{path:source.path,sha256:source.sha256,value:result};
}
export async function readConnection(path,{directory,actorId}={}){
  const source=await readJson(path,65536),v=source.value;
  exact(v,['schema','launchId','instanceId','directory','applicationDirectory','directoryIdentity','authFile','actorId','runtimeReadyFile','origin','pid','startedAt','sourceManifestSha256','runtimeSelectionSha256','python','consumerRoot'],
    ['schema','launchId','instanceId','directory','applicationDirectory','directoryIdentity','authFile','actorId','runtimeReadyFile','origin','pid','startedAt','sourceManifestSha256','runtimeSelectionSha256','python','consumerRoot']);
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&typeof v.instanceId==='string'&&v.instanceId,
    'REPLICATION_CONNECTION','Use the current managed Replication Workbench connection.');
  const selected=await privateDirectory(v.directory),applicationDirectory=absolute(v.applicationDirectory);
  need(!directory||selected.path===absolute(directory),'REPLICATION_DIRECTORY_CHANGED','The connection selects another workspace.',409);
  need(plain(v.directoryIdentity)&&v.directoryIdentity.dev===selected.dev&&v.directoryIdentity.ino===selected.ino,
    'REPLICATION_DIRECTORY_CHANGED','The original workspace directory changed.',409);
  need(!inside(selected.path,source.path)&&!inside(selected.path,absolute(v.authFile))&&
    !inside(applicationDirectory,source.path)&&!inside(applicationDirectory,absolute(v.authFile)),
    'REPLICATION_PRIVATE_LAYOUT','Private connection and authentication belong outside the exported workspace.');
  const url=new URL(v.origin);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===v.origin&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash&&Number(url.port)>0,
    'REPLICATION_CONNECTION_ORIGIN','Use the original managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);digest(v.sourceManifestSha256);digest(v.runtimeSelectionSha256);
  absolute(v.python);if(v.consumerRoot!==null)absolute(v.consumerRoot);
  await readFile(v.authFile,1024*1024);
  // The original host authentication file remains the actor authority on every read.
  const actors=Auth.prototype.config.call({authFile:v.authFile}).actors,selectedId=actorId??v.actorId;
  const actor=actors.find(a=>a.id===selectedId);
  need(actor,'REPLICATION_HOST_ACTOR','Select the host-declared installation actor.');
  return{path:source.path,sha256:source.sha256,value:v,actor:{id:actor.id,name:actor.name,roles:actor.roles},token:actor.token};
}
export function connectionView(c){const{launchId,instanceId,origin,pid,startedAt,applicationDirectory,sourceManifestSha256,runtimeSelectionSha256}=c.value;return{launchId,instanceId,origin,pid,startedAt,applicationDirectory,sourceManifestSha256,runtimeSelectionSha256,actor:c.actor};}
function originalFilename(response){
  const header=response.headers.get('content-disposition');if(header===null)return null;
  const matched=/^attachment;\s*filename="([^"]+)"$/i.exec(header);
  need(matched,'REPLICATION_DOWNLOAD_NAME','The original download filename header is invalid.',502);
  const value=matched[1];
  need(value.length>0&&value.length<=240&&!/[\\/\x00-\x1f\x7f]/.test(value)&&value!=='.'&&value!=='..',
    'REPLICATION_DOWNLOAD_NAME','The original download must select a plain complete filename.',502);
  return value;
}
const safeError=(v,token)=>String(v??'Original replication request failed.').split(token).join('[redacted]').slice(0,4000);
async function request(c,path,{method='GET',body,bytes,headers={},signal,maximum=MAX_FILE,sink,raw=false}={}){
  const url=new URL(path,c.value.origin);
  need(url.origin===c.value.origin&&url.pathname.startsWith('/api/')&&!url.username&&!url.password&&!url.hash&&['GET','POST','PUT'].includes(method),
    'REPLICATION_ROUTE','Choose an original replication API operation.');
  const serialized=bytes??(body===undefined?undefined:Buffer.from(JSON.stringify(body)));
  need(serialized===undefined||serialized.length<=MAX_JSON,'REPLICATION_REQUEST_SIZE','The original request exceeds its installed limit.',413);
  let response,dispatched=false;
  try{
    dispatched=true;
    response=await fetch(url,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000),
      headers:{...headers,authorization:'Bearer '+c.token,...(body===undefined?{}:{'content-type':'application/json'})},body:serialized});
    const advertised=response.headers.get('content-length');
    need(advertised===null||/^\d+$/.test(advertised)&&Number(advertised)<=maximum,'REPLICATION_RESPONSE_SIZE','The complete response exceeds this operation limit.',413);
    const chunks=[],hasher=createHash('sha256');let length=0;
    for await(const chunk of response.body??[]){
      length+=chunk.length;need(length<=maximum,'REPLICATION_RESPONSE_SIZE','The complete response exceeds this operation limit.',413);hasher.update(chunk);
      if(sink&&response.ok)await sink(chunk);else chunks.push(chunk);
    }
    need(advertised===null||Number(advertised)===length,'REPLICATION_RESPONSE_INCOMPLETE','The original response was incomplete.',502);
    const responseBytes=Buffer.concat(chunks),sha256=hasher.digest('hex');
    if(!response.ok){let error;try{error=parse(responseBytes).error;}catch{error={};}
      throw fault(typeof error?.code==='string'?error.code:'REPLICATION_REQUEST_FAILED',safeError(error?.message,c.token),response.status,
        {originalResponse:true,requestId:body?.requestId??null,original:error?.details??null});}
    const supplied=response.headers.get('x-content-sha256');
    if(supplied!==null)need(digest(supplied)===sha256,'REPLICATION_RESPONSE_IDENTITY','The full artifact differs from its original digest.',502);
    const filename=originalFilename(response);
    if(sink)return{bytes:length,sha256,contentType:response.headers.get('content-type'),originalSha256:supplied,filename};
    return raw?{bytes:responseBytes,sha256,contentType:response.headers.get('content-type'),filename}:
      {value:parse(responseBytes),bytes:responseBytes,sha256,status:response.status};
  }catch(error){
    if(error.details?.originalResponse)throw error;
    const details={requestId:body?.requestId??null,dispatch:method==='GET'?'read':dispatched?'unknown':'not-dispatched',
      recovery:method==='GET'?'Repeat the same original read.':'Reconcile or replay the identical original request ID and complete payload.'};
    if(String(error.code??'').startsWith('REPLICATION_')){error.details={...error.details,...details};throw error;}
    throw fault('REPLICATION_CONNECTION_UNAVAILABLE',method==='GET'?'Open the selected original application and reconnect.':
      'The original response is incomplete. Reuse this exact request and reconcile its retained result.',503,details);
  }finally{if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
}
export class ReplicationClient{
  #connection;#pending=new Set();#closed=false;
  constructor(connection){this.#connection=connection;}
  static async connect(path,options={}){
    const c=await readConnection(path,options);
    if(options.expectedLaunchId)need(c.value.launchId===options.expectedLaunchId,'REPLICATION_INSTANCE_CHANGED','Select the current managed application.',409);
    const client=new ReplicationClient(c);await client.info();return client;
  }
  get connection(){return connectionView(this.#connection);}
  async #request(path,options){
    need(!this.#closed,'REPLICATION_CLIENT_CLOSED','Reconnect this application attachment.',409);
    const work=(async()=>{
      const current=await readConnection(this.#connection.path,{directory:this.#connection.value.directory,actorId:this.#connection.actor.id});
      need(current.sha256===this.#connection.sha256,'REPLICATION_INSTANCE_CHANGED','The application restarted. Reconnect to the current launch.',409);
      return request(current,path,options);
    })();this.#pending.add(work);try{return await work;}finally{this.#pending.delete(work);}
  }
  async info(){
    const r=await this.#request('/api/info');
    need(r.value.instanceId===this.#connection.value.instanceId&&r.value.actor?.id===this.#connection.actor.id&&
      hash(JSON.stringify(r.value.runtime))===this.#connection.value.runtimeSelectionSha256&&
      r.value.limits?.upload===MAX_FILE&&r.value.limits?.chunk===CHUNK&&r.value.limits?.json===MAX_JSON,
      'REPLICATION_INSTANCE_CHANGED','The authenticated application differs from its recorded workspace, native runtime or actor.',409);
    return r;
  }
  projects(){return this.#request('/api/projects');}
  create(input){
    exact(input,['requestId','title','notes'],['requestId','title']);
    identifier(input.requestId,'request ID');
    return this.#request('/api/projects',{method:'POST',body:input});
  }
  project({projectId,revision}){
    identifier(projectId,'project ID');if(revision!==undefined)integer(revision,'revision');
    return this.#request('/api/projects/'+encodeURIComponent(projectId)+(revision===undefined?'':'?revision='+revision));
  }
  sourceConnections({projectId,sourceId,revision}){
    identifier(projectId,'project ID');identifier(sourceId,'source ID');if(revision!==undefined)integer(revision,'revision');
    return this.#request('/api/projects/'+encodeURIComponent(projectId)+'/sources/'+encodeURIComponent(sourceId)+'/connections'+
      (revision===undefined?'':'?revision='+revision));
  }
  consumer({projectId,streamId,offset=0,limit=100}){
    identifier(projectId,'project ID');integer(offset,'row offset');integer(limit,'row limit',1000,1);
    const query=new URLSearchParams({offset:String(offset),limit:String(limit)});
    if(streamId!==undefined){
      need(typeof streamId==='string'&&streamId.length>0&&streamId.length<=2000&&!/[\x00-\x1f\x7f]/.test(streamId),
        'REPLICATION_STREAM_ID','Select the original retained stream identity.');
      query.set('streamId',streamId);
    }
    return this.#request('/api/projects/'+encodeURIComponent(projectId)+'/consumer?'+query);
  }
  action(input){
    exact(input,['projectId','requestId','expectedRevision','action','payload'],['projectId','requestId','expectedRevision','action','payload']);
    identifier(input.projectId,'project ID');identifier(input.requestId,'request ID');integer(input.expectedRevision,'revision');
    need(typeof input.action==='string'&&plain(input.payload),'REPLICATION_ACTION','Supply the original action and complete payload.');
    return this.#request('/api/projects/'+encodeURIComponent(input.projectId)+'/actions',{method:'POST',body:input});
  }
  uploadStart(input){exact(input,['uploadId','filename','mediaType','bytes','sha256'],['uploadId','filename','mediaType','bytes','sha256']);
    identifier(input.uploadId,'upload ID');integer(input.bytes,'source bytes',MAX_FILE,1);digest(input.sha256);
    return this.#request('/api/uploads',{method:'POST',body:input});}
  uploadStatus(uploadId){return this.#request('/api/uploads/'+encodeURIComponent(identifier(uploadId,'upload ID')));}
  uploadChunk({uploadId,start,total,sha256,bytes}){
    identifier(uploadId,'upload ID');integer(start,'byte offset');integer(total,'total bytes',MAX_FILE,1);digest(sha256);
    bytes=Buffer.from(bytes);need(bytes.length>0&&bytes.length<=CHUNK&&start+bytes.length<=total&&hash(bytes)===sha256,
      'REPLICATION_CHUNK','Use the exact original upload range and chunk digest.');
    return this.#request('/api/uploads/'+encodeURIComponent(uploadId),{method:'PUT',bytes,headers:{
      'content-type':'application/octet-stream','content-range':'bytes '+start+'-'+(start+bytes.length-1)+'/'+total,'x-chunk-sha256':sha256}});
  }
  uploadFinish(uploadId){return this.#request('/api/uploads/'+encodeURIComponent(identifier(uploadId,'upload ID'))+'/finish',{method:'POST'});}
  async artifact(selection,{sink}={}){
    exact(selection,['projectId','kind','id','path','revision'],['projectId','kind','id']);
    const base='/api/projects/'+encodeURIComponent(identifier(selection.projectId,'project ID'));
    const id=encodeURIComponent(identifier(selection.id,'artifact ID')),query=new URLSearchParams();let path;
    if(selection.kind==='source')path=base+'/sources/'+id;
    else if(['plan','replication','comparison','observations','handoff','downstream_plan'].includes(selection.kind)){
      const kind=selection.kind==='downstream_plan'?'downstream':selection.kind;
      path=base+'/outputs/'+kind+'/'+id;
    }else{
      need(['native','downstream'].includes(selection.kind),'REPLICATION_ARTIFACT_KIND','Select an original source, plan, comparison, handoff, native output or downstream file.');
      need(typeof selection.path==='string'&&selection.path.length>0&&selection.path.length<=2000&&
        !selection.path.startsWith('/')&&!selection.path.includes('\\')&&!/[\x00-\x1f\x7f]/.test(selection.path)&&
        selection.path.split('/').every(part=>part&&part!=='.'&&part!=='..'),
        'REPLICATION_ARTIFACT_PATH','Select one exact retained original relative file path.');
      path=base+'/'+selection.kind+'/'+id;query.set('path',selection.path);
    }
    need(['native','downstream'].includes(selection.kind)||selection.path===undefined,
      'REPLICATION_ARTIFACT_INPUT','A relative file path belongs only to native or downstream output.');
    if(selection.revision!==undefined){integer(selection.revision,'revision');query.set('revision',String(selection.revision));}
    return this.#request(path+(query.size?'?'+query:''),{sink,raw:true,maximum:MAX_FILE});
  }
  async close(){this.#closed=true;await Promise.allSettled([...this.#pending]);}
}
