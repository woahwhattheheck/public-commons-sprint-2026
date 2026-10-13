// SPDX-License-Identifier: MIT
// Borrow the original customer-delivery owner; never start a Collection or buyer.
import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {isAbsolute,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializationDirectory as privateDirectory,initializationBytes as privateBytes,
 optionalInitializationBytes as optionalBytes,retainInitializationRecord as retainRecord}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {collectionsWorkspaceUrl,COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA,COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/launch.mjs';
import {openCustomerDelivery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/model.mjs';
import {selectSource} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/source.mjs';
import {SCHEMA as PACKAGE,MAX_PACKAGE,inspectPackage,measure,identity}
 from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {nativeCollectionDeliveryOperations,nativeCollectionDeliveryUploadBatchChunks} from './native-collection-delivery-schema.mjs';
import {selectNativeInboxTask,nativeInboxTaskRequest,publicNativeTaskRequest,verifyNativeTaskPreview} from './native-inbox-task-delivery.mjs';
export {nativeCollectionDeliveryActions,nativeCollectionDeliverySchema} from './native-collection-delivery-schema.mjs';

export const DELIVERY_NATIVE_SCHEMA='stellar-forge.mcp-native-collection-delivery.v1';
export const DELIVERY_DOWNLOAD_SCHEMA='stellar-forge.collection-customer-download-manifest.v1';
export const RECEIVED_DOWNLOAD_SCHEMA='stellar-forge.received-customer-download-manifest.v1';
const SCHEMA=DELIVERY_NATIVE_SCHEMA,STATUS='stellar-forge.sf88.customer-delivery-status.v1';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,ID=/^[A-Za-z0-9._-]{1,100}$/,HASH=/^[a-f0-9]{64}$/;
const MAX_JSON=32*1024*1024,MAX_TOOL=256*1024,MAX_REQUEST=256*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const encoded=v=>Buffer.from(JSON.stringify(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw new InputError(code);};
const named=v=>{need(typeof v==='string'&&ALIAS.test(v),'MCP_DELIVERY_ALIAS_REQUIRED');return v;};
const id=v=>{need(typeof v==='string'&&ID.test(v)&&!['.','..'].includes(v),'MCP_DELIVERY_ID_REQUIRED');return v;};
const hash=v=>{need(typeof v==='string'&&HASH.test(v),'MCP_DELIVERY_HASH_REQUIRED');return v;};
function absolute(v){need(typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&v!=='/'&&!v.includes('\0'),'MCP_DELIVERY_PATH_REQUIRED');return v;}
function fields(v,names){need(object(v)&&Object.keys(v).every(k=>names.includes(k)),'MCP_DELIVERY_ARGUMENTS_INVALID');return v;}
function parse(raw){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('MCP_DELIVERY_JSON_INVALID');}}
const json=async(path,max=65536)=>parse(await privateBytes(path,max));
function page(items,body={}){
 const offset=body.offset??0,limit=body.limit??25;
 need(Number.isSafeInteger(offset)&&offset>=0&&offset<=items.length&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_DELIVERY_PAGE_INVALID');
 return{items:items.slice(offset,offset+limit),offset,total:items.length,nextOffset:offset+limit<items.length?offset+limit:null};
}
function launch(value){
 let original=value;
 if([COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA,COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA].includes(value?.original?.schema))
  original={...value.original,state:'LISTENING',url:value.url};
 need(original?.state==='LISTENING'&&Number.isSafeInteger(original.pid)&&original.pid>0,'MCP_DELIVERY_ORIGINAL_LAUNCH_REQUIRED');
 const address=collectionsWorkspaceUrl(original.url);need(address,'MCP_DELIVERY_LOOPBACK_LAUNCH_REQUIRED');
 const url=new URL(address),token=url.hash.slice(1);url.hash='';
 let selection;
 if(original.schema===COLLECTIONS_WORKSPACE_LAUNCH_SCHEMA){
  need(['BROWSER','TERMINAL'].includes(original.approvalMode),'MCP_DELIVERY_ORIGINAL_LAUNCH_REQUIRED');
  selection={mode:'COLLECTIONS',directory:absolute(original.directory),queueRoot:absolute(original.queueRoot),approvalMode:original.approvalMode};
 }else{
  need(original.schema===COLLECTION_RECOVERY_WORKSPACE_LAUNCH_SCHEMA,'MCP_DELIVERY_ORIGINAL_LAUNCH_REQUIRED');
  selection={mode:'RECEIVING',receivingDirectory:absolute(original.receivingDirectory)};
 }
 return{url,token,selection};
}
async function bodyBytes(response,maximum){
 const declared=response.headers.get('content-length');
 need(declared===null||/^[0-9]+$/.test(declared)&&Number(declared)<=maximum,'MCP_DELIVERY_RESPONSE_LIMIT');
 const chunks=[];let size=0;
 try{for await(const chunk of response.body??[]){size+=chunk.length;need(size<=maximum,'MCP_DELIVERY_RESPONSE_LIMIT');chunks.push(Buffer.from(chunk));}}
 catch(error){await response.body?.cancel().catch(()=>{});throw error;}
 need(declared===null||size===Number(declared),'MCP_DELIVERY_RESPONSE_INCOMPLETE');return Buffer.concat(chunks,size);
}
function publicRegistration(record){return{schema:SCHEMA,name:record.name,mode:record.mode,
 source:record.source?{sha256:record.source.sha256,files:record.source.files,bytes:record.source.bytes}:null,
 ...(record.task?{task:record.task.inspection.task}: {})};}
function originalRequest(body,record){
 const keys=['id','collectionId','expectedManifestSha256','title','note','intentIds','maxVerifyBytes','allowIncomplete'];
 fields(body,[...keys,'expectedPreviewSha256']);need(record.source,'MCP_DELIVERY_SENDER_REQUIRED');id(body.id);
 need(typeof body.collectionId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.collectionId),'MCP_DELIVERY_COLLECTION_REQUIRED');
 hash(body.expectedManifestSha256);
 need(typeof body.title==='string'&&body.title.trim().length>0&&body.title.length<=160&&!/[\x00-\x1f]/.test(body.title)&&
  typeof body.note==='string'&&body.note.length<=10000,'MCP_DELIVERY_TITLE_REQUIRED');
 need(Array.isArray(body.intentIds)&&body.intentIds.length>0&&body.intentIds.length<=100&&new Set(body.intentIds).size===body.intentIds.length&&
  body.intentIds.every(v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v)),'MCP_DELIVERY_INTENTS_REQUIRED');
 need(Number.isSafeInteger(body.maxVerifyBytes)&&body.maxVerifyBytes>=0&&body.maxVerifyBytes<=1073741824&&
  typeof body.allowIncomplete==='boolean','MCP_DELIVERY_REVIEW_REQUIRED');
 return{...Object.fromEntries(keys.map(k=>[k,body[k]])),sourceRoot:record.source.root,sourceManifest:record.source.manifest};
}
function uploadView(value,expected,uploadBatchChunks){
 need(object(value)&&value.sha256===expected&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=MAX_PACKAGE&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=value.bytes&&typeof value.complete==='boolean','MCP_DELIVERY_UPLOAD_CHANGED');
 return {sha256:value.sha256,bytes:value.bytes,filename:value.filename,offset:value.offset,complete:value.complete,uploadBatchChunks};
}
function uploadBatchLimit(status,maximum){
 const count=status.uploadBatchChunks;
 return Number.isSafeInteger(count)&&count>=1?Math.min(count,maximum):1;
}
function checkedChunk(value){
 fields(value,['offset','base64','chunkSha256']);
 need(Number.isSafeInteger(value.offset)&&value.offset>=0&&typeof value.base64==='string'&&value.base64.length<=87384&&
  /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64)&&value.base64.length%4===0,'MCP_DELIVERY_CHUNK_REQUIRED');
 const raw=Buffer.from(value.base64,'base64');
 need(raw.length>0&&raw.length<=65536&&raw.toString('base64')===value.base64&&sha(raw)===hash(value.chunkSha256),'MCP_DELIVERY_CHUNK_CHANGED');
 return{offset:value.offset,base64:value.base64,sha256:value.chunkSha256,bytes:raw.length};
}
function resultView(value,files){
 return{schema:value.schema,id:value.id,state:value.state,request:value.request,previewSha256:value.previewSha256,
  ...(value.package?{package:value.package,outputsComplete:value.manifest.outputsComplete,
   responseCount:value.manifest.rows.length,sourceFiles:value.manifest.source.files.length,files}: {})};
}
/** Trusted host registration binds paths. Remote operations select only that alias. */
export function createNativeCollectionDelivery({manifest,isClosed=()=>false,maxUploadBatchChunks=1}={}){
 need(object(manifest),'MCP_DELIVERY_NATIVE_WORKSPACE_REQUIRED');
 need(Number.isSafeInteger(maxUploadBatchChunks)&&maxUploadBatchChunks>=1&&maxUploadBatchChunks<=nativeCollectionDeliveryUploadBatchChunks,'MCP_DELIVERY_HOST_UPLOAD_LIMIT');
 const nativeRoot=absolute(manifest.directory),root=join(nativeRoot,'collection-delivery'),aliases=join(root,'workspaces');
 const reader=createSavedFileReader(),shutdown=new AbortController(),pending=new Set();let closed=false;
 const available=()=>need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
 async function roots(create=false){
  await privateDirectory(nativeRoot);
  if(!create&&await optionalBytes(join(root,'format.json'),1024)===null)return false;
  await privateDirectory(root,{create});await privateDirectory(aliases,{create});
  if(create)await retainRecord(join(root,'format.json'),{schema:SCHEMA},{resume:true});
  need((await json(join(root,'format.json'))).schema===SCHEMA,'MCP_DELIVERY_FORMAT_CHANGED');return true;
 }
 async function request(connection,route,body,signal){
  available();const options={method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+connection.token,Origin:connection.url.origin},
   signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(120000),...(signal?[signal]:[])])};
  if(body!==undefined){options.body=encoded(body);need(options.body.length<=MAX_REQUEST,'MCP_DELIVERY_REQUEST_LIMIT');options.headers['Content-Type']='application/json';}
  let response,raw;
  try{response=await fetch(new URL('/api/customer-delivery/'+route,connection.url),options);raw=await bodyBytes(response,MAX_JSON);}
  catch(error){if(/^MCP_DELIVERY_RESPONSE_/.test(error.code??''))throw error;fail(body===undefined?'MCP_DELIVERY_SERVICE_UNAVAILABLE':'MCP_DELIVERY_REPLY_UNCERTAIN_REUSE_ORIGINAL_REQUEST');}
  const value=parse(raw);if(!response.ok)fail(/^[A-Z0-9_]{1,160}$/.test(value?.error??'')?value.error:'MCP_DELIVERY_HTTP_'+response.status);return value;
 }
 async function connect(record,signal){
  const connection=launch(await json(record.connectionFile));
  need(identity(connection.selection)===identity(record.selection),'MCP_DELIVERY_ORIGINAL_LAUNCH_CHANGED');
  const status=await request(connection,'status',undefined,signal);
  need([STATUS,PACKAGE+'.list'].includes(status.schema)&&status.scope===record.scope&&status.canPrepare===(record.selection.mode==='COLLECTIONS')&&Array.isArray(status.deliveries)&&
   (record.mode!=='INBOX_TASK'||status.canPrepareTask===true),
   'MCP_DELIVERY_ORIGINAL_LISTENER_CHANGED');
  return{...connection,status};
 }
 async function register(description){
  available();fields(description,['name','connectionFile','sourceRoot','sourceManifest','taskPacketDirectory','expectedTaskSha256']);
  const name=named(description.name),connectionFile=absolute(description.connectionFile),connection=launch(await json(connectionFile));
  const selection=connection.selection,scope=join(selection.mode==='COLLECTIONS'?selection.directory:selection.receivingDirectory,'customer-delivery');
  const hasTask=description.taskPacketDirectory!==undefined||description.expectedTaskSha256!==undefined;
  const task=hasTask?await selectNativeInboxTask({taskPacketDirectory:absolute(description.taskPacketDirectory),expectedTaskSha256:hash(description.expectedTaskSha256)}):null;
  let source=null;
  if(selection.mode==='COLLECTIONS'||task){
   const root=absolute(description.sourceRoot),file=absolute(description.sourceManifest);
   const selected=await selectSource({sourceRoot:root,sourceManifest:file,exclude:[scope,nativeRoot,selection.directory,selection.queueRoot,task?.directory].filter(Boolean)});
   const executing=relative(root,fileURLToPath(import.meta.url));
   need(['stellar-forge/mcp-paid-agent/native-collection-delivery.mjs','source/stellar-forge/mcp-paid-agent/native-collection-delivery.mjs'].includes(executing)&&selected.files.some(row=>row.path===executing),'MCP_DELIVERY_EXECUTING_SOURCE_CHANGED');
   source={root,manifest:file,sha256:selected.sha256,files:selected.files.length,bytes:selected.bytes};
  }else need(description.sourceRoot===undefined&&description.sourceManifest===undefined,'MCP_DELIVERY_RECIPIENT_SOURCE_NOT_REQUIRED');
  const record={schema:SCHEMA,name,nativeWorkspace:nativeRoot,connectionFile,selection,scope,mode:task?'INBOX_TASK':selection.mode,source,...(task?{task}: {})};
  await connect(record);await roots(true);await retainRecord(join(aliases,name+'.json'),record,{resume:true});return publicRegistration(record);
 }
 async function registered(name){
  named(name);need(await roots(),'MCP_DELIVERY_NOT_REGISTERED');
  const record=await json(join(aliases,name+'.json'));
  need(record.schema===SCHEMA&&record.name===name&&record.nativeWorkspace===nativeRoot,'MCP_DELIVERY_REGISTRATION_CHANGED');
  absolute(record.scope);absolute(record.connectionFile);return record;
 }
 async function savedDirectory(record,deliveryId){
  id(deliveryId);const path=join(root,'results',record.name,deliveryId);
  await privateDirectory(join(root,'results'),{create:true});await privateDirectory(join(root,'results',record.name),{create:true});
  await privateDirectory(path,{create:true});return path;
 }
 async function retainComplete(record,value){
  need(value?.schema===PACKAGE+'.result'&&value.state==='COMPLETE'&&value.manifest?.schema===PACKAGE&&
   value.request?.id===value.id&&value.request.sourceRoot===undefined&&value.request.sourceManifest===undefined&&value.request.packetDirectory===undefined,'MCP_DELIVERY_RESULT_CHANGED');
  id(value.id);hash(value.previewSha256);const p=value.package;
  need(object(p)&&hash(p.sha256)&&hash(p.manifestSha256)&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_PACKAGE&&
   p.filename===value.id+'.ndjson'&&p.mediaType==='application/x-ndjson'&&
   Array.isArray(value.manifest.rows)&&Array.isArray(value.manifest.files)&&Array.isArray(value.manifest.source?.files),
   'MCP_DELIVERY_RESULT_CHANGED');
  const path=join(record.scope,'deliveries',value.id,'customer-delivery.ndjson');
  const checked=await inspectPackage(path,{expected:p});
  need(checked.manifestSha256===p.manifestSha256&&identity(checked.manifest)===identity(value.manifest),'MCP_DELIVERY_RESULT_CHANGED');
  const directory=await savedDirectory(record,value.id),raw=encoded(value);
  await retainRecord(join(directory,'result.json'),value,{resume:true});
  const manifestValue={schema:DELIVERY_DOWNLOAD_SCHEMA,id:value.id,previewSha256:value.previewSha256,package:p,
   files:[{name:'customer-delivery.ndjson',bytes:p.bytes,sha256:p.sha256}]};
  await retainRecord(join(directory,'manifest.json'),manifestValue,{resume:true});
  // Measure the exact maintained record writer's bytes, including its final LF.
  const result=await measure(join(directory,'result.json')),download=await measure(join(directory,'manifest.json'));
  return resultView(value,{result:{name:'result.json',...result},manifest:{name:'manifest.json',...download}});
 }
 async function retained(record,deliveryId){
  id(deliveryId);const directory=join(root,'results',record.name,deliveryId),value=await json(join(directory,'result.json'),MAX_JSON);
  need(value.schema===PACKAGE+'.result'&&value.id===deliveryId&&value.state==='COMPLETE','MCP_DELIVERY_RESULT_CHANGED');
  const manifestValue=await json(join(directory,'manifest.json'));
  need(manifestValue.schema===DELIVERY_DOWNLOAD_SCHEMA&&manifestValue.id===deliveryId&&identity(manifestValue.package)===identity(value.package),
   'MCP_DELIVERY_RESULT_CHANGED');
  return{directory,value};
 }
 async function retainedView(record,deliveryId){
  const saved=await retained(record,deliveryId);
  return resultView(saved.value,{result:{name:'result.json',...await measure(join(saved.directory,'result.json'))},
   manifest:{name:'manifest.json',...await measure(join(saved.directory,'manifest.json'))}});
 }
 async function retainReceived(record,value,expected){
  need([PACKAGE+'.received',PACKAGE+'.receive-intent'].includes(value?.schema)&&value.sha256===expected&&value.manifest?.schema===PACKAGE&&
   Array.isArray(value.manifest.files),'MCP_DELIVERY_RECEIVED_CHANGED');
  const checked=await inspectPackage(join(record.scope,'received',expected,'customer-delivery.ndjson'),{expected:{bytes:value.bytes,sha256:expected}});
  need(checked.manifestSha256===value.manifestSha256&&identity(checked.manifest)===identity(value.manifest),'MCP_DELIVERY_RECEIVED_CHANGED');
  const directory=join(root,'received',record.name,expected);
  for(const path of [join(root,'received'),join(root,'received',record.name),directory])await privateDirectory(path,{create:true});
  await retainRecord(join(directory,'result.json'),value,{resume:true});return value;
 }
 // Borrow only the original read methods. Existing directories must already exist;
 // no new recipient, server, queue or package registry is created by discovery.
 async function withRecipientReader(record,read){
  for(const path of [record.scope,join(record.scope,'deliveries'),join(record.scope,'received')])await privateDirectory(path);
  const original=await openCustomerDelivery({directory:record.scope});
  try{return await read(original);}finally{await original.close();}
 }
 async function receivedHistory(record,body){
  const value=await withRecipientReader(record,original=>original.listReceived());
  need(value?.schema===PACKAGE+'.received-list'&&Array.isArray(value.packages),'MCP_DELIVERY_HISTORY_CHANGED');
  const historySha256=identity(value);
  if(body.expectedHistorySha256!==undefined)need(hash(body.expectedHistorySha256)===historySha256,'MCP_DELIVERY_HISTORY_CHANGED');
  return{schema:value.schema,historySha256,...page(value.packages,body)};
 }
 async function receivedPackageView(record,expected){
  const value=await withRecipientReader(record,original=>original.received(expected));
  await retainReceived(record,value,expected);
  const directory=join(root,'received',record.name,expected);
  const manifest={schema:RECEIVED_DOWNLOAD_SCHEMA,id:expected,
   package:{sha256:expected,bytes:value.bytes,manifestSha256:value.manifestSha256},
   origin:{collectionId:value.manifest.collection?.id??null,...(value.manifest.task?{task:value.manifest.task}:{})},
   files:[{name:'customer-delivery.ndjson',bytes:value.bytes,sha256:expected}]};
  await retainRecord(join(directory,'manifest.json'),manifest,{resume:true});
  return{schema:RECEIVED_DOWNLOAD_SCHEMA,state:'COMPLETE',sha256:expected,package:manifest.package,origin:manifest.origin,
   outputsComplete:value.outputsComplete,files:{manifest:{name:'manifest.json',...await measure(join(directory,'manifest.json'))}}};
 }
 async function receivedPackageFile(record,body,operation){
  const expected=hash(body.sha256),directory=join(root,'received',record.name,expected);
  const value=await savedReceived(record,expected);
  need(value,'MCP_DELIVERY_RECEIVED_INSPECT_REQUIRED');
  const manifest=await json(join(directory,'manifest.json'));
  need(manifest.schema===RECEIVED_DOWNLOAD_SCHEMA&&manifest.id===expected&&manifest.package?.sha256===expected&&
   manifest.package.bytes===value.bytes&&manifest.package.manifestSha256===value.manifestSha256&&
   identity(manifest.files)===identity([{name:'customer-delivery.ndjson',bytes:value.bytes,sha256:expected}]),
   'MCP_DELIVERY_RECEIVED_MANIFEST_CHANGED');
  const name=operation==='received-manifest-file'?'manifest.json':'customer-delivery.ndjson';
  const destination=name==='manifest.json'?join(directory,name):join(record.scope,'received',expected,name);
  const descriptor=name==='manifest.json'?await measure(destination):{bytes:value.bytes,sha256:expected};
  need(descriptor.sha256===hash(body.expectedFileSha256),'MCP_DELIVERY_FILE_CHANGED');
  return{sha256:expected,filename:name,file:await reader({destination,...descriptor,
   contentType:name==='manifest.json'?'application/json':'application/x-ndjson'},body)};
 }
 async function savedReceived(record,expected){
  const raw=await optionalBytes(join(root,'received',record.name,expected,'result.json'),MAX_JSON);
  if(raw===null)return null;const value=parse(raw);
  need([PACKAGE+'.received',PACKAGE+'.receive-intent'].includes(value?.schema)&&value.sha256===expected&&value.manifest?.schema===PACKAGE&&Array.isArray(value.manifest.files),'MCP_DELIVERY_RECEIVED_CHANGED');
  return value;
 }
 function receivedView(value,body){
  return{schema:value.schema,sha256:value.sha256,bytes:value.bytes,manifestSha256:value.manifestSha256,
   outputsComplete:value.outputsComplete,title:value.manifest.title,...page(value.manifest.files,body)};
 }
 async function receivedFile(record,value,body){
  need(typeof body.path==='string','MCP_DELIVERY_MEMBER_REQUIRED');const file=value.manifest.files.find(f=>f.path===body.path);
  need(file&&file.sha256===hash(body.expectedFileSha256),'MCP_DELIVERY_MEMBER_CHANGED');
  const destination=join(record.scope,'received',body.sha256,'members',file.path);
  return{packageSha256:body.sha256,path:file.path,file:await reader({destination,bytes:file.bytes,sha256:file.sha256},body)};
 }
 async function perform(args={},context={}){
  available();fields(args,['action','deliveryWorkspace','deliveryOperation','deliveryRequest']);
  need(args.action==='collection-delivery'&&object(context)&&(context.signal===undefined||context.signal instanceof AbortSignal),'MCP_DELIVERY_ARGUMENTS_INVALID');
  const operation=args.deliveryOperation,body=args.deliveryRequest??{};
  need(Object.hasOwn(nativeCollectionDeliveryOperations,operation),'MCP_DELIVERY_OPERATION_REQUIRED');const spec=nativeCollectionDeliveryOperations[operation];
  need(spec,'MCP_DELIVERY_OPERATION_REQUIRED');fields(body,Object.keys(spec.properties));
  need(spec.required.every(k=>Object.hasOwn(body,k)),'MCP_DELIVERY_FIELDS_REQUIRED');
  if(operation==='workspaces'){
   if(!await roots())return{schema:SCHEMA,operation,...page([],body)};
   const names=(await readdir(aliases,{withFileTypes:true})).filter(v=>v.isFile()&&v.name.endsWith('.json')&&ALIAS.test(v.name.slice(0,-5))).map(v=>v.name.slice(0,-5)).sort();
   const selection=page(names,body),items=[];for(const name of selection.items)items.push(publicRegistration(await registered(name)));
   return{schema:SCHEMA,operation,...selection,items};
  }
  const record=await registered(args.deliveryWorkspace);
  const result=value=>{const response={schema:SCHEMA,workspace:record.name,operation,value};need(encoded(response).length<=MAX_TOOL,'MCP_DELIVERY_TOOL_PAGE_LIMIT');return response;};
  if(operation==='received-list')return result(await receivedHistory(record,body));
  if(operation==='received-package')return result(await receivedPackageView(record,hash(body.sha256)));
  if(['received-manifest-file','received-package-file'].includes(operation))return result(await receivedPackageFile(record,body,operation));
  if(['result-file','manifest-file','package-file'].includes(operation)){
   hash(body.expectedFileSha256);const saved=await retained(record,id(body.id));
   const name=operation==='result-file'?'result.json':operation==='manifest-file'?'manifest.json':'customer-delivery.ndjson';
   const destination=operation==='package-file'?join(record.scope,'deliveries',body.id,name):join(saved.directory,name);
   const descriptor=operation==='package-file'?saved.value.package:await measure(destination);
   need(descriptor.sha256===body.expectedFileSha256,'MCP_DELIVERY_FILE_CHANGED');
   return result({id:body.id,filename:name,file:await reader({destination,...descriptor,contentType:operation==='package-file'?'application/x-ndjson':'application/json'},body)});
  }
  if(operation==='inspect'){
   id(body.id);const prior=await optionalBytes(join(root,'results',record.name,body.id,'result.json'),MAX_JSON);
   if(prior!==null)return result(await retainedView(record,body.id));
  }
  if(operation==='received'||operation==='received-file'){
   hash(body.sha256);const prior=await savedReceived(record,body.sha256);
   if(prior)return result(operation==='received-file'?await receivedFile(record,prior,body):receivedView(prior,body));
  }
  if(operation==='task-inspect'){
   need(record.mode==='INBOX_TASK'&&record.task,'MCP_DELIVERY_TASK_SENDER_REQUIRED');
   need(body.expectedTaskSha256===record.task.sha256,'MCP_DELIVERY_TASK_SELECTION_CHANGED');
   return result({schema:PACKAGE+'.task-inspection',task:record.task.inspection.task,...page(record.task.inspection.intents,body)});
  }
  const connection=await connect(record,context.signal),get=route=>request(connection,route,undefined,context.signal),post=(route,v)=>request(connection,route,v,context.signal);
  const uploadBatchChunks=uploadBatchLimit(connection.status,maxUploadBatchChunks);
  if(operation==='status')return result({mode:record.mode,source:publicRegistration(record).source,uploadBatchChunks,...page(connection.status.deliveries,body)});
  if(operation==='task-preview'||operation==='task-prepare'){
   const selected=nativeInboxTaskRequest(body,record),directory=await savedDirectory(record,selected.id),previewFile=join(directory,'preview.json');
   if(operation==='task-preview'){
    const prior=await optionalBytes(previewFile,MAX_JSON);
    if(prior)return result(verifyNativeTaskPreview(parse(prior),selected,record));
    const value=verifyNativeTaskPreview(await post('task-preview',selected),selected,record);
    await retainRecord(previewFile,value,{resume:true});return result(value);
   }
   hash(body.expectedPreviewSha256);
   const preview=verifyNativeTaskPreview(await json(previewFile,MAX_JSON),selected,record);
   need(preview.previewSha256===body.expectedPreviewSha256,'MCP_DELIVERY_TASK_PREVIEW_CHANGED');
   const value=await post('task-prepare',{...selected,expectedPreviewSha256:body.expectedPreviewSha256});
   need(identity(value.request)===identity(publicNativeTaskRequest(selected))&&
    identity(value.manifest?.task)===identity(record.task.inspection.task)&&value.manifest?.collection===null&&
    value.manifest?.outputsComplete===true,'MCP_DELIVERY_TASK_RESULT_CHANGED');
   return result(await retainComplete(record,value));
  }
  if(operation==='preview'||operation==='prepare'){
   need(record.mode==='COLLECTIONS','MCP_DELIVERY_COLLECTION_SENDER_REQUIRED');
   const selected=originalRequest(body,record),directory=await savedDirectory(record,selected.id);
   const previewFile=join(directory,'preview.json');
   if(operation==='preview'){
    const prior=await optionalBytes(previewFile,MAX_JSON);
    if(prior){const v=parse(prior);need(identity(v.request)===identity(Object.fromEntries(Object.entries(selected).filter(([k])=>!['sourceRoot','sourceManifest'].includes(k)))),'MCP_DELIVERY_PREVIEW_REQUEST_CHANGED');return result(v);}
    const value=await post('preview',selected);
    need(value.schema===PACKAGE+'.preview'&&hash(value.previewSha256)&&value.source?.sha256===record.source.sha256,'MCP_DELIVERY_PREVIEW_CHANGED');
    await retainRecord(previewFile,value,{resume:true});return result(value);
   }
   hash(body.expectedPreviewSha256);const preview=await json(previewFile,MAX_JSON);
   const safe=Object.fromEntries(Object.entries(selected).filter(([k])=>!['sourceRoot','sourceManifest'].includes(k)));
   need(preview.previewSha256===body.expectedPreviewSha256&&identity(preview.request)===identity(safe)&&preview.source.sha256===record.source.sha256,'MCP_DELIVERY_PREVIEW_CHANGED');
   const value=await post('prepare',{...selected,expectedPreviewSha256:body.expectedPreviewSha256});
   return result(await retainComplete(record,value));
  }
  if(operation==='inspect'){
   id(body.id);const value=await get('deliveries/'+body.id);
   if(value.state==='COMPLETE')return result(await retainComplete(record,value));
   need(value.schema===PACKAGE+'.status'&&value.id===body.id&&value.state==='PREPARING','MCP_DELIVERY_RESULT_CHANGED');return result(value);
  }
  hash(body.sha256);
  if(operation==='upload-start'){
   need(Number.isSafeInteger(body.bytes)&&body.bytes>0&&body.bytes<=MAX_PACKAGE&&typeof body.filename==='string'&&body.filename.length<=160,'MCP_DELIVERY_UPLOAD_REQUIRED');
   return result(uploadView(await post('uploads?progress=compact',body),body.sha256,uploadBatchChunks));
  }
  if(operation==='upload-status')return result(uploadView(await get('uploads/'+body.sha256+'?progress=compact'),body.sha256,uploadBatchChunks));
  if(operation==='upload-chunk'){
   const {bytes,...part}=checkedChunk({offset:body.offset,base64:body.base64,chunkSha256:body.chunkSha256});
   return result(uploadView(await post('uploads/'+body.sha256+'/chunk?progress=compact',part),body.sha256,uploadBatchChunks));
  }
  if(operation==='upload-chunks'){
   need(Array.isArray(body.chunks)&&body.chunks.length>=1&&body.chunks.length<=uploadBatchChunks,'MCP_DELIVERY_BATCH_REQUIRED');
   const checked=body.chunks.map(checkedChunk);
   for(let index=1;index<checked.length;index++)need(checked[index].offset===checked[index-1].offset+checked[index-1].bytes,'MCP_DELIVERY_BATCH_ORDER');
   const chunks=checked.map(({bytes,...part})=>part);
   // An older host accepts the retained single-part route; no speculative batch retry.
   const route=checked.length===1&&uploadBatchChunks===1?'chunk':'chunks';
   const input=route==='chunk'?chunks[0]:{chunks};
   return result(uploadView(await post('uploads/'+body.sha256+'/'+route+'?progress=compact',input),body.sha256,uploadBatchChunks));
  }
  if(operation==='upload-finish')return result(uploadView(await post('uploads/'+body.sha256+'/finish?progress=compact',{}),body.sha256,uploadBatchChunks));
  if(operation==='receive'||operation==='received'||operation==='received-file'){
   const value=operation==='receive'?await post('uploads/'+body.sha256+'/receive',{}):await get('received/'+body.sha256);
   await retainReceived(record,value,body.sha256);
   return result(operation==='received-file'?await receivedFile(record,value,body):receivedView(value,operation==='receive'?{}:body));
  }
  fail('MCP_DELIVERY_OPERATION_REQUIRED');
 }
 async function track(fn){available();const work=Promise.resolve().then(fn);pending.add(work);try{return await work;}finally{pending.delete(work);}}
 return{register:v=>track(()=>register(v)),call:(args,context)=>track(()=>perform(args,context)),
  async close(){if(closed)return;closed=true;shutdown.abort();await Promise.allSettled([...pending]);}};
}
