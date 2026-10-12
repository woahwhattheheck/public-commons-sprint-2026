import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {digest,fail} from './patch.mjs';

const context=new AsyncLocalStorage();
const realFetch=globalThis.fetch.bind(globalThis);
const secretPattern=/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
export const cleanError=e=>String(e?.message??e).replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [redacted]').replace(secretPattern,'[redacted JWT]');
const authPath=url=>/\/api\/(?:authn\/(?:login|logout)|security\/csrf)(?:[/?]|$)/.test(url);
function safeBody(value,url){if(authPath(url))return {authentication_exchange:true};if(typeof value!=='string')return value===undefined?undefined:{body_type:'multipart'};try{return JSON.parse(value);}catch{return value;}}
globalThis.fetch=async function observedFetch(input,init={}){
 const ctx=context.getStore();if(!ctx)return realFetch(input,init);
 const url=String(input instanceof Request?input.url:input),method=String(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
 const id=randomUUID(),base={id,method,url,started_at:new Date().toISOString(),request_body:safeBody(init.body,url)};
 await ctx.observe({phase:'before',...base});
 let response,receivedBytes=0;
 try{
  const signals=[AbortSignal.timeout(120000),init.signal].filter(Boolean);
  response=await realFetch(input,{...init,signal:AbortSignal.any(signals)});
  let bytes=Buffer.alloc(0),body;
  if(authPath(url))body={authentication_exchange:true};
  else {
   const limit=ctx.responseLimit??32*1024*1024,declared=Number(response.headers.get('content-length')||0);
   if(declared>limit){await response.body?.cancel();fail('RESPONSE_TOO_LARGE','The native response exceeds the configured receiving limit.',413);}
   const reader=response.clone().body?.getReader(),chunks=[];
   if(reader)for(;;){const part=await reader.read();if(part.done)break;receivedBytes+=part.value.length;if(receivedBytes>limit){await Promise.allSettled([reader.cancel(),response.body?.cancel()]);fail('RESPONSE_TOO_LARGE','The native response exceeds the configured receiving limit.',413);}chunks.push(Buffer.from(part.value));}
   bytes=Buffer.concat(chunks,receivedBytes);
   const type=response.headers.get('content-type')||'';
   if(/json/.test(type)){try{body=JSON.parse(bytes.toString('utf8'));}catch{body=bytes.toString('utf8');}}
   else if(/text|xml/.test(type))body=bytes.toString('utf8');
  }
  await ctx.observe({phase:'after',...base,status:response.status,response_url:response.url,redirected:response.redirected,received_at:new Date().toISOString(),content_type:response.headers.get('content-type')||'application/octet-stream',date:response.headers.get('date'),body,body_bytes:authPath(url)?null:bytes,body_sha256:authPath(url)?null:digest(bytes)});
  return response;
 }catch(error){await ctx.observe({phase:'error',...base,status:response?.status,content_type:response?.headers.get('content-type')??null,received_bytes:receivedBytes,error:cleanError(error),received_at:new Date().toISOString()});throw error;}
};

const isEnv=n=>!n||/^DSPACE_[A-Z0-9_]+$/.test(n);
export function validateProfile(profile){
 let u;try{u=new URL(profile.base_url);}catch{fail('INVALID_PROFILE','Provide an absolute DSpace REST URL.');}
 if(u.username||u.password||u.search||u.hash)fail('INVALID_PROFILE','Use a repository base URL without credentials, query or fragment.');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))fail('INVALID_PROFILE','Use HTTPS, or HTTP for a local development repository.');
 for(const [key,value]of Object.entries(profile.auth_env??{}))if(!['token','user','password'].includes(key)||typeof value!=='string'||!isEnv(value))fail('INVALID_PROFILE','Credential references must be DSPACE_ environment variable names.');
 return u.href.replace(/\/$/,'');
}
export class NativeBridge {
 constructor(profile,{upstreamRoot,observe}={}){
  this.profile=profile;this.upstreamRoot=upstreamRoot??path.join(path.dirname(fileURLToPath(import.meta.url)),'vendor/dspace-mcp');
  this.observe=observe??(()=>{});this.opened=false;this.authenticatedOnce=false;this.handlers=new Set();
 }
 async open(){
  if(this.opened)return;
  const from=p=>import(pathToFileURL(path.join(this.upstreamRoot,p)).href);
  const [{McpServer},{Client},{InMemoryTransport},{DSpaceClient},{registerAllTools}]=await Promise.all([
   from('node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js'),
   from('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'),
   from('node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js'),
   from('dist/services/dspace-client.js'),from('dist/tools/index.js')
  ]);
  this.native=new DSpaceClient(this.profile.base_url);
  for(const name of ['request','requestMultipart','downloadBitstreamContent','refreshCsrf']){
   const original=this.native[name].bind(this.native);
   this.native[name]=(...args)=>context.run(context.getStore()??{observe:this.observe},()=>original(...args));
  }
  // Keep the original tools and request implementation; extend their HAL reads to complete inventories.
  // ensureBundle in the upstream upload tool also uses these instance helpers.
  this.native.getItemBundles=uuid=>this.completePage('/api/core/items/'+encodeURIComponent(uuid)+'/bundles','bundles');
  this.native.getBundleBitstreams=uuid=>this.completePage('/api/core/bundles/'+encodeURIComponent(uuid)+'/bitstreams','bitstreams',{embed:'format'});
  this.server=new McpServer({name:'dspace-mcp',version:'1.0.0'});
  const register=this.server.tool.bind(this.server);
  this.server.tool=(...registration)=>{
   const callback=registration.pop(),toolName=registration[0];
   return register(...registration,(...args)=>{
    const invocation=this.invocation?.name===toolName?this.invocation:null,observer=invocation?.observe??this.observe;
    const task=context.run({observe:observer},async()=>callback(...args));
    this.handlers.add(task);task.then(result=>{if(invocation)invocation.result=result;this.handlers.delete(task);},error=>{if(invocation)invocation.error=error;this.handlers.delete(task);});
    return task;
   });
  };
  registerAllTools(this.server,this.native,{transport:'stdio'});
  this.client=new Client({name:'dspace-repository-workspace',version:'1.0.0'},{capabilities:{}});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await this.server.connect(serverTransport);await this.client.connect(clientTransport);
  this.tools=(await this.client.listTools()).tools;
  this.opened=true;
 }
 async authenticate(){
  await this.open();if(this.authenticatedOnce)return;
  const env=this.profile.auth_env||{},token=env.token?process.env[env.token]:undefined,user=env.user?process.env[env.user]:undefined,password=env.password?process.env[env.password]:undefined;
  if(token)this.native.setToken(token);else if(user&&password)await this.native.login(user,password);
  this.authenticatedOnce=true;
 }
 async status(){
  await this.authenticate();const data=await this.native.authStatus();
  if(typeof data?.authenticated!=='boolean')fail('INVALID_NATIVE_RESPONSE','DSpace did not return an authentication status object. Inspect its retained HTTP response.',502);
  const person=data._embedded?.eperson;
  return {authenticated:data.authenticated,principal:data.authenticated?{uuid:person?.uuid??null,email:person?.email??null,name:person?.name??null}:{uuid:'anonymous',email:null,name:'Anonymous'},checked_at:new Date().toISOString()};
 }
 async call(name,args){
  await this.authenticate();
  await Promise.allSettled([...this.handlers]);
  const invocation={name,observe:this.observe};this.invocation=invocation;
  let result,error;
  try{result=await this.client.callTool({name,arguments:args},undefined,{timeout:180000});}catch(e){error=e;}
  finally{await Promise.allSettled([...this.handlers]);this.invocation=null;}
  if(error){if(invocation.result)return {...invocation.result,_meta:{...invocation.result._meta,'repository-workspace/transport-recovery':{handler_completed:true,error:cleanError(error)}}};throw error;}
  return result;
 }
 async item(uuid){await this.authenticate();return this.native.getItemTyped(uuid);}
 async collection(uuid){await this.authenticate();return this.native.getCollection(uuid);}
 async owner(uuid){await this.authenticate();const r=await this.native.request('GET','/api/core/items/'+encodeURIComponent(uuid)+'/owningCollection');if(r.status>=400)fail('NATIVE_READ_FAILED','Original item owning collection returned HTTP '+r.status,502);return r.data;}
 async workspace(id){await this.authenticate();const r=await this.native.request('GET','/api/submission/workspaceitems/'+encodeURIComponent(id));if(r.status>=400)fail('NATIVE_READ_FAILED','Original workspace item returned HTTP '+r.status,502);return r.data;}
 async workspaceCollection(id){await this.authenticate();const r=await this.native.request('GET','/api/submission/workspaceitems/'+encodeURIComponent(id)+'/collection');if(r.status>=400||!r.data?.uuid)fail('NATIVE_READ_FAILED','Original draft collection could not be read.',502);return r.data;}
 async completePage(endpoint,key,params={}){
  const rows=[],seen=new Set();let expectedTotal,expectedPages;
  for(let page=0;page<100;page++){
   const r=await this.native.request('GET',endpoint,{params:{...params,page,size:100}});
   if(r.status<200||r.status>=300)fail('NATIVE_READ_FAILED','Original '+key+' inventory returned HTTP '+r.status,502);
   const meta=r.data?.page,part=r.data?._embedded?.[key]??[];
   if(!meta||!Array.isArray(part)||!Number.isInteger(meta.number)||meta.number!==page||!Number.isInteger(meta.totalElements)||meta.totalElements<0||!Number.isInteger(meta.totalPages)||meta.totalPages<0||!Number.isInteger(meta.size)||meta.size<1)fail('INCOMPLETE_INVENTORY','Original '+key+' page metadata is missing or invalid.',502);
   if(page===0){expectedTotal=meta.totalElements;expectedPages=meta.totalPages;}
   else if(meta.totalElements!==expectedTotal||meta.totalPages!==expectedPages)fail('INVENTORY_CHANGED','The native '+key+' inventory changed while paging. Refresh it before continuing.',409);
   for(const object of part){const identity=object?.uuid??object?.id;if(identity===undefined||seen.has(String(identity)))fail('INCOMPLETE_INVENTORY','Original '+key+' pages contain missing or repeated identities.',502);seen.add(String(identity));rows.push(object);}
   if(page+1>=expectedPages){if(rows.length!==expectedTotal)fail('INCOMPLETE_INVENTORY','The original '+key+' inventory does not match its declared total.',502);return rows;}
   if(!part.length)fail('INCOMPLETE_INVENTORY','The original '+key+' inventory ended before its declared final page.',502);
  }
  fail('COHORT_TOO_LARGE','The native '+key+' inventory exceeds 10,000 records.');
 }
 async bundles(uuid){await this.authenticate();return this.native.getItemBundles(uuid);}
 async bitstreams(uuid){await this.authenticate();return this.native.getBundleBitstreams(uuid);}
 async download(uuid){await this.authenticate();return this.native.downloadBitstreamContent(uuid);}
 async workspaceList(){await this.authenticate();return this.completePage('/api/submission/workspaceitems','workspaceitems');}
 async close(){await Promise.allSettled([...this.handlers]);await this.client?.close();await this.server?.close();}
}
export function extractObjects(requests){
 const out=new Map(),types=new Set(['item','community','collection','workspaceitem','bundle','bitstream']);
 function visit(value){if(!value||typeof value!=='object')return;if(types.has(value.type)&&(value.uuid!==undefined||value.id!==undefined)){const key=value.type+':'+(value.uuid??value.id),old=out.get(key);if(!old||JSON.stringify(value).length>JSON.stringify(old).length)out.set(key,structuredClone(value));}if(Array.isArray(value)){value.forEach(visit);return;}if(value._embedded)visit(value._embedded);for(const key of ['objects','searchResult','items','communities','collections','workspaceitems','indexableObject','item','collection','bundles','bitstreams'])if(value[key])visit(value[key]);}
 for(const r of requests)if((r.status>=200&&r.status<300)||(r.status==null&&['provider-extracted-native-json','retained-native-object'].includes(r.source_mode)))visit(r.body);
 return [...out.values()];
}

