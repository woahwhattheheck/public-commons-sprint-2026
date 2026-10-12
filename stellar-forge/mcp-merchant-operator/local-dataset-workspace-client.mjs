// SPDX-License-Identifier: MIT
// Typed calls and full retained downloads through the existing merchant MCP transport.
import {openMerchantFileClient,createRetainedDownload} from './retained-download.mjs';
import {LOCAL_DATASET_DOWNLOAD_MANIFEST,LOCAL_DATASET_FILE_BYTES,UUID,parseLocalDatasetDownloadManifest} from './local-dataset-download-contract.mjs';
import {failure,identifier} from './host-files.mjs';
export async function openLocalDatasetClient({url,tokenEnv,environment,workspace,workspaceId,client,signal}={}){
 identifier(workspace,'Local dataset workspace alias');
 if(workspaceId!==undefined&&!UUID.test(workspaceId))throw failure('LOCAL_DATASET_CLIENT_BINDING','Use the original persistent delivery workspace UUID.');
 const transport=client??await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'LOCAL_DATASET',clientName:'starforge-local-dataset-customer',maximumResponseBytes:32*1024*1024});
 if(!transport||typeof transport.call!=='function'||typeof transport.endpoint!=='string')throw failure('LOCAL_DATASET_CLIENT_REQUIRED','Select one original merchant client.');
 let selected=workspaceId;
 const scoped=()=>{if(!selected)throw failure('LOCAL_DATASET_CLIENT_BINDING','Open or select the original delivery workspace first.');return{workspace,workspaceId:selected};};
 const call=(name,args={},options)=>transport.call('merchant_local_dataset_'+name,{...args,...scoped()},options);
 const raw={
  get workspaceId(){return selected;},get endpoint(){return transport.endpoint;},
  async open(){const result=await transport.call('merchant_local_dataset_open',{workspace});if(!UUID.test(result.workspaceId??'')||selected&&result.workspaceId!==selected)throw failure('LOCAL_DATASET_CLIENT_BINDING','The listener returned a different original workspace.');selected=result.workspaceId;return result;},
  status:args=>transport.call('merchant_local_dataset_status',{...(args??{}),workspace,...(selected?{workspaceId:selected}:{})}),
  record:deliveryId=>call('record',{deliveryId}),
  prepare:input=>call('prepare',input),
  continue:input=>call('continue',input),
  cancel:input=>call('cancel',input),
  request:(requestId,action='inspect')=>call('request',{requestId,action}),
  customerRead:(deliveryId,operation,args={})=>call('customer',{action:'read',deliveryId,operation,arguments:args}),
  customerWrite:(requestId,deliveryId,operation,args={})=>call('customer',{action:'write',requestId,deliveryId,operation,arguments:args}),
  package:input=>call('package',{...input,action:'create'}),
  inspectPackage:requestId=>call('package',{action:'inspect',requestId}),
  browser:(action='open',port=0)=>call('browser',{action,...(action==='open'?{port}:{})}),
  close:input=>call('close',input),
  file:input=>call('file',input),
  fileRelease:readId=>call('file_release',{readId}),
  async wait(requestId,{signal:waitingSignal=signal,intervalMs=400,onProgress}={}){
   if(!Number.isSafeInteger(intervalMs)||intervalMs<100||intervalMs>10000)throw failure('LOCAL_DATASET_CLIENT_INTERVAL','Choose an explicit status interval from 100 to 10000 ms.');
   for(;;){
    waitingSignal?.throwIfAborted();const state=await call('request',{requestId,action:'inspect'},{requestSignal:waitingSignal});await onProgress?.(state);
    if(state.state!=='RUNNING')return state;
    await new Promise((resolve,reject)=>{
     const finish=()=>{waitingSignal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(finish,intervalMs),abort=()=>{clearTimeout(timer);waitingSignal?.removeEventListener('abort',abort);reject(waitingSignal.reason??failure('LOCAL_DATASET_CLIENT_CANCELLED','Status observation stopped; the original operation is unchanged.'));};
     waitingSignal?.addEventListener('abort',abort,{once:true});if(waitingSignal?.aborted)abort();
    });
   }
  },
  async downloadPackage(options){
   const binding=scoped(),adapter={endpoint:transport.endpoint+'#local-dataset='+workspace+'/'+binding.workspaceId,
    call:(name,args,callOptions)=>transport.call(name,{...args,...binding},callOptions)};
   const receiver=createRetainedDownload({
    manifestName:LOCAL_DATASET_DOWNLOAD_MANIFEST,maximumBytes:LOCAL_DATASET_FILE_BYTES,
    parseManifest:(bytes,exportId)=>{const manifest=parseLocalDatasetDownloadManifest(bytes,exportId);if(manifest.workspaceId!==binding.workspaceId)throw failure('LOCAL_DATASET_DOWNLOAD_BINDING','The original package belongs to a different workspace.');return manifest;},
    stateSchema:'stellar-forge.local-dataset-download-state.v1',resultSchema:'stellar-forge.local-dataset-downloaded.v1',
    toolPrefix:'merchant_local_dataset_package',errorPrefix:'LOCAL_DATASET',clientName:'starforge-local-dataset-customer',
    validateExportId:id=>{if(!UUID.test(id))throw failure('LOCAL_DATASET_DOWNLOAD_BINDING','Use the original completed package request UUID.');},
    describe:manifest=>({workspaceId:manifest.workspaceId,deliveryId:manifest.deliveryId,nativeManifestSha256:manifest.nativeManifestSha256})});
   return receiver.download({...options,client:adapter});
  }
 };
 return Object.freeze(raw);
}
