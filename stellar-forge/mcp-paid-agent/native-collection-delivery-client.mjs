// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {acquireCollectionLease} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/model.mjs';
import {initializationDirectory,retainInitializationFile,optionalInitializationBytes} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {fileHandle,measure,bytes,identity,need,absolute,MAX_PACKAGE,CHUNK} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
import {nativeCollectionDeliveryOperations,nativeCollectionDeliveryUploadBatchChunks} from './native-collection-delivery-schema.mjs';
export const DELIVERY_NATIVE_SCHEMA='stellar-forge.mcp-native-collection-delivery.v1';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const stamp=v=>['dev','ino','size','mtimeNs','ctimeNs'].map(k=>String(v[k])).join(':');
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function openNativeCollectionDeliveryClient(options={}){
 const deliveryWorkspace=options.deliveryWorkspace;
 need(deliveryWorkspace===undefined||ALIAS.test(deliveryWorkspace),'MCP_DELIVERY_CLIENT_ALIAS');
 const native=await openMerchantFileClient({...options,errorPrefix:'MCP_DELIVERY',clientName:'starforge-customer-delivery'});
 async function call(operation,body={},context){
  need(Object.hasOwn(nativeCollectionDeliveryOperations,operation),'MCP_DELIVERY_CLIENT_OPERATION');
  const spec=nativeCollectionDeliveryOperations[operation];
  need(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>Object.hasOwn(spec.properties,k))&&spec.required.every(k=>Object.hasOwn(body,k)),'MCP_DELIVERY_CLIENT_FIELDS');
  need(operation==='workspaces'||ALIAS.test(deliveryWorkspace??''),'MCP_DELIVERY_CLIENT_ALIAS');
  const value=await native.call('sf43_discover_review_and_pay',{action:'collection-delivery',deliveryOperation:operation,
   ...(deliveryWorkspace?{deliveryWorkspace}:{}),deliveryRequest:body},context);
  need(value?.schema===DELIVERY_NATIVE_SCHEMA&&value.operation===operation,'MCP_DELIVERY_CLIENT_ORIGINAL_RESPONSE');
  if(operation==='workspaces')return value;
  need(value.workspace===deliveryWorkspace&&value.value&&typeof value.value==='object','MCP_DELIVERY_CLIENT_ORIGINAL_RESPONSE');
  return value.value;
 }
 return Object.freeze({endpoint:native.endpoint,deliveryWorkspace,call,
  preview:(request,context)=>call('preview',request,context),
  prepare:(request,context)=>call('prepare',request,context),
  inspectTask:(expectedTaskSha256,range={},context)=>call('task-inspect',{expectedTaskSha256,...range},context),
  previewTask:(request,context)=>call('task-preview',request,context),
  prepareTask:(request,context)=>call('task-prepare',request,context),
  inspect:(id,context)=>call('inspect',{id},context),
  received:(sha256,range={},context)=>call('received',{sha256,...range},context),
  receivedHistory:(range={},context)=>call('received-list',range,context),
  receivedPackage:(sha256,context)=>call('received-package',{sha256},context)});
}
export function checkedDeliveryRange(value,{bytes:total,sha256,byteOffset,maxBytes}){
 need(value?.verifiedSavedFile===true&&value.encoding==='base64'&&value.bytes===total&&value.sha256===sha256&&
  value.byteOffset===byteOffset&&Number.isSafeInteger(value.returnedBytes)&&value.returnedBytes===Math.min(maxBytes,total-byteOffset)&&
  typeof value.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(value.data),'MCP_DELIVERY_CLIENT_RANGE_CHANGED');
 const raw=Buffer.from(value.data,'base64'),next=byteOffset+raw.length<total?byteOffset+raw.length:null;
 need(raw.length===value.returnedBytes&&raw.toString('base64')===value.data&&value.nextByteOffset===next,'MCP_DELIVERY_CLIENT_RANGE_CHANGED');
 return raw;
}
/** Upload only a closed original package; progress comes from the original recipient. */
export async function uploadNativeCustomerPackage({client,file,directory,expectedSha256,filename,signal,onProgress=()=>{}}){
 need(client&&typeof client.call==='function'&&typeof client.endpoint==='string'&&ALIAS.test(client.deliveryWorkspace??''),'MCP_DELIVERY_UPLOAD_CLIENT');
 absolute(file);absolute(directory);need(HASH.test(expectedSha256??'')&&typeof filename==='string'&&filename.length>0&&filename.length<=160,'MCP_DELIVERY_UPLOAD_SELECTION');
 await initializationDirectory(directory,{create:true});const release=await acquireCollectionLease(directory);
 let held;
 try{
  const selected=await measure(file,undefined,MAX_PACKAGE);need(selected.bytes>0&&selected.sha256===expectedSha256,'MCP_DELIVERY_UPLOAD_SOURCE_CHANGED');
  const intent={schema:'stellar-forge.customer-package-upload.v1',endpoint:client.endpoint,workspace:client.deliveryWorkspace,
   file,filename,bytes:selected.bytes,sha256:selected.sha256};
  await retainInitializationFile(join(directory,'intent.json'),bytes(intent),{resume:true});
  const completed=await optionalInitializationBytes(join(directory,'result.json'));
  if(completed){const saved=JSON.parse(completed);need(identity(saved.intent)===identity(intent),'MCP_DELIVERY_UPLOAD_INTENT_CHANGED');return saved;}
  held=await fileHandle(file,selected,MAX_PACKAGE);
  const verifyHeld=async()=>need(stamp(held.stat)===stamp(await held.file.stat({bigint:true})),'MCP_DELIVERY_UPLOAD_SOURCE_CHANGED');
  const digest=createHash('sha256'),scratch=Buffer.alloc(CHUNK);let measured=0;
  while(measured<selected.bytes){const part=await held.file.read(scratch,0,Math.min(CHUNK,selected.bytes-measured),measured);need(part.bytesRead>0,'MCP_DELIVERY_UPLOAD_SOURCE_CHANGED');digest.update(scratch.subarray(0,part.bytesRead));measured+=part.bytesRead;}
  await verifyHeld();need(digest.digest('hex')===selected.sha256,'MCP_DELIVERY_UPLOAD_SOURCE_CHANGED');
  const context={requestSignal:signal};
  let status=await client.call('upload-start',{sha256:selected.sha256,bytes:selected.bytes,filename},context);
  const validate=value=>{need(value.sha256===selected.sha256&&value.bytes===selected.bytes&&value.filename===filename&&
   Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=selected.bytes&&typeof value.complete==='boolean','MCP_DELIVERY_UPLOAD_STATUS_CHANGED');return value;};
  validate(status);
  while(status.offset<selected.bytes){
   signal?.throwIfAborted();
   const advertised=status.uploadBatchChunks;
   need(advertised===undefined||Number.isSafeInteger(advertised)&&advertised>=1&&advertised<=nativeCollectionDeliveryUploadBatchChunks,'MCP_DELIVERY_UPLOAD_CAPABILITY_CHANGED');
   const limit=advertised??1,chunks=[],start=status.offset;let offset=start;
   while(chunks.length<limit&&offset<selected.bytes){
    const raw=Buffer.alloc(Math.min(CHUNK,selected.bytes-offset));let used=0;
    while(used<raw.length){const part=await held.file.read(raw,used,raw.length-used,offset+used);need(part.bytesRead>0,'MCP_DELIVERY_UPLOAD_SOURCE_CHANGED');used+=part.bytesRead;}
    chunks.push({offset,base64:raw.toString('base64'),chunkSha256:sha(raw)});offset+=raw.length;
   }
   await verifyHeld();
   status=validate(await client.call(chunks.length===1?'upload-chunk':'upload-chunks',
    chunks.length===1?{sha256:selected.sha256,...chunks[0]}:{sha256:selected.sha256,chunks},context));
   need(status.offset>=offset,'MCP_DELIVERY_UPLOAD_OFFSET_CHANGED');
   await onProgress({stage:'upload',sha256:selected.sha256,offset:status.offset,bytes:selected.bytes,
    startOffset:start,chunks:chunks.length,uploadBatchChunks:limit});
  }
  status=validate(await client.call('upload-finish',{sha256:selected.sha256},context));need(status.complete,'MCP_DELIVERY_UPLOAD_NOT_COMPLETE');
  await verifyHeld();await measure(file,selected,MAX_PACKAGE);
  const result={schema:intent.schema+'.result',intent,status};await retainInitializationFile(join(directory,'result.json'),bytes(result),{resume:true});return result;
 }finally{try{await held?.file.close();}finally{await release();}}
}

