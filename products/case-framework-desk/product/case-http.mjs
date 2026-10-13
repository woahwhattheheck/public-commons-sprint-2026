// MIT. Complete selected CASE file/HTTP capture; no publisher writes.
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {inspectCASESource} from './case-source.mjs';
export const CASE_SOURCE_LIMIT=1024*1024;
export const sha256=async bytes=>createHash('sha256').update(bytes).digest('hex');
export const utf8=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
const fail=m=>{throw Object.assign(Error(m),{code:'CASE_CAPTURE_INVALID'});};
export async function readOriginalFile(path,maxBytes=CASE_SOURCE_LIMIT){
 const selected=resolve(path),before=await lstat(selected,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink())fail('Select an ordinary complete file.');
 if(before.size>BigInt(maxBytes))fail('Selected file exceeds its complete-input byte limit.');
 let handle;
 try{
  handle=await open(selected,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const first=await handle.stat({bigint:true});
  if(!first.isFile()||first.dev!==before.dev||first.ino!==before.ino||first.size!==before.size)fail('Selected file changed before it was opened.');
  const chunks=[];let length=0;
  for(;;){
   const buffer=Buffer.alloc(Math.min(65536,maxBytes+1-length));
   const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
   if(!bytesRead)break;
   length+=bytesRead;if(length>maxBytes)fail('Selected file grew beyond its complete-input byte limit.');
   chunks.push(buffer.subarray(0,bytesRead));
  }
  const last=await handle.stat({bigint:true}),pathStat=await lstat(selected,{bigint:true});
  if(first.dev!==last.dev||first.ino!==last.ino||first.size!==last.size||first.mtimeNs!==last.mtimeNs||first.ctimeNs!==last.ctimeNs||BigInt(length)!==last.size||pathStat.dev!==last.dev||pathStat.ino!==last.ino||!pathStat.isFile())fail('Selected source changed during reading.');
  return {bytes:Buffer.concat(chunks,length),selected,realPath:await realpath(selected)};
 }finally{if(handle)await handle.close();}
}
function label(value){if(typeof value!=='string'||!value.trim()||value.length>256)fail('Choose a source label of 1–256 characters.');return value;}
export async function captureCASEFile(path,{label:sourceLabel}){
 const original=await readOriginalFile(path),text=utf8(original.bytes);
 const origin={label:label(sourceLabel),locator:original.selected,transport:{kind:'file',selectedPath:original.selected,realPath:original.realPath,bytes:original.bytes.length,sha256:await sha256(original.bytes)}};
 const inspection=await inspectCASESource({text,origin},{hash:sha256});
 return {schema:'commons.case-capture.v1',source:inspection.source,inspection};
}
export async function captureCASEHTTP(selectedURL,{label:sourceLabel,authorizationEnv,allowHttpLoopback=false,timeoutMs=30000,fetchImpl=globalThis.fetch}={}){
 label(sourceLabel);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)fail('HTTP timeout must be 1,000–120,000 milliseconds.');
 const url=new URL(selectedURL),loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.hash||url.search)fail('Use a complete CASE package URL without credentials, query or fragment.');
 if(url.protocol!=='https:'&&!(allowHttpLoopback&&url.protocol==='http:'&&loopback))fail('Use HTTPS, or explicitly select an HTTP loopback exercise.');
 if(!/\/ims\/case\/v1p1\/CFPackages\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(url.pathname))fail('Select one complete CASE 1.1 CFPackages/{identifier} endpoint.');
 const headers={'Accept':'application/json','Accept-Encoding':'identity'};
 if(authorizationEnv!==undefined){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(authorizationEnv))fail('Authorization must name an environment variable.');
  const authorization=process.env[authorizationEnv];
  if(!authorization||/[\r\n]/.test(authorization))fail('Selected authorization environment variable is missing or invalid.');
  headers.Authorization=authorization;
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 let response,reader,complete=false;
 try{
  try{response=await fetchImpl(url.href,{method:'GET',headers,redirect:'manual',signal:controller.signal});}
  catch{fail(controller.signal.aborted?'CASE package request exceeded its timeout.':'CASE package request failed; check the selected endpoint and account.');}
  if(response.status!==200||response.redirected||response.headers.has('content-range'))fail('A complete 200 response without redirects or Content-Range is required.');
  if(response.url&&response.url!==url.href)fail('Response URL differs from the selected package URL.');
  const contentType=response.headers.get('content-type')??'';
  if(!/^(?:application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType))fail('CASE response must declare a JSON media type.');
  const encoding=response.headers.get('content-encoding');
  if(encoding&&encoding.toLowerCase()!=='identity')fail('Select an uncompressed entity response so original response bytes can be retained.');
  const size=response.headers.get('content-length');
  if(size!==null&&(!/^\d+$/.test(size)||BigInt(size)>BigInt(CASE_SOURCE_LIMIT)))fail('Declared source size exceeds the complete package limit.');
  if(!response.body)fail('CASE response has no complete body.');
  reader=response.body.getReader();const chunks=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))fail('CASE body chunk is not bytes.');length+=value.byteLength;if(length>CASE_SOURCE_LIMIT)fail('Complete CASE package exceeds 1 MiB.');chunks.push(value);}
  complete=true;
  if(size!==null&&BigInt(size)!==BigInt(length))fail('Complete response differs from its declared Content-Length.');
  const bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)),length),text=utf8(bytes);
  const retainedHeaders={};
  for(const key of ['content-type','content-length','content-encoding','etag','last-modified','date','cache-control']){const value=response.headers.get(key);if(value!==null)retainedHeaders[key]=value;}
  const origin={label:sourceLabel,locator:url.href,transport:{kind:'http-get',requestedURL:url.href,responseURL:response.url||url.href,status:response.status,capturedAt:new Date().toISOString(),authorizationProvided:authorizationEnv!==undefined,headers:retainedHeaders,bytes:length,sha256:await sha256(bytes)}};
  let inspection;
  try{
   inspection=await inspectCASESource({text,origin},{hash:sha256});
   if(inspection.document.identifier!==url.pathname.split('/').at(-1))fail('Returned CFDocument.identifier differs from the explicitly selected package UUID.');
  }catch(error){
   error.caseCaptureFailure={schema:'commons.case-capture-failure.v1',source:{text,origin,bytes:length,sha256:origin.transport.sha256},failure:{code:error.code??'CASE_SOURCE_INVALID',message:error.message},...(inspection?{inspection}:{})};
   throw error;
  }
  return {schema:'commons.case-capture.v1',source:inspection.source,inspection};
 }catch(error){if(controller.signal.aborted)fail('CASE package request exceeded its timeout.');throw error;}
 finally{
  clearTimeout(timer);controller.abort();
  if(reader){if(!complete)try{await reader.cancel();}catch{}reader.releaseLock();}
  else if(response?.body)try{await response.body.cancel();}catch{}
 }
}
