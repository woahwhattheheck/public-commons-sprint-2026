// SPDX-License-Identifier: MIT
// Client and private host configuration for the externally installed original staff portal application.
import {constants} from 'node:fs';
import {open,lstat,realpath,rename,unlink,link,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const CONNECTION_SCHEMA='stellar-forge.staff-portal-workbench-connection.v1';
export const LAUNCH_SCHEMA='stellar-forge.staff-portal-workbench-launch.v1';
export const STARTUP_SCHEMA='stellar-forge.staff-portal-workbench-startup.v1';
export const MAX_UPLOAD=1073741824,MAX_ARCHIVE=MAX_UPLOAD+48*1024*1024,MAX_JSON=8388608,MAX_RESPONSE=268435456,MAX_FILE=MAX_ARCHIVE,CHUNK=1024*1024;
export const SOURCE_SCHEMA='stellar-forge.staff-portal-workbench-source.v1';
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
export const fault=(code,message,status=400,details={})=>Object.assign(new Error(message),{code,status,details});
export function need(value,code,message,status=400,details={}){if(!value)throw fault(code,message,status,details);}
export function exact(v,allowed,required=[]){
  need(plain(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k)),
    'STAFF_PORTAL_INPUT','Use the declared complete input fields.');
}
export function absolute(v){
  need(typeof v==='string'&&isAbsolute(v)&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v),
    'STAFF_PORTAL_PATH','Use an absolute host-selected path.');
  return resolve(v);
}
export function identifier(v,label='identifier'){need(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v),'STAFF_PORTAL_IDENTIFIER','Use an original '+label+'.');return v;}
export function digest(v){need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'STAFF_PORTAL_SHA256','Use the complete SHA-256.');return v;}
export function integer(v,label,max=Number.MAX_SAFE_INTEGER,min=0){
  need(Number.isSafeInteger(v)&&v>=min&&v<=max,'STAFF_PORTAL_INTEGER','Use the original whole '+label+'.');return v;
}
export const inside=(root,path)=>{const r=relative(root,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\');};
export async function ownedDirectory(path){
  path=absolute(path);const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o022)&&
    (!process.getuid||s.uid===process.getuid()),'STAFF_PORTAL_OWNED_DIRECTORY','Use an owned directory without group or world write access.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function privateDirectory(path,{create=false}={}){
  path=absolute(path);if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const s=await lstat(path);
  need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path&&!(s.mode&0o077)&&
    (!process.getuid||s.uid===process.getuid()),'STAFF_PORTAL_PRIVATE_DIRECTORY','Use an owned private directory.');
  return{path,dev:String(s.dev),ino:String(s.ino)};
}
export async function readFile(path,maximum=MAX_JSON,{privateOnly=true}={}){
  path=absolute(path);need(await realpath(path)===path,'STAFF_PORTAL_FILE','Use a canonical regular file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await fd.stat();
    need(first.isFile()&&first.size<=maximum&&(!privateOnly||!(first.mode&0o077)&&(!process.getuid||first.uid===process.getuid())),
      'STAFF_PORTAL_FILE','Use the complete regular file within its installed limit.');
    const bytes=await fd.readFile(),last=await fd.stat();
    need(bytes.length===first.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===last[k]),
      'STAFF_PORTAL_FILE_CHANGED','The selected file changed while being read.',409);
    return{path,bytes,sha256:hash(bytes)};
  }finally{await fd.close();}
}
export async function readJson(path,maximum=MAX_JSON,options){const r=await readFile(path,maximum,options);return{...r,value:parse(r.bytes)};}
export async function writePrivate(path,bytes,{replace=false}={}){
  path=absolute(path);bytes=Buffer.from(bytes);await privateDirectory(dirname(path));
  if(replace){try{await readFile(path,MAX_FILE);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const temporary=join(dirname(path),'.staff-portal-'+randomUUID()),fd=await open(temporary,'wx',0o600);
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
  need(s.isFile()&&(s.mode&0o111),'STAFF_PORTAL_EXECUTABLE','Select an installed executable.');
  // The invocation path belongs to the original virtual environment; keep it.
  return path;
}

export async function readLaunchConfiguration(path){
  const source=await readJson(path,65536),v=source.value,base=dirname(source.path);
  const required=['schema','directory','applicationDirectory','sourceManifestFile','sourceManifestSha256','connectionFile','python','actor'];
  exact(v,[...required,'expectedWorkspaceId','allowedOrigins','port','insightsLocalHttp'],required);
  need(v.schema===LAUNCH_SCHEMA,'STAFF_PORTAL_LAUNCH_SCHEMA','Use a complete staff portal launch configuration.');
  const at=p=>{need(typeof p==='string','STAFF_PORTAL_PATH','Select the original complete path.');return absolute(isAbsolute(p)?p:resolve(base,p));};
  const result={schema:v.schema,sourceManifestSha256:digest(v.sourceManifestSha256),actor:v.actor,
    port:integer(v.port??0,'port',65535),insightsLocalHttp:v.insightsLocalHttp??false,allowedOrigins:v.allowedOrigins??[]};
  for(const k of['directory','applicationDirectory','sourceManifestFile','connectionFile','python'])result[k]=at(v[k]);
  need(typeof v.actor==='string'&&v.actor.trim()===v.actor&&v.actor.length>=1&&v.actor.length<=160&&!/[\x00-\x1f\x7f]/.test(v.actor),
    'STAFF_PORTAL_ACTOR','Select the original operator name retained in saved requests.');
  need(typeof result.insightsLocalHttp==='boolean'&&Array.isArray(result.allowedOrigins)&&result.allowedOrigins.length<=100,
    'STAFF_PORTAL_ORIGINS','Declare the complete authorized native tenant origins.');
  result.allowedOrigins=result.allowedOrigins.map(origin=>{
    need(typeof origin==='string','STAFF_PORTAL_ORIGIN','Use an exact authorized native origin.');
    const u=new URL(origin);
    need(u.origin===origin&&!u.username&&!u.password&&!u.hash&&!u.search&&u.pathname==='/'&&
      (u.protocol==='https:'||result.insightsLocalHttp&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)),
      'STAFF_PORTAL_ORIGIN','Select an HTTPS native tenant or explicit local development origin.');
    return origin;
  });
  need(new Set(result.allowedOrigins).size===result.allowedOrigins.length,'STAFF_PORTAL_ORIGINS','Declare each native origin once.');
  if(v.expectedWorkspaceId!==undefined)result.expectedWorkspaceId=workspaceId(v.expectedWorkspaceId);
  need(!inside(result.directory,result.applicationDirectory)&&!inside(result.applicationDirectory,result.directory),
    'STAFF_PORTAL_LAYOUT','Keep original source and mutable workspace in separate trees.');
  need(new Set([source.path,result.connectionFile,result.sourceManifestFile]).size===3&&
    ![result.directory,result.applicationDirectory].some(root=>[source.path,result.connectionFile,result.sourceManifestFile].some(p=>inside(root,p))),
    'STAFF_PORTAL_LAYOUT','Keep private launch, source authority and generated connection outside source and workspace exports.');
  await ownedDirectory(dirname(result.directory));await privateDirectory(dirname(result.connectionFile));
  await readFile(result.sourceManifestFile,4*1024*1024);
  result.python=await executablePath(result.python);
  return{path:source.path,sha256:source.sha256,value:result};
}
export function workspaceId(value){
  need(typeof value==='string'&&/^workspace-[a-f0-9]{32}$/.test(value),'STAFF_PORTAL_WORKSPACE','Select the complete original workspace identity.');return value;
}
export async function readConnection(path,{directory,applicationDirectory,sourceManifestSha256}={}){
  const source=await readJson(path,65536),v=source.value;
  const fields=['schema','launchId','instanceId','directory','applicationDirectory','directoryIdentity','sourceManifestFile',
    'sourceManifestSha256','python','capabilityFile','origin','pid','startedAt','actor','expectedWorkspaceId','allowedOrigins','insightsLocalHttp'];
  exact(v,fields,fields.filter(x=>x!=='expectedWorkspaceId'));
  need(v.schema===CONNECTION_SCHEMA&&/^[a-f0-9-]{36}$/.test(v.launchId??'')&&v.instanceId===v.launchId,
    'STAFF_PORTAL_CONNECTION','Use the current managed staff portal connection.');
  const selected=await privateDirectory(v.directory);
  need(plain(v.directoryIdentity)&&selected.dev===v.directoryIdentity.dev&&selected.ino===v.directoryIdentity.ino&&
    (!directory||selected.path===absolute(directory))&&(!applicationDirectory||v.applicationDirectory===absolute(applicationDirectory))&&
    (!sourceManifestSha256||v.sourceManifestSha256===sourceManifestSha256),
    'STAFF_PORTAL_DIRECTORY_CHANGED','The connection selects another original installation.',409);
  for(const k of['applicationDirectory','sourceManifestFile','python','capabilityFile'])absolute(v[k]);
  need(![v.directory,v.applicationDirectory].some(root=>inside(root,source.path)||inside(root,v.capabilityFile)),
    'STAFF_PORTAL_PRIVATE_LAYOUT','Keep the private connection and access key outside customer exports.');
  const u=new URL(v.origin);
  need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.origin===v.origin&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash&&Number(u.port)>0,
    'STAFF_PORTAL_ORIGIN','Use the actual managed loopback listener.');
  integer(v.pid,'listener PID',Number.MAX_SAFE_INTEGER,1);digest(v.sourceManifestSha256);
  need(typeof v.actor==='string'&&v.actor.length>=1&&v.actor.length<=160,'STAFF_PORTAL_ACTOR','Select the original operator.');
  const token=(await readFile(v.capabilityFile,4096)).bytes.toString('utf8').trim();
  need(token.length>=40&&token.length<=1024&&!/[\s\x00-\x1f\x7f]/.test(token),'STAFF_PORTAL_CAPABILITY','Use the original private access key.');
  return{path:source.path,sha256:source.sha256,value:v,token};
}
export function connectionView(c){
  const{capabilityFile,...value}=c.value;return structuredClone(value);
}
function filename(response){
  const h=response.headers.get('content-disposition');if(!h)return null;
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(h),simple=/(?:^|;)\s*filename="([^"]+)"/i.exec(h);
  let name=encoded?decodeURIComponent(encoded[1]):simple?.[1];
  need(typeof name==='string'&&name.length<=1024&&!/[\\/\x00-\x1f\x7f]/.test(name)&&!['.','..'].includes(name),
    'STAFF_PORTAL_FILENAME','The original download filename is invalid.',502);return name;
}
const READ_ROUTES=new Set(['/api/session','/api/workspaces','/api/state','/api/view','/api/preview','/api/report','/api/download',
  '/api/insights/connection','/api/portal/context','/api/portal/view','/api/portal/preview','/api/portal/report','/api/portal/download','/api/merchant/info']);
