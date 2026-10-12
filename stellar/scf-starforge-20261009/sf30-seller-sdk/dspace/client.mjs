// MIT. Typed host client for the original retained DSpace dataset operator.
import fs, {constants} from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {readDspaceOperatorLaunch} from './launch.mjs';

export const DSPACE_MAX_INPUT_BYTES=256*1024*1024;
export const DSPACE_MAX_RESPONSE_BYTES=384*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_.:-]{8,128}$/;
const ACTIONS=new Set(['import-source','save-edition','review-edition','select-edition','compare-editions','record-publication']);
const SCOPE_KEYS=['operatorId','instanceId','projectKey','workspaceId'];
const scopeHeaders={operatorId:'X-DSpace-Operator',instanceId:'X-DSpace-Instance',projectKey:'X-DSpace-Project',workspaceId:'X-DSpace-Workspace'};

export class DspaceClientError extends Error {
  constructor(code,message,details={}) {super(message);this.name='DspaceClientError';this.code=code;Object.assign(this,details);}
}
const fail=(code,message,details)=>new DspaceClientError(code,message,details);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function validHash(value,label='SHA256') {
  if(typeof value!=='string'||!HASH.test(value))throw fail('DSPACE_CLIENT_HASH',label+' must be the exact lowercase SHA256.');
  return value;
}
function integer(value,min,max,label) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('DSPACE_CLIENT_ARGUMENT',label+' is outside the original operator range.');
  return value;
}
export function validateDspaceScope(scope) {
  if(!plain(scope)||Object.keys(scope).some(k=>!SCOPE_KEYS.includes(k))||
      SCOPE_KEYS.some(k=>typeof scope[k]!=='string'||!scope[k]||scope[k].length>256||/[\x00-\x20\x7f]/.test(scope[k])))
    throw fail('DSPACE_CLIENT_SCOPE','Use the complete operator, instance, project and workspace binding returned by this operator.');
  return Object.freeze(Object.fromEntries(SCOPE_KEYS.map(k=>[k,scope[k]])));
}
export function dspaceScopeFromState(state) {
  return validateDspaceScope({operatorId:state?.operator?.id,instanceId:state?.operator?.instanceId,
    projectKey:state?.operator?.selected,workspaceId:state?.id});
}
function sameScope(a,b) {return SCOPE_KEYS.every(k=>a[k]===b[k]);}
function regularPrivate(info) {
  return info.isFile()&&(process.platform==='win32'||(info.mode&0o077n)===0n&&
    (!process.getuid||info.uid===BigInt(process.getuid())));
}
function unchanged(a,b) {
  return a.size===b.size&&a.ino===b.ino&&a.dev===b.dev&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
async function originalFile(filename,{maximum=DSPACE_MAX_INPUT_BYTES,privateFile=false}={}) {
  const resolved=path.resolve(filename);
  if(await fsp.realpath(resolved)!==resolved)throw fail('DSPACE_CLIENT_SOURCE_PATH','Use the declared canonical regular source file.');
  const handle=await fsp.open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(maximum)||privateFile&&!regularPrivate(before))
      throw fail('DSPACE_CLIENT_SOURCE_FILE','Use a regular source within its limit; connection files must be owned and private.');
    return {handle,before,path:resolved,maximum};
  }catch(error){await handle.close();throw error;}
}
async function verifyUnchanged(source) {
  if(!unchanged(source.before,await source.handle.stat({bigint:true})))
    throw fail('DSPACE_CLIENT_SOURCE_CHANGED','The original source changed during this read.');
}
/** Host-only source inspection; no path is taken from an MCP argument. */
export async function inspectDspaceInput(filename,options={}) {
  const source=await originalFile(filename,options);
  try{
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of source.handle.createReadStream({autoClose:false,start:0})){
      bytes+=chunk.length;if(bytes>source.maximum)throw fail('DSPACE_CLIENT_SOURCE_SIZE','The source grew beyond its declared limit.');
      hash.update(chunk);
    }
    await verifyUnchanged(source);
    return {bytes,sha256:hash.digest('hex')};
  }finally{await source.handle.close();}
}
export async function readDspaceInput(filename,{expectedSha256,...options}={}) {
  if(expectedSha256!==undefined)validHash(expectedSha256);
  const source=await originalFile(filename,options);
  try{
    const chunks=[];let count=0;
    for await(const chunk of source.handle.createReadStream({autoClose:false,start:0})){
      count+=chunk.length;if(count>source.maximum)throw fail('DSPACE_CLIENT_SOURCE_SIZE','The source grew beyond its declared limit.');
      chunks.push(chunk);
    }
    await verifyUnchanged(source);
    const bytes=Buffer.concat(chunks),sha256=digest(bytes);
    if(expectedSha256&&sha256!==expectedSha256)throw fail('DSPACE_CLIENT_SOURCE_CHANGED','The declared input differs from its inspected SHA256.');
    return {bytes,sha256};
  }finally{await source.handle.close();}
}
async function privateDirectory(directory) {
  const real=await fsp.realpath(path.resolve(directory));
  if(real!==path.resolve(directory))throw fail('DSPACE_CLIENT_DIRECTORY','Use the original private receiving directory.');
  const st=await fsp.lstat(real);
  if(!st.isDirectory()||st.isSymbolicLink()||process.platform!=='win32'&&
      ((st.mode&0o077)!==0||process.getuid&&st.uid!==process.getuid()))
    throw fail('DSPACE_CLIENT_DIRECTORY','The receiving directory must be owned and private (0700).');
  return real;
}
async function immutableInput(filename,expectedSha256) {
  validHash(expectedSha256);
  const source=await originalFile(filename);let directory,target;
  try{
    directory=await fsp.mkdtemp(path.join(os.tmpdir(),'dspace-input-'));
    const temporary=path.join(directory,'original.sqlite3');
    target=await fsp.open(temporary,'wx',0o600);
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of source.handle.createReadStream({autoClose:false,start:0})){
      bytes+=chunk.length;if(bytes>DSPACE_MAX_INPUT_BYTES)throw fail('DSPACE_CLIENT_SOURCE_SIZE','The complete project exceeds the original 256 MiB receiver.');
      hash.update(chunk);await target.writeFile(chunk);
    }
    await verifyUnchanged(source);
    if(hash.digest('hex')!==expectedSha256)throw fail('DSPACE_CLIENT_SOURCE_CHANGED','The complete receiving file differs from the inspected original.');
    await target.sync();await target.close();target=null;await source.handle.close();
    const handle=await fsp.open(temporary,'r');
    return {handle,bytes,sha256:expectedSha256,async close(){await handle.close();await fsp.rm(directory,{recursive:true,force:true});}};
  }catch(error){await target?.close();await source.handle.close().catch(()=>{});if(directory)await fsp.rm(directory,{recursive:true,force:true});throw error;}
}
async function bodyBytes(response,maximum) {
  const chunks=[];let bytes=0;
  if(!response.body)return Buffer.alloc(0);
  for await(const chunk of response.body){
    bytes+=chunk.byteLength;
    if(bytes>maximum)throw fail('DSPACE_CLIENT_RESPONSE_SIZE','Use the complete retained file export for this response; the JSON response exceeds its original receiving limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function filenameFrom(response) {
  const value=response.headers.get('content-disposition')??'';
  const name=/^attachment;\s*filename="([^"]+)"$/.exec(value)?.[1];
  if(!name||name.length>240||path.basename(name)!==name||/[\x00-\x1f\x7f]/.test(name))
    throw fail('DSPACE_CLIENT_DOWNLOAD_NAME','The original operator returned an invalid download filename.');
  return name;
}
function jsonError(response,body,scope,operationId) {
  const code=typeof body?.error==='string'?body.error:body?.error?.code??'DSPACE_OPERATOR_HTTP';
  return fail(code,body?.message??body?.error?.message??'The original operator returned HTTP '+response.status+'.',
    {status:response.status,scope,operationId,uncertain:Boolean(operationId&&response.status>=500),response:body});
}

