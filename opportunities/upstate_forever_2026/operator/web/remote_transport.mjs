/** Same-origin recipient transport for the existing operator API. */
const CHUNK_BYTES=1048576;
const SESSION_MARKER='eco-edge-session';
const JOURNAL_PREFIX='upstate-remote-upload/v1:';
const inMemory=new Map();
const heldFiles=new WeakMap();
const retryCodes=new Set([408,429,502,503,504]);
const forbiddenHeaders=new Set(['authorization','cookie','host','origin','content-length','connection']);
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
function problem(message,code,id,status){
 const error=new Error(message+(id?' Transfer reference: '+id+'.':''));
 error.code=code;error.requestId=id;if(status)error.status=status;return error;
}
function abort(signal){
 if(signal?.aborted)throw signal.reason??new DOMException('The operation was aborted.','AbortError');
}
function pause(ms,signal){
 abort(signal);
 return new Promise((resolve,reject)=>{
  let timer;
  const onAbort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);reject(signal.reason??new DOMException('The operation was aborted.','AbortError'));};
  timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)onAbort();
 });
}
function retryDelay(response,attempt,fallback){
 const value=response?.headers.get('Retry-After');
 if(value){
  const seconds=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):null;
  const delay=seconds===null?Date.parse(value)-Date.now():seconds*1000;
  if(Number.isFinite(delay)&&delay>=0)return delay;
 }
 return fallback??Math.min(4000,250*2**attempt);
}
async function hash(bytes,signal){
 abort(signal);const digest=await crypto.subtle.digest('SHA-256',bytes);abort(signal);return new Uint8Array(digest);
}
function journalRead(key){
 const local=inMemory.get(key);if(local)return local;
 try{const value=JSON.parse(sessionStorage.getItem(JOURNAL_PREFIX+key)||'null');if(value&&/^[A-Za-z0-9_-]{8,128}$/.test(value.id))return value;}catch{}
 return null;
}
function journalWrite(key,value){
 inMemory.set(key,value);
 try{sessionStorage.setItem(JOURNAL_PREFIX+key,JSON.stringify(value));}catch{}
}
function journalRemove(key,id){
 if(inMemory.get(key)?.id===id)inMemory.delete(key);
 try{const value=JSON.parse(sessionStorage.getItem(JOURNAL_PREFIX+key)||'null');if(value?.id===id)sessionStorage.removeItem(JOURNAL_PREFIX+key);}catch{}
}
function sourceHeaders(input,body){
 const headers=new Headers(input);
 for(const key of [...headers.keys()])if(forbiddenHeaders.has(key))headers.delete(key);
 if(!headers.has('content-type')&&body.type)headers.set('content-type',body.type);
 return Object.fromEntries([...headers.entries()].sort(([a],[b])=>a.localeCompare(b)));
}
async function fileIdentity(blob,metadata,signal){
 // Bounded-memory content fingerprint, not a claim of the file's SHA-256.
 // A fresh File with the same name cannot silently resume different bytes.
 let digest=await hash(new TextEncoder().encode(JSON.stringify(metadata)),signal);
 for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
  abort(signal);const chunk=await blob.slice(offset,offset+CHUNK_BYTES).arrayBuffer();
  const part=await hash(chunk,signal),joined=new Uint8Array(64);joined.set(digest);joined.set(part,32);
  digest=await hash(joined,signal);
 }
 return hex(digest);
}
async function control(path,options,id,signal){
 for(let attempt=0;;attempt++){
  abort(signal);let response,error;
  try{response=await fetch(path,{...options,credentials:'same-origin',redirect:'error',signal});}
  catch(cause){abort(signal);error=cause;}
  if(response&&!retryCodes.has(response.status)){
   let value;try{value=await response.json();}catch(cause){abort(signal);throw problem('The transfer returned an unreadable response. Reopen the same selected file to resume.','REMOTE_RESPONSE',id,response.status);}
   if(response.ok)return value;
   const code=value?.error?.code||value?.code;
   if(!(response.status===409&&code==='INPUT_PENDING'))throw problem(value?.error?.message||value?.message||'The transfer could not continue.','REMOTE_'+(code||response.status),id,response.status);
   // The original input may already have reached the native spool.
   try{await fetch('/_eco/v1/requests/'+id+'/status',{credentials:'same-origin',redirect:'error',signal});}catch(cause){abort(signal);}
  }
  if(attempt>=7)throw problem('The connection was interrupted. Reopen the same selected file to resume this transfer.','REMOTE_INTERRUPTED',id,response?.status);
  try{await response?.body?.cancel();}catch{}
  await pause(retryDelay(response,attempt),signal);
 }
}
async function outcome(id,signal){
 for(let attempt=0;;){
  abort(signal);let response;
  try{response=await fetch('/_eco/v1/requests/'+id+'/result',{credentials:'same-origin',redirect:'error',signal});}
  catch(cause){
   abort(signal);if(attempt++>=7)throw problem('The connection was interrupted. The original request is retained; check Operations before submitting it again.','REMOTE_INTERRUPTED',id);
   await pause(Math.min(4000,250*2**attempt),signal);continue;
  }
  if(response.headers.get('X-Eco-Uncertain')==='1'){
   await response.body?.cancel();
   throw problem('The native request needs reconciliation. Check its original operation before submitting it again.','UPSTREAM_UNCERTAIN',id,response.status);
  }
  if(response.headers.get('X-Eco-Pending')==='1'){
   await response.body?.cancel();attempt=0;await pause(retryDelay(response,0,500),signal);continue;
  }
  if((retryCodes.has(response.status)||(response.status===409&&response.headers.get('X-Eco-Transport-Error')==='RESULT_OPEN'))&&response.headers.has('X-Eco-Transport-Error')){
   await response.body?.cancel();if(attempt++>=7)throw problem('The original request is retained but its result is temporarily unavailable.','REMOTE_INTERRUPTED',id,response.status);
   await pause(retryDelay(response,attempt),signal);continue;
  }
  if(response.headers.has('X-Eco-Transport-Error')){
   const code=response.headers.get('X-Eco-Transport-Error');
   await response.body?.cancel();
   throw problem('The original transfer result could not be read ('+code+'). Keep its reference when reconnecting.','REMOTE_'+code,id,response.status);
  }
  return response;
 }
}
async function completeApiResponse(response,id,signal){
 // app.api already consumes the complete JSON body. Finish that read here so
 // interrupted action/upload acknowledgements recover through the SAME result.
 // Original file links and download streams use their unchanged native routes.
 let identity=null;
 for(let attempt=0;;attempt++){
  abort(signal);
  const returned=response.headers.get('X-Eco-Request-ID');
  if(returned&&returned!==id){try{await response.body?.cancel();}catch{}throw problem('The connection returned a different request identity.','REMOTE_IDENTITY',id);}
  const current={status:response.status,sha256:response.headers.get('X-Eco-Body-SHA256'),type:response.headers.get('Content-Type')};
  if(identity&&(current.status!==identity.status||current.sha256!==identity.sha256||current.type!==identity.type)){
   try{await response.body?.cancel();}catch{}
   throw problem('The retained response identity changed while reconnecting.','REMOTE_RESULT_IDENTITY',id);
  }
  identity??=current;
  try{
   const bytes=await response.arrayBuffer();abort(signal);
   const length=response.headers.get('Content-Length');
   if(length!==null&&!response.headers.has('Content-Encoding')&&/^\d+$/.test(length)&&Number(length)!==bytes.byteLength)throw new Error('Incomplete original response bytes');
   if(current.sha256&&(!/^[a-f0-9]{64}$/.test(current.sha256)||hex(await hash(bytes,signal))!==current.sha256))throw new Error('Original response digest did not match');
   return new Response(response.body===null?null:bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(cause){
   abort(signal);try{await response.body?.cancel(cause);}catch{}
   if(attempt>=7)throw problem('The original request is retained but its complete reply could not be read. Keep its reference when reconnecting.','REMOTE_RESPONSE_INTERRUPTED',id,response.status);
   await pause(retryDelay(response,attempt),signal);
   response=await outcome(id,signal);
  }
 }
}
function finishWhenRead(response,done,signal){
 if(!response.body){done();return response;}
 const reader=response.body.getReader();
 const body=new ReadableStream({
  async pull(controller){
   try{abort(signal);const item=await reader.read();if(item.done){done();controller.close();}else controller.enqueue(item.value);}
   catch(error){controller.error(error);try{await reader.cancel(error);}catch{}}
  },
  async cancel(reason){await reader.cancel(reason);}
 });
 return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
async function upload(path,options){
 const blob=options.body,signal=options.signal,method=String(options.method||'GET').toUpperCase();
 if(method!=='POST'||new URL(path,location.href).pathname!=='/api/upload')throw problem('This selected file requires the original upload route.','REMOTE_UPLOAD_ROUTE');
 if(!Number.isSafeInteger(blob.size)||blob.size<0)throw problem('The selected file size is not supported by this browser.','REMOTE_FILE_SIZE');
 if(!crypto?.subtle)throw problem('This connection needs secure browser file verification.','REMOTE_CRYPTO');
 const headers=sourceHeaders(options.headers,blob),metadata={method,path,headers,body_bytes:blob.size};
 const signature=JSON.stringify(metadata);
 let known=heldFiles.get(blob)?.get(signature);
 if(!known){
  const key=await fileIdentity(blob,metadata,signal),saved=journalRead(key);
  known={key,id:saved?.id||crypto.randomUUID()};
  const records=heldFiles.get(blob)||new Map();records.set(signature,known);heldFiles.set(blob,records);
  journalWrite(key,{id:known.id,created_at:saved?.created_at||new Date().toISOString()});
 }
 const {id,key}=known,json={'Content-Type':'application/json'};
 const created=await control('/_eco/v1/requests',{method:'POST',headers:json,body:JSON.stringify({id,...metadata})},id,signal);
 if(created.id!==id)throw problem('The transfer returned a different request identity.','REMOTE_IDENTITY',id);
 // Replay exact chunks from zero when resuming. Durable duplicate acknowledgements
 // verify the content and never execute the native upload a second time.
 for(let offset=0;offset<blob.size;offset+=CHUNK_BYTES){
  abort(signal);
  const bytes=await blob.slice(offset,offset+CHUNK_BYTES).arrayBuffer(),sha256=hex(await hash(bytes,signal));
  const ack=await control('/_eco/v1/requests/'+id+'/input?offset='+offset,{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':sha256},body:bytes},id,signal);
  if(ack.id!==id||ack.input_offset!==offset+bytes.byteLength||ack.bytes!==bytes.byteLength||ack.sha256!==sha256)throw problem('The transfer did not confirm the selected file bytes.','REMOTE_CHUNK_MISMATCH',id);
 }
 const sealed=await control('/_eco/v1/requests/'+id+'/seal',{method:'POST',headers:json,body:JSON.stringify({body_bytes:blob.size})},id,signal);
 if(sealed.id!==id||sealed.sealed!==true)throw problem('The transfer has not confirmed the complete file.','REMOTE_SEAL',id);
 const response=await completeApiResponse(await outcome(id,signal),id,signal);
 return finishWhenRead(response,()=>{journalRemove(key,id);heldFiles.get(blob)?.delete(signature);},signal);
}
/** Keep the ordinary local fetch unchanged; the login marker enables remote transport. */
export async function operatorFetch(path,options={},capability=null){
 if(capability!==SESSION_MARKER)return fetch(path,options);
 abort(options.signal);
 const url=new URL(path,location.href);
 if(location.protocol!=='https:'||url.origin!==location.origin||url.username||url.password)throw problem('Open the original secure workbench address for this request.','REMOTE_ORIGIN');
 const originalPath=url.pathname+url.search;
 if(typeof Blob!=='undefined'&&options.body instanceof Blob)return upload(originalPath,options);
 const id=crypto.randomUUID(),headers=new Headers(options.headers);
 headers.delete('Authorization');headers.set('X-Eco-Request-ID',id);
 let response;
 try{response=await fetch(originalPath,{...options,headers,credentials:'same-origin',redirect:'error'});}
 catch(cause){abort(options.signal);return completeApiResponse(await outcome(id,options.signal),id,options.signal);}
 if(response.headers.get('X-Eco-Uncertain')==='1'){
  await response.body?.cancel();throw problem('The native request needs reconciliation. Check its original operation before submitting it again.','UPSTREAM_UNCERTAIN',id,response.status);
 }
 if(response.headers.get('X-Eco-Pending')==='1'){
  const returned=response.headers.get('X-Eco-Request-ID');
  await response.body?.cancel();
  if(returned&&returned!==id)throw problem('The connection returned a different request identity.','REMOTE_IDENTITY',id);
  return completeApiResponse(await outcome(id,options.signal),id,options.signal);
 }
 return completeApiResponse(response,id,options.signal);
}
