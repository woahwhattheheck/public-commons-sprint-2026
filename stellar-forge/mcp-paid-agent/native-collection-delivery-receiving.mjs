// SPDX-License-Identifier: MIT
// One complete native customer-package journey over existing original Inbox outputs.
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open,writeFile,rename,realpath} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {serveCollections} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/server.mjs';
import {collectionsWorkspaceLaunch,collectionsRecoveryWorkspaceLaunch} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/launch.mjs';
import {acquireCollectionLease} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/model.mjs';
import {initializationDirectory,initializationBytes,optionalInitializationBytes,retainInitializationFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {selectSource} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/source.mjs';
import {bytes,identity,need,measure,inspectPackage,copyFile,MAX_PACKAGE} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/format.mjs';
import {receiveCustomerDelivery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/delivery/receiving/receive.mjs';
import {selectNativeInboxTask} from './native-inbox-task-delivery.mjs';
import {initializeCollectionReceiver,openCollectionReceiver,startCollectionReceiver} from './native-collections-receiver.mjs';
import {openNativeCollectionDeliveryClient,retainNativeCustomerRequest,uploadNativeCustomerPackage,checkedDeliveryRange} from './native-collection-delivery-client.mjs';
import {inspectNativeCustomerPackage,downloadNativeCustomerPackage,reopenNativeCustomerPackage,receiveDownloadedCustomerPackage,inspectReceivedCustomerPackage,downloadReceivedCustomerPackage,reopenReceivedCustomerPackage} from './native-collection-delivery-download.mjs';

const SCHEMA='stellar-forge.collection-customer-mcp-receiving.v1';
const hash=v=>createHash('sha256').update(v).digest('hex');
async function atomic(file,value){
 const target=file+'.'+randomUUID(),raw=bytes(value);
 try{await writeFile(target,raw,{mode:0o600,flag:'wx'});const h=await open(target,'r+');try{await h.sync();}finally{await h.close();}
  await rename(target,file);const parent=await open(join(file,'..'),'r');try{await parent.sync();}finally{await parent.close();}
 }catch(error){throw error;}
}
async function exactRows(client,digest){
 const rows=[];let offset=0,first;
 do{
  const page=await client.received(digest,{offset,limit:100});first??=page;
  need(page.sha256===digest&&page.manifestSha256===first.manifestSha256&&page.total===first.total&&page.offset===offset,'MCP_DELIVERY_RECEIVING_PAGE_CHANGED');
  rows.push(...page.items);offset=page.nextOffset;
 }while(offset!==null);
 need(rows.length===first.total&&new Set(rows.map(r=>r.path)).size===rows.length,'MCP_DELIVERY_RECEIVING_INVENTORY');
 return{...first,items:rows,offset:0,nextOffset:null};
}
async function exactHistory(client){
 const items=[];let offset=0,first;
 do{
  const value=await client.receivedHistory({offset,limit:25,...(first?{expectedHistorySha256:first.historySha256}:{})});
  first??=value;
  need(value.historySha256===first.historySha256&&value.total===first.total&&value.offset===offset&&
   Array.isArray(value.items)&&value.items.length<=25&&
   (value.nextOffset===null||value.nextOffset===offset+value.items.length&&value.items.length>0),
   'MCP_DELIVERY_RECEIVING_HISTORY_CHANGED');
  items.push(...value.items);offset=value.nextOffset;
 }while(offset!==null);
 need(items.length===first.total&&new Set(items.map(row=>row.sha256)).size===items.length,'MCP_DELIVERY_RECEIVING_HISTORY_CHANGED');
 return{...first,items,offset:0,nextOffset:null};
}
/** Caller retains the original Collections object and its existing queue owner. */
export async function receiveNativeCustomerDelivery({directory,collections,sourceRoot,sourceManifest,collectionId,intentIds,taskPacket,expectedTaskSha256,onProgress=()=>{}}){
 const taskMode=collections==null&&typeof taskPacket==='string'&&typeof expectedTaskSha256==='string';
 need((taskMode||(collections&&typeof collections.inspect==='function'&&taskPacket===undefined&&expectedTaskSha256===undefined))&&Array.isArray(intentIds)&&intentIds.length>0,'MCP_DELIVERY_RECEIVING_SELECTION');
 const task=taskMode?await selectNativeInboxTask({taskPacketDirectory:taskPacket,expectedTaskSha256}):null;
 if(taskMode)need(collectionId==null&&intentIds.every(id=>task.inspection.intents.some(row=>row.intentId===id)),'MCP_DELIVERY_RECEIVING_TASK_SELECTION');
 const executed=relative(sourceRoot,fileURLToPath(import.meta.url));
 need(['stellar-forge/mcp-paid-agent/native-collection-delivery-receiving.mjs','source/stellar-forge/mcp-paid-agent/native-collection-delivery-receiving.mjs'].includes(executed)&&await realpath(sourceRoot)===sourceRoot,'MCP_DELIVERY_RECEIVING_SOURCE');
 const source=await selectSource({sourceRoot,sourceManifest,exclude:[directory,collections?.directory,collections?.queueRoot,taskPacket].filter(Boolean)});
 await initializationDirectory(directory,{create:true});const release=await acquireCollectionLease(directory);
 let state,mcp,registration,sender,recipient,failed;
 const stateFile=join(directory,'operation.json'),files=join(directory,'files'),host=join(directory,'mcp-host'),recipientRoot=join(directory,'remote-customer');
 const save=()=>atomic(stateFile,state);
 const owners=()=>[mcp?'mcp':null,registration?'registration':null,sender?'sender':null,recipient?'recipient':null].filter(Boolean);
 async function closeOne(name){
  const value=name==='mcp'?mcp:name==='registration'?registration:name==='sender'?sender:recipient;
  if(!value)return;await value.close();
  if(name==='mcp')mcp=null;else if(name==='registration')registration=null;else if(name==='sender')sender=null;else recipient=null;
 }
 async function recordFile(name,kind,expected){
  const descriptor={name,kind,...await measure(join(files,name),expected,MAX_PACKAGE)};
  const prior=state.files.find(r=>r.name===name);if(prior)need(identity(prior)===identity(descriptor),'MCP_DELIVERY_RECEIVING_ARTIFACT_CHANGED');else{state.files.push(descriptor);await save();}
  return descriptor;
 }
 async function retainedJson(name,value){
  const content=bytes(value);await retainInitializationFile(join(files,name),content,{resume:true});return recordFile(name,'json',{bytes:content.length,sha256:hash(content)});
 }
 async function verifyCompletion(){
  for(const row of state.files)await measure(join(files,row.name),row,MAX_PACKAGE);
  const packageFile=join(files,'customer-delivery.ndjson'),checked=await inspectPackage(packageFile,{expected:state.original.package});
  need(checked.manifestSha256===state.original.package.manifestSha256,'MCP_DELIVERY_RECEIVING_FINAL_PACKAGE');
  const result=JSON.parse(await initializationBytes(join(directory,'result.json')));
  need(result.operationId===state.operationId&&result.ownersClosed===true&&identity(result.files)===identity(state.files),'MCP_DELIVERY_RECEIVING_RESULT');
  return result;
 }
 try{
  await initializationDirectory(files,{create:true});await initializationDirectory(recipientRoot,{create:true});
  const raw=await optionalInitializationBytes(stateFile,32*1024*1024);state=raw?JSON.parse(raw):null;
  const selection=taskMode?{kind:'inbox-task',taskPacket,expectedTaskSha256,task:task.inspection.task,intentIds,sourceRoot,sourceManifest,sourceSha256:source.sha256}:
   {collectionId,intentIds,sourceRoot,sourceManifest,sourceSha256:source.sha256,collectionsDirectory:collections.directory,queueRoot:collections.queueRoot};
  if(!state){
   const original=taskMode?null:await collections.inspect(collectionId);
   state={schema:SCHEMA,operationId:'collection-mcp-'+randomUUID(),selection,
    request:taskMode?{id:'mcp-'+randomUUID(),expectedTaskSha256,title:'Complete original InboxTask customer package through MCP',
     note:'The original saved Task output and its separate recovery read; no new buyer execution.',intentIds}:
    {id:'mcp-'+randomUUID(),collectionId,expectedManifestSha256:original.manifestSha256,title:'Complete original customer package through MCP',
     note:'Original saved output and source receiving; no new buyer execution.',intentIds,maxVerifyBytes:1073741824,allowIncomplete:false},
    steps:{},files:[]};await save();
  }
  need(state.schema===SCHEMA&&identity(state.selection)===identity(selection),'MCP_DELIVERY_RECEIVING_SELECTION_CHANGED');
  if(state.complete)return await verifyCompletion();
  const credentialsFile=join(directory,'credentials.json');let credential=await optionalInitializationBytes(credentialsFile);
  if(!credential){credential=bytes({token:randomBytes(32).toString('hex')});await retainInitializationFile(credentialsFile,credential,{resume:true});}
  const token=JSON.parse(credential).token;need(/^[a-f0-9]{64}$/.test(token),'MCP_DELIVERY_RECEIVING_CREDENTIALS');
  const environment={MCP_ACCESS_TOKEN:token};
  const taskSenderRoot=join(directory,'original-task-sender');
  if(taskMode)await initializationDirectory(taskSenderRoot,{create:true});
  sender=await serveCollections(taskMode?null:collections,{...(taskMode?{receivingDirectory:taskSenderRoot}:{}),port:state.senderPort??0,approvalMode:'TERMINAL'});
  recipient=await serveCollections(null,{receivingDirectory:recipientRoot,port:state.recipientPort??0,approvalMode:'TERMINAL'});
  if(!state.senderPort){state.senderPort=Number(new URL(sender.origin).port);await save();}
  if(!state.recipientPort){state.recipientPort=Number(new URL(recipient.origin).port);await save();}
  const senderConnection=join(directory,'sender-connection.json'),recipientConnection=join(directory,'recipient-connection.json');
  await atomic(senderConnection,taskMode?collectionsRecoveryWorkspaceLaunch({receivingDirectory:taskSenderRoot},sender.origin+'/#'+sender.token):
   collectionsWorkspaceLaunch({directory:collections.directory,queueRoot:collections.queueRoot,approvalMode:'TERMINAL'},sender.origin+'/#'+sender.token));
  await atomic(recipientConnection,collectionsRecoveryWorkspaceLaunch({receivingDirectory:recipientRoot},recipient.origin+'/#'+recipient.token));
  try{await initializationBytes(join(host,'collection-receiver.json'));}
  catch(error){if(error.code!=='ENOENT')throw error;await initializeCollectionReceiver({directory:host});}
  registration=await openCollectionReceiver(host);
  await registration.registerCollectionDelivery({name:'sender',connectionFile:senderConnection,sourceRoot,sourceManifest,...(taskMode?{taskPacketDirectory:taskPacket,expectedTaskSha256}: {})});
  await registration.registerCollectionDelivery({name:'recipient',connectionFile:recipientConnection});
  await closeOne('registration');
  mcp=await startCollectionReceiver({directory:host,port:state.mcpPort??0,environment});
  if(!state.mcpPort){state.mcpPort=Number(new URL(mcp.url).port);await save();}
  const options={url:mcp.url,environment},client=await openNativeCollectionDeliveryClient({...options,deliveryWorkspace:'sender'});
  const receiving=await openNativeCollectionDeliveryClient({...options,deliveryWorkspace:'recipient'});
  if(taskMode){
   const rows=[];let offset=0,first;
   do{const page=await client.inspectTask(expectedTaskSha256,{offset,limit:100});first??=page;
    need(identity(page.task)===identity(task.inspection.task)&&page.offset===offset&&page.total===first.total,'MCP_DELIVERY_RECEIVING_TASK_INSPECTION');
    rows.push(...page.items);offset=page.nextOffset;
   }while(offset!==null);
   need(identity(rows)===identity(task.inspection.intents),'MCP_DELIVERY_RECEIVING_TASK_POPULATION');
   await retainedJson('original-task-inspection.json',{schema:first.schema,task:first.task,intents:rows});
  }
  const preview=await retainNativeCustomerRequest({client,directory:join(directory,'preview'),operation:taskMode?'task-preview':'preview',body:state.request});
  if(!state.preview){state.preview=preview.value;await save();}
  need(identity(state.preview)===identity(preview.value)&&state.preview.source.sha256===source.sha256,'MCP_DELIVERY_RECEIVING_PREVIEW');
  const prepared=await retainNativeCustomerRequest({client,directory:join(directory,'prepare'),operation:taskMode?'task-prepare':'prepare',body:{...state.request,expectedPreviewSha256:state.preview.previewSha256}});
  need(prepared.value.state==='COMPLETE'&&prepared.value.outputsComplete&&prepared.value.responseCount===intentIds.length,'MCP_DELIVERY_RECEIVING_OUTPUTS');
  if(!state.original){state.original=prepared.value;await save();}
  need(identity(prepared.value)===identity(state.original),'MCP_DELIVERY_RECEIVING_PREPARE_CHANGED');
  await retainedJson('remote-delivery.json',state.original);
  const inspected=await inspectNativeCustomerPackage({...options,deliveryWorkspace:'sender',id:state.request.id});
  if(!state.downloadManifest){state.downloadManifest=inspected;await save();}
  need(identity(inspected)===identity(state.downloadManifest),'MCP_DELIVERY_RECEIVING_DOWNLOAD_SELECTION');
  const downloadOptions={...options,deliveryWorkspace:'sender',id:state.request.id,directory:join(directory,'download'),expectedManifestSha256:inspected.manifestSha256};
  if(!state.steps.downloadInterrupted){
   try{
    await downloadNativeCustomerPackage({...downloadOptions,onProgress:async progress=>{
     if(progress.state==='DOWNLOADING'&&progress.bytes>0){state.steps.downloadInterrupted=true;await save();throw Object.assign(new Error('Retained prefix selected'),{code:'MCP_DELIVERY_RECEIVING_PREFIX_HELD'});}
    }});
   }catch(error){if(error.code!=='MCP_DELIVERY_RECEIVING_PREFIX_HELD')throw error;}
   need(state.steps.downloadInterrupted,'MCP_DELIVERY_RECEIVING_NO_DOWNLOAD_PREFIX');
  }
  const downloaded=await downloadNativeCustomerPackage(downloadOptions);
  await reopenNativeCustomerPackage(downloadOptions);
  need(downloaded.packageSha256===state.original.package.sha256&&downloaded.packageManifestSha256===state.original.package.manifestSha256,'MCP_DELIVERY_RECEIVING_DOWNLOAD_CHANGED');
  await copyFile(join(downloadOptions.directory,'customer-delivery.ndjson'),join(files,'customer-delivery.ndjson'),state.original.package,{maximum:MAX_PACKAGE});
  await recordFile('customer-delivery.ndjson','package',state.original.package);state.steps.downloaded=true;await save();
  const uploadOptions={client:receiving,file:join(files,'customer-delivery.ndjson'),directory:join(directory,'upload'),
   expectedSha256:state.original.package.sha256,filename:state.original.package.filename};
  if(!state.steps.uploadInterrupted){
   try{await uploadNativeCustomerPackage({...uploadOptions,onProgress:async progress=>{
    if(progress.offset>0){state.uploadProgress=progress;state.steps.uploadInterrupted=true;await save();throw Object.assign(new Error('Original recipient offset retained'),{code:'MCP_DELIVERY_RECEIVING_UPLOAD_HELD'});}
   }});}catch(error){if(error.code!=='MCP_DELIVERY_RECEIVING_UPLOAD_HELD')throw error;}
   need(state.steps.uploadInterrupted,'MCP_DELIVERY_RECEIVING_NO_UPLOAD_PREFIX');
  }
  const uploaded=await uploadNativeCustomerPackage(uploadOptions);need(uploaded.status.complete,'MCP_DELIVERY_RECEIVING_UPLOAD_INCOMPLETE');
  const received=await retainNativeCustomerRequest({client:receiving,directory:join(directory,'receive'),operation:'receive',body:{sha256:state.original.package.sha256}});
  const inventory=await exactRows(receiving,state.original.package.sha256);
  const packageInspection=await inspectPackage(join(files,'customer-delivery.ndjson'),{expected:state.original.package});
  need(received.value.outputsComplete&&inventory.manifestSha256===packageInspection.manifestSha256&&identity(inventory.items)===identity(packageInspection.manifest.files),'MCP_DELIVERY_RECEIVING_MEMBER_POPULATION');
  await retainedJson('received-inventory.json',inventory);
  if(taskMode)need(packageInspection.manifest.collection===null&&identity(packageInspection.manifest.task)===identity(task.inspection.task)&&
   packageInspection.manifest.rows.every((row,index)=>row.intentId===intentIds[index]&&row.output.state==='VERIFIED'),'MCP_DELIVERY_RECEIVING_TASK_MANIFEST');
  const response=packageInspection.manifest.rows.find(r=>r.output.state==='VERIFIED').output;
  const responseTarget=join(files,'original-response.bin');
  // Receive all original bytes via the registered member reader, with a durable original package as independent witness.
  try{await measure(responseTarget,response);}
  catch(error){
   if(error.code!=='ENOENT')throw error;
   const temporary=join(files,'original-response.part');let out;
   try{
    // A partial owned observation can be reproduced from the same immutable original member.
    out=await open(temporary,'w',0o600);let offset=0;const digest=createHash('sha256');
    while(offset<response.bytes){const value=await receiving.call('received-file',{sha256:state.original.package.sha256,path:response.path,
     expectedFileSha256:response.sha256,byteOffset:offset,maxBytes:65536});
     need(value.packageSha256===state.original.package.sha256&&value.path===response.path,'MCP_DELIVERY_RECEIVING_RESPONSE_CHANGED');
     const part=checkedDeliveryRange(value.file,{...response,byteOffset:offset,maxBytes:65536});await out.writeFile(part);digest.update(part);offset+=part.length;
    }
    need(digest.digest('hex')===response.sha256,'MCP_DELIVERY_RECEIVING_RESPONSE_CHANGED');await out.sync();await out.close();out=null;
    await copyFile(temporary,responseTarget,response);
   }finally{await out?.close();}
  }
  await recordFile('original-response.bin','response',response);
  const local=await receiveDownloadedCustomerPackage({file:join(files,'customer-delivery.ndjson'),receivingDirectory:join(directory,'independent-customer'),expectedSha256:state.original.package.sha256});
  need(local.manifestSha256===packageInspection.manifestSha256,'MCP_DELIVERY_RECEIVING_INDEPENDENT_CHANGED');
  state.steps.independentReceived=true;await save();
  await closeOne('mcp');await closeOne('sender');await closeOne('recipient');
  // Reopen only MCP. Both borrowed original listeners are now positively closed.
  mcp=await startCollectionReceiver({directory:host,port:state.mcpPort,environment});
  const coldOptions={url:mcp.url,environment},cold=await openNativeCollectionDeliveryClient({...coldOptions,deliveryWorkspace:'sender'}),
   coldRecipient=await openNativeCollectionDeliveryClient({...coldOptions,deliveryWorkspace:'recipient'});
  const coldResult=await cold.inspect(state.request.id);need(identity(coldResult)===identity(state.original),'MCP_DELIVERY_RECEIVING_COLD_RESULT');
  const coldInventory=await exactRows(coldRecipient,state.original.package.sha256);
  need(identity(coldInventory)===identity(inventory),'MCP_DELIVERY_RECEIVING_COLD_INVENTORY');
  const coldManifest=await inspectNativeCustomerPackage({...coldOptions,deliveryWorkspace:'sender',id:state.request.id});
  need(identity(coldManifest)===identity(state.downloadManifest),'MCP_DELIVERY_RECEIVING_COLD_MANIFEST');
  const one=await coldRecipient.call('received-file',{sha256:state.original.package.sha256,path:response.path,expectedFileSha256:response.sha256,byteOffset:0,maxBytes:65536});
  checkedDeliveryRange(one.file,{...response,byteOffset:0,maxBytes:65536});
  state.steps.originalOwnersClosedReadback=true;await save();
  // Discover the original recipient without a hash supplied to its history call.
  // The original sender and recipient listeners remain closed for this whole path.
  const history=await exactHistory(coldRecipient),selected=history.items.find(row=>row.sha256===state.original.package.sha256);
  need(selected?.state==='COMPLETE'&&selected.bytes===state.original.package.bytes&&
   selected.manifestSha256===state.original.package.manifestSha256&&
   selected.collectionId===(packageInspection.manifest.collection?.id??null)&&
   identity(selected.task??null)===identity(packageInspection.manifest.task??null),'MCP_DELIVERY_RECEIVING_HISTORY_SELECTION');
  if(!state.recipientHistory){state.recipientHistory=history;await save();}
  const originalSelection=state.recipientHistory.items.find(row=>row.sha256===selected.sha256);
  need(originalSelection&&identity(originalSelection)===identity(selected),'MCP_DELIVERY_RECEIVING_HISTORY_SELECTION');
  // Preserve the originally observed discovery snapshot if unrelated receipts arrive.
  await retainedJson('recipient-history.json',state.recipientHistory);
  const receivedManifest=await inspectReceivedCustomerPackage({...coldOptions,deliveryWorkspace:'recipient',receivedSha256:selected.sha256});
  if(!state.receivedDownloadManifest){state.receivedDownloadManifest=receivedManifest;await save();}
  need(identity(receivedManifest)===identity(state.receivedDownloadManifest),'MCP_DELIVERY_RECEIVING_RECIPIENT_SELECTION');
  const recipientDownload={...coldOptions,deliveryWorkspace:'recipient',receivedSha256:selected.sha256,
   expectedManifestSha256:receivedManifest.manifestSha256,directory:join(directory,'recipient-download')};
  if(!state.steps.recipientDownloadInterrupted){
   try{await downloadReceivedCustomerPackage({...recipientDownload,onProgress:async progress=>{
    if(progress.state==='DOWNLOADING'&&progress.bytes>0){state.steps.recipientDownloadInterrupted=true;await save();
     throw Object.assign(new Error('Original received package prefix retained'),{code:'MCP_DELIVERY_RECEIVING_RECIPIENT_PREFIX'});}
   }});}catch(error){if(error.code!=='MCP_DELIVERY_RECEIVING_RECIPIENT_PREFIX')throw error;}
   need(state.steps.recipientDownloadInterrupted,'MCP_DELIVERY_RECEIVING_NO_RECIPIENT_PREFIX');
  }
  const recipientDownloaded=await downloadReceivedCustomerPackage(recipientDownload);
  need(recipientDownloaded.packageSha256===state.original.package.sha256&&
   recipientDownloaded.packageManifestSha256===state.original.package.manifestSha256,
   'MCP_DELIVERY_RECEIVING_RECIPIENT_PACKAGE_CHANGED');
  await measure(join(recipientDownload.directory,'customer-delivery.ndjson'),state.original.package,MAX_PACKAGE);
  await retainedJson('recipient-download-manifest.json',receivedManifest);
  await closeOne('mcp');
  // The retained download reopens after every owner has closed, with no connection.
  await reopenReceivedCustomerPackage({deliveryWorkspace:'recipient',receivedSha256:selected.sha256,
   expectedManifestSha256:receivedManifest.manifestSha256,directory:recipientDownload.directory});
  const forwarded=await receiveDownloadedCustomerPackage({file:join(recipientDownload.directory,'customer-delivery.ndjson'),
   receivingDirectory:join(directory,'recipient-independent-customer'),expectedSha256:selected.sha256});
  need(forwarded.manifestSha256===packageInspection.manifestSha256,'MCP_DELIVERY_RECEIVING_RECIPIENT_INDEPENDENT_CHANGED');
  state.steps.recipientHistoryDiscovered=true;state.steps.receivedPackageDownloaded=true;
  state.steps.receivedPackageOfflineReopened=true;state.steps.receivedPackageIndependentlyReceived=true;await save();
  await retainedJson('receiving-evidence.json',{schema:SCHEMA+'.evidence',operationId:state.operationId,originalIntents:intentIds,
   source:{sha256:source.sha256,files:source.files.length,bytes:source.bytes},package:state.original.package,
   downloadManifestSha256:state.downloadManifest.manifestSha256,memberCount:inventory.total,
   ...(state.uploadProgress?{retainedUploadProgress:state.uploadProgress}:{}),steps:state.steps});
 }catch(error){failed=error;}
 finally{
  while(owners().length){
   const failures=[];for(const name of ['mcp','registration','sender','recipient'])try{await closeOne(name);}catch(error){failures.push(error);}
   if(failures.length){try{await onProgress({stage:'waiting-for-original-owner-closure',owners:owners(),codes:failures.map(e=>e.code??'OWNER_CLOSE_FAILED')});}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  try{
   if(!failed&&state&&!state.complete){
    for(const row of state.files)await measure(join(files,row.name),row,MAX_PACKAGE);
    const result={schema:SCHEMA+'.result',operationId:state.operationId,source:{sha256:source.sha256,files:source.files.length,bytes:source.bytes},
     ...(taskMode?{originalTask:task.inspection.task}:{originalCollection:collectionId}),originalIntents:intentIds,package:state.original.package,downloadManifestSha256:state.downloadManifest.manifestSha256,
     files:state.files,steps:state.steps,ownersClosed:true};
    await retainInitializationFile(join(directory,'final-candidate.json'),bytes(result),{resume:true});
    await retainInitializationFile(join(directory,'result.json'),bytes(result),{resume:true});state.complete=true;await save();
   }
  }finally{await release();}
 }
 if(failed)throw failed;
 return verifyCompletion();
}
/** The existing browser programme and the native agent programme share the same original Collection or InboxTask outputs. */
export async function receiveCollectionsCustomerProgramme(options){
 const browser=await receiveCustomerDelivery({...options,directory:join(options.directory,'browser')});
 const native=await receiveNativeCustomerDelivery({...options,directory:join(options.directory,'mcp')});
 return{schema:'stellar-forge.collections-customer-programme.v1',browser,native,ownersClosed:browser.ownersClosed&&native.ownersClosed};
}

/** Compose the same original browser/MCP course with the existing immutable Task packet. */
export async function receiveInboxTaskCustomerProgramme(options){
 need(options?.collections==null&&typeof options?.taskPacket==='string'&&typeof options?.expectedTaskSha256==='string','MCP_DELIVERY_RECEIVING_TASK_SELECTION');
 return receiveCollectionsCustomerProgramme({...options,collections:null});
}
