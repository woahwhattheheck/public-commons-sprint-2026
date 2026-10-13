// MIT. One original HTTP attempt, retained before use; credentials never enter public evidence.
import {need,keys,object,clone,canonical,identity,hash,decode64,text} from './value.mjs';
import {parseSourceJSON} from './source-json.mjs';
import {allowedOrigins,errorRecord,stamp} from './protocol.mjs';
const PRIVATE_HEADERS=new Set(['authorization','proxy-authorization','cookie','set-cookie','x-api-key','api-key']);
export function requestSelection(spec,config,descriptor){
 keys(spec,['url','method','headers','bodyBase64','credential','semantics','timeoutMs','maxBytes','privateResponse'],['url','method','semantics']);
 const u=new URL(text(spec.url,16384));need(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash&&allowedOrigins(config,descriptor).has(u.origin),'HTTP_ORIGIN_NOT_SELECTED',{origin:u.origin});
 need(['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(spec.method),'HTTP_METHOD');
 need(['read','write'].includes(spec.semantics),'HTTP_SEMANTICS_REQUIRED');need(spec.semantics!=='write'||descriptor.mode==='external-write','EXPLICIT_EXTERNAL_ACTION_REQUIRED');
 const headers={};for(const [name,value]of Object.entries(spec.headers??{})){const key=name.toLowerCase();need(/^[!#$%&'*+.^_\x60|~0-9a-z-]+$/.test(key)&&!PRIVATE_HEADERS.has(key)&&!['host','content-length','connection','transfer-encoding'].includes(key)&&typeof value==='string'&&!/[\r\n]/.test(value),'PUBLIC_HEADER_REQUIRED');need(!Object.hasOwn(headers,key),'DUPLICATE_HEADER');headers[key]=value;}
 const body=spec.bodyBase64===undefined?null:decode64(spec.bodyBase64);need(!body||body.length<=32*1024*1024,'HTTP_BODY_CAPACITY');need(!body||!['GET','HEAD'].includes(spec.method),'HTTP_BODY_METHOD');
 const timeoutMs=spec.timeoutMs??60000,maxBytes=spec.maxBytes??32*1024*1024;need(Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=120000&&Number.isInteger(maxBytes)&&maxBytes>=0&&maxBytes<=128*1024*1024,'HTTP_BOUNDS');
 if(spec.credential)text(spec.credential,200);
 return {url:u.href,method:spec.method,headers,bodyBase64:body?.toString('base64')??null,credential:spec.credential??null,semantics:spec.semantics,timeoutMs,maxBytes,privateResponse:spec.privateResponse===true};
}
export function decodeResponse(row,data){
 need(row.status==='COMPLETE'&&data.length===row.response.bytes&&hash(data)===row.response.sha256,'EXCHANGE_SOURCE_CHANGED');
 let textValue=null,parsed=null,numberTokens={},parseError=null;
 try{textValue=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch(error){parseError=errorRecord(Object.assign(error,{code:'RESPONSE_NOT_UTF8'}));}
 if(textValue!==null)try{const p=parseSourceJSON(data,{maxBytes:row.selection.maxBytes});parsed=p.value;numberTokens=p.numberTokens;}catch(error){parseError=errorRecord(error);}
 return {exchangeId:row.id,url:row.selection.url,status:row.response.status,statusText:row.response.statusText,headers:clone(row.response.headers),observedAt:row.response.observedAt,bodyBase64:data.toString('base64'),bytes:data.length,sha256:hash(data),text:textValue,parsed,numberTokens,parseError};
}
export async function originalHTTP({owner,request,lane,index,spec,configuration,descriptor,signal,replayOnly=false}){
 const selection=requestSelection(spec,configuration,descriptor),id='exchange-'+identity({requestId:request.id,lane,index}),binding={requestId:request.id,lane,index,actionId:descriptor.id,configurationSha256:identity(configuration),selection};
 let row=owner.exchange(id);
 if(row){need(row.bindingSha256===identity(binding),'ORIGINAL_EXCHANGE_CHANGED');if(row.status==='COMPLETE')return decodeResponse(row,owner.exchangeBytes(row));need(!replayOnly,'RETAINED_EXCHANGE_INCOMPLETE');throw Object.assign(new Error('ORIGINAL_EXCHANGE_UNRESOLVED'),{code:'ORIGINAL_EXCHANGE_UNRESOLVED'});}
 need(!replayOnly,'RETAINED_EXCHANGE_MISSING');signal?.throwIfAborted();
 // Admission of the external attempt is durable before fetch is called.
 row={id,...binding,bindingSha256:identity(binding),status:'RESERVED',createdAt:stamp(),response:null,error:null};
 owner.saveExchange(row);
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason),timer=setTimeout(()=>controller.abort(new Error('HTTP_TIMEOUT')),selection.timeoutMs);
 signal?.addEventListener('abort',abort,{once:true});
 let response,reader,chunks=[],size=0,bodyComplete=false,failure=null;
 try{
  const headers={...selection.headers};if(selection.credential){
   const credential=await owner.resolveCredential(selection.credential,request,selection.url);
   need(credential&&Array.isArray(credential.origins)&&credential.origins.includes(new URL(selection.url).origin)&&object(credential.headers),'CREDENTIAL_ORIGIN_BINDING_REQUIRED');
   const privateSha256=owner.savePrivate(id+'-authorization',{alias:selection.credential,headers:credential.headers});row={...row,authorization:{alias:selection.credential,headerNames:Object.keys(credential.headers).map(v=>v.toLowerCase()).sort(),privateSha256}};owner.saveExchange(row);
   for(const [name,value]of Object.entries(credential.headers)){need(typeof value==='string'&&!/[\r\n]/.test(name+value),'CREDENTIAL_HEADER_INVALID');need(!Object.hasOwn(headers,name.toLowerCase()),'CREDENTIAL_HEADER_CONFLICT');headers[name.toLowerCase()]=value;}
  }
  response=await owner.fetch(selection.url,{method:selection.method,headers,body:selection.bodyBase64===null?undefined:decode64(selection.bodyBase64),redirect:'error',signal:controller.signal});
  const observed=Object.fromEntries(response.headers.entries()),privateHeaderNames=Object.keys(observed).filter(k=>PRIVATE_HEADERS.has(k));
  const publicHeaders={};for(const [k,v]of Object.entries(observed))if(!PRIVATE_HEADERS.has(k))publicHeaders[k]=v;
  row={...row,status:'READING',response:{status:response.status,statusText:response.statusText,headers:publicHeaders,privateHeaderNames,observedAt:stamp(),bytes:null,sha256:null,bodyFileId:null,private:selection.privateResponse||privateHeaderNames.length>0}};
  if(privateHeaderNames.length)row.response.privateHeadersSha256=owner.savePrivate(id+'-headers',observed);owner.saveExchange(row);
  if(response.body){reader=response.body.getReader();for(;;){const part=await reader.read();if(part.done)break;const b=Buffer.from(part.value);size+=b.length;need(size<=selection.maxBytes,'HTTP_RESPONSE_CAPACITY');chunks.push(b);}}
  bodyComplete=true;
 }catch(error){failure=error;}
 finally{
  if(reader){try{if(!bodyComplete)await reader.cancel(failure).catch(()=>{});}finally{reader.releaseLock();}}
  else if(response?.body&&!bodyComplete)await response.body.cancel(failure).catch(()=>{});
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
 }
 const body=Buffer.concat(chunks);
 if(failure){owner.finishExchange({...row,status:'UNCERTAIN',error:errorRecord(failure)},body,false);throw failure;}
 const complete=owner.finishExchange({...row,status:'COMPLETE',completedAt:stamp(),error:null},body,true);
 return decodeResponse(complete,body);
}
