// SPDX-License-Identifier: MIT
// Client and private host configuration for the original client pipeline delivery application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONNECTION_SCHEMA='stellar-forge.pipeline-delivery-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.pipeline-delivery-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.pipeline-delivery-workbench-startup.v1';
export const MAX_ARCHIVE=512*1024*1024,MAX_JSON=Math.floor(MAX_ARCHIVE*4/3)+2*1024*1024,MAX_FILE=MAX_JSON,CHUNK=3*1024*1024;
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'PIPELINE_DELIVERY_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'PIPELINE_DELIVERY_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export function identifier(v,label='identifier'){need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v),'PIPELINE_DELIVERY_IDENTIFIER','Use an original '+label+'.');return v;}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'PIPELINE_DELIVERY_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'PIPELINE_DELIVERY_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function ownedDirectory(path){
  path=absolute(path);const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o022)&&
    (!process.getuid||s.uid===process.getuid()),'PIPELINE_DELIVERY_OWNED_DIRECTORY','Use an owned directory without group or world write access.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'PIPELINE_DELIVERY_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'PIPELINE_DELIVERY_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'PIPELINE_DELIVERY_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'PIPELINE_DELIVERY_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.pipeline-delivery-'+randomUUID()),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}catch(e){await unlink(temporary).catch(()=>{});throw e;}finally{await fd.close();}
  try{
    if(replace)await rename(temporary,path);else{await link(temporary,path);await unlink(temporary);}
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }catch(e){await unlink(temporary).catch(()=>{});throw e;}
  return{path,bytes:bytes.length,sha256:hash(bytes)};
}
export const writeJson=(path,value,options)=>writePrivate(path,Buffer.from(JSON.stringify(value,null,2)+'\n'),options);

