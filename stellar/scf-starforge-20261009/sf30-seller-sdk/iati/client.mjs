// MIT. Original IATI console client. All values and native query parameters retain their source strings.
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
const HASH=/^[0-9a-f]{64}$/;
const problem=(code,message)=>Object.assign(new Error(message),{code:'IATI_'+code});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=value=>{if(!HASH.test(value??''))throw problem('SELECTION','Use the full retained source, plan, build or portfolio SHA-256.');return value;};
const revision=value=>{if(value!==undefined&&(!Number.isSafeInteger(value)||value<1))throw problem('REVISION','Select a positive original portfolio revision.');return value;};
const query=values=>{const q=new URLSearchParams();for(const[key,value]of Object.entries(values))if(value!==undefined)q.set(key,String(value));return q.toString();};

/** Connect to the exact private URL printed by the original local IATI server.
 * The client borrows that running workspace and never stops its process.
 * Calling dispose aborts only this client's pending HTTP reads and requests.
 */
export class IatiWorkspaceClient{
 #origin;#token;#controller=new AbortController();#pending=new Set();#closed=false;#timeout;
 constructor(consoleUrl,{timeoutMs=240000}={}){
  let selected;try{selected=new URL(consoleUrl);}catch{throw problem('CONNECTION','Use the original private console URL.');}
  if(selected.protocol!=='http:'||selected.hostname!=='127.0.0.1'||!selected.port||
    selected.pathname!=='/'||selected.username||selected.password||selected.search||
    !/^[A-Za-z0-9_-]{32,256}$/.test(selected.hash.slice(1)))
    throw problem('CONNECTION','Use the complete loopback console URL without altering its private fragment.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>900000)throw problem('TIMEOUT','Choose a request timeout from 1 to 900000 milliseconds.');
  this.#origin=selected.origin;this.#token=selected.hash.slice(1);this.#timeout=timeoutMs;
 }
 get origin(){return this.#origin;}
 async #request(path,{body,headers={},signal,raw=false,maximum=16*1024*1024}={}){
  if(this.#closed)throw problem('CLOSED','This borrowed console client is closed.');
  const signals=[this.#controller.signal,AbortSignal.timeout(this.#timeout),...(signal?[signal]:[])];
  const selected=AbortSignal.any(signals);
  const task=(async()=>{
   const response=await fetch(this.#origin+path,{method:body===undefined?'GET':'POST',redirect:'error',
    headers:{...headers,authorization:'Bearer '+this.#token},signal:selected,
    ...(body===undefined?{}:{body,...(typeof body==='string'||Buffer.isBuffer(body)||body instanceof Blob?{}:{duplex:'half'})})});
   if(raw&&response.ok)return response;
   let total=0;const chunks=[];
   for await(const chunk of response.body??[]){total+=chunk.length;if(total>maximum)throw problem('RESPONSE_LIMIT','Read the full native file export for this response.');chunks.push(chunk);}
   let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));}
   catch{throw problem('RESPONSE','The original console returned no complete JSON response.');}
   if(!response.ok){const error=problem('HTTP_'+response.status,typeof value.error==='string'?value.error:'The original local operation was rejected.');error.status=response.status;error.details=value;throw error;}
   return value;
  })();
  this.#pending.add(task);try{return await task;}finally{this.#pending.delete(task);}
 }
 #post(path,value,options){if(!object(value))throw problem('INPUT','Use an original object payload.');
  const data=JSON.stringify(value);if(Buffer.byteLength(data)>131072)throw problem('INPUT_LIMIT','The native JSON selection exceeds 128 KiB.');
  return this.#request(path,{...options,headers:{'content-type':'application/json'},body:data});}
 async state(options){const result=await this.#request('/api/state',options);
  if(result.schema!=='stellar-forge.iati-workspace.v1')throw problem('WORKSPACE','This console names a different source format.');return result;}
 launch(options){return this.#request('/api/launch',options);}
 source(id,options){return this.#request('/api/source?'+query({id:hash(id)}),options);}
 plan(id,options){return this.#request('/api/plan?'+query({id:hash(id)}),options);}
 savePlan(plan,options){return this.#post('/api/plan',plan,options);}
 build(source,plan,options){return this.#post('/api/build',{source:hash(source),plan:hash(plan)},options);}
 query(build,params={},options){if(!object(params)||Object.values(params).some(v=>typeof v!=='string'))throw problem('QUERY','Pass native query parameters as exact scalar strings.');
  return this.#post('/api/query',{build:hash(build),query:params},options);}
 compare(before,after,options){return this.#post('/api/compare',{before:hash(before),after:hash(after)},options);}
 changes(id,{offset=0,limit=50,...options}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>250)throw problem('PAGE','Choose a bounded original change page.');
  return this.#request('/api/changes?'+query({id:hash(id),offset,limit}),options);}
 presets(options){return this.#request('/api/iati/presets',options);}
 profile(source,options){return this.#request('/api/iati/profile?'+query({source:hash(source)}),options);}
 portfolios(options){return this.#request('/api/iati/portfolios',options);}
 portfolio(id,{revision:selectedRevision,...options}={}){return this.#request('/api/iati/portfolio?'+query({id:hash(id),revision:revision(selectedRevision)}),options);}
 history(id,options){return this.#request('/api/iati/history?'+query({portfolio:hash(id)}),options);}
 savePortfolio(input,options){return this.#post('/api/iati/portfolio',input,options);}
 report(id,{revision:selectedRevision,...options}={}){return this.#request('/api/iati/report?'+query({portfolio:hash(id),revision:revision(selectedRevision)}),options);}
 comparePortfolio(input,options){return this.#post('/api/iati/compare',input,options);}
 /** Returned Response owns the full native ZIP/JSONL stream; consume or cancel it. */
 export(kind,id,{revision:selectedRevision,...options}={}){
  const routes={project:['/api/export','build'],dataset:['/api/dataset-export','build'],
   changes:['/api/changes/download','id'],portfolio:['/api/iati/export','portfolio'],
   report:['/api/iati/report/export','portfolio']};
  if(!routes[kind])throw problem('EXPORT','Choose the complete native project, dataset, changes, portfolio or report export.');
  if(selectedRevision!==undefined&&!['portfolio','report'].includes(kind))throw problem('REVISION','Native build and change IDs already select immutable editions.');
  const [path,key]=routes[kind];
  return this.#request(path+'?'+query({[key]:hash(id),revision:revision(selectedRevision)}),{...options,raw:true});
 }
 /** The caller supplies a complete original source stream and its observed byte count. */
 ingest({body,bytes,name='source.xml',label=name},options={}){
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>256*1024*1024)throw problem('SOURCE_SIZE','Choose a complete source up to 256 MiB.');
  return this.#request('/api/source',{...options,body,headers:{'content-type':'application/xml','content-length':String(bytes),
   'X-IATI-Name':encodeURIComponent(name),'X-IATI-Label':encodeURIComponent(label)}});
 }
 receive({body,bytes,kind='portfolio'},options={}){
  if(!['portfolio','project'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<1||bytes>4*1024*1024*1024)
   throw problem('PACKET','Choose a complete original source packet up to 4 GiB.');
  return this.#request(kind==='portfolio'?'/api/iati/receive':'/api/import',{...options,body,
   headers:{'content-type':'application/zip','content-length':String(bytes)}});
 }
 async dispose(){if(this.#closed)return;this.#closed=true;this.#controller.abort(problem('CLOSED','The local IATI client is closing.'));
  await Promise.allSettled([...this.#pending]);}
}
async function privateConnection(path){
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw problem('CONNECTION_FILE','Select one absolute private connection file.');
 const target=resolve(path);
 if(await realpath(target)!==target)throw problem('CONNECTION_FILE','Select the real original connection file without symlink aliases.');
 const selected=await lstat(target),parent=await lstat(dirname(target));
 const owner=typeof process.getuid==='function'?process.getuid():selected.uid;
 if(!selected.isFile()||selected.nlink!==1||selected.uid!==owner||(selected.mode&0o077)!==0||
   selected.size<1||selected.size>4096||!parent.isDirectory()||parent.uid!==owner||(parent.mode&0o077)!==0)
  throw problem('CONNECTION_FILE','The original connection must be a private regular file in its private directory.');
 const handle=await open(target,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const first=await handle.stat();
  if(first.dev!==selected.dev||first.ino!==selected.ino||first.size!==selected.size||first.nlink!==1)
   throw problem('CONNECTION_FILE_CHANGED','The selected connection file changed while opening.');
  const data=Buffer.alloc(first.size);let offset=0;
  while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);
   if(!bytesRead)throw problem('CONNECTION_FILE_CHANGED','The selected connection is incomplete.');offset+=bytesRead;}
  const extra=await handle.read(Buffer.alloc(1),0,1,offset),last=await handle.stat(),attached=await lstat(target);
  if(extra.bytesRead||last.dev!==first.dev||last.ino!==first.ino||last.size!==first.size||
    last.mtimeNs!==first.mtimeNs||last.mtimeMs!==first.mtimeMs||last.ctimeMs!==first.ctimeMs||
    last.nlink!==1||attached.dev!==first.dev||attached.ino!==first.ino)
   throw problem('CONNECTION_FILE_CHANGED','The original connection changed during its bounded read.');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(data).trim();}
  catch{throw problem('CONNECTION_FILE','The private connection is not complete UTF-8.');}
 }finally{await handle.close();}
}
export async function connectIatiWorkspace({consoleUrl,consoleUrlFile,timeoutMs}={}){
 if((consoleUrl===undefined)===(consoleUrlFile===undefined))throw problem('CONNECTION','Choose one original console URL or private connection file.');
 if(consoleUrlFile!==undefined)consoleUrl=await privateConnection(consoleUrlFile);
 return new IatiWorkspaceClient(consoleUrl,{timeoutMs});
}