const WRITE_ROUTES=new Set(['/api/workspaces/select','/api/workspaces','/api/receive','/api/mutate','/api/portal/operation',
  '/api/insights/connect','/api/insights/disconnect','/api/insights/start','/api/insights/capture']);
export function originalRoute(route,query={},method='GET'){
  need(typeof route==='string'&&(method==='GET'?(READ_ROUTES.has(route)||/^\/api\/object\/[a-f0-9]{64}$/.test(route)):WRITE_ROUTES.has(route)),
    'STAFF_PORTAL_ROUTE','Select an original staff portal endpoint.');
  need(plain(query)&&Object.keys(query).length<=40,'STAFF_PORTAL_QUERY','Select the complete original query.');
  const params=new URLSearchParams();
  for(const[k,v]of Object.entries(query)){
    need(typeof k==='string'&&k.length>=1&&k.length<=120&&['string','number','boolean'].includes(typeof v)&&
      String(v).length<=16384,'STAFF_PORTAL_QUERY','Use complete scalar query values.');
    params.set(k,String(v));
  }
  return route+(params.size?'?'+params.toString():'');
}
async function request(c,path,{method='GET',body,stream,length,headers:extra={},maximum=MAX_RESPONSE,sink,contentType='application/json'}={}){
  const headers={origin:c.value.origin,accept:'application/json',...extra};let content;
  if(body!==undefined){content=Buffer.from(JSON.stringify(body));length=content.length;integer(length,'JSON request bytes',MAX_JSON);}
  else if(stream!==undefined){content=stream;integer(length,'upload bytes',MAX_UPLOAD);}
  if(content!==undefined){headers['content-type']=contentType;headers['content-length']=String(length);}
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);
  try{
    const r=await fetch(c.value.origin+path,{method,headers,body:content,signal:controller.signal,redirect:'error',...(stream?{duplex:'half'}:{})});
    const type=r.headers.get('content-type')||'',isJSON=/^application\/json(?:;|$)/i.test(type);
    const limit=r.ok&&!isJSON?MAX_ARCHIVE:maximum,reported=r.headers.get('content-length');
    if(reported!==null)need(/^\d+$/.test(reported)&&Number(reported)<=limit,'STAFF_PORTAL_RESPONSE_SIZE','Retain the complete response within its installed capacity.',502);
    const chunks=[],sha=createHash('sha256');let bytes=0;
    for await(const chunk of r.body??[]){
      bytes+=chunk.length;need(bytes<=limit,'STAFF_PORTAL_RESPONSE_SIZE','The original response exceeds its installed capacity.',502);
      sha.update(chunk);if(r.ok&&sink)await sink(chunk);else chunks.push(Buffer.from(chunk));
    }
    need(reported===null||Number(reported)===bytes,'STAFF_PORTAL_RESPONSE_INCOMPLETE','The original response ended before its declared length.',502);
    const result={ok:r.ok,status:r.status,contentType:type,sha256:sha.digest('hex'),filename:filename(r),bytes:r.ok&&sink?bytes:Buffer.concat(chunks)};
    if(isJSON&&!(r.ok&&sink)){try{result.value=parse(result.bytes);}catch{result.value=null;result.parseError='The complete original response is not valid UTF-8 JSON.';}}
    const cookie=r.headers.get('set-cookie');return{result,cookie};
  }finally{clearTimeout(timeout);controller.abort();}
}
function requireOK(result){
  need(result.ok&&!result.parseError,'STAFF_PORTAL_HTTP','The original staff portal returned an error.',result.status,
    {response:result.value??null,responseSha256:result.sha256});return result;
}
export class StaffPortalClient{
  #connection;#cookie;#csrf;
  get connection(){return connectionView(this.#connection);}
  static async connect(path,options={}){
    const client=new StaffPortalClient(await readConnection(path,options),options);
    try{await client._authenticate();await client.info();return client;}catch(e){await client.close().catch(()=>{});throw e;}
  }
  constructor(connection,options={}){
    this.#connection=connection;this.options=options;this.#cookie=null;this.#csrf=null;this.selected=null;
    this.closed=false;this.closing=null;this.tail=Promise.resolve();
    need(!options.expectedLaunchId||connection.value.launchId===options.expectedLaunchId,'STAFF_PORTAL_LAUNCH_CHANGED','The listener belongs to another launch.',409);
  }
  _enqueue(fn){
    need(!this.closed&&!this.closing,'STAFF_PORTAL_CLIENT_CLOSED','Reconnect to the selected original application.');
    const work=this.tail.then(fn);this.tail=work.catch(()=>{});return work;
  }
  async _current(){
    const fresh=await readConnection(this.#connection.path,this.options);
    need(fresh.sha256===this.#connection.sha256&&fresh.value.launchId===this.#connection.value.launchId,
      'STAFF_PORTAL_CONNECTION_RESTARTED','The original application restarted. Reconnect explicitly before another operation.',409);
    return fresh;
  }
  async _authenticate(){
    const c=await this._current(),{result,cookie}=await request(c,'/api/session',{method:'POST',body:{accessKey:c.token,actor:c.value.actor}});
    requireOK(result);const v=result.value;
    need(v?.authenticated===true&&v.actor===c.value.actor&&typeof v.csrfToken==='string'&&typeof cookie==='string',
      'STAFF_PORTAL_SESSION','The original authenticated session is incomplete.',502);
    const match=/^dam_session=([A-Za-z0-9_-]+);/.exec(cookie);
    need(match,'STAFF_PORTAL_SESSION','The original session cookie is missing.',502);
    this.#cookie='dam_session='+match[1];this.#csrf=v.csrfToken;this.selected=workspaceId(v.workspaceId);
    if(c.value.expectedWorkspaceId&&this.selected!==c.value.expectedWorkspaceId)
      requireOK(await this._request('/api/workspaces/select',{method:'POST',body:{workspaceId:c.value.expectedWorkspaceId}}));
  }
  async _request(path,options={}){
    const c=await this._current(),headers={cookie:this.#cookie,'X-DAM-Workspace-ID':this.selected,
      ...(options.method==='POST'?{'X-DAM-CSRF':this.#csrf}:{}),...options.headers};
    const{result}=await request(c,path,{...options,headers});
    if(result.ok&&options.method==='POST'&&['/api/workspaces/select','/api/workspaces','/api/receive'].includes(path)){
      need(result.value?.workspaceId,'STAFF_PORTAL_SESSION','The original selection response is incomplete.',502);
      this.selected=workspaceId(result.value.workspaceId);
    }
    return result;
  }
  info(){return this._enqueue(async()=>{
    const r=requireOK(await this._request('/api/merchant/info')),v=r.value,c=this.#connection.value;
    need(v?.schema===CONNECTION_SCHEMA&&['launchId','instanceId','directory','applicationDirectory','sourceManifestSha256','python','pid','origin','actor']
      .every(k=>v[k]===c[k]),'STAFF_PORTAL_LISTENER_CHANGED','The authenticated listener differs from its complete connection.',409);
    return r;
  });}
  session(){return this.read('/api/session');}
  workspaces(){return this.read('/api/workspaces');}
  select(id){workspaceId(id);return this.invoke('/api/workspaces/select',{workspaceId:id});}
  state(options={}){return this.read('/api/state',{},options);}
  read(route,query={},options={}){const path=originalRoute(route,query);exact(options,['workspaceId']);const headers=options.workspaceId?{'X-DAM-Workspace-ID':workspaceId(options.workspaceId)}:{};return this._enqueue(()=>this._request(path,{headers}));}
  invoke(route,body,options={}){
    originalRoute(route,{},'POST');need(plain(body),'STAFF_PORTAL_INPUT','Supply the complete original JSON request.');
    exact(options,['workspaceId']);const headers=options.workspaceId?{'X-DAM-Workspace-ID':workspaceId(options.workspaceId)}:{};
    const frozen=parse(Buffer.from(JSON.stringify(body)));return this._enqueue(()=>this._request(route,{method:'POST',body:frozen,headers}));
  }
  upload(input,options={}){
    exact(options,['workspaceId']);const selectedHeaders=options.workspaceId?{'X-DAM-Workspace-ID':workspaceId(options.workspaceId)}:{};
    exact(input,['path','sha256','bytes','name','contentType','requestId'],['path','sha256','bytes','name','contentType','requestId']);
    const selected={...input,path:absolute(input.path),sha256:digest(input.sha256),bytes:integer(input.bytes,'original input bytes',MAX_UPLOAD)};
    need(typeof input.name==='string'&&input.name.length>=1&&input.name.length<=4096&&typeof input.contentType==='string'&&
      input.contentType.length>=1&&input.contentType.length<=200&&typeof input.requestId==='string'&&input.requestId.length>=1&&input.requestId.length<=200,
      'STAFF_PORTAL_UPLOAD','Select complete original upload metadata and request ID.');
    return this._enqueue(async()=>{
      need(await realpath(selected.path)===selected.path,'STAFF_PORTAL_INPUT','Select a canonical original file.');
      const fd=await open(selected.path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const first=await fd.stat();need(first.isFile()&&first.size===selected.bytes,'STAFF_PORTAL_INPUT_CHANGED','The original input size changed.',409);
        const sha=createHash('sha256'),chunk=Buffer.alloc(CHUNK);let position=0;
        while(position<first.size){const r=await fd.read(chunk,0,Math.min(CHUNK,first.size-position),position);need(r.bytesRead>0,'STAFF_PORTAL_INPUT_CHANGED','The selected input ended early.',409);sha.update(chunk.subarray(0,r.bytesRead));position+=r.bytesRead;}
        const before=await fd.stat();
        need(sha.digest('hex')===selected.sha256&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===before[k]),
          'STAFF_PORTAL_INPUT_CHANGED','The complete original upload changed before dispatch.',409);
        async function* stream(){let position=0;while(position<first.size){const b=Buffer.alloc(Math.min(CHUNK,first.size-position));const r=await fd.read(b,0,b.length,position);need(r.bytesRead>0,'STAFF_PORTAL_INPUT_CHANGED','The selected upload ended early.',409);position+=r.bytesRead;yield b.subarray(0,r.bytesRead);}}
        const q=new URLSearchParams({name:selected.name,contentType:selected.contentType});
        const result=await this._request('/api/upload?'+q,{method:'POST',stream:stream(),length:selected.bytes,contentType:'application/octet-stream',
          headers:{...selectedHeaders,'X-DAM-Request-ID':selected.requestId}});
        const after=await fd.stat();
        need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>first[k]===after[k]),'STAFF_PORTAL_INPUT_CHANGED',
          'The original upload changed during dispatch. Inspect the same original request before continuing.',409,{response:result.value??null,responseSha256:result.sha256});
        if(result.ok)need(result.value?.object?.sha256===selected.sha256&&result.value.object.bytes===selected.bytes,
          'STAFF_PORTAL_UPLOAD_CHANGED','The original retained upload differs from the selected complete input.',502,{response:result.value??null});
        return result;
      }finally{await fd.close();}
    });
  }
  download(route,query={},output={}){
    const path=originalRoute(route,query);exact(output,['path','sink','sha256','workspaceId']);
    need((typeof output.path==='string')!==(typeof output.sink==='function'),'STAFF_PORTAL_DOWNLOAD','Select exactly one owned output path or complete receiving sink.');
    if(output.sink){
      if(output.sha256!==undefined)digest(output.sha256);
      const headers=output.workspaceId?{'X-DAM-Workspace-ID':workspaceId(output.workspaceId)}:{};
      return this._enqueue(async()=>{const result=await this._request(path,{headers,sink:output.sink});
        need(!result.ok||!output.sha256||result.sha256===output.sha256,'STAFF_PORTAL_DOWNLOAD_CHANGED','The complete download differs from the selected original.',409);return result;});
    }
    const target=absolute(output.path);if(output.sha256!==undefined)digest(output.sha256);
    const selectedHeaders=output.workspaceId?{'X-DAM-Workspace-ID':workspaceId(output.workspaceId)}:{};
    return this._enqueue(async()=>{
      await privateDirectory(dirname(target));const temporary=join(dirname(target),'.staff-portal-download-'+randomUUID());
      const fd=await open(temporary,'wx',0o600);let closed=false;
      try{
        const result=await this._request(path,{headers:selectedHeaders,sink:chunk=>fd.writeFile(chunk)});
        await fd.sync();await fd.close();closed=true;
        if(!result.ok){await unlink(temporary);return result;}
        need(!output.sha256||result.sha256===output.sha256,'STAFF_PORTAL_DOWNLOAD_CHANGED','The complete download differs from the selected original.',409);
        await link(temporary,target);await unlink(temporary);
        const dir=await open(dirname(target),'r');try{await dir.sync();}finally{await dir.close();}
        return{...result,path:target};
      }finally{if(!closed)await fd.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    });
  }
  browser(view='portal'){
    need(['portal','migration','insights','editorial'].includes(view),'STAFF_PORTAL_VIEW','Select an installed original application view.');
    return this._enqueue(async()=>{await this._current();return{url:this.#connection.value.origin+'/'+view,view,
      instructions:'Open the private managed access-key file locally to unlock the original application. Keep the key out of shared messages and tool arguments.',
      connection:connectionView(this.#connection)};});
  }
  async close(){
    if(this.closed)return;if(this.closing)return this.closing;
    this.closing=(async()=>{
      await this.tail;
      if(this.#cookie){try{await this._request('/api/lock',{method:'POST',body:{}});}finally{this.#cookie=null;this.#csrf=null;}}
      this.closed=true;
    })();try{return await this.closing;}finally{this.closing=null;}
  }
}