export class DspaceOperatorClient {
  #connection;#fetch;#timeout;#scope;#pending=new Set();#closing=false;#closed;
  constructor(connection,{fetchImpl=globalThis.fetch,timeoutMs=120000}={}) {
    if(!plain(connection)||typeof connection.url!=='string'||typeof connection.token!=='string')
      throw fail('DSPACE_CLIENT_CONNECTION','Open the verified original operator connection first.');
    const url=new URL(connection.url);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||
        url.username||url.password||url.search||url.hash||url.pathname!=='/')
      throw fail('DSPACE_CLIENT_CONNECTION','Use the verified original loopback operator address.');
    if(typeof fetchImpl!=='function')throw fail('DSPACE_CLIENT_FETCH','A native HTTP fetch implementation is required.');
    this.#connection={...connection,url:url.origin};this.#scope=validateDspaceScope(connection.scope);this.#fetch=fetchImpl;
    this.#timeout=integer(timeoutMs,1000,600000,'HTTP timeout');
  }
  get scope(){return {...this.#scope};}
  get launch(){return structuredClone(this.#connection.launch);}
  get summary(){return {scope:this.scope,pending:this.#pending.size,closing:this.#closing};}
  #run(fn){
    if(this.#closing)return Promise.reject(fail('DSPACE_CLIENT_CLOSED','This borrowed client is closing.'));
    const task=Promise.resolve().then(fn);this.#pending.add(task);task.finally(()=>this.#pending.delete(task)).catch(()=>{});return task;
  }
  #binding(value=this.#scope){
    const scope=validateDspaceScope(value);
    if(scope.operatorId!==this.#scope.operatorId||scope.instanceId!==this.#scope.instanceId)
      throw fail('DSPACE_CLIENT_INSTANCE','Reconnect explicitly to the same declared operator before using a new instance.',{scope});
    return scope;
  }
  async #request(method,route,{scope,body,stream,headers={},operationId}={}){
    const binding=this.#binding(scope);
    const requestHeaders={authorization:'Bearer '+this.#connection.token,...headers};
    for(const [key,name] of Object.entries(scopeHeaders))requestHeaders[name]=binding[key];
    const options={method,headers:requestHeaders,redirect:'error',signal:AbortSignal.timeout(this.#timeout)};
    if(body!==undefined){requestHeaders['content-type']='application/json';options.body=JSON.stringify(body);}
    if(stream){options.body=stream;options.duplex='half';}
    try{return await this.#fetch(this.#connection.url+route,options);}
    catch(error){throw fail(operationId?'DSPACE_CLIENT_UNCERTAIN':'DSPACE_CLIENT_TRANSPORT',
      operationId?'The original response was interrupted. Inspect this same operation in its original project before continuing.':'The original operator did not return a complete response.',
      {scope:binding,operationId,uncertain:Boolean(operationId),causeCode:error?.code??error?.cause?.code??error?.name});}
  }
  async #json(method,route,{scope=this.#scope,operationId,...input}={}){
    const binding=this.#binding(scope);
    const response=await this.#request(method,route,{...input,scope:binding,operationId});
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bodyBytes(response,DSPACE_MAX_RESPONSE_BYTES)));}
    catch(error){
      if(error instanceof DspaceClientError){if(operationId)Object.assign(error,{status:response.status,scope:binding,operationId,uncertain:true});throw error;}
      throw fail(operationId?'DSPACE_CLIENT_UNCERTAIN':'DSPACE_CLIENT_RESPONSE','The original response body was incomplete or invalid JSON.',
        {status:response.status,scope:binding,operationId,uncertain:Boolean(operationId)});
    }
    if(!response.ok)throw jsonError(response,value,binding,operationId);
    return value;
  }
  state({scope=this.#scope}={}){return this.#run(async()=>{
    const binding=this.#binding(scope),state=await this.#json('GET','/api/state',{scope:binding});
    if(!sameScope(binding,dspaceScopeFromState(state)))throw fail('DSPACE_CLIENT_RESPONSE_SCOPE','The response belongs to another original workspace.');
    return state;
  });}
  record({kind,id,offset=0,limit=20,scope=this.#scope}){
    return this.#run(()=>this.#json('GET','/api/record?'+new URLSearchParams({kind,id,offset:String(offset),limit:String(limit)}),{scope}));
  }
  items({sourceId,offset=0,limit=20,selection='all',search='',scope=this.#scope}){
    integer(offset,0,Number.MAX_SAFE_INTEGER,'Offset');integer(limit,1,100,'Page limit');
    if(!['all','collection'].includes(selection))throw fail('DSPACE_CLIENT_ARGUMENT','Select all retained items or the captured collection scope.');
    return this.#run(()=>this.#json('GET','/api/items?'+new URLSearchParams({id:sourceId,offset:String(offset),limit:String(limit),scope:selection,search}),{scope}));
  }
  item({sourceId,uuid,objectSha256,scope=this.#scope}){
    validHash(objectSha256,'Original object SHA256');
    return this.#run(()=>this.#json('GET','/api/item?'+new URLSearchParams({source:sourceId,uuid,variant:objectSha256}),{scope}));
  }
  operation({operationId,scope=this.#scope}){
    if(!ID.test(operationId??''))throw fail('DSPACE_CLIENT_OPERATION','Use the original persistent operation ID.');
    return this.#run(()=>this.#json('GET','/api/operation?'+new URLSearchParams({id:operationId}),{scope}));
  }
  dispatch(action,input,{scope=this.#scope}={}){
    if(!ACTIONS.has(action)||!plain(input)||!ID.test(input.operationId??''))throw fail('DSPACE_CLIENT_ACTION','Use an original action and persistent operation ID.');
    if(Object.hasOwn(input,'action')||Object.hasOwn(input,'scope'))throw fail('DSPACE_CLIENT_ACTION','Pass the original action and scope separately from its exact input.');
    return this.#run(()=>this.#json('POST','/api/action',{scope,operationId:input.operationId,body:{action,...input}}));
  }
  importSource({file,expectedSha256,scope=this.#scope,...input}){
    validHash(expectedSha256);if(!ID.test(input.operationId??''))throw fail('DSPACE_CLIENT_OPERATION','Use the original persistent operation ID.');
    return this.#run(async()=>{
      const source=await readDspaceInput(file,{expectedSha256});
      return this.#json('POST','/api/action',{scope,operationId:input.operationId,body:{...input,action:'import-source',sourceBase64:source.bytes.toString('base64')}});
    });
  }
  query({editionId,query={},scope=this.#scope}){
    return this.#run(()=>this.#json('POST','/api/query',{scope,body:{editionId,query}}));
  }
  selectProject({key,scope=this.#scope}){
    return this.#run(async()=>{
      const state=await this.#json('POST','/api/select-project',{scope,body:{key}});
      const next=dspaceScopeFromState(state);
      if(next.operatorId!==this.#scope.operatorId||next.instanceId!==this.#scope.instanceId||next.projectKey!==key)
        throw fail('DSPACE_CLIENT_RESPONSE_SCOPE','The project selection returned another operator or project.');
      return {scope:{...next},state};
    });
  }
  receiveWorkspace({file,expectedSha256,operationId,scope=this.#scope}){
    if(!ID.test(operationId??''))throw fail('DSPACE_CLIENT_OPERATION','Retain the original receiving operation ID.');
    return this.#run(async()=>{
      const source=await immutableInput(file,expectedSha256);
      try{
        const result=await this.#json('POST','/api/receive',{scope,operationId,
          stream:source.handle.createReadStream({autoClose:false,start:0}),
          headers:{'content-type':'application/vnd.sqlite3','content-length':String(source.bytes),'X-Operation-Id':operationId}});
        if(result.operationId!==operationId||result.sha256!==expectedSha256||result.bytes!==source.bytes)
          throw fail('DSPACE_CLIENT_RECEIVING_IDENTITY','The receiving result differs from the complete original input.',{scope,operationId,uncertain:true});
        const next=dspaceScopeFromState(result.state);
        if(next.operatorId!==this.#scope.operatorId||next.instanceId!==this.#scope.instanceId)
          throw fail('DSPACE_CLIENT_RESPONSE_SCOPE','Receiving returned another original operator.');
        return {...result,scope:{...next}};
      }finally{await source.close();}
    });
  }
  download({kind,id='',directory,expectedSha256,scope=this.#scope,maximumBytes=1024*1024*1024}){
    if(expectedSha256!==undefined)validHash(expectedSha256);
    integer(maximumBytes,1,Number.MAX_SAFE_INTEGER,'Download byte limit');
    return this.#run(async()=>{
      const root=await privateDirectory(directory);
      const response=await this.#request('GET','/api/download?'+new URLSearchParams({kind,id}),{scope});
      let handle,temporary,received=0,consumed=false;
      try{
        if(!response.ok){
          const body=await bodyBytes(response,1024*1024);consumed=true;
          let value;try{value=JSON.parse(body.toString('utf8'));}catch{value={};}
          throw jsonError(response,value,scope);
        }
        const sha256=validHash(response.headers.get('x-file-sha256'),'Original download SHA256');
        const length=response.headers.get('content-length');
        if(length===null||!/^[0-9]+$/.test(length))throw fail('DSPACE_CLIENT_DOWNLOAD_SIZE','The original download must retain its exact byte count.');
        const bytes=integer(Number(length),0,maximumBytes,'Download bytes'),filename=filenameFrom(response);
        if(expectedSha256&&sha256!==expectedSha256)throw fail('DSPACE_CLIENT_DOWNLOAD_CHANGED','The current export differs from the selected original file.');
        const destination=path.join(root,sha256+'.data'),hash=createHash('sha256');
        temporary=path.join(root,'.download-'+randomUUID()+'.part');
        handle=await fsp.open(temporary,'wx',0o600);
        for await(const chunk of response.body??[]){
          received+=chunk.byteLength;if(received>bytes)throw fail('DSPACE_CLIENT_DOWNLOAD_SIZE','The download exceeds its original byte count.');
          hash.update(chunk);await handle.writeFile(chunk);
        }
        consumed=true;
        if(received!==bytes||hash.digest('hex')!==sha256)throw fail('DSPACE_CLIENT_DOWNLOAD_CHANGED','The received file differs from the complete original export.');
        await handle.sync();await handle.close();handle=null;
        try{await fsp.link(temporary,destination);}
        catch(error){if(error.code!=='EEXIST')throw error;const existing=await inspectDspaceInput(destination,{maximum:maximumBytes,privateFile:true});
          if(existing.bytes!==bytes||existing.sha256!==sha256)throw fail('DSPACE_CLIENT_DOWNLOAD_CHANGED','The retained file path contains different bytes.');}
        return {path:destination,filename,contentType:response.headers.get('content-type')??'application/octet-stream',bytes,sha256,scope:{...this.#binding(scope)},kind,id};
      }finally{
        if(!consumed)await response.body?.cancel().catch(()=>{});
        await handle?.close();
        if(temporary)await fsp.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
      }
    });
  }
  close(){
    if(!this.#closed){this.#closing=true;this.#closed=Promise.allSettled([...this.#pending]).then(()=>undefined);}
    return this.#closed;
  }
}

/** Borrow the host-owned writer through the maintained verified launch helper. */
export async function connectDspaceOperator({launchFile,directory,operatorId,instanceId,executionSourceDirectory,announcement,fetchImpl,timeoutMs}={}) {
  if(!directory&&!launchFile)throw fail('DSPACE_CLIENT_CONNECTION','Declare the original operator directory or private launch file.');
  const connection=await readDspaceOperatorLaunch({directory:directory??path.dirname(path.resolve(launchFile)),
    launchFile,operatorId,instanceId,executionSourceDirectory,announcement,...(timeoutMs?{timeoutMs:Math.min(timeoutMs,60000)}:{})});
  const client=new DspaceOperatorClient(connection,{fetchImpl,timeoutMs});
  try{await client.state();return client;}catch(error){await client.close();throw error;}
}
