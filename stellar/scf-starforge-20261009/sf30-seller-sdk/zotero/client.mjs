// MIT. Typed whole-file client for the original Zotero workspace.
import {readBytes} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,LIMIT,need,plain,parse,json,sha256,requestId} from './contracts.mjs';
export function readZoteroConnection(value) {
  need(plain(value)&&value.schema===SCHEMA.connection&&value.active===true,'ZOTERO_CONNECTION_INACTIVE');
  const url=new URL(value.url);need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&
    !url.search&&!url.username&&!url.password&&/^#token=[a-f0-9]{64}$/.test(url.hash),'ZOTERO_CONNECTION_INVALID');
  return {origin:url.origin,token:url.hash.slice(7),workspaceId:value.workspaceId,instanceId:value.instanceId};
}
export async function loadZoteroConnection(path) {
  const bytes=await readBytes(path,16384);
  return readZoteroConnection(parse(bytes));
}
export function createZoteroClient(connection,{fetchImpl=globalThis.fetch,timeoutMs=120000}={}) {
  const selected=connection.schema?readZoteroConnection(connection):connection;
  need(plain(selected)&&typeof selected.origin==='string'&&/^[a-f0-9]{64}$/.test(selected.token??''),'ZOTERO_CONNECTION_INVALID');
  const parsed=new URL(selected.origin);need(parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'&&parsed.port&&
    parsed.origin===selected.origin,'ZOTERO_CONNECTION_INVALID');
  let closed=false;const active=new Set();
  async function request(path,{method='GET',body=null,raw=false,headers={},signal}={}) {
    need(!closed,'ZOTERO_CLIENT_CLOSED');const controller=new AbortController();active.add(controller);
    const joined=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    try{
      const response=await fetchImpl(selected.origin+path,{method,headers:{Authorization:'Bearer '+selected.token,
        ...(body!==null?{'Content-Type':'application/json'}:{}),...headers},body,redirect:'error',signal:joined,cache:'no-store'});
      const chunks=[];let size=0;
      for await(const chunk of response.body??[]){size+=chunk.length;need(size<=LIMIT.transfer,'ZOTERO_CLIENT_RESPONSE_LIMIT');chunks.push(Buffer.from(chunk));}
      const bytes=Buffer.concat(chunks);
      if(!response.ok){let error;try{error=parse(bytes);}catch{};throw Object.assign(new Error(error?.error??'ZOTERO_HTTP_FAILURE'),
        {code:error?.error??'ZOTERO_HTTP_FAILURE',status:response.status,details:error?.details??{}});}
      if(raw){
        const expected=response.headers.get('x-content-sha256');need(expected&&expected===sha256(bytes),'ZOTERO_DOWNLOAD_HASH_MISMATCH');
        return {bytes,sha256:expected,contentType:response.headers.get('content-type'),
          filename:response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'zotero-download.json'};
      }
      return parse(bytes);
    }finally{active.delete(controller);}
  }
  async function verify(){
    const value=await request('/health');
    need(value.schema===SCHEMA.connection&&value.instanceId===selected.instanceId&&value.workspaceId===selected.workspaceId&&
      value.active===true,'ZOTERO_CONNECTION_INSTANCE_CHANGED');return value;
  }
  return {
    verify,state:()=>request('/api/state'),
    invoke:(method,input={},op=null)=>request('/api/invoke',{method:'POST',body:json({method,input,requestId:op})}),
    importDocuments:(bytes,{profileId,profileRevision,requestId:op})=>request('/api/import?'+new URLSearchParams({profileId,profileRevision:String(profileRevision)}),
      {method:'POST',body:Buffer.from(bytes),headers:{'X-Zotero-Request-Id':requestId(op)}}),
    download:input=>request('/api/download?'+new URLSearchParams(Object.entries(input).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>[k,String(v)])),{raw:true}),
    exportWorkspace:op=>request('/api/export?'+new URLSearchParams({requestId:requestId(op)}),{raw:true}),
    receiveWorkspace:(bytes,{name,requestId:op})=>request('/api/receive?'+new URLSearchParams({name}),{method:'POST',body:Buffer.from(bytes),
      headers:{'X-Zotero-Request-Id':requestId(op)}}),
    openReceiver:name=>request('/api/receiver/open',{method:'POST',body:json({name})}),
    shutdown:()=>request('/api/shutdown',{method:'POST',body:json({})}),
    close(){closed=true;for(const c of active)c.abort();active.clear();},
  };
}
