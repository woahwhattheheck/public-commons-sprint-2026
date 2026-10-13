// SPDX-License-Identifier: MIT
// Client and private host configuration for the externally installed original catalogue delivery application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONNECTION_SCHEMA='stellar-forge.catalogue-delivery-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.catalogue-delivery-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.catalogue-delivery-workbench-startup.v1';
export const MAX_UPLOAD=2*1024**3,MAX_ARCHIVE=4*1024**3,MAX_JSON=8388608,MAX_RESPONSE=268435456,MAX_FILE=MAX_ARCHIVE,CHUNK=1024*1024;
export const SOURCE_SCHEMA='stellar-forge.catalogue-delivery-workbench-source.v1';
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'CATALOGUE_DELIVERY_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'CATALOGUE_DELIVERY_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export function identifier(v,label='identifier'){need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v),'CATALOGUE_DELIVERY_IDENTIFIER','Use an original '+label+'.');return v;}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'CATALOGUE_DELIVERY_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'CATALOGUE_DELIVERY_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function ownedDirectory(path){
  path=absolute(path);const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o022)&&
    (!process.getuid||s.uid===process.getuid()),'CATALOGUE_DELIVERY_OWNED_DIRECTORY','Use an owned directory without group or world write access.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'CATALOGUE_DELIVERY_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'CATALOGUE_DELIVERY_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'CATALOGUE_DELIVERY_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'CATALOGUE_DELIVERY_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.catalogue-delivery-'+randomUUID()),fd=await open(temporary,'wx',0o600);
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
  need(s.isFile()&&(s.mode&0o111),'CATALOGUE_DELIVERY_EXECUTABLE','Select an installed executable.');
  // The invocation path belongs to the original virtual environment; keep it.
  return path;
}


