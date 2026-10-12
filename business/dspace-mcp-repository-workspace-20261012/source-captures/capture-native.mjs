#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only capture of original DSpace HAL pages and public bitstream bytes.
// Uses the pinned 4Science client when --client-module is supplied.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const args={};
for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
const base=(args.base||'https://sandbox.dspace.org/server').replace(/\/$/,'');
const root=resolve(args.output||'dspace-source-capture');
const scope=args.scope||'dd1240ae-d7dd-405c-bdc3-d6c960609433';
const sourceCommit='ee503ba97910f592867c897c1fa938f9e029d03c';
const sourceClientBlob='24868f19a931f7295132dcec7ebf41e4415bf9e9';
const documentItems=['0bc64a68-f318-474e-b70c-1fa5e0eb6dbe','ab949daf-405c-4a84-8c4a-a7bd883fd7d2'];
const sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(join(root,'responses'),{recursive:true});
await mkdir(join(root,'files'),{recursive:true});
const started=new Date().toISOString();
const manifest={schema:'dspace-source-capture/v1',base_url:base,started_at:started,completed_at:null,status:'RUNNING',upstream:{repository:'4Science/dspace-mcp',commit:sourceCommit,client_blob:sourceClientBlob},access:{mode:'anonymous',methods:['GET'],credentials_used:false},requests:[],files:[],collections:[],scopes:[],items:[],bundles:[],bitstreams:[],failures:[]};
const save=async()=>{
 const file=join(root,'manifest.json'),temp=file+'.tmp';
 await writeFile(temp,JSON.stringify(manifest,null,2)+'\n');await rename(temp,file);
};
const put=async(path,bytes,extra={})=>{
 const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 await writeFile(join(root,path),buffer);
 const entry={path,sha256:sha(buffer),bytes:buffer.length,...extra};
 manifest.files.push(entry);return entry;
};
const nativeFetch=globalThis.fetch;
let sequence=0;
globalThis.fetch=async(input,init={})=>{
 const request=new Request(input,init);
 if(request.method!=='GET')throw new Error('This source capture accepts GET only.');
 if(request.headers.has('authorization')||request.headers.has('cookie'))throw new Error('This capture is strictly anonymous.');
 const url=new URL(request.url);
 if(url.origin!==new URL(base).origin||!url.pathname.startsWith(new URL(base).pathname+'/api/'))throw new Error('Source request left the selected public DSpace API.');
 const id=String(++sequence).padStart(4,'0');
 const startedAt=new Date().toISOString();
 let response=null,receivedAt=null;
 try{
  response=await nativeFetch(request,{signal:AbortSignal.timeout(60000)});
  receivedAt=new Date().toISOString();
  const body=Buffer.from(await response.clone().arrayBuffer());
  const type=response.headers.get('content-type')||'application/octet-stream';
  const path='responses/'+id+(/json/i.test(type)?'.json':/text/i.test(type)?'.txt':'.bin');
  const file=await put(path,body,{content_type:type});
  manifest.requests.push({id,method:request.method,url:request.url,status:response.status,started_at:startedAt,received_at:receivedAt,body_completed_at:new Date().toISOString(),response_url:response.url,redirected:response.redirected,content_type:type,response_headers:{'content-type':response.headers.get('content-type'),date:response.headers.get('date')},body_file:path,body_sha256:file.sha256,body_bytes:file.bytes});
  await save();return response;
 }catch(error){
  manifest.requests.push({id,method:request.method,url:request.url,status:response?.status??null,started_at:startedAt,received_at:receivedAt,response_url:response?.url??null,error:String(error)});
  await save();throw error;
 }
};
let client;
if(args['client-module']){
 const module=await import(pathToFileURL(resolve(args['client-module'])).href);
 client=new module.DSpaceClient(base);
 manifest.upstream.client_module_used=true;
}else{
 manifest.upstream.client_module_used=false;
 manifest.upstream.request_contract='Read-only GET paths and params from the exact pinned original DSpaceClient; no replacement MCP/server.';
 client={request:async(method,path,options={})=>{
  const url=new URL(base+path);
  for(const[k,v]of Object.entries(options.params||{}))if(v!==undefined)url.searchParams.set(k,String(v));
  const response=await fetch(url,{method,headers:{Accept:'application/json'}});
  const body=await response.text();let data;try{data=JSON.parse(body);}catch{data=body;}
  return {status:response.status,data,headers:response.headers};
 }};
}
const get=async(path,params={})=>{
 const response=await client.request('GET',path,{params});
 if(response.status!==200)throw new Error('HTTP '+response.status+' on '+path);
 if(!response.data||typeof response.data!=='object')throw new Error('Expected native JSON object on '+path);
 return response.data;
};
const pageAll=async(path,key,params={})=>{
 const rows=[],pages=[];let number=0,total=null;
 while(true){
  const value=await get(path,{...params,size:20,page:number});
  const envelope=key==='discover'?value._embedded?.searchResult:value;
  const page=envelope?.page;const items=key==='discover'?envelope?._embedded?.objects:envelope?._embedded?.[key];
  if(!page||!Array.isArray(items)||page.number!==number)throw new Error('Invalid native page envelope on '+path);
  if(total!==null&&total!==page.totalElements)throw new Error('Source result count changed during capture; retained pages identify the change.');
  total=page.totalElements;rows.push(...items);pages.push({number:page.number,size:page.size,totalElements:page.totalElements,totalPages:page.totalPages});
  if(number+1>=page.totalPages)break;
  number++;
 }
 if(rows.length!==total)throw new Error('Incomplete native result on '+path+': '+rows.length+'/'+total);
 return {rows,pages,total};
};
try{
 await save();
 const auth=await get('/api/authn/status');
 if(auth.authenticated===true)throw new Error('Expected the anonymous source principal.');
 manifest.access.status=auth;
 const communities=await pageAll('/api/core/communities/search/top','communities');
 manifest.communities=communities.rows;
 manifest.community_pages=communities.pages;
 const collections=await pageAll('/api/core/collections','collections');
 manifest.collections=collections.rows;manifest.collection_pages=collections.pages;
 const selected=await get('/api/core/collections/'+scope);
 if(!selected.uuid||selected.uuid!==scope)throw new Error('Selected collection identity changed.');
 const parentUrl=selected._links?.parentCommunity?.href;
 if(parentUrl){
  const parent=await get(new URL(parentUrl).pathname.replace(new URL(base).pathname,''));
  manifest.selected_parent_community=parent;
  manifest.selected_parent_collections=(await pageAll('/api/core/communities/'+parent.uuid+'/collections','collections')).rows;
 }
 const search=await pageAll('/api/discover/search/objects','discover',{dsoType:'item',scope});
 const found=search.rows.map(row=>row._embedded?.indexableObject);
 if(found.some(item=>!item?.uuid)||new Set(found.map(item=>item.uuid)).size!==found.length)throw new Error('Search repeated or omitted an original item identity.');
 manifest.scopes.push({scope,collection_name:selected.name,total:search.total,pages:search.pages,item_uuids:found.map(item=>item.uuid)});
 const ids=[...new Set([...found.map(item=>item.uuid),...documentItems])];
 for(const id of ids){
  const item=await get('/api/core/items/'+id);
  if(item.uuid!==id)throw new Error('Native item UUID mismatch.');
  manifest.items.push(item);
  const bundlePage=await pageAll('/api/core/items/'+id+'/bundles','bundles');
  for(const bundle of bundlePage.rows)manifest.bundles.push({item_uuid:id,original:bundle});
  if(documentItems.includes(id)){
   for(const bundle of bundlePage.rows.filter(b=>['ORIGINAL','TEXT','LICENSE'].includes(b.name))){
    const bitstreams=await pageAll('/api/core/bundles/'+bundle.uuid+'/bitstreams','bitstreams',{embed:'format'});
    for(const bitstream of bitstreams.rows){
     manifest.bitstreams.push({item_uuid:id,bundle_uuid:bundle.uuid,bundle_name:bundle.name,original:bitstream});
     const url=bitstream._links?.content?.href;
     if(!url)throw new Error('Missing native content link for '+bitstream.uuid);
     const response=await fetch(url,{method:'GET'});
     if(response.status!==200)throw new Error('Public bitstream HTTP '+response.status+' for '+bitstream.uuid);
     const bytes=Buffer.from(await response.arrayBuffer());
     if(bytes.length!==bitstream.sizeBytes)throw new Error('Original bitstream length changed: '+bitstream.uuid);
     const checksum=bitstream.checkSum;
     if(checksum?.checkSumAlgorithm&&checksum?.value){
      const algorithm=checksum.checkSumAlgorithm.toLowerCase().replace(/-/g,'');
      const actual=createHash(algorithm).update(bytes).digest('hex');
      if(actual.toLowerCase()!==checksum.value.toLowerCase())throw new Error('Native bitstream checksum differs: '+bitstream.uuid);
     }
     const extension=/pdf/i.test(bitstream._embedded?.format?.mimetype||'')?'.pdf':'.txt';
     const path='files/'+bitstream.uuid+extension;
     await put(path,bytes,{content_type:response.headers.get('content-type')||bitstream._embedded?.format?.mimetype||'application/octet-stream',bitstream_uuid:bitstream.uuid,item_uuid:id,bundle_uuid:bundle.uuid,bundle_name:bundle.name,original_name:bitstream.name,source_url:url,native_checksum:checksum});
     await save();
    }
   }
  }
 }
 manifest.completed_at=new Date().toISOString();manifest.status='COMPLETE';
 await save();
 console.log(JSON.stringify({status:manifest.status,manifest:join(root,'manifest.json'),communities:manifest.communities.length,collections:manifest.collections.length,selectedItems:search.total,capturedItems:manifest.items.length,requests:manifest.requests.length,originalFiles:manifest.files.filter(f=>f.bitstream_uuid).length,bytes:manifest.files.reduce((a,b)=>a+b.bytes,0)}));
}catch(error){
 manifest.status='FAILED';manifest.completed_at=new Date().toISOString();manifest.failures.push({at:manifest.completed_at,error:String(error)});
 await save();console.error(String(error));process.exitCode=1;
}finally{globalThis.fetch=nativeFetch;}
