// SPDX-License-Identifier: MIT
import { readJson, absolute, digest } from '../postgres/publisher/files.mjs';
import { SCHEMA, need } from './core.mjs';
function origin(value) {const url=new URL(value);need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','GLEIF_CONNECTION_ORIGIN');return url.origin;}
export async function readGleifConnection(path) {
  const value=await readJson(absolute(path));
  need(value.schema===SCHEMA+'.connection'&&/^[A-Za-z0-9_-]{43}$/.test(value.token??'')&&typeof value.workspaceId==='string'&&typeof value.instanceId==='string'&&/^[a-f0-9]{64}$/.test(value.workspaceIdentity??''),'GLEIF_CONNECTION');
  origin(value.origin);return value;
}
export class GleifClient {
  constructor(binding,{fetchImpl=globalThis.fetch}={}){this.binding=binding;this.fetchImpl=fetchImpl;this.closed=false;this.pending=new Set();}
  static async connect(connectionFile,options={}){const client=new GleifClient(await readGleifConnection(connectionFile),options);await client.verify();return client;}
  async request(path,{method='GET',body,raw=false,signal}={}) {
    need(!this.closed,'GLEIF_CLIENT_CLOSED');need(path.startsWith('/api/')&&!path.startsWith('//'),'GLEIF_CLIENT_PATH');
    const controller=new AbortController();this.pending.add(controller);
    try{
      const response=await this.fetchImpl(origin(this.binding.origin)+path,{method,headers:{authorization:'Bearer '+this.binding.token,...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:signal?AbortSignal.any([signal,controller.signal,AbortSignal.timeout(120000)]):AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])});
      need(response.headers.get('x-gleif-instance')===this.binding.instanceId,'GLEIF_INSTANCE_CHANGED','The original application instance changed.',409);
      const pieces=[];let size=0;for await(const part of response.body??[]){size+=part.length;need(size<=256*1024*1024,'GLEIF_CLIENT_TOO_LARGE');pieces.push(Buffer.from(part));}
      const data=Buffer.concat(pieces);
      if(!response.ok){let value;try{value=JSON.parse(data);}catch{}throw Object.assign(new Error(value?.message??'The local request failed.'),{code:value?.error??'GLEIF_CLIENT_RESPONSE',status:response.status,notBefore:value?.notBefore});}
      return raw?data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    }finally{this.pending.delete(controller);}
  }
  async verify(){const value=await this.request('/api/identity');need(value.workspaceId===this.binding.workspaceId&&value.workspaceIdentity===this.binding.workspaceIdentity&&value.instanceId===this.binding.instanceId&&
    value.sourceIdentity?.sha256===this.binding.sourceIdentity?.sha256,'GLEIF_CONNECTION_CHANGED');return value;}
  status(){return this.request('/api/status');}
  rows(id,options={}){return this.request('/api/captures/'+encodeURIComponent(id)+'/rows?'+new URLSearchParams(Object.entries(options).map(([k,v])=>[k,String(v)])));}
  capture(id){return this.request('/api/captures/'+encodeURIComponent(id));}
  compare(before,after){return this.request('/api/compare?'+new URLSearchParams({before,after}));}
  monitoringPreview(input){return this.request('/api/monitoring-preview',{method:'POST',body:input});}
  operation(id){return this.request('/api/operations/'+encodeURIComponent(id));}
  start(request){return this.request('/api/start',{method:'POST',body:request});}
  pause(id){return this.request('/api/pause/'+encodeURIComponent(id),{method:'POST',body:{}});}
  async wait(id){for(;;){const result=await this.operation(id);if(!['PENDING','RUNNING'].includes(result.state))return result;await new Promise(resolve=>setTimeout(resolve,250));}}
  async run(request){await this.start(request);return this.wait(request.id);}
  package(){return this.request('/api/package');}
  packageFile(){return this.request('/api/package-file',{method:'POST',body:{}});}
  query(id,query=''){return this.request('/api/datasets/'+encodeURIComponent(id)+'/query?'+query);}
  async object(sha){const data=await this.request('/api/objects/'+sha,{raw:true});need(digest(data)===sha,'GLEIF_FILE_CHANGED');return data;}
  chunk(sha,offset=0,limit=65536){return this.request('/api/objects/'+sha+'?'+new URLSearchParams({offset:String(offset),limit:String(limit)}));}
  close(){this.closed=true;for(const controller of this.pending)controller.abort();this.pending.clear();}
}