export function environmentName(value){
  need(typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,127}$/.test(value)&&
    !/^(?:HOME|PATH|SHELL|USER|LOGNAME|PWD|TMPDIR|VIRTUAL_ENV|XDG_.*|PYTHON.*|LD_.*|NODE_.*|CATALOGUE_DELIVERY_LEASE_ROOT|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/.test(value),
    'CATALOGUE_DELIVERY_ENVIRONMENT','Select an explicit service credential environment name.');return value;
}
export async function readLaunchConfiguration(path){
  const source=await readJson(path,131072),v=source.value,base=dirname(source.path);
  const required=['schema','directory','applicationDirectory','sourceManifestFile','sourceManifestSha256','connectionFile','python','actor'];
  exact(v,[...required,'port','worker','environment','leaseRoot'],required);
  need(v.schema===LAUNCH_SCHEMA,'CATALOGUE_DELIVERY_LAUNCH_SCHEMA','Use the complete catalogue delivery launch configuration.');
  const at=p=>{need(typeof p==='string','CATALOGUE_DELIVERY_PATH','Select a complete host path.');return absolute(isAbsolute(p)?p:resolve(base,p));};
  const result={schema:v.schema,sourceManifestSha256:digest(v.sourceManifestSha256),actor:v.actor,
    port:integer(v.port??0,'port',65535),worker:v.worker??false,environment:{},leaseRoot:v.leaseRoot===undefined||v.leaseRoot===null?null:at(v.leaseRoot)};
  for(const k of['directory','applicationDirectory','sourceManifestFile','connectionFile','python'])result[k]=at(v[k]);
  need(typeof v.actor==='string'&&v.actor.trim()===v.actor&&v.actor.length>=1&&v.actor.length<=160&&!/[\x00-\x1f\x7f]/.test(v.actor),
    'CATALOGUE_DELIVERY_ACTOR','Select the original named operator.');
  need(typeof result.worker==='boolean'&&plain(v.environment??{})&&Object.keys(v.environment??{}).length<=100,
    'CATALOGUE_DELIVERY_ENVIRONMENT','Declare whether the original worker runs and the service credential file mapping.');
  need(!inside(result.directory,result.applicationDirectory)&&!inside(result.applicationDirectory,result.directory),
    'CATALOGUE_DELIVERY_LAYOUT','Keep the original source and mutable workspace separate.');
  if(result.leaseRoot){
    need(!inside(result.leaseRoot,result.directory)&&
      !inside(result.applicationDirectory,result.leaseRoot)&&!inside(result.leaseRoot,result.applicationDirectory),
      'CATALOGUE_DELIVERY_LEASE_LAYOUT','Preserve the selected original request journal separately from application source and above neither source nor workspace.');
    // Original Store accepts its journal within the workspace. Keep that exact
    // identity when reopening a delivered operation, including a new nested path.
    let parent=dirname(result.leaseRoot);
    for(;;){try{await ownedDirectory(parent);break;}catch(e){if(e.code!=='ENOENT')throw e;const next=dirname(parent);if(next===parent)throw e;parent=next;}}
    try{await privateDirectory(result.leaseRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const control=[source.path,result.connectionFile,result.sourceManifestFile];
  for(const[name,descriptor]of Object.entries(v.environment??{})){
    environmentName(name);exact(descriptor,['file','bytes','sha256'],['file','bytes','sha256']);
    const entry={file:at(descriptor.file),bytes:integer(descriptor.bytes,'credential file bytes',16384,1),sha256:digest(descriptor.sha256)};
    need(!control.includes(entry.file),'CATALOGUE_DELIVERY_SECRET_LAYOUT','Keep credential files separate from configuration, connection and source authority.');
    const selected=await readFile(entry.file,16384);
    need(selected.bytes.length===entry.bytes&&selected.sha256===entry.sha256,'CATALOGUE_DELIVERY_SECRET_CHANGED','The selected private service credential file changed.',409);
    result.environment[name]=entry;
  }
  need(new Set(control).size===control.length&&![result.directory,result.applicationDirectory].some(root=>
    [...control,...Object.values(result.environment).map(v=>v.file)].some(p=>inside(root,p))),
    'CATALOGUE_DELIVERY_LAYOUT','Keep configuration, source authority, generated connection and credentials outside exported source and workspace.');
  await ownedDirectory(dirname(result.directory));await privateDirectory(dirname(result.connectionFile));
  await readFile(result.sourceManifestFile,32*1024*1024);result.python=await executablePath(result.python);
  return{path:source.path,sha256:source.sha256,value:result};
}
export async function readConnection(path,{directory,applicationDirectory,sourceManifestSha256}={}){
  const source=await readJson(path,131072),v=source.value;
  const fields=['schema','launchId','instanceId','directory','applicationDirectory','directoryIdentity','sourceManifestFile',
    'sourceManifestSha256','python','capabilityFile','origin','pid','startedAt','actor','worker','environmentNames','configurationFile','configurationSha256','leaseRoot'];
  exact(v,fields,fields);
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&v.instanceId===v.launchId,
    'CATALOGUE_DELIVERY_CONNECTION','Use the current managed catalogue delivery connection.');
  const selected=await privateDirectory(v.directory);
  need(plain(v.directoryIdentity)&&selected.dev===v.directoryIdentity.dev&&selected.ino===v.directoryIdentity.ino&&
    (!directory||selected.path===absolute(directory))&&(!applicationDirectory||v.applicationDirectory===absolute(applicationDirectory))&&
    (!sourceManifestSha256||v.sourceManifestSha256===sourceManifestSha256),
    'CATALOGUE_DELIVERY_DIRECTORY_CHANGED','The connection selects another original installation.',409);
  for(const k of['applicationDirectory','sourceManifestFile','python','capabilityFile','configurationFile'])absolute(v[k]);
  need(![v.directory,v.applicationDirectory].some(root=>[source.path,v.capabilityFile,v.configurationFile].some(p=>inside(root,p))),
    'CATALOGUE_DELIVERY_PRIVATE_LAYOUT','Keep the connection and private access material outside exports.');
  const u=new URL(v.origin);
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.origin===v.origin&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash&&Number(u.port)>0,
    'CATALOGUE_DELIVERY_ORIGIN','Use the actual managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);digest(v.sourceManifestSha256);digest(v.configurationSha256);
  need(typeof v.actor==='string'&&v.actor.length>=1&&v.actor.length<=160&&typeof v.worker==='boolean'&&Array.isArray(v.environmentNames)&&
    new Set(v.environmentNames).size===v.environmentNames.length,'CATALOGUE_DELIVERY_CONNECTION','Retain the complete original listener identity.');
  v.environmentNames.forEach(environmentName);if(v.leaseRoot!==null)absolute(v.leaseRoot);
  const token=(await readFile(v.capabilityFile,4096)).bytes.toString('utf8').trim();
  need(token.length>=40&&token.length<=1024&&!/[\s\x00-\x1f\x7f]/.test(token),'CATALOGUE_DELIVERY_CAPABILITY','Use the original private workbench token.');
  return{path:source.path,sha256:source.sha256,value:v,token};
}
export function connectionView(c){
  const{capabilityFile,configurationFile,...value}=c.value;return structuredClone(value);
}
function filename(response){
  const h=response.headers.get('content-disposition');if(!h)return null;
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(h),simple=/(?:^|;)\s*filename="([^"]+)"/i.exec(h);
  const name=encoded?decodeURIComponent(encoded[1]):simple?.[1];
  need(typeof name==='string'&&name.length<=1024&&!/[\\/\x00-\x1f\x7f]/.test(name)&&!['.','..'].includes(name),
    'CATALOGUE_DELIVERY_FILENAME','The original download filename is invalid.',502);return name;
}
const READ_FIXED=new Set(['/api/status','/api/implementation-template','/api/implementations','/api/approval/status',
  '/_merchant/info','/_merchant/catalogue']);
