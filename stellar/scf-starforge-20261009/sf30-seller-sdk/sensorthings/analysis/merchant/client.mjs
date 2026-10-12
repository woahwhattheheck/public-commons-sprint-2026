// SPDX-License-Identifier: MIT
// Browser/Node client over the original authenticated workspace API.
export class MerchantClientError extends Error{
  constructor(code,message,{status=0,detail=null,operationId=null}={}){super(message);this.name='MerchantClientError';Object.assign(this,{code,status,detail,operationId});}
}
const fail=(code,message,more)=>{throw new MerchantClientError(code,message,more);};
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function parsePrivateLink(value){
  let u;try{u=new URL(value);}catch{fail('PRIVATE_LINK','Use the existing private workspace URL.');}
  const token=u.hash.slice(1);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||! /^[A-Za-z0-9_-]{32,200}$/.test(token))
    fail('PRIVATE_LINK','Use the original workspace URL with its private token fragment.');
  return {origin:u.origin,token};
}
export async function sha256(raw){const data=typeof raw==='string'?new TextEncoder().encode(raw):raw;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export class AnalysisMerchantClient{
  #token;#fetch;
  constructor({origin,token,workspaceId=null,fetch:fetcher=globalThis.fetch,timeoutMs=60000}){
    const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol))fail('ORIGIN','Use one actual original workspace origin.');
    if(!/^[A-Za-z0-9_-]{32,200}$/.test(token??''))fail('PRIVATE_LINK','Use the original private workspace token.');
    if(workspaceId!==null&&!UUID.test(workspaceId))fail('WORKSPACE','Use the original workspace UUID.');
    Object.assign(this,{origin,workspaceId,timeoutMs});this.#token=token;this.#fetch=fetcher;
  }
  async request(path,{rawBody,maximum=24*1024*1024,binary=false,allowUnbound=false,signal}={}){
    const u=new URL(path,this.origin);
    if(u.origin!==this.origin||!u.pathname.startsWith('/api/')||u.hash)fail('ROUTE','Use an original same-origin API route.');
    if(!allowUnbound&&!this.workspaceId)fail('WORKSPACE','Connect to the original workspace first.');
    const timeout=AbortSignal.timeout(this.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let res;try{res=await this.#fetch(u,{method:rawBody===undefined?'GET':'POST',redirect:'error',signal:combined,
      headers:{authorization:'Bearer '+this.#token,...(this.workspaceId?{'X-SensorThings-Workspace':this.workspaceId}:{}),
        ...(rawBody===undefined?{}:{'content-type':'application/json'})},...(rawBody===undefined?{}:{body:rawBody})});}
    catch{fail('TRANSPORT','The original request has no confirmed response. Recover its retained operation before continuing.');}
    const actual=res.headers.get('X-SensorThings-Workspace');
    if(this.workspaceId&&actual!==this.workspaceId)fail('WORKSPACE','The response belongs to another workspace.');
    const reader=res.body?.getReader(),chunks=[];let n=0;
    try{if(reader)while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;
      if(n>maximum){await reader.cancel();fail('CAPACITY','Use the retained streaming file receiver for this complete large file.');}chunks.push(r.value);}}
    catch(e){if(e instanceof MerchantClientError)throw e;fail('TRANSPORT','The original response ended before completion. Recover the same operation.');}
    finally{reader?.releaseLock();}
    const raw=new Uint8Array(n);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
    if(binary&&res.ok)return {raw,headers:res.headers};
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('RESPONSE','The original response is not complete UTF-8 JSON.');}
    if(!res.ok)fail(value.error?.code??value.error??'NATIVE_REQUEST',value.error?.message??value.message??'The original request was rejected.',
      {status:res.status,detail:value.details??value,operationId:value.operationId});
    return value;
  }
  async connect(){const schema=await this.request('/api/schema',{allowUnbound:true});
    if(!UUID.test(schema.workspaceId??'')||this.workspaceId&&this.workspaceId!==schema.workspaceId)fail('WORKSPACE','The selected original UUID differs.');
    if(!schema.actions?.['analysis.merchant.offer'])fail('INSTALL','The selected workspace lacks the complete merchant integration.');
    this.workspaceId=schema.workspaceId;return schema;
  }
  close(){this.#token='';}
  privateLink(path='/analysis/'){if(!path.startsWith('/analysis/'))fail('ROUTE','Use the same analysis application.');return this.origin+path+'#'+this.#token;}
  get key(){if(!this.workspaceId)fail('WORKSPACE','Connect first.');return this.origin+'|'+this.workspaceId;}
  overview(projectId){return this.request('/api/analysis/merchant'+(projectId?'/projects/'+encodeURIComponent(projectId):''));}
  record(id){return this.request('/api/analysis/merchant/records/'+encodeURIComponent(id));}
  operations(){return this.request('/api/analysis/merchant/operations');}
  operation(id){return this.request('/api/operations/'+encodeURIComponent(id));}
  merchantOperation(id){return this.request('/api/analysis/merchant/operations/'+encodeURIComponent(id));}
  inbox(){return this.request('/api/analysis/inbox');}
  inspectInput(selection){return this.request('/api/analysis/merchant/inputs?selection='+encodeURIComponent(JSON.stringify(selection)));}
  preview(selection){return this.request('/api/analysis/merchant/preview?selection='+encodeURIComponent(JSON.stringify(selection)));}
  files(id){return this.request('/api/files?selection='+encodeURIComponent(JSON.stringify({kind:'analysis',id})));}
  async actionRaw(raw){
    let request;try{request=JSON.parse(raw);}catch{fail('REQUEST','Keep the complete original JSON request.');}
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>2*1024*1024||!request.operationId)fail('REQUEST','Use the original bounded request with a stable ID.');
    return this.request('/api/action',{rawBody:raw});
  }
  async download(file,{maximum=256*1024*1024,signal}={}){
    if(!file.selection||! /^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes>maximum)
      fail('FILE_CAPACITY','Use the maintained CLI streaming download for this complete file.');
    const {raw}=await this.request('/api/files/download?selection='+encodeURIComponent(JSON.stringify(file.selection))+
      '&expectedSha256='+file.sha256,{binary:true,maximum,signal});
    if(raw.length!==file.bytes||await sha256(raw)!==file.sha256)fail('FILE_CHANGED','The received file differs from its original complete identity.');
    return {raw,name:file.name,type:file.type,bytes:raw.length,sha256:file.sha256};
  }
}