export async function executablePath(path){
  path=absolute(path);const target=await realpath(path),s=await lstat(target);
  need(s.isFile()&&(s.mode&0o111),'PIPELINE_DELIVERY_EXECUTABLE','Select an installed executable.');
  // The invocation path belongs to the original virtual environment; keep it.
  return path;
}
export async function readLaunchConfiguration(path){
  const source=await readJson(path,65536),v=source.value,base=dirname(source.path);
  const fields=['schema','directory','controlDirectory','applicationDirectory','programmeDirectory','runtimeReadyFile','connectionFile','python'];
  exact(v,fields,fields);need(v.schema===LAUNCH_SCHEMA,'PIPELINE_DELIVERY_LAUNCH_SCHEMA','Use a complete pipeline-delivery launch configuration.');
  const at=p=>{need(typeof p==='string','PIPELINE_DELIVERY_PATH','Select the complete host path.');return absolute(isAbsolute(p)?p:resolve(base,p));};
  const result={schema:v.schema};for(const k of fields.slice(1))result[k]=at(v[k]);
  const separate=[result.directory,result.controlDirectory,result.applicationDirectory,result.programmeDirectory];
  need(separate.every((p,i)=>separate.every((q,j)=>i===j||!inside(p,q)&&!inside(q,p))),
    'PIPELINE_DELIVERY_LAYOUT','Keep the original workspace, Staff control, application and programme in distinct trees.');
  need(![source.path,result.runtimeReadyFile].includes(result.connectionFile)&&
    ![result.directory,result.applicationDirectory,result.programmeDirectory].some(root=>[source.path,result.connectionFile,result.runtimeReadyFile].some(p=>inside(root,p))),
    'PIPELINE_DELIVERY_LAYOUT','Keep private launch, runtime receipt and generated connection outside writable/source exports.');
  await ownedDirectory(dirname(result.directory));await ownedDirectory(dirname(result.controlDirectory));
  await privateDirectory(dirname(result.connectionFile));await readFile(result.runtimeReadyFile,MAX_JSON);
  result.python=await executablePath(result.python);
  return{path:source.path,sha256:source.sha256,value:result};
}
export async function readConnection(path,{directory,controlDirectory}={}){
  const source=await readJson(path,65536),v=source.value;
  const fields=['schema','launchId','instanceId','directory','controlDirectory','applicationDirectory','programmeDirectory',
    'directoryIdentity','controlIdentity','runtimeReadyFile','runtimeId','runtimeSelectionSha256','python','dbt',
    'sourceManifestSha256','capabilityFile','origin','pid','startedAt'];
  exact(v,fields,fields);
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&v.instanceId===v.launchId,
    'PIPELINE_DELIVERY_CONNECTION','Use the current managed pipeline-delivery connection.');
  const selected=await privateDirectory(v.directory),control=await privateDirectory(v.controlDirectory);
  for(const [actual,expected]of[[selected,v.directoryIdentity],[control,v.controlIdentity]])
    need(plain(expected)&&actual.dev===expected.dev&&actual.ino===expected.ino,'PIPELINE_DELIVERY_DIRECTORY_CHANGED','The selected original directory changed.',409);
  need((!directory||selected.path===absolute(directory))&&(!controlDirectory||control.path===absolute(controlDirectory)),
    'PIPELINE_DELIVERY_DIRECTORY_CHANGED','The connection selects another original installation.',409);
  for(const k of['applicationDirectory','programmeDirectory','runtimeReadyFile','python','dbt'])absolute(v[k]);
  need(v.capabilityFile===join(control.path,'capability')&&!inside(selected.path,source.path)&&!inside(absolute(v.applicationDirectory),source.path),
    'PIPELINE_DELIVERY_PRIVATE_LAYOUT','Keep the original Staff capability and connection outside customer source.');
  const url=new URL(v.origin);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===v.origin&&url.pathname==='/'&&
    !url.username&&!url.password&&!url.search&&!url.hash&&Number(url.port)>0,
    'PIPELINE_DELIVERY_ORIGIN','Use the actual managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);digest(v.sourceManifestSha256);digest(v.runtimeSelectionSha256);
  need(typeof v.runtimeId==='string'&&v.runtimeId.length>0&&v.runtimeId.length<=200,'PIPELINE_DELIVERY_RUNTIME','Select the prepared original runtime.');
  const token=(await readFile(v.capabilityFile,4096)).bytes.toString('utf8').trim();
  need(token.length>=40&&token.length<=1024&&!/[\s\x00-\x1f\x7f]/.test(token),'PIPELINE_DELIVERY_CAPABILITY','Use the original private Staff capability.');
  return{path:source.path,sha256:source.sha256,value:v,token};
}
export function connectionView(c){
  const {launchId,instanceId,directory,controlDirectory,applicationDirectory,programmeDirectory,sourceManifestSha256,
    runtimeReadyFile,runtimeId,runtimeSelectionSha256,python,dbt,origin,pid,startedAt}=c.value;
  return{launchId,instanceId,directory,controlDirectory,applicationDirectory,programmeDirectory,sourceManifestSha256,
    runtimeReadyFile,runtimeId,runtimeSelectionSha256,python,dbt,origin,pid,startedAt};
}
function filename(response){
  const header=response.headers.get('content-disposition');if(!header)return null;
  const match=/^attachment;\s*filename="([^"]+)"$/i.exec(header);
  need(match&&match[1].length<=240&&!/[\\/\x00-\x1f\x7f]/.test(match[1])&&!['.','..'].includes(match[1]),
    'PIPELINE_DELIVERY_FILENAME','The original download filename changed.',502);
  return match[1];
}
async function request(c,path,{method='GET',body,stream,length,maximum=MAX_JSON,sink}={}){
  need(path.startsWith('/api/')&&!path.startsWith('//'),'PIPELINE_DELIVERY_ROUTE','Use an original application endpoint.');
  const headers={authorization:'Bearer '+c.token,origin:c.value.origin,accept:'application/json'};
  let content;
  if(body!==undefined){content=Buffer.from(JSON.stringify(body));length=content.length;}
  else if(stream!==undefined)content=stream;
  if(content!==undefined){
    integer(length,'complete request bytes',MAX_JSON);
    headers['content-type']='application/json';headers['content-length']=String(length);
  }
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);
  try{
    const response=await fetch(c.value.origin+path,{method,headers,body:content,signal:controller.signal,redirect:'error',
      ...(stream!==undefined?{duplex:'half'}:{})});
    const contentType=response.headers.get('content-type')||'',binary=response.ok&&contentType.split(';')[0].trim()==='application/zip';
    const selectedMaximum=binary?MAX_ARCHIVE:maximum,reported=response.headers.get('content-length');
    if(reported!==null)need(/^\d+$/.test(reported)&&Number(reported)<=selectedMaximum,'PIPELINE_DELIVERY_RESPONSE_SIZE','Keep the complete original response within its declared limit.',502);
    const digest_=createHash('sha256'),chunks=[];let count=0;
    for await(const chunk of response.body??[]){
      count+=chunk.length;need(count<=selectedMaximum,'PIPELINE_DELIVERY_RESPONSE_SIZE','The original response exceeds its installed limit.',502);
      digest_.update(chunk);if(binary&&sink)await sink(chunk);else chunks.push(Buffer.from(chunk));
    }
    need(reported===null||count===Number(reported),'PIPELINE_DELIVERY_RESPONSE_INCOMPLETE','The original response ended before its declared byte count.',502);
    const sha256=digest_.digest('hex'),base={ok:response.ok,status:response.status,sha256,contentType,filename:filename(response)};
    if(binary){
      const expected=response.headers.get('x-archive-sha256'),workspaceId=response.headers.get('x-workspace-id'),
        revision=response.headers.get('x-workspace-revision'),receivingId=response.headers.get('x-receiving-id');
      need(expected===sha256&&typeof workspaceId==='string'&&workspaceId&&/^\d+$/.test(revision??'')&&receivingId,
        'PIPELINE_DELIVERY_ARCHIVE_IDENTITY','The original complete archive identity differs from its HTTP headers.',502);
      return{...base,bytes:sink?count:Buffer.concat(chunks),workspaceId,revision:Number(revision),receivingId,
        headers:{'x-archive-sha256':expected,'x-workspace-id':workspaceId,'x-workspace-revision':revision,'x-receiving-id':receivingId}};
    }
    const bytes=Buffer.concat(chunks);let value=null,parseError=null;
    try{value=parse(bytes);}catch{parseError='The complete original response is not valid UTF-8 JSON.';}
    return{...base,bytes,value,...(parseError?{parseError}:{})};
  }finally{clearTimeout(timeout);controller.abort();}
}
async function selectedBytes(path,identity,maximum){
  need(plain(identity),'PIPELINE_DELIVERY_INPUT','Select the declared original input identity.');
  digest(identity.sha256);integer(identity.bytes,'input bytes',maximum);
  const source=await readFile(path,maximum,{privateOnly:false});
  need(source.sha256===identity.sha256&&source.bytes.length===identity.bytes,
    'PIPELINE_DELIVERY_INPUT_CHANGED','The complete host-declared source changed.',409);
  return source.bytes;
}
function base64Body(bytes,envelope){
  // Hold one verified byte snapshot. Stream base64 without constructing a second full encoded copy.
  const prefix=Buffer.from('{"content_base64":"'),tail=Buffer.from('"'+
    Object.entries(envelope).map(([key,value])=>','+JSON.stringify(key)+':'+JSON.stringify(value)).join('')+'}');
  async function* stream(){yield prefix;for(let i=0;i<bytes.length;i+=CHUNK)yield Buffer.from(bytes.subarray(i,i+CHUNK).toString('base64'));yield tail;}
  return{stream:stream(),length:prefix.length+4*Math.ceil(bytes.length/3)+tail.length};
}
export const READ_ACTIONS=new Set(['workspace.get','request.get','records.list','project.get','edition.get','contract.get',
  'binding.get','run.get','comparison.get','review.get','release.get','file.read','run.log','run.artifact','edition.diff','audit.list','runtime.get']);