const READ_PATTERNS=[
  /^\/api\/implementations\/[a-f0-9]{24}(?:\/deployment|\/comparisons\/[a-z][a-z0-9_-]{0,63})?$/,
  /^\/api\/(?:implementation-exports|exports|sources)\/[a-f0-9]{24}\/download$/,
  /^\/api\/records\/(?:sources|targets|plans|jobs|feeds)\/[a-f0-9]{24}$/,
  /^\/api\/jobs\/[a-f0-9]{24}\/exports$/,
  /^\/api\/approval\/records\/[a-f0-9]{24}(?:\/exports)?$/,
  /^\/api\/approval\/exports\/[a-f0-9]{24}\/download$/];
const WRITE_FIXED=new Set(['/api/implementations','/api/implementations/inspect','/api/sources/path','/api/targets','/api/plans',
  '/api/jobs','/api/feeds','/api/tick','/api/approval/profiles','/api/approval/track',
  '/_merchant/call','/_merchant/resource','/_merchant/implementation/receive']);
const WRITE_PATTERNS=[
  /^\/api\/implementations\/[a-f0-9]{24}\/(?:plan|queue|adopt-job|bind-target|advance|receiving|feeds|export)$/,
  /^\/api\/jobs\/[a-f0-9]{24}\/(?:run|pause|resume|accept-metadata|confirm-finished|export)$/,
  /^\/api\/feeds\/[a-f0-9]{24}\/(?:enabled|replace)$/,
  /^\/api\/approval\/records\/[a-f0-9]{24}\/(?:refresh|notes|request|approve|reject|export)$/,
  /^\/api\/approval\/operations\/[a-f0-9]{24}\/(?:reconcile|resume)$/];
