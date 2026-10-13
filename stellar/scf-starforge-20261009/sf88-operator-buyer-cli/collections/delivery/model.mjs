// MIT. Read-only original Inbox capture and complete customer result delivery.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireCollectionLease } from '../model.mjs';
import { captureInbox } from '../../operations-handoff/capture.mjs';
import { inspectHandoff } from '../../operations-handoff/contract.mjs';
import { initializationDirectory, initializationBytes, optionalInitializationBytes, retainInitializationFile } from '../../initialization.mjs';
import { SCHEMA, bytes, clone, need, hash, identity, digest, absolute, measure, copyFile, ensureMember, writePackage, inspectPackage, receivePackage, validateManifest, MAX_PACKAGE } from './format.mjs';
import { selectSource } from './source.mjs';
import { createInboxTaskDelivery } from './inbox-task.mjs';

const ID=/^[A-Za-z0-9._-]{1,100}$/;
const date=()=>new Date().toISOString();
import { reviewHtml } from './review.mjs';
const parsed=async path=>{const raw=await optionalInitializationBytes(path,16*1024*1024);return raw?JSON.parse(raw):null;};
function request(input){
 need(input&&ID.test(input.id)&&input.id!=='.'&&input.id!=='..'&&typeof input.collectionId==='string'&&hash(input.expectedManifestSha256),'CUSTOMER_DELIVERY_REQUEST');
 need(typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=160&&!/[\x00-\x1f]/.test(input.title)&&typeof input.note==='string'&&input.note.length<=10000,'CUSTOMER_DELIVERY_TITLE');
 need(Array.isArray(input.intentIds)&&input.intentIds.length>0&&input.intentIds.length<=100&&new Set(input.intentIds).size===input.intentIds.length&&input.intentIds.every(x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x)),'CUSTOMER_DELIVERY_INTENTS');
 absolute(input.sourceRoot);absolute(input.sourceManifest);
 const limit=input.maxVerifyBytes??268435456;need(Number.isSafeInteger(limit)&&limit>=0&&limit<=1073741824,'CUSTOMER_DELIVERY_VERIFY_LIMIT');
 need(input.allowIncomplete===true||input.allowIncomplete===false,'CUSTOMER_DELIVERY_COMPLETENESS_DECISION');
 return{id:input.id,collectionId:input.collectionId,expectedManifestSha256:input.expectedManifestSha256,title:input.title,note:input.note,intentIds:[...input.intentIds],sourceRoot:input.sourceRoot,sourceManifest:input.sourceManifest,maxVerifyBytes:limit,allowIncomplete:input.allowIncomplete};
}
function customerRow(row,index){
 // Explicitly excludes URL/query, operator identity, local paths, request bodies,
 // headers, tickets, execution configuration and literal private evidence.
 return{intentId:row.intentId,jobId:row.jobId,configSha256:row.configSha256,sourceConfigSha256:row.sourceConfigSha256,sourceRecordSha256:row.sourceRecordSha256,
  originalCreatedAt:row.originalCreatedAt,capturedAt:row.capturedAt,method:row.method,nativeState:row.nativeState,
  originalSourceFiles:row.sourceFiles.map(x=>({name:x.name,bytes:x.bytes,sha256:x.sha256})),
  observation:{attemptStatus:row.purchase.attemptStatus,settlementStatus:row.purchase.settlementStatus,outputStatus:row.purchase.outputStatus,network:row.purchase.network,asset:row.purchase.asset,amountAtomic:row.purchase.amountStroops,transactionHash:row.purchase.transactionHash,ledger:row.purchase.ledger,issues:[...row.issues]},
  output:{state:row.output.state,path:row.output.state==='VERIFIED'?'responses/'+String(index+1).padStart(3,'0')+'.bin':null,bytes:row.output.state==='VERIFIED'?row.output.bytes:null,sha256:row.output.state==='VERIFIED'?row.output.sha256:null}};
}
export async function openCustomerDelivery({collections=null,directory}){
 absolute(directory);await initializationDirectory(directory,{create:true});
 const exportsRoot=join(directory,'deliveries'),receivesRoot=join(directory,'received');await initializationDirectory(exportsRoot,{create:true});await initializationDirectory(receivesRoot,{create:true});
 let closed=false;const active=new Set();
 async function lock(fn){
  need(!closed,'CUSTOMER_DELIVERY_CLOSED');
  const work=(async()=>{const release=await acquireCollectionLease(directory);try{return await fn();}finally{await release();}})();active.add(work);try{return await work;}finally{active.delete(work);}
 }
 async function original(input){
  need(collections,'CUSTOMER_DELIVERY_COLLECTIONS_REQUIRED');const snapshot=await collections.inspect(input.collectionId);
  need(snapshot.manifestSha256===input.expectedManifestSha256,'CUSTOMER_DELIVERY_COLLECTION_CHANGED');
  const items=input.intentIds.map(id=>{const item=snapshot.items.find(row=>row.intentId===id);need(item&&item.job&&!item.error,'CUSTOMER_DELIVERY_ORIGINAL_JOB_REQUIRED');return item;});
  return{snapshot,items};
 }
 async function preview(input){
  input=request(input);const {snapshot,items}=await original(input);const source=await selectSource({...input,exclude:[directory,collections.directory,collections.queueRoot]});
  const value={schema:SCHEMA+'.preview',request:input,collection:{id:snapshot.id,manifestSha256:snapshot.manifestSha256},jobs:items.map(item=>({intentId:item.intentId,jobId:item.job.id,sha256:identity(item.job)})),source:{sha256:source.sha256,files:source.files.length,bytes:source.bytes}};
  return{...value,previewSha256:identity(value)};
 }
 async function inspect(id){
  need(ID.test(id)&&!['.','..'].includes(id),'CUSTOMER_DELIVERY_ID');const base=join(exportsRoot,id),intent=await parsed(join(base,'intent.json'));need(intent,'CUSTOMER_DELIVERY_NOT_FOUND');const result=await parsed(join(base,'result.json'));
  if(result){const checked=await inspectPackage(join(base,'customer-delivery.ndjson'),{expected:result.package});need(checked.manifestSha256===result.package.manifestSha256,'CUSTOMER_DELIVERY_RESULT_CHANGED');return clone(result);}
  return{schema:SCHEMA+'.status',id,state:'PREPARING',request:clone(intent.request),previewSha256:intent.previewSha256};
 }
 async function prepare(input){
  const savedRequest=request(input);need(hash(input.expectedPreviewSha256),'CUSTOMER_DELIVERY_PREVIEW_REQUIRED');
  return lock(async()=>{
   need(collections,'CUSTOMER_DELIVERY_COLLECTIONS_REQUIRED');
   return collections.withRecoveryLock(async()=>{
    const base=join(exportsRoot,savedRequest.id);await initializationDirectory(base,{create:true});
    const intentPath=join(base,'intent.json');let intent=await parsed(intentPath);
    if(intent)need(identity(intent.request)===identity(savedRequest)&&intent.previewSha256===input.expectedPreviewSha256,'CUSTOMER_DELIVERY_REQUEST_CONFLICT');
    else{
     const review=await preview(savedRequest);need(review.previewSha256===input.expectedPreviewSha256,'CUSTOMER_DELIVERY_PREVIEW_CHANGED');
     intent={schema:SCHEMA+'.intent',request:savedRequest,previewSha256:review.previewSha256,preview:review,createdAt:date()};
     await retainInitializationFile(intentPath,bytes(intent),{resume:true});
    }
    const completed=await parsed(join(base,'result.json'));if(completed)return inspect(savedRequest.id);
    const rawPath=join(base,'private-original-capture.json');let raw=await optionalInitializationBytes(rawPath,32*1024*1024);
    if(!raw){
     const current=await original(savedRequest);need(identity(current.items.map(item=>({intentId:item.intentId,jobId:item.job.id,sha256:identity(item.job)})))===identity(intent.preview.jobs),'CUSTOMER_DELIVERY_ORIGINAL_JOB_CHANGED');
     const captured=await captureInbox({directory:collections.queueRoot,intentIds:savedRequest.intentIds,maxVerifyBytes:savedRequest.maxVerifyBytes});
     // Preserve the first complete native read before selecting any customer bytes.
     await retainInitializationFile(rawPath,captured.raw,{resume:true});raw=captured.raw;
    }
    const report=inspectHandoff(raw),packet=JSON.parse(raw);
    need(report.rows.length===savedRequest.intentIds.length&&report.rows.every((row,index)=>row.intentId===savedRequest.intentIds[index]&&row.jobId===intent.preview.jobs[index].jobId),'CUSTOMER_DELIVERY_CAPTURE_CHANGED');
    const source=await selectSource({...savedRequest,exclude:[directory,collections.directory,collections.queueRoot]});
    need(source.sha256===intent.preview.source.sha256,'CUSTOMER_DELIVERY_SOURCE_CHANGED');
    const rows=report.rows.map(customerRow),outputsComplete=rows.every(row=>row.output.state==='VERIFIED');
    need(outputsComplete||savedRequest.allowIncomplete,'CUSTOMER_DELIVERY_INCOMPLETE_REVIEW_REQUIRED');
    const members=join(base,'members');await initializationDirectory(members,{create:true});const files=[];
    for(let index=0;index<rows.length;index++){
     const row=rows[index];if(row.output.state!=='VERIFIED')continue;
     const path=packet.jobs[index].native.outcome.responseFile.path;absolute(path);
     await copyFile(path,await ensureMember(members,row.output.path),row.output);files.push({path:row.output.path,role:'response',bytes:row.output.bytes,sha256:row.output.sha256});
    }
    for(const row of source.files){const path='source/'+row.path;await copyFile(join(savedRequest.sourceRoot,row.path),await ensureMember(members,path),row);files.push({path,role:'source',bytes:row.bytes,sha256:row.sha256});}
    const review={schema:SCHEMA+'.review',title:savedRequest.title,note:savedRequest.note,collection:{id:savedRequest.collectionId,manifestSha256:savedRequest.expectedManifestSha256},capture:{sha256:report.source.sha256,bytes:report.source.bytes,capturedAt:report.source.capturedAt},rows,outputsComplete,source:{sha256:source.sha256,files:source.files}};
    for(const [path,content] of [['review.json',bytes(review)],['review.html',Buffer.from(reviewHtml(review))]]){
     await retainInitializationFile(join(members,path),content,{resume:true});files.push({path,role:'review',bytes:content.length,sha256:digest(content)});
    }
    const manifest={...review,schema:SCHEMA,files};const archive=await writePackage(join(base,'customer-delivery.ndjson'),manifest,row=>join(members,row.path));
    const result={schema:SCHEMA+'.result',id:savedRequest.id,state:'COMPLETE',request:savedRequest,previewSha256:intent.previewSha256,package:{filename:savedRequest.id+'.ndjson',mediaType:'application/x-ndjson',bytes:archive.bytes,sha256:archive.sha256,manifestSha256:archive.manifestSha256},manifest};
    await retainInitializationFile(join(base,'result.json'),bytes(result),{resume:true});return clone(result);
   });
  });
 }
 async function list(){
  const result=[];for(const item of await readdir(exportsRoot,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink()&&ID.test(item.name)){const intent=await parsed(join(exportsRoot,item.name,'intent.json'));if(intent){const completed=await parsed(join(exportsRoot,item.name,'result.json'));result.push({id:item.name,title:intent.request.title,createdAt:intent.createdAt,state:completed?'COMPLETE':'PREPARING',outputsComplete:completed?.manifest.outputsComplete??false,package:completed?.package??null});}}
  return{schema:SCHEMA+'.list',deliveries:result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
 }
 async function download(id){const result=await inspect(id);need(result.state==='COMPLETE','CUSTOMER_DELIVERY_NOT_COMPLETE');return{...result.package,path:join(exportsRoot,id,'customer-delivery.ndjson')};}
 async function receive({file,expectedSha256}){
  need(hash(expectedSha256),'CUSTOMER_DELIVERY_EXPECTED_SHA_REQUIRED');
  return lock(async()=>receivePackage({file,directory:join(receivesRoot,expectedSha256),expectedSha256}));
 }
 function receivedReceipt(result,sha256){
  // Original v1 receipts inherit receive-intent's schema through its object spread.
  // Preserve those immutable receipts as well as the explicit received spelling.
  need(result&&result.sha256===sha256&&[SCHEMA+'.receive-intent',SCHEMA+'.received'].includes(result.schema),'CUSTOMER_DELIVERY_RECEIVED_RECORD');
  const selected=validateManifest(result.manifest);
  need(result.manifestSha256===selected.sha256&&result.files===selected.files&&result.contentBytes===selected.bytes&&result.outputsComplete===selected.outputsComplete&&Number.isSafeInteger(result.bytes)&&result.bytes>0&&result.bytes<=MAX_PACKAGE,'CUSTOMER_DELIVERY_RECEIVED_RECORD');
  return result;
 }
 async function listReceived(){
  const packages=[];
  for(const item of await readdir(receivesRoot,{withFileTypes:true})){
   if(!hash(item.name)||!item.isDirectory()||item.isSymbolicLink())continue;
   const sha256=item.name,base=join(receivesRoot,sha256);
   try{
    const result=await parsed(join(base,'result.json'));
    if(!result){packages.push({sha256,state:'INCOMPLETE'});continue;}
    receivedReceipt(result,sha256);
    packages.push({sha256,state:'COMPLETE',title:result.manifest.title,collectionId:result.manifest.collection?.id??null,...(result.manifest.task?{task:clone(result.manifest.task)}:{}),capturedAt:result.manifest.capture.capturedAt,manifestSha256:result.manifestSha256,bytes:result.bytes,files:result.files,contentBytes:result.contentBytes,outputsComplete:result.outputsComplete,requestCount:result.manifest.rows.length});
   }catch(error){packages.push({sha256,state:'UNAVAILABLE',code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CUSTOMER_DELIVERY_RECEIVED_RECORD'});}
  }
  packages.sort((a,b)=>String(b.capturedAt??'').localeCompare(String(a.capturedAt??''))||a.sha256.localeCompare(b.sha256));
  // This discovers saved receipts; opening a selected package rechecks all bytes.
  return{schema:SCHEMA+'.received-list',packages};
 }
 async function received(sha256){
  need(hash(sha256),'CUSTOMER_DELIVERY_EXPECTED_SHA_REQUIRED');const base=join(receivesRoot,sha256);
  const result=await parsed(join(base,'result.json'));need(result,'CUSTOMER_DELIVERY_RECEIVED_NOT_FOUND');receivedReceipt(result,sha256);
  await measure(join(base,'customer-delivery.ndjson'),result,MAX_PACKAGE);
  for(const row of result.manifest.files)await measure(join(base,'members',row.path),row);
  return result;
 }
 async function receivedPackage(sha256){
  const result=await received(sha256);
  return{path:join(receivesRoot,sha256,'customer-delivery.ndjson'),filename:'received-'+sha256+'.ndjson',mediaType:'application/x-ndjson',bytes:result.bytes,sha256:result.sha256};
 }
 async function member(sha256,path){const result=await received(sha256);const row=result.manifest.files.find(row=>row.path===path);need(row,'CUSTOMER_DELIVERY_MEMBER_NOT_FOUND');return{...row,name:path.split('/').at(-1),path:join(receivesRoot,sha256,'members',path),mediaType:path==='review.html'?'text/html; charset=utf-8':path==='review.json'?'application/json':'application/octet-stream'};}
 const taskDelivery=createInboxTaskDelivery({directory,exportsRoot,lock,inspect});
 return{directory,preview,prepare,inspectTask:taskDelivery.inspect,previewTask:taskDelivery.preview,prepareTask:taskDelivery.prepare,inspect,list,download,receive,listReceived,received,receivedPackage,member,async close(){closed=true;await Promise.allSettled([...active]);}};
}
