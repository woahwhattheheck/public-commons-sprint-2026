// SPDX-License-Identifier: MIT
// Complete original package download using the maintained retained-file engine.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createRetainedDownload} from '../mcp-merchant-operator/retained-download.mjs';
import {openNativeCollectionDeliveryClient,checkedDeliveryRange} from './native-collection-delivery-client.mjs';
import {openCustomerDelivery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/model.mjs';
import {inspectPackage,MAX_PACKAGE,need,identity} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
const SCHEMA='stellar-forge.collection-customer-download-manifest.v1',RECEIVED_SCHEMA='stellar-forge.received-customer-download-manifest.v1',TOOL='collection_customer_package';
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9._-]{1,100}$/;
const sha=v=>createHash('sha256').update(v).digest('hex');
const select=id=>need(typeof id==='string'&&ID.test(id)&&!['.','..'].includes(id),'MCP_DELIVERY_DOWNLOAD_ID');
function transport(input){
 const options={...input};
 const received=options.receivedSha256!==undefined,selectionId=received?options.receivedSha256:options.id;
 select(selectionId);need(!received||HASH.test(selectionId),'MCP_DELIVERY_DOWNLOAD_RECEIVED_SHA');
 need(!received||options.id===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');
 need(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.deliveryWorkspace??''),'MCP_DELIVERY_DOWNLOAD_ALIAS');
 function parseManifest(raw,exportId){
  select(exportId);need(exportId===selectionId,'MCP_DELIVERY_DOWNLOAD_SELECTION');let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'MCP_DELIVERY_DOWNLOAD_MANIFEST');}
  need(value?.schema===(received?RECEIVED_SCHEMA:SCHEMA)&&value.id===exportId&&
   (received?value.package?.sha256===selectionId:HASH.test(value.previewSha256??''))&&Array.isArray(value.files)&&value.files.length===1&&
   value.files[0].name==='customer-delivery.ndjson'&&Number.isSafeInteger(value.files[0].bytes)&&value.files[0].bytes>0&&
   value.files[0].bytes<=MAX_PACKAGE&&HASH.test(value.files[0].sha256??'')&&value.package?.sha256===value.files[0].sha256&&
   value.package.bytes===value.files[0].bytes&&HASH.test(value.package.manifestSha256??''),'MCP_DELIVERY_DOWNLOAD_MANIFEST');
  return value;
 }
 async function connect(connectionOptions){
  const client=await openNativeCollectionDeliveryClient({...connectionOptions,deliveryWorkspace:options.deliveryWorkspace});let saved;
  async function metadata(){
   saved??=received?await client.receivedPackage(selectionId):await client.inspect(selectionId);
   need(saved.state==='COMPLETE'&&(received?saved.schema===RECEIVED_SCHEMA&&saved.sha256===selectionId:saved.id===selectionId)&&saved.files?.manifest?.name==='manifest.json'&&
    Number.isSafeInteger(saved.files.manifest.bytes)&&saved.files.manifest.bytes>0&&saved.files.manifest.bytes<=65000&&
    HASH.test(saved.files.manifest.sha256??'')&&HASH.test(saved.package?.sha256??''),'MCP_DELIVERY_DOWNLOAD_METADATA');
   return saved;
  }
  return{endpoint:client.endpoint+'#collection-delivery='+options.deliveryWorkspace+(received?'&origin=received':''),async call(tool,args,context){
   need(args.exportId===selectionId,'MCP_DELIVERY_DOWNLOAD_SELECTION');const value=await metadata(),manifest=value.files.manifest;
   if(tool===TOOL+'_manifest')return{state:'MANIFEST_RETAINED',exportId:selectionId,manifestFile:manifest};
   need(tool===TOOL+'_file'&&args.readId===undefined&&args.expectedManifestSha256===manifest.sha256,'MCP_DELIVERY_DOWNLOAD_FILE');
   const name=args.file,file=name==='manifest.json'?manifest:name==='customer-delivery.ndjson'?{name,bytes:value.package.bytes,sha256:value.package.sha256}:null;
   need(file&&file.sha256===args.expectedSha256,'MCP_DELIVERY_DOWNLOAD_FILE');
   const offset=args.offset??0,limit=Math.min(args.limit??65536,65536);
   const operation=received?(name==='manifest.json'?'received-manifest-file':'received-package-file'):(name==='manifest.json'?'manifest-file':'package-file');
   const response=await client.call(operation,{...(received?{sha256:selectionId}:{id:selectionId}),expectedFileSha256:file.sha256,
    byteOffset:offset,maxBytes:limit},context);
   need((received?response.sha256===selectionId:response.id===selectionId)&&response.filename===name,'MCP_DELIVERY_DOWNLOAD_FILE');
   checkedDeliveryRange(response.file,{...file,byteOffset:offset,maxBytes:limit});
   return{exportId:selectionId,manifestSha256:manifest.sha256,file,offset:response.file.byteOffset,
    bytesRead:response.file.returnedBytes,encoding:response.file.encoding,nextOffset:response.file.nextByteOffset,data:response.file.data};
  }};
 }
 return createRetainedDownload({manifestName:'manifest.json',parseManifest,maximumBytes:MAX_PACKAGE,
  stateSchema:received?'stellar-forge.received-customer-package-download-state.v1':'stellar-forge.customer-package-download-state.v1',
  resultSchema:received?'stellar-forge.received-customer-package-download.v1':'stellar-forge.customer-package-download.v1',
  toolPrefix:TOOL,errorPrefix:'MCP_DELIVERY',clientName:'starforge-customer-package',connect,readLease:false,
  validateExportId:select,describe:m=>({...(!received?{deliveryId:m.id}:{receivedPackageSha256:m.id}),
   packageSha256:m.package.sha256,packageManifestSha256:m.package.manifestSha256})});
}
const selectionId=options=>options.receivedSha256??options.id;
export async function inspectNativeCustomerPackage(options){need(options.receivedSha256===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return transport(options).inspect({...options,exportId:options.id});}
export async function inspectReceivedCustomerPackage(options){need(HASH.test(options.receivedSha256??'')&&options.id===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return transport(options).inspect({...options,exportId:options.receivedSha256});}
async function downloadPackage(input){
 const options={...input};
 need(HASH.test(options.expectedManifestSha256??''),'MCP_DELIVERY_DOWNLOAD_REVIEW_REQUIRED');
 const chunkSize=options.chunkSize??65536;
 need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=65536,'MCP_DELIVERY_DOWNLOAD_CHUNK_SIZE');
 const result=await transport(options).download({...options,exportId:selectionId(options),chunkSize});
 const checked=await inspectPackage(join(options.directory,'customer-delivery.ndjson'),{expected:{sha256:result.packageSha256,bytes:result.bytes}});
 need(checked.manifestSha256===result.packageManifestSha256,'MCP_DELIVERY_DOWNLOAD_PACKAGE_CHANGED');
 return{...result,packageFiles:checked.files,contentBytes:checked.contentBytes,outputsComplete:checked.outputsComplete};
}
async function reopenPackage(input){
 const options={...input};
 need(HASH.test(options.expectedManifestSha256??''),'MCP_DELIVERY_DOWNLOAD_REVIEW_REQUIRED');const selected=transport(options);
 return selected.lockedDownload(options.directory,async context=>{
  const raw=await selected.bytesAt(join(context.root,'manifest.json'),65000);need(sha(raw)===options.expectedManifestSha256,'MCP_DELIVERY_DOWNLOAD_MANIFEST_CHANGED');
  // Offline reopen must retain the original transport origin before loadContext
  // can checkpoint anything. No connection is made to recover that identity.
  let retained;
  try{retained=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(
   await selected.bytesAt(join(context.stateDirectory,'checkpoint.json'),32*1024*1024)));}
  catch{need(false,'MCP_DELIVERY_DOWNLOAD_RETAINED_ENDPOINT_REQUIRED');}
  const suffix='#collection-delivery='+options.deliveryWorkspace+(options.receivedSha256?'&origin=received':'');
  need(typeof retained?.endpoint==='string'&&retained.endpoint.indexOf('#')>0&&
   retained.endpoint.slice(retained.endpoint.indexOf('#'))===suffix,'MCP_DELIVERY_DOWNLOAD_ALIAS_CHANGED');
  let endpoint;try{endpoint=new URL(retained.endpoint);}catch{need(false,'MCP_DELIVERY_DOWNLOAD_RETAINED_ENDPOINT_REQUIRED');}
  need(['http:','https:'].includes(endpoint.protocol)&&endpoint.hostname,'MCP_DELIVERY_DOWNLOAD_RETAINED_ENDPOINT_REQUIRED');
  await selected.loadContext(context,raw,selectionId(options),retained.endpoint);const file=context.manifest.files[0];
  await selected.verifiedFile(join(context.root,file.name),file);
  const checked=await inspectPackage(join(context.root,file.name),{expected:file});
  need(checked.manifestSha256===context.manifest.package.manifestSha256,'MCP_DELIVERY_DOWNLOAD_PACKAGE_CHANGED');
  context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};await selected.checkpoint(context);
  return{schema:options.receivedSha256?'stellar-forge.received-customer-package-download.v1':'stellar-forge.customer-package-download.v1',
   state:'COMPLETE',...(options.receivedSha256?{receivedPackageSha256:options.receivedSha256}:{deliveryId:options.id}),manifestSha256:sha(raw),
   packageSha256:checked.sha256,packageManifestSha256:checked.manifestSha256,bytes:checked.bytes,packageFiles:checked.files,
   contentBytes:checked.contentBytes,outputsComplete:checked.outputsComplete};
 });
}
export async function downloadNativeCustomerPackage(options){need(options.receivedSha256===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return downloadPackage(options);}
export async function reopenNativeCustomerPackage(options){need(options.receivedSha256===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return reopenPackage(options);}
export async function downloadReceivedCustomerPackage(options){need(HASH.test(options.receivedSha256??'')&&options.id===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return downloadPackage(options);}
export async function reopenReceivedCustomerPackage(options){need(HASH.test(options.receivedSha256??'')&&options.id===undefined,'MCP_DELIVERY_DOWNLOAD_ORIGIN');return reopenPackage(options);}
/** Keep downloaded source inert and receive through the original full package reader. */
export async function receiveDownloadedCustomerPackage({file,receivingDirectory,expectedSha256}){
 const desk=await openCustomerDelivery({directory:receivingDirectory});try{
  const result=await desk.receive({file,expectedSha256}),reopened=await desk.received(expectedSha256);
  const {directory:ignored,...saved}=result;need(identity(reopened)===identity(saved),'MCP_DELIVERY_RECEIVED_CHANGED');return result;
 }finally{await desk.close();}
}
