// SPDX-License-Identifier: MIT
// Client and private host configuration for the externally installed original grant analyst application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONNECTION_SCHEMA='stellar-forge.grant-analyst-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.grant-analyst-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.grant-analyst-workbench-startup.v1';
export const MAX_UPLOAD=32*1024**2,MAX_ARCHIVE=1024**3+64*1024**2,MAX_JSON=64*1024**2,MAX_RESPONSE=268435456,MAX_FILE=MAX_ARCHIVE,CHUNK=1024*1024;
export const SOURCE_SCHEMA='stellar-forge.grant-analyst-workbench-source.v1';
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'GRANT_ANALYST_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'GRANT_ANALYST_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export function identifier(v,label='identifier'){need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v),'GRANT_ANALYST_IDENTIFIER','Use an original '+label+'.');return v;}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'GRANT_ANALYST_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'GRANT_ANALYST_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function ownedDirectory(path){
  path=absolute(path);const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o022)&&
    (!process.getuid||s.uid===process.getuid()),'GRANT_ANALYST_OWNED_DIRECTORY','Use an owned directory without group or world write access.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'GRANT_ANALYST_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'GRANT_ANALYST_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'GRANT_ANALYST_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'GRANT_ANALYST_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.grant-analyst-'+randomUUID()),fd=await open(temporary,'wx',0o600);
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
  need(s.isFile()&&(s.mode&0o111),'GRANT_ANALYST_EXECUTABLE','Select an installed executable.');
  // The invocation path belongs to the original virtual environment; keep it.
  return path;
}


export async function readLaunchConfiguration(path){
  const source=await readJson(path,131072),v=source.value,base=dirname(source.path);
  const required=['schema','directory','applicationDirectory','sourceManifestFile','sourceManifestSha256','connectionFile','python','actor'];
  exact(v,[...required,'port','workspaceName'],required);
  need(v.schema===LAUNCH_SCHEMA,'GRANT_ANALYST_LAUNCH_SCHEMA','Use the complete grant analyst launch configuration.');
  const at=p=>{need(typeof p==='string','GRANT_ANALYST_PATH','Select a complete host path.');return absolute(isAbsolute(p)?p:resolve(base,p));};
  const result={schema:v.schema,sourceManifestSha256:digest(v.sourceManifestSha256),actor:v.actor,
    port:integer(v.port??0,'port',65535),workspaceName:v.workspaceName??null};
  for(const k of['directory','applicationDirectory','sourceManifestFile','connectionFile','python'])result[k]=at(v[k]);
  need(typeof v.actor==='string'&&v.actor.trim()===v.actor&&v.actor.length>=1&&v.actor.length<=160&&!/[\x00-\x1f\x7f]/.test(v.actor),
    'GRANT_ANALYST_ACTOR','Select the original named operator.');
  need(result.workspaceName===null||typeof result.workspaceName==='string'&&result.workspaceName.trim()===result.workspaceName&&
    result.workspaceName.length>=1&&result.workspaceName.length<=500&&!/[\x00-\x1f\x7f]/.test(result.workspaceName),
    'GRANT_ANALYST_NAME','Select the original workspace name, or leave it unchanged for an existing workspace.');
  need(!inside(result.directory,result.applicationDirectory)&&!inside(result.applicationDirectory,result.directory),
    'GRANT_ANALYST_LAYOUT','Keep original source and mutable workspace separate.');
  const control=[source.path,result.connectionFile,result.sourceManifestFile];
  need(new Set(control).size===control.length&&![result.directory,result.applicationDirectory].some(root=>control.some(p=>inside(root,p))),
    'GRANT_ANALYST_LAYOUT','Keep private launch, connection and source authority outside exported source and workspace.');
  await ownedDirectory(dirname(result.directory));await privateDirectory(dirname(result.connectionFile));
  await readFile(result.sourceManifestFile,32*1024*1024);result.python=await executablePath(result.python);
  return{path:source.path,sha256:source.sha256,value:result};
}
export async function readConnection(path,{directory,applicationDirectory,sourceManifestSha256}={}){
  const source=await readJson(path,131072),v=source.value;
  const fields=['schema','launchId','instanceId','workspaceId','workspaceName','directory','applicationDirectory','directoryIdentity','sourceManifestFile',
    'sourceManifestSha256','python','capabilityFile','origin','pid','startedAt','actor','configurationFile','configurationSha256'];
  exact(v,fields,fields);
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&v.instanceId===v.launchId&&
    typeof v.workspaceId==='string'&&v.workspaceId.length>0&&typeof v.workspaceName==='string',
    'GRANT_ANALYST_CONNECTION','Use the current managed grant analyst connection.');
  const selected=await privateDirectory(v.directory);
  need(plain(v.directoryIdentity)&&selected.dev===v.directoryIdentity.dev&&selected.ino===v.directoryIdentity.ino&&
    (!directory||selected.path===absolute(directory))&&(!applicationDirectory||v.applicationDirectory===absolute(applicationDirectory))&&
    (!sourceManifestSha256||v.sourceManifestSha256===sourceManifestSha256),
    'GRANT_ANALYST_DIRECTORY_CHANGED','The connection selects another original installation.',409);
  for(const k of['applicationDirectory','sourceManifestFile','python','capabilityFile','configurationFile'])absolute(v[k]);
  need(![v.directory,v.applicationDirectory].some(root=>[source.path,v.capabilityFile,v.configurationFile].some(p=>inside(root,p))),
    'GRANT_ANALYST_PRIVATE_LAYOUT','Keep connection and private access material outside exports.');
  const u=new URL(v.origin);
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.origin===v.origin&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash&&Number(u.port)>0,
    'GRANT_ANALYST_ORIGIN','Use the actual managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);digest(v.sourceManifestSha256);digest(v.configurationSha256);
  need(typeof v.actor==='string'&&v.actor.length>=1&&v.actor.length<=160,'GRANT_ANALYST_CONNECTION','Retain the complete original listener identity.');
  const token=(await readFile(v.capabilityFile,4096)).bytes.toString('utf8').trim();
  need(/^[A-Za-z0-9_-]{43}$/.test(token),'GRANT_ANALYST_CAPABILITY','Use the actual original private console token.');
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
    'GRANT_ANALYST_FILENAME','The original download filename is invalid.',502);return name;
}
const READ_FIXED=new Set(['/api/state','/api/source','/api/report','/api/csv','/api/studies','/api/study-document','/api/study-release',
  '/api/learning','/api/learning-csv','/api/learning-markdown','/api/compare','/api/export','/_merchant/info','/_merchant/state','/_merchant/report']);