export function originalRoute(route,query={},method='GET'){
  const fixed=method==='GET'?READ_FIXED:WRITE_FIXED,patterns=method==='GET'?READ_PATTERNS:WRITE_PATTERNS;
  need(typeof route==='string'&&(fixed.has(route)||patterns.some(p=>p.test(route))),
    'CATALOGUE_DELIVERY_ROUTE','Select an original catalogue delivery endpoint.');
  need(plain(query)&&Object.keys(query).length<=40,'CATALOGUE_DELIVERY_QUERY','Select the complete original query.');
  const params=new URLSearchParams();
  for(const[k,v]of Object.entries(query)){
    need(k.length>=1&&k.length<=120&&['string','number','boolean'].includes(typeof v)&&String(v).length<=16384,
      'CATALOGUE_DELIVERY_QUERY','Use complete scalar query values.');params.set(k,String(v));
  }
  return route+(params.size?'?'+params.toString():'');
}
async function request(c,path,{method='GET',body,maximum=MAX_RESPONSE,sink,signal}={}){
  const headers={origin:c.value.origin,accept:'application/json','X-Workspace-Token':c.token};let content;
  if(body!==undefined){
    content=Buffer.from(JSON.stringify(body));integer(content.length,'JSON request bytes',MAX_JSON);
    headers['content-type']='application/json';headers['content-length']=String(content.length);
  }
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  try{
    const r=await fetch(c.value.origin+path,{method,headers,body:content,signal:controller.signal,redirect:'error'});
    const type=r.headers.get('content-type')||'',isJSON=/^application\/json(?:;|$)/i.test(type);
    const limit=r.ok&&sink?maximum:Math.min(maximum,MAX_RESPONSE),reported=r.headers.get('content-length');
    if(reported!==null)need(/^\d+$/.test(reported)&&Number(reported)<=limit,
      'CATALOGUE_DELIVERY_RESPONSE_SIZE','Retain the complete response within the selected capacity.',502);
    const chunks=[],sha=createHash('sha256');let bytes=0;
    for await(const chunk of r.body??[]){
      bytes+=chunk.length;need(bytes<=limit,'CATALOGUE_DELIVERY_RESPONSE_SIZE','The original response exceeds its selected capacity.',502);
      sha.update(chunk);if(r.ok&&sink)await sink(chunk);else chunks.push(Buffer.from(chunk));
    }
    need(reported===null||Number(reported)===bytes,'CATALOGUE_DELIVERY_RESPONSE_INCOMPLETE','The original response ended before its declared length.',502);
    const result={ok:r.ok,status:r.status,contentType:type,sha256:sha.digest('hex'),filename:filename(r),bytes};
    if(!(r.ok&&sink)){
      result.body=Buffer.concat(chunks);
      if(isJSON){try{result.value=parse(result.body);}catch{result.value=null;result.parseError='The complete response is not valid UTF-8 JSON.';}}
    }
    return result;
  }finally{signal?.removeEventListener('abort',abort);controller.abort();}
}
function requireOK(result){
  need(result.ok&&!result.parseError,'CATALOGUE_DELIVERY_HTTP','The original catalogue delivery returned an error.',result.status,
    {response:result.value??null,responseSha256:result.sha256});return result;
}
export class CatalogueDeliveryClient{
  #connection;
  get connection(){return connectionView(this.#connection);}
  static async connect(path,options={}){
    const client=new CatalogueDeliveryClient(await readConnection(path,options),options);
    try{await client.info();return client;}catch(e){await client.close();throw e;}
  }
  constructor(connection,options={}){
    this.#connection=connection;this.options=options;this.closed=false;this.closing=null;this.tail=Promise.resolve();
    need(!options.expectedLaunchId||connection.value.launchId===options.expectedLaunchId,
      'CATALOGUE_DELIVERY_LAUNCH_CHANGED','The listener belongs to another launch.',409);
  }
  _enqueue(fn){
    need(!this.closed&&!this.closing,'CATALOGUE_DELIVERY_CLIENT_CLOSED','Reconnect to the selected original application.');
    const work=this.tail.then(fn);this.tail=work.catch(()=>{});return work;
  }
  async _current(){
    const fresh=await readConnection(this.#connection.path,this.options);
    need(fresh.sha256===this.#connection.sha256&&fresh.value.launchId===this.#connection.value.launchId,
      'CATALOGUE_DELIVERY_CONNECTION_RESTARTED','The application restarted. Reconnect explicitly before another operation.',409);return fresh;
  }
  async _request(path,options={}){return request(await this._current(),path,options);}
  info(){return this._enqueue(async()=>{
    const r=requireOK(await this._request('/_merchant/info')),v=r.value,c=connectionView(this.#connection);
    need(v?.schema===CONNECTION_SCHEMA&&['launchId','instanceId','directory','applicationDirectory','sourceManifestSha256','configurationSha256','python','pid','origin','actor','worker','leaseRoot']
      .every(k=>v[k]===c[k])&&JSON.stringify(v.environmentNames)===JSON.stringify(c.environmentNames),
      'CATALOGUE_DELIVERY_LISTENER_CHANGED','The authenticated listener differs from its complete connection.',409);return r;
  });}
  read(route,query={},options={}){
    const path=originalRoute(route,query);exact(options,['signal']);return this._enqueue(()=>this._request(path,options));
  }
  invoke(route,body,options={}){
    originalRoute(route,{},'POST');need(plain(body),'CATALOGUE_DELIVERY_INPUT','Supply the complete original JSON request.');exact(options,['signal']);
    const frozen=parse(Buffer.from(JSON.stringify(body)));return this._enqueue(()=>this._request(route,{...options,method:'POST',body:frozen}));
  }
  catalogue(){return this.read('/_merchant/catalogue');}
  call(name,args={}){
    need(typeof name==='string'&&/^catalogue_[a-z_]+$/.test(name)&&plain(args),
      'CATALOGUE_DELIVERY_TOOL','Select an original catalogue tool and its complete arguments.');
    return this.invoke('/_merchant/call',{name,arguments:args});
  }
  resource(uri){
    need(typeof uri==='string'&&uri.length>=1&&uri.length<=1024,'CATALOGUE_DELIVERY_RESOURCE','Select a complete original resource URI.');
    return this.invoke('/_merchant/resource',{uri});
  }
  implementationReceive({archivePath,destination}){
    return this.invoke('/_merchant/implementation/receive',{archivePath:absolute(archivePath),destination:absolute(destination)});
  }
  download(route,options={}){
    exact(options,['query','path','sink','sha256','signal','maxBytes']);
    const path=originalRoute(route,options.query??{});
    need((typeof options.path==='string')!==(typeof options.sink==='function'),
      'CATALOGUE_DELIVERY_DOWNLOAD','Select exactly one private output path or full receiving sink.');
    const maximum=integer(options.maxBytes??MAX_ARCHIVE,'full download capacity',MAX_ARCHIVE,1);
    if(options.sha256!==undefined)digest(options.sha256);
    return this._enqueue(async()=>{
      if(options.sink){
        const result=await this._request(path,{sink:options.sink,maximum,signal:options.signal});
        need(!result.ok||!options.sha256||result.sha256===options.sha256,'CATALOGUE_DELIVERY_DOWNLOAD_CHANGED','The complete download differs from its selected identity.',409);
        return result;
      }
      const target=absolute(options.path);await privateDirectory(dirname(target));
      const temporary=join(dirname(target),'.catalogue-delivery-download-'+randomUUID()+'.part');
      const fd=await open(temporary,'wx',0o600);let closed=false;
      try{
        const result=await this._request(path,{sink:chunk=>fd.writeFile(chunk),maximum,signal:options.signal});
        await fd.sync();await fd.close();closed=true;
        if(!result.ok){await unlink(temporary);return result;}
        need(!options.sha256||result.sha256===options.sha256,'CATALOGUE_DELIVERY_DOWNLOAD_CHANGED','The complete download differs from the selected original.',409);
        await link(temporary,target);await unlink(temporary);
        const dir=await open(dirname(target),'r');try{await dir.sync();}finally{await dir.close();}
        return{...result,path:target};
      }catch(error){error.partialPath=temporary;throw error;}
      finally{if(!closed){await fd.sync().catch(()=>{});await fd.close();}}
    });
  }
  browser(view='catalogue'){
    need(['catalogue','implementation','approval'].includes(view),'CATALOGUE_DELIVERY_VIEW','Select an original application view.');
    return this._enqueue(async()=>{await this._current();return{url:this.#connection.value.origin+(view==='catalogue'?'/':'/'+view),
      view,connection:connectionView(this.#connection)};});
  }
  async close(){
    if(this.closed)return;if(this.closing)return this.closing;
    this.closing=(async()=>{await this.tail;this.closed=true;})();
    try{return await this.closing;}finally{this.closing=null;}
  }
}