/** Save one original effect selection before dispatch, then retry only that selection. */
export async function retainNativeCustomerRequest({client,directory,operation,body,signal}){
 need(client&&typeof client.call==='function'&&typeof client.endpoint==='string'&&
  ['preview','prepare','task-preview','task-prepare','receive'].includes(operation),'MCP_DELIVERY_REQUEST_SELECTION');
 absolute(directory);
 const selected={schema:'stellar-forge.customer-package-request.v1',endpoint:client.endpoint,
  workspace:client.deliveryWorkspace,operation,body};
 // Capture the complete original JSON before any asynchronous boundary.
 // The native canonical encoder still rejects undefined and unsupported values.
 identity(selected);const intentBytes=bytes(selected),intent=JSON.parse(intentBytes);
 const dispatch=client.call.bind(client);
 await initializationDirectory(directory,{create:true});
 const release=await acquireCollectionLease(directory);
 try{
  await retainInitializationFile(join(directory,'intent.json'),intentBytes,{resume:true});
  const prior=await optionalInitializationBytes(join(directory,'result.json'),32*1024*1024);
  if(prior){const saved=JSON.parse(prior);need(identity(saved.intent)===identity(intent),'MCP_DELIVERY_REQUEST_CHANGED');return saved;}
  // The transport receives its own copy, separate from the retained result intent.
  const value=await dispatch(intent.operation,JSON.parse(intentBytes).body,{requestSignal:signal});
  const result={schema:intent.schema+'.result',intent,value};
  await retainInitializationFile(join(directory,'result.json'),bytes(result),{resume:true});
  return result;
 }finally{await release();}
}