const READ_PATTERNS=[];
const WRITE_FIXED=new Set(['/api/import','/api/codebook','/api/review','/api/cycle-create','/api/cycle-action','/api/cycle-review',
  '/api/study-create','/api/study-questions','/api/study-scope','/api/study-evidence','/api/study-answer','/api/study-release','/_merchant/receive']);
const WRITE_PATTERNS=[];
export function originalRoute(route,query={},method='GET'){
  const fixed=method==='GET'?READ_FIXED:WRITE_FIXED,patterns=method==='GET'?READ_PATTERNS:WRITE_PATTERNS;
  need(typeof route==='string'&&(fixed.has(route)||patterns.some(p=>p.test(route))),
    'GRANT_ANALYST_ROUTE','Select an original grant analyst endpoint.');
  need(plain(query)&&Object.keys(query).length<=40,'GRANT_ANALYST_QUERY','Select the complete original query.');
  const params=new URLSearchParams();
  for(const[k,v]of Object.entries(query)){
    need(k.length>=1&&k.length<=120&&['string','number','boolean'].includes(typeof v)&&String(v).length<=16384,
      'GRANT_ANALYST_QUERY','Use complete scalar query values.');params.set(k,String(v));
  }
  return route+(params.size?'?'+params.toString():'');
}
async function request(c,path,{method='GET',body,maximum=MAX_RESPONSE,sink,signal}={}){
  const headers={origin:c.value.origin,accept:'application/json',authorization:'Bearer '+c.token};let content;
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
      'GRANT_ANALYST_RESPONSE_SIZE','Retain the complete response within the selected capacity.',502);
    const chunks=[],sha=createHash('sha256');let bytes=0;
    for await(const chunk of r.body??[]){
      bytes+=chunk.length;need(bytes<=limit,'GRANT_ANALYST_RESPONSE_SIZE','The original response exceeds its selected capacity.',502);
      sha.update(chunk);if(r.ok&&sink)await sink(chunk);else chunks.push(Buffer.from(chunk));
    }
    need(reported===null||Number(reported)===bytes,'GRANT_ANALYST_RESPONSE_INCOMPLETE','The original response ended before its declared length.',502);
    const result={ok:r.ok,status:r.status,contentType:type,sha256:sha.digest('hex'),filename:filename(r),bytes};
    if(!(r.ok&&sink)){
      result.body=Buffer.concat(chunks);
      if(isJSON){try{result.value=parse(result.body);}catch{result.value=null;result.parseError='The complete response is not valid UTF-8 JSON.';}}
    }
    return result;
  }finally{signal?.removeEventListener('abort',abort);controller.abort();}
}
function requireOK(result){
  need(result.ok&&!result.parseError,'GRANT_ANALYST_HTTP','The original grant analyst returned an error.',result.status,
    {response:result.value??null,responseSha256:result.sha256});return result;
}
export class GrantAnalystClient{
  #connection;
  get connection(){return connectionView(this.#connection);}
  static async connect(path,options={}){
    const client=new GrantAnalystClient(await readConnection(path,options),options);
    try{await client.info();return client;}catch(e){await client.close();throw e;}
  }
  constructor(connection,options={}){
    this.#connection=connection;this.options=options;this.closed=false;this.closing=null;this.tail=Promise.resolve();
    need(!options.expectedLaunchId||connection.value.launchId===options.expectedLaunchId,
      'GRANT_ANALYST_LAUNCH_CHANGED','The listener belongs to another launch.',409);
  }
  _enqueue(fn){
    need(!this.closed&&!this.closing,'GRANT_ANALYST_CLIENT_CLOSED','Reconnect to the selected original application.');
    const work=this.tail.then(fn);this.tail=work.catch(()=>{});return work;
  }
  async _current(){
    const fresh=await readConnection(this.#connection.path,this.options);
    need(fresh.sha256===this.#connection.sha256&&fresh.value.launchId===this.#connection.value.launchId,
      'GRANT_ANALYST_CONNECTION_RESTARTED','The application restarted. Reconnect explicitly before another operation.',409);return fresh;
  }
  async _request(path,options={}){return request(await this._current(),path,options);}
  info(){return this._enqueue(async()=>{
    const r=requireOK(await this._request('/_merchant/info')),v=r.value,c=connectionView(this.#connection);
    need(v?.schema===CONNECTION_SCHEMA&&['launchId','instanceId','workspaceId','workspaceName','directory','applicationDirectory','sourceManifestSha256','configurationSha256','python','pid','origin','actor']
      .every(k=>v[k]===c[k]),
      'GRANT_ANALYST_LISTENER_CHANGED','The authenticated listener differs from its complete connection.',409);return r;
  });}
  read(route,query={},options={}){
    const path=originalRoute(route,query);exact(options,['signal']);return this._enqueue(()=>this._request(path,options));
  }
  invoke(route,body,options={}){
    originalRoute(route,{},'POST');need(plain(body),'GRANT_ANALYST_INPUT','Supply the complete original JSON request.');exact(options,['signal']);
    const frozen=parse(Buffer.from(JSON.stringify(body)));return this._enqueue(()=>this._request(route,{...options,method:'POST',body:frozen}));
  }
  receiveWorkspace({archivePath,destination}){
    return this.invoke('/_merchant/receive',{archivePath:absolute(archivePath),destination:absolute(destination)});
  }
  download(route,options={}){
    exact(options,['query','path','sink','sha256','signal','maxBytes']);
    const path=originalRoute(route,options.query??{});
    need((typeof options.path==='string')!==(typeof options.sink==='function'),
      'GRANT_ANALYST_DOWNLOAD','Select exactly one private output path or full receiving sink.');
    const maximum=integer(options.maxBytes??MAX_ARCHIVE,'full download capacity',MAX_ARCHIVE,1);
    if(options.sha256!==undefined)digest(options.sha256);
    return this._enqueue(async()=>{
      if(options.sink){
        const result=await this._request(path,{sink:options.sink,maximum,signal:options.signal});
        need(!result.ok||!options.sha256||result.sha256===options.sha256,'GRANT_ANALYST_DOWNLOAD_CHANGED','The complete download differs from its selected identity.',409);
        return result;
      }
      const target=absolute(options.path);await privateDirectory(dirname(target));
      const temporary=join(dirname(target),'.grant-analyst-download-'+randomUUID()+'.part');
      const fd=await open(temporary,'wx',0o600);let closed=false;
      try{
        const result=await this._request(path,{sink:chunk=>fd.writeFile(chunk),maximum,signal:options.signal});
        await fd.sync();await fd.close();closed=true;
        if(!result.ok){await unlink(temporary);return result;}
        need(!options.sha256||result.sha256===options.sha256,'GRANT_ANALYST_DOWNLOAD_CHANGED','The complete download differs from the selected original.',409);
        await link(temporary,target);await unlink(temporary);
        const dir=await open(dirname(target),'r');try{await dir.sync();}finally{await dir.close();}
        return{...result,path:target};
      }catch(error){error.partialPath=temporary;throw error;}
      finally{if(!closed){await fd.sync().catch(()=>{});await fd.close();}}
    });
  }
  browser(){
    return this._enqueue(async()=>{await this._current();return{url:this.#connection.value.origin+'/',
      instructions:'Open the original private console URL from Applications, or add the locally retained private console token as the URL fragment. The original UI removes the fragment after retaining it in this browser session.',
      connection:connectionView(this.#connection)};});
  }
  async close(){
    if(this.closed)return;if(this.closing)return this.closing;
    this.closing=(async()=>{await this.tail;this.closed=true;})();
    try{return await this.closing;}finally{this.closing=null;}
  }
}
