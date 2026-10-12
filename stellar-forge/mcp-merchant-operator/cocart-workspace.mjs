// MIT. Original CoCart customer workspaces through the shared merchant provider.
import { constants } from 'node:fs';
import { open, realpath, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exact, failure, identifier, line, plain } from './host-files.mjs';
import { RetainedFileReads, MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { CartWorkspace, CartError, validateProfile, inspectReceiving } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/workspace.mjs';
import { loadSDK } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/server.mjs';
import { validateHandoff } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/buyer.mjs';

export const COCART_CONNECTION_SCHEMA='stellar-forge.cocart-workspace-connection.v1';
export const COCART_EXPORT_SCHEMA='stellar-forge.cocart-workspace-export.v1';
const MAX_SOURCE_BYTES=256_000_000, HASH=/^[a-f0-9]{64}$/;
const digest=b=>createHash('sha256').update(b).digest('hex');
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const hash={type:'string',pattern:HASH.source};
const nativeId={type:'string',pattern:'^[a-z]+-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};
const short={type:'string',minLength:1,maxLength:160};
const base={workspace:alias}, version={...base,expectedVersion:hash};
const paged={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},expectedVersion:hash};
const read={readOnly:true,idempotent:true};
const write={readOnly:false,idempotent:false};
const live={...write,openWorld:true};
const sourceKind={type:'string',enum:['profile','handoff','receiving']};
const definitions=[
 ['merchant_cocart_workspaces','List the host-declared original CoCart workspaces, input aliases and native SDK selection.',base,[],read],
 ['merchant_cocart_state','Read the original saved workspace, selected cart and paged history. Later pages require the same workspace revision.',
  {...base,...paged,view:{type:'string',enum:['summary','carts','events','catalogs','catalog','cart','operations','snapshots','checkouts']},cartId:nativeId,catalogId:nativeId},['workspace'],read],
 ['merchant_cocart_source','Inspect and validate the complete original merchant profile, Woo handoff or receiving export before selecting it.',
  {...base,kind:sourceKind,input:alias},['workspace','kind'],read],
 ['merchant_cocart_create','Create this declared empty workspace from the exact reviewed original merchant profile and its host-selected receiving transport.',
  {...base,expectedSourceSha256:hash},['workspace','expectedSourceSha256'],write],
 ['merchant_cocart_receive','Receive a complete original export into this declared destination, or reopen its same prior receiving operation.',
  {...base,input:alias,expectedSourceSha256:hash},['workspace','input','expectedSourceSha256'],{...write,idempotent:true}],
 ['merchant_cocart_catalog','Read an actual native product page through the original SDK and retain its original response and pagination.',
  {...version,search:{type:'string',maxLength:200},page:{type:'integer',minimum:1,maximum:10000},perPage:{type:'integer',minimum:1,maximum:100}},['workspace','expectedVersion'],live],
 ['merchant_cocart_cart_create','Create or attach one actual native guest cart. Retain the returned original cart identity before continuing.',
  {...version,label:short,cartKey:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'}},['workspace','label','expectedVersion'],live],
 ['merchant_cocart_cart_refresh','Read the same original guest cart through the original SDK and retain a native snapshot.',
  {...version,cartId:nativeId},['workspace','cartId','expectedVersion'],live],
 ['merchant_cocart_cart_prepare','Prepare a specific original cart mutation against a fresh native snapshot; preserve requestId for recovery.',
  {...version,cartId:nativeId,action:{type:'string',enum:['add','quantity','remove','restore','calculate','clear']},requestId:{type:'string',pattern:'^[A-Za-z0-9_.:-]{1,160}$'},productId:{type:'string',pattern:'^[1-9][0-9]{0,17}$'},itemKey:{type:'string',minLength:1,maxLength:160},quantity:{type:'integer',minimum:0,maximum:100000}},['workspace','cartId','action','requestId','expectedVersion'],{...live,idempotent:true}],
 ['merchant_cocart_cart_apply','Apply the selected original prepared operation. A repeated completed operation returns its retained outcome.',
  {...version,cartId:nativeId,operationId:nativeId},['workspace','cartId','operationId','expectedVersion'],{...live,idempotent:true}],
 ['merchant_cocart_cart_reconcile','Observe the original cart after an interrupted operation and record the selected disposition with its native reason.',
  {...version,cartId:nativeId,operationId:nativeId,decision:{type:'string',enum:['inspect','accept_current','confirmed_not_applied']},reason:{type:'string',maxLength:2000}},['workspace','cartId','operationId','decision','expectedVersion'],live],
 ['merchant_cocart_checkout_prepare','Read the native cart and prepare explicit replacement or merged Woo checkout, retaining its admission decision and exact URL.',
  {...version,cartId:nativeId,mode:{type:'string',enum:['replace','merge']}},['workspace','cartId','mode','expectedVersion'],live],
 ['merchant_cocart_woo_attach','Attach an exact host-declared original Woo buyer handoff to the cart checkout that produced its order.',
  {...version,cartId:nativeId,previewId:nativeId,input:alias,expectedSourceSha256:hash},['workspace','cartId','previewId','input','expectedSourceSha256','expectedVersion'],write],
 ['merchant_cocart_transport_rebind','Rebind an existing local receiving workspace to the transport selected in its private host connection.',
  version,['workspace','expectedVersion'],write],
 ['merchant_cocart_export','Export the complete original workspace and reachable objects under a stable exportId. Reopening the same export retains its exact bytes.',
  {...version,exportId:alias},['workspace','exportId','expectedVersion'],{...write,idempotent:true}],
 ['merchant_cocart_export_status','Validate and inspect an existing complete customer export and its exact original file.',
  {...base,exportId:alias},['workspace','exportId'],read],
 ['merchant_cocart_file','Retrieve the complete original export file in verified chunks; continue with its readId, hash and nextOffset.',
  {...base,exportId:alias,file:{type:'string',enum:['manifest.json','CoCart_Receiving_Workspace.json']},expectedManifestSha256:hash,expectedSha256:hash,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','exportId','file','expectedManifestSha256'],read],
 ['merchant_cocart_file_release','Release this provider-owned temporary file read after receiving the original bytes.',
  {...base,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'}},['workspace','readId'],read]
];
export const cocartWorkspaceTools=tool=>definitions.map(parts=>tool(...parts));
const schemas=new Map(definitions.map(([name,,properties,required])=>[name,{type:'object',properties,required,additionalProperties:false}]));
function check(s,v) {
 if(s.enum&&!s.enum.includes(v))return false;
 if(s.type==='object')return plain(v)&&(s.required||[]).every(k=>Object.hasOwn(v,k))&&Object.entries(v).every(([k,x])=>Object.hasOwn(s.properties,k)&&check(s.properties[k],x));
 if(s.type==='integer')return Number.isSafeInteger(v)&&v>=(s.minimum??0)&&v<=(s.maximum??Number.MAX_SAFE_INTEGER);
 if(typeof v!==s.type)return false;
 return s.type!=='string'||((s.minLength===undefined||v.length>=s.minLength)&&(s.maxLength===undefined||v.length<=s.maxLength)&&(!s.pattern||new RegExp(s.pattern).test(v)));
}
function need(ok,code,message,details) {if(!ok)throw Object.assign(failure('COCART_MCP_'+code,message),details?{details}:{});}
const decode=b=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{throw failure('COCART_MCP_JSON_INVALID','Select an original UTF-8 JSON file.');}};
async function hostFile(path,maximum=MAX_SOURCE_BYTES,{privateFile=false}={}) {
 const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try {const s=await h.stat();need(s.isFile()&&s.size<=maximum,'SOURCE_INVALID','Use the declared regular source file within its receiving capacity.');
  if(privateFile)need(process.platform==='win32'||!(s.mode&0o077),'CONFIGURATION_PRIVATE','Use a mode-0600 private connection file.');
  const b=await h.readFile();need(b.length<=maximum,'SOURCE_INVALID','The original source exceeds its receiving capacity.');return b;
 }finally{await h.close();}
}
async function directory(path,create=false) {
 if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path,'DIRECTORY_INVALID','Use the original real private directory.');
 need(process.platform==='win32'||!(s.mode&0o077),'DIRECTORY_PRIVATE','Use an operator-owned mode-0700 private directory.');
 return path;
}
const hostPath=(v,base)=>{need(typeof v==='string'&&v.length>0&&!/[\0\r\n]/.test(v),'CONFIGURATION_INVALID','Choose a host-declared original path.');return resolve(base,v);};
export async function readCocartWorkspaceConfiguration(path) {
 path=resolve(path);const raw=decode(await hostFile(path,1_048_576,{privateFile:true})),base=dirname(path);
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===COCART_CONNECTION_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'CONFIGURATION_INVALID','Declare one to thirty-two original customer workspaces.');
 const workspaces=Object.create(null),seen=new Set();
 for(const [name,row]of Object.entries(raw.workspaces)){
  identifier(name,'CoCart workspace alias');exact(row,['label','directory','sdkModule','profile','handoffs','receivingInputs','receivingTransport'],['directory']);
  const root=hostPath(row.directory,base);await directory(root);need(!seen.has(root),'WORKSPACE_DUPLICATE','Use one alias per original customer workspace.');seen.add(root);
  const selected={label:line(row.label??name),directory:root,handoffs:Object.create(null),receivingInputs:Object.create(null)};
  if(row.sdkModule!==undefined){need(typeof row.sdkModule==='string'&&row.sdkModule.length>0,'SDK_INVALID','Select the original SDK module.');selected.sdkModule=row.sdkModule==='@cocartheadless/sdk'?row.sdkModule:hostPath(row.sdkModule,base);}
  if(row.profile!==undefined)selected.profile=hostPath(row.profile,base);
  for(const kind of ['handoffs','receivingInputs']){need(plain(row[kind]??{})&&Object.keys(row[kind]??{}).length<=128,'CONFIGURATION_INVALID','Declare up to 128 original file aliases per input kind.');
   for(const [key,value]of Object.entries(row[kind]??{})){identifier(key,'CoCart input alias');selected[kind][key]=hostPath(value,base);}
  }
  if(row.receivingTransport!==undefined){exact(row.receivingTransport,['store_url','checkout_url','reason'],['store_url','checkout_url','reason']);
   for(const key of ['store_url','checkout_url']){const u=new URL(row.receivingTransport[key]);need(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.hash,'TRANSPORT_INVALID','Select an explicit original loopback HTTP receiving transport.');}
   selected.receivingTransport={...row.receivingTransport,reason:line(row.receivingTransport.reason)};
  }
  workspaces[name]=selected;
 }
 return {workspaces};
}
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
function summary(view) {return {...pick(view,['schema','revision','created_at','updated_at','version','source','profile','profile_source']),carts:view.carts.length,catalogs:view.catalogs.length,events:view.events.length};}
function cartSummary(cart) {const current=cart.snapshots.find(s=>s.id===cart.current_snapshot);return {...pick(cart,['id','label','cart_key','created_at','updated_at','current_snapshot']),current:current??null,operations:cart.operations.length,snapshots:cart.snapshots.length,checkouts:cart.handoffs.length};}
function page(rows,args,version){const offset=args.offset??0,limit=args.limit??25;need(offset===0||args.expectedVersion,'PAGE_VERSION_REQUIRED','Repeat expectedVersion from the first page.');need(args.expectedVersion===undefined||args.expectedVersion===version,'PAGE_CHANGED','The saved workspace changed. Read its current first page.');const selected=rows.slice(offset,offset+limit);return{version,offset,limit,total:rows.length,nextOffset:offset+selected.length<rows.length?offset+selected.length:null,rows:selected};}
async function writeAtomic(path,bytes) {
 const temp=path+'.new-'+randomUUID();let h;
 try{
  h=await open(temp,'wx',0o600);await h.writeFile(bytes);await h.sync();await h.close();h=null;
  await rename(temp,path);const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}
 }finally{try{await h?.close();}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
}
export class MerchantCocartWorkspaces {
 #config;#workspaces;#files;#pending=new Set();#closing=false;#close;#sdks=new Map();
 constructor(config){this.#config=config;this.#workspaces=config.cocartWorkspaces?.workspaces??{};this.#files=new RetainedFileReads({errorPrefix:'COCART_MCP'});}
 get summary(){return{configured:Object.keys(this.#workspaces).length>0,workspaces:Object.keys(this.#workspaces).length,pendingOperations:this.#pending.size,...this.#files.summary};}
 #selected(name){const row=this.#workspaces[name];need(row,'WORKSPACE_UNKNOWN','Choose a host-declared customer workspace.');return row;}
 async #workspace(row,live=false){await directory(row.directory);let sdk={};if(live){const key=row.sdkModule||'@cocartheadless/sdk';if(!this.#sdks.has(key)){const loading=loadSDK(key).catch(error=>{this.#sdks.delete(key);throw error;});this.#sdks.set(key,loading);}sdk=await this.#sdks.get(key);}return new CartWorkspace({root:row.directory,...sdk});}
 async #source(row,kind,input){
  let path;if(kind==='profile'){need(input===undefined,'INPUT_INVALID','This workspace has one original profile.');path=row.profile;}
  else path=(kind==='handoff'?row.handoffs:row.receivingInputs)[input];
  need(path,'SOURCE_UNKNOWN','Choose the original input declared by this host.');
  const bytes=await hostFile(path),sourceSha256=digest(bytes);let value=decode(bytes),view;
  if(kind==='profile')view=validateProfile(value);
  else if(kind==='handoff')view=validateHandoff(value);
  else{value=inspectReceiving(bytes);view={schema:value.schema,createdAt:value.created_at,workspaceVersion:value.workspace_version,workspace:summary({...value.workspace,version:value.workspace_version}),objects:value.objects.length,contentSha256:value.content_sha256};}
  return{bytes,value,sourceSha256,view,kind,input:input??null};
 }
 #sourceView(s){return{kind:s.kind,input:s.input,bytes:s.bytes.length,sourceSha256:s.sourceSha256,value:s.view};}
 async #exportDirectory(args,create=false){let p=await directory(this.#config.exportsDirectory);for(const part of ['cocart',args.workspace,args.exportId])p=await directory(join(p,part),create);return p;}
 async #manifest(args){
  const dir=await this.#exportDirectory(args),bytes=await hostFile(join(dir,'manifest.json'),1_048_576),manifest=decode(bytes);
  need(manifest.schema===COCART_EXPORT_SCHEMA&&manifest.workspace===args.workspace&&manifest.exportId===args.exportId&&HASH.test(manifest.workspaceVersion)&&Array.isArray(manifest.files)&&manifest.files.length===1,'EXPORT_INVALID','The original export identity changed.');
  const f=manifest.files[0];need(f.name==='CoCart_Receiving_Workspace.json'&&HASH.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=MAX_SOURCE_BYTES,'EXPORT_INVALID','The original receiving manifest changed.');
  const data=await hostFile(join(dir,f.name));need(data.length===f.bytes&&digest(data)===f.sha256,'EXPORT_INCOMPLETE','Recover this same export from its original retained file.');
  return{dir,bytes,manifest,manifestSha256:digest(bytes),data};
 }
 async #export(args,row){
  const dir=await this.#exportDirectory(args,true),lock=join(dir,'export.lock');let handle;
  try{handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));}
  catch(e){if(handle){try{await handle.close();}finally{await unlink(lock);}}if(e.code==='EEXIST')throw failure('COCART_MCP_EXPORT_BUSY','The original export writer owns this destination.');throw e;}
  try{
   const path=join(dir,'CoCart_Receiving_Workspace.json'),manifestPath=join(dir,'manifest.json');let existing=false;
   try{await lstat(manifestPath);existing=true;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(existing){const result=await this.#manifest(args);need(result.manifest.workspaceVersion===args.expectedVersion,'EXPORT_VERSION_CHANGED','Use this export with its original reviewed workspace revision.');return{reused:true,manifest:result.manifest,manifestSha256:result.manifestSha256};}
   let bytes,retained=true;try{bytes=await hostFile(path);}catch(e){if(e.code!=='ENOENT')throw e;retained=false;const w=await this.#workspace(row);bytes=w.receivingBundle();}
   const original=inspectReceiving(bytes);need(original.workspace_version===args.expectedVersion,'REVISION_CHANGED','Export the original reviewed workspace revision.');
   if(!retained)await writeAtomic(path,bytes);
   const manifest={schema:COCART_EXPORT_SCHEMA,workspace:args.workspace,exportId:args.exportId,workspaceVersion:original.workspace_version,createdAt:original.created_at,source:original.source,objects:original.objects.length,files:[{name:'CoCart_Receiving_Workspace.json',bytes:bytes.length,sha256:digest(bytes)}]};
   await writeAtomic(manifestPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
   const completed=await this.#manifest(args);return{manifest:completed.manifest,manifestSha256:completed.manifestSha256};
  }finally{try{await handle?.close();}finally{await unlink(lock);}}
 }
 async #execute(name,args){
  if(name==='merchant_cocart_workspaces'){const entries=args.workspace?[[args.workspace,this.#selected(args.workspace)]]:Object.entries(this.#workspaces);return{schema:COCART_CONNECTION_SCHEMA,...this.summary,entries:entries.map(([alias,row])=>({alias,label:row.label,sdkModule:row.sdkModule??'@cocartheadless/sdk',profileConfigured:!!row.profile,handoffs:Object.keys(row.handoffs),receivingInputs:Object.keys(row.receivingInputs),receivingTransport:row.receivingTransport??null,fileReads:this.#files.status(alias)}))};}
  const row=this.#selected(args.workspace);
  if(name==='merchant_cocart_source')return this.#sourceView(await this.#source(row,args.kind,args.input));
  if(name==='merchant_cocart_create'){
   const s=await this.#source(row,'profile');need(s.sourceSha256===args.expectedSourceSha256,'SOURCE_CHANGED','Read and select the exact original merchant profile.');
   await directory(row.directory);const w=new CartWorkspace({root:row.directory,create:true,profile:s.value,profileBytes:s.bytes,receivingTransport:row.receivingTransport??null});
   return{workspace:summary(w.view()),sourceSha256:s.sourceSha256};
  }
  if(name==='merchant_cocart_receive'){
   const s=await this.#source(row,'receiving',args.input);need(s.sourceSha256===args.expectedSourceSha256,'SOURCE_CHANGED','Receive the exact original complete export.');
   const w=CartWorkspace.receive({root:row.directory,bytes:s.bytes});return{workspace:summary(w.view()),sourceSha256:s.sourceSha256,received:true};
  }
  if(name==='merchant_cocart_file_release'){await this.#files.release(args.workspace,args.readId);return{released:true};}
  if(name==='merchant_cocart_export')return this.#export(args,row);
  if(name==='merchant_cocart_export_status'){const r=await this.#manifest(args);return{state:'MANIFEST_RETAINED',workspace:args.workspace,exportId:args.exportId,manifest:r.manifest,manifestSha256:r.manifestSha256,manifestFile:{name:'manifest.json',bytes:r.bytes.length,sha256:r.manifestSha256}};}
  if(name==='merchant_cocart_file'){
   const key=JSON.stringify([args.workspace,args.exportId,args.file,args.expectedManifestSha256]);
   const chunk=await this.#files.read({scope:args.workspace,key,kind:'cocart-receiving',directory:this.#config.exportsDirectory,readId:args.readId,expectedSha256:args.expectedSha256,offset:args.offset,limit:args.limit,
    load:async()=>{const r=await this.#manifest(args);need(r.manifestSha256===args.expectedManifestSha256,'EXPORT_CHANGED','Use the selected original export manifest.');return{name:args.file,bytes:args.file==='manifest.json'?r.bytes:r.data,type:'application/json'};}});
   return{workspace:args.workspace,exportId:args.exportId,manifestSha256:args.expectedManifestSha256,...chunk};
  }
  if(name==='merchant_cocart_state'){
   const w=await this.#workspace(row),state=w.view(),view=args.view??'summary';need(args.expectedVersion===undefined||state.version===args.expectedVersion,'REVISION_CHANGED','Read the current original workspace.');
   if(view==='summary')return{workspace:summary(state)};
   if(['carts','events','catalogs'].includes(view)){const rows=view==='carts'?state.carts.map(cartSummary):view==='catalogs'?state.catalogs.map(c=>({...pick(c,['id','at','query','exchange','total','total_pages']),products:c.products.length})):state.events;return{workspace:summary(state),view,...page(rows,args,state.version)};}
   if(view==='catalog'){const catalog=state.catalogs.find(c=>c.id===args.catalogId);need(catalog,'CATALOG_UNKNOWN','Select an original saved catalogId.');return{workspace:summary(state),catalog:pick(catalog,['id','at','query','exchange','total','total_pages']),view,...page(catalog.products,args,state.version)};}
   const cart=state.carts.find(c=>c.id===args.cartId);need(cart,'CART_UNKNOWN','Select an original cartId.');
   if(view==='cart')return{workspace:summary(state),cart:cartSummary(cart)};
   const rows=view==='checkouts'?cart.handoffs:cart[view];return{workspace:summary(state),cart:pick(cart,['id','label','cart_key']),view,...page(rows,args,state.version)};
  }
  const live=!['merchant_cocart_woo_attach','merchant_cocart_transport_rebind'].includes(name);
  const w=await this.#workspace(row,live);let result;
  switch(name){
   case'merchant_cocart_catalog':result=await w.products({search:args.search,page:args.page,per_page:args.perPage},args.expectedVersion);break;
   case'merchant_cocart_cart_create':result=await w.createCart({label:args.label,cart_key:args.cartKey},args.expectedVersion);break;
   case'merchant_cocart_cart_refresh':result=await w.refresh(args.cartId,args.expectedVersion);break;
   case'merchant_cocart_cart_prepare':result=await w.prepare(args.cartId,{action:args.action,request_id:args.requestId,product_id:args.productId,item_key:args.itemKey,quantity:args.quantity},args.expectedVersion);break;
   case'merchant_cocart_cart_apply':result=await w.apply(args.cartId,args.operationId,args.expectedVersion);break;
   case'merchant_cocart_cart_reconcile':result=await w.reconcile(args.cartId,args.operationId,{decision:args.decision,reason:args.reason},args.expectedVersion);break;
   case'merchant_cocart_checkout_prepare':result=await w.prepareCheckout(args.cartId,{mode:args.mode},args.expectedVersion);break;
   case'merchant_cocart_woo_attach':{const s=await this.#source(row,'handoff',args.input);need(s.sourceSha256===args.expectedSourceSha256,'SOURCE_CHANGED','Attach the selected original Woo handoff bytes.');result=await w.attachWooHandoff(args.cartId,args.previewId,s.bytes,args.expectedVersion);break;}
   case'merchant_cocart_transport_rebind':need(row.receivingTransport,'TRANSPORT_UNSELECTED','Select the native receiving transport in this workspace connection.');result=await w.rebindTransport(row.receivingTransport,args.expectedVersion);break;
   default:throw failure('COCART_MCP_TOOL_UNKNOWN','Choose an available original CoCart tool.');
  }
  return{...result,workspace:summary(result.workspace)};
 }
 async call(name,args={}){
  need(!this.#closing,'CLOSING','The customer workspace provider is closing.');need(schemas.has(name)&&check(schemas.get(name),args),'INPUT_INVALID','Use the published tool schema and original operation identities.');
  const pending=this.#execute(name,args);this.#pending.add(pending);
  try{return await pending;}catch(e){if(e instanceof CartError)throw Object.assign(failure(e.code,e.message),{details:e.details});throw e;}finally{this.#pending.delete(pending);}
 }
 close(){if(!this.#close){this.#closing=true;this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#files.close();})();}return this.#close;}
}