export class PipelineDeliveryClient{
  #connection;#pending=new Set();#closed=false;
  constructor(connection){this.#connection=connection;}
  static async connect(path,options={}){
    const connection=await readConnection(path,options);
    if(options.expectedLaunchId)need(connection.value.launchId===options.expectedLaunchId,'PIPELINE_DELIVERY_INSTANCE_CHANGED','Reconnect to the current managed launch.',409);
    const client=new PipelineDeliveryClient(connection);
    try{await client.info();return client;}catch(error){await client.close();throw error;}
  }
  get connection(){return connectionView(this.#connection);}
  async #attach(){
    need(!this.#closed,'PIPELINE_DELIVERY_CLOSED','Reconnect this application attachment.',409);
    const c=await readConnection(this.#connection.path,{directory:this.#connection.value.directory,controlDirectory:this.#connection.value.controlDirectory});
    need(c.sha256===this.#connection.sha256,'PIPELINE_DELIVERY_INSTANCE_CHANGED','The application restarted. Reconnect to its current launch.',409);
    return c;
  }
  #verify(r,c){
    const v=r.value;
    need(r.ok&&plain(v)&&v.schema==='stellar-forge.pipeline-delivery-managed-info.v1'&&
      ['launchId','instanceId','directory','controlDirectory','applicationDirectory','programmeDirectory','sourceManifestSha256',
       'runtimeId','runtimeSelectionSha256','python','dbt','origin','pid'].every(k=>v[k]===c.value[k])&&
      v.workspaceSchema==='tjlabs.dagster-client-delivery/v1'&&v.limits?.json===MAX_JSON&&v.limits?.archive===MAX_ARCHIVE,
      'PIPELINE_DELIVERY_INSTANCE_CHANGED','The authenticated original application differs from its recorded source/runtime/installation.',409);
    return r;
  }
  async #perform(path,options,info=false){
    const work=(async()=>{
      const c=await this.#attach(),observed=this.#verify(await request(c,'/api/merchant/info',{maximum:1024*1024}),c);
      return info?observed:request(c,path,options);
    })();this.#pending.add(work);try{return await work;}finally{this.#pending.delete(work);}
  }
  info(){return this.#perform(null,null,true);}
  state(){return this.#perform('/api/state');}
  pending(){return this.#perform('/api/pending');}
  received(){return this.#perform('/api/received');}
  read(action,payload={}){
    need(READ_ACTIONS.has(action)&&plain(payload),'PIPELINE_DELIVERY_READ','Select an original read action and complete payload.');
    return this.#perform('/api/read?'+new URLSearchParams({action,payload:JSON.stringify(payload)}));
  }
  invoke(body){need(plain(body),'PIPELINE_DELIVERY_ENVELOPE','Use the complete original mutation envelope.');return this.#perform('/api/invoke',{method:'POST',body});}
  async invokeInput(file,identity){
    const bytes=await selectedBytes(file,identity,MAX_JSON);
    // Parsing before dispatch validates a complete JSON object while keeping the literal wire unchanged.
    need(plain(parse(bytes)),'PIPELINE_DELIVERY_ENVELOPE','Use one complete original JSON mutation envelope.');
    return this.#perform('/api/invoke',{method:'POST',stream:(async function*(){yield bytes;})(),length:bytes.length});
  }
  async sourceImport(file,identity,{root}={}){
    need(root===undefined||typeof root==='string','PIPELINE_DELIVERY_SOURCE_ROOT','Select the original ZIP project root.');
    const bytes=await selectedBytes(file,identity,MAX_ARCHIVE),body=base64Body(bytes,root===undefined?{}:{root});
    return this.#perform('/api/import/source',{method:'POST',...body});
  }
  async receive(file,identity,envelope){
    exact(envelope,['workspace_id','expected_revision','request_id','selection'],['workspace_id','expected_revision','request_id']);
    const bytes=await selectedBytes(file,identity,MAX_ARCHIVE);
    return this.#perform('/api/receive',{method:'POST',...base64Body(bytes,envelope)});
  }
  open(body){need(plain(body),'PIPELINE_DELIVERY_ENVELOPE','Use the complete retained original open envelope.');return this.#perform('/api/open',{method:'POST',body});}
  archive({kind,requestId,releaseId},sink){
    need(kind==='backup'||kind==='release','PIPELINE_DELIVERY_ARCHIVE_KIND','Choose the original backup or client release archive.');
    identifier(requestId,'archive request ID');if(kind==='release')identifier(releaseId,'release ID');
    need(sink===undefined||typeof sink==='function','PIPELINE_DELIVERY_SINK','Use the complete private archive receiver.');
    const path=kind==='backup'?'/api/backup':'/api/releases/'+encodeURIComponent(releaseId)+'/download';
    return this.#perform(path+'?'+new URLSearchParams({request_id:requestId}),{sink,maximum:MAX_JSON});
  }
  async browser(){
    await this.info();
    return{url:this.#connection.value.origin+'/',authentication:'Use the original Staff capability from the local private control directory; no bearer is returned by customer-agent tools.',
      launchId:this.#connection.value.launchId};
  }
  async close(){this.#closed=true;await Promise.allSettled([...this.#pending]);}
}
