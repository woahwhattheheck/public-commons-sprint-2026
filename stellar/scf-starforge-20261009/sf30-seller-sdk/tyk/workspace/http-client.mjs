// MIT. Original private Tyk HTTP connection with full streamed delivery and request continuity.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { TYK_WORKSPACE_SCHEMA, TYK_MAX_JSON_BYTES, validateTykAction } from './actions.mjs';
import { need, privateDirectory } from '../../../distribution/runtime-workspace/storage.mjs';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const issue=(code,message,status)=>Object.assign(new Error(message),{code,...(status?{status}:{})});
export function parseTykWorkspaceUrl(raw){
  need(typeof raw==='string' && raw.length<=4096,'TYK_WORKSPACE_URL_INVALID');
  let url;try{url=new URL(raw.trim());}catch{throw issue('TYK_WORKSPACE_URL_INVALID','Use the original private workspace URL.');}
  need(url.protocol==='http:' && url.hostname==='127.0.0.1' && Number(url.port||80)>0 && url.pathname==='/' &&
    !url.search && !url.username && !url.password && /^#[a-f0-9]{64}$/.test(url.hash),
    'TYK_WORKSPACE_URL_INVALID','Use the original private loopback workspace URL.');
  return Object.freeze({origin:url.origin,token:url.hash.slice(1)});
}
export async function readTykPrivateFile(path,maximum=TYK_MAX_JSON_BYTES){
  need(typeof path==='string' && resolve(path)===path,'TYK_ABSOLUTE_PATH_REQUIRED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const first=await handle.stat();
    need(first.isFile() && first.size<=maximum && !(first.mode&0o077) &&
      (typeof process.getuid!=='function'||first.uid===process.getuid()),'TYK_PRIVATE_FILE_REQUIRED');
    const bytes=await handle.readFile(),last=await handle.stat();
    need(first.dev===last.dev && first.ino===last.ino && first.size===last.size && first.size===bytes.length &&
      first.mtimeMs===last.mtimeMs && first.ctimeMs===last.ctimeMs,'TYK_SOURCE_FILE_CHANGED');
    return bytes;
  }finally{await handle.close();}
}
async function responseBytes(response,maximum){
  const chunks=[];let bytes=0;
  for await(const chunk of response.body??[]){
    bytes+=chunk.length;need(bytes<=maximum,'TYK_REPLY_TOO_LARGE','Download this complete original as a file.',413);chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonResponse(response){
  const bytes=await responseBytes(response,512*1024*1024);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw issue('TYK_REPLY_JSON_INVALID','The original workspace reply is not complete UTF-8 JSON.');}
}
async function originalFile(handle,expected){
  const first=await handle.stat();need(first.isFile() && first.size===expected.bytes,'TYK_DOWNLOAD_CHANGED');
  const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
  while(offset<first.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,first.size-offset),offset);
    need(bytesRead>0,'TYK_DOWNLOAD_TRUNCATED');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  const last=await handle.stat();
  need(first.dev===last.dev && first.ino===last.ino && first.size===last.size &&
    first.mtimeMs===last.mtimeMs && first.ctimeMs===last.ctimeMs && hash.digest('hex')===expected.sha256,'TYK_DOWNLOAD_CHANGED');
  return first;
}
export async function retainTykResponse(response,output,{expectedSha256,expectedBytes,signal}={}){
  need(typeof output==='string' && resolve(output)===output,'TYK_ABSOLUTE_PATH_REQUIRED');
  await privateDirectory(dirname(output));
  const suppliedSha=response.headers.get('x-content-sha256'),suppliedBytes=response.headers.get('content-length');
  if(suppliedSha!==null){need(SHA.test(suppliedSha),'TYK_DOWNLOAD_HEADER_INVALID');
    need(!expectedSha256 || expectedSha256===suppliedSha,'TYK_DOWNLOAD_CHANGED');expectedSha256=suppliedSha;}
  if(suppliedBytes!==null){need(/^\d+$/.test(suppliedBytes) && Number.isSafeInteger(Number(suppliedBytes)),'TYK_DOWNLOAD_HEADER_INVALID');
    need(expectedBytes===undefined||expectedBytes===Number(suppliedBytes),'TYK_DOWNLOAD_CHANGED');expectedBytes=Number(suppliedBytes);}
  const temporary=output+'.partial-'+randomUUID(),handle=await open(temporary,
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const hash=createHash('sha256');let bytes=0,closed=false;
  try{
    for await(const chunk of response.body??[]){
      signal?.throwIfAborted();bytes+=chunk.length;need(Number.isSafeInteger(bytes),'TYK_DOWNLOAD_TOO_LARGE');
      need(expectedBytes===undefined||bytes<=expectedBytes,'TYK_DOWNLOAD_CHANGED');
      hash.update(chunk);await handle.writeFile(chunk);
    }
    const sha256=hash.digest('hex');
    need((expectedBytes===undefined||bytes===expectedBytes)&&(!expectedSha256||sha256===expectedSha256),'TYK_DOWNLOAD_CHANGED');
    await handle.sync();await handle.close();closed=true;
    try{await link(temporary,output);}
    catch(error){if(error.code!=='EEXIST')throw error;const original=await open(output,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{await originalFile(original,{sha256,bytes});}finally{await original.close();}}
    const parent=await open(dirname(output),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}
    return {path:output,sha256,bytes,mediaType:response.headers.get('content-type')??'application/octet-stream'};
  }finally{if(!closed)await handle.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export class TykWorkspaceHttpClient{
  #connection;#fetch;#signal;#timeoutMs;#workspaceId;#connecting;#closing=false;#closed=false;#close;
  #controllers=new Set();#pending=new Set();
  constructor({url,workspaceId,fetch=globalThis.fetch,signal,timeoutMs=3600000}={}){
    this.#connection=parseTykWorkspaceUrl(url);
    need(workspaceId===undefined||UUID.test(workspaceId),'TYK_WORKSPACE_ID_INVALID');
    need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=3600000,'TYK_TIMEOUT_INVALID');
    this.#workspaceId=workspaceId;this.#fetch=fetch;this.#signal=signal;this.#timeoutMs=timeoutMs;
  }
  get workspaceId(){return this.#workspaceId??null;}
  get origin(){return this.#connection.origin;}
  #run(fn){
    if(this.#closing||this.#closed)return Promise.reject(issue('TYK_CONNECTION_CLOSING','The original workspace connection is closing.'));
    const task=Promise.resolve().then(fn);this.#pending.add(task);
    task.then(()=>this.#pending.delete(task),()=>this.#pending.delete(task));return task;
  }
  async #request(route,{body,headers={},signal,method,consume=jsonResponse,mutationRequestId}={}){
    need(!this.#closing,'TYK_CONNECTION_CLOSING');
    const controller=new AbortController();this.#controllers.add(controller);
    const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(this.#timeoutMs),this.#signal,signal].filter(Boolean));
    let response,attempted=false,definiteRejection=false;
    try{
      combined.throwIfAborted();attempted=true;
      response=await this.#fetch(this.#connection.origin+route,{method:method??(body===undefined?'GET':'POST'),redirect:'error',signal:combined,
        headers:{origin:this.#connection.origin,'x-workspace-token':this.#connection.token,
          ...(this.#workspaceId?{'x-workspace-id':this.#workspaceId}:{}),...headers},
        ...(body===undefined?{}:{body}),...(body&&typeof body!=='string'&&!(body instanceof Uint8Array)?{duplex:'half'}:{})});
      if(!response.ok){
        let error;try{error=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await responseBytes(response,65536)));}catch{}
        definiteRejection=response.status>=400&&response.status<500&&typeof error?.error==='string';
        const code=typeof error?.error==='string'&&/^[A-Z][A-Z0-9_]{0,120}$/.test(error.error)?error.error:'TYK_ORIGINAL_REQUEST_REJECTED';
        const message=String(error?.message??code).split(this.#connection.token).join('[private capability]').slice(0,2000);
        throw Object.assign(issue(code,message,response.status),error?.recordId?{recordId:error.recordId}:{});
      }
      return await consume(response,combined);
    }catch(error){
      const original=error?.status || typeof error?.code==='string'&&/^TYK_/.test(error.code) ||
        ['ENOSPC','EDQUOT','EROFS','EACCES','EPERM'].includes(error?.code)
        ? error : issue('TYK_ORIGINAL_REPLY_INTERRUPTED','Read the original saved record or replay the same request ID and input to recover its outcome.');
      if(mutationRequestId&&attempted&&!definiteRejection)
        Object.assign(original,{outcomeUnknown:true,requestId:mutationRequestId});
      throw original;
    }finally{controller.abort();await response?.body?.cancel().catch(()=>{});this.#controllers.delete(controller);}
  }
  async #ready(){
    if(this.#connecting)return this.#connecting;
    this.#connecting=this.#request('/api/workspace').then(value=>{
      need(value?.schema===TYK_WORKSPACE_SCHEMA&&UUID.test(value.workspaceId),'TYK_WORKSPACE_ID_INVALID');
      need(!this.#workspaceId||this.#workspaceId===value.workspaceId,'TYK_WORKSPACE_ID_CHANGED');
      this.#workspaceId=value.workspaceId;return value;
    }).catch(error=>{this.#connecting=undefined;throw error;});
    return this.#connecting;
  }
  ready(){return this.#run(()=>this.#ready());}
  action(method,args={},options={}){
    const contract=validateTykAction(method,args);const payload=JSON.stringify({method,args});
    need(Buffer.byteLength(payload)<=TYK_MAX_JSON_BYTES,'TYK_JSON_TOO_LARGE',undefined,413);
    return this.#run(async()=>{await this.#ready();return this.#request('/api/action',{body:payload,
      headers:{'content-type':'application/json'},signal:options.signal,consume:options.consume??jsonResponse,
      mutationRequestId:contract.write?args.requestId:undefined});});
  }
  actionToFile(method,args,output,options={}){
    return this.action(method,args,{...options,consume:(response,signal)=>retainTykResponse(response,output,{signal})});
  }
  downloadDelivery(id,output,options={}){
    need(/^[a-f0-9]{24}$/.test(id),'TYK_RECORD_ID_INVALID');
    return this.#run(async()=>{await this.#ready();return this.#request('/api/delivery?id='+id,{signal:options.signal,
      consume:(response,signal)=>{need(SHA.test(response.headers.get('x-content-sha256')??'')&&response.headers.has('content-length'),
        'TYK_DOWNLOAD_HEADER_INVALID');return retainTykResponse(response,output,{...options,signal});}});});
  }
  downloadSource(reference,output,options={}){
    validateTykAction('readSource',{reference});
    return this.#run(async()=>{await this.#ready();return this.#request('/api/source?sha256='+reference.sha256+'&bytes='+reference.bytes,
      {signal:options.signal,consume:(response,signal)=>retainTykResponse(response,output,
        {expectedSha256:reference.sha256,expectedBytes:reference.bytes,signal})});});
  }
  inspectFile(path,{requestId,label,expectedSha256,signal}={}){
    need(UUID.test(requestId),'TYK_REQUEST_ID_INVALID');
    need(typeof path==='string'&&resolve(path)===path,'TYK_ABSOLUTE_PATH_REQUIRED');
    need(typeof label==='string'&&label.trim()&&label.length<=300&&!/[\u0000-\u001f\u007f]/.test(label),'TYK_DELIVERY_NAME_INVALID');
    need(expectedSha256===undefined||SHA.test(expectedSha256),'TYK_SOURCE_HASH_INVALID');
    return this.#run(async()=>{
      await this.#ready();const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const first=await handle.stat();need(first.isFile()&&!(first.mode&0o077)&&
          (typeof process.getuid!=='function'||first.uid===process.getuid()),'TYK_PRIVATE_FILE_REQUIRED');
        if(expectedSha256)await originalFile(handle,{sha256:expectedSha256,bytes:first.size});
        async function* chunks(){
          const buffer=Buffer.alloc(65536),hash=createHash('sha256');let offset=0;
          while(offset<first.size){signal?.throwIfAborted();
            const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,first.size-offset),offset);
            need(bytesRead>0,'TYK_UPLOAD_SOURCE_CHANGED');const chunk=Buffer.from(buffer.subarray(0,bytesRead));hash.update(chunk);offset+=bytesRead;yield chunk;}
          const last=await handle.stat();need(first.dev===last.dev&&first.ino===last.ino&&first.size===last.size&&
            first.mtimeMs===last.mtimeMs&&first.ctimeMs===last.ctimeMs&&(!expectedSha256||hash.digest('hex')===expectedSha256),
            'TYK_UPLOAD_SOURCE_CHANGED');
        }
        return await this.#request('/api/delivery/inspect',{body:chunks(),signal,mutationRequestId:requestId,headers:{'content-type':'application/octet-stream',
          'content-length':String(first.size),'x-request-id':requestId,'x-delivery-name':encodeURIComponent(label)}});
      }finally{await handle.close();}
    });
  }
  close(){
    if(this.#closed)return Promise.resolve();if(this.#close)return this.#close;
    this.#closing=true;for(const controller of this.#controllers)controller.abort();
    this.#close=Promise.allSettled([...this.#pending]).then(()=>{this.#closed=true;}).catch(error=>{this.#close=undefined;throw error;});
    return this.#close;
  }
}
