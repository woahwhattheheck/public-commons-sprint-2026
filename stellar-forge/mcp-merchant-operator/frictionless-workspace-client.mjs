// SPDX-License-Identifier: MIT
// Typed calls and complete source receiving through the maintained MCP/file transport.
import {openMerchantFileClient,createRetainedDownload} from './retained-download.mjs';
import {FRICTIONLESS_DOWNLOAD_MANIFEST,FRICTIONLESS_FILE_BYTES,UUID,parseFrictionlessDownloadManifest} from './frictionless-download-contract.mjs';
import {failure,identifier} from './host-files.mjs';
export async function openFrictionlessClient({url,tokenEnv,environment,workspace,workspaceId,client,signal}={}){
 identifier(workspace,'Frictionless source workspace');
 if(workspaceId!==undefined&&!UUID.test(workspaceId))throw failure('FRICTIONLESS_CLIENT_BINDING','Use the persistent original source-workbench UUID.');
 const transport=client??await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'FRICTIONLESS',clientName:'starforge-frictionless-source',maximumResponseBytes:32*1024*1024});
 if(!transport||typeof transport.call!=='function'||typeof transport.endpoint!=='string')throw failure('FRICTIONLESS_CLIENT_REQUIRED','Select one original merchant file client.');
 let selected=workspaceId;
 const scoped=()=>{if(!selected)throw failure('FRICTIONLESS_CLIENT_BINDING','Open or select the original source workspace first.');return{workspace,workspaceId:selected};};
 const call=(name,args={},options)=>transport.call('merchant_frictionless_'+name,{...args,...scoped()},options);
 const raw={
  get workspaceId(){return selected;},get endpoint(){return transport.endpoint;},
  async open(){const result=await transport.call('merchant_frictionless_open',{workspace});
   if(!UUID.test(result.workspaceId??'')||selected&&result.workspaceId!==selected)throw failure('FRICTIONLESS_CLIENT_BINDING','The listener returned a different source workspace.');
   selected=result.workspaceId;return result;},
  status:args=>transport.call('merchant_frictionless_status',{...(args??{}),workspace,...(selected?{workspaceId:selected}:{})}),
  current:()=>call('current'),input:input=>call('input',{input}),
  capture:(captureId,args={})=>call('capture',{...args,captureId}),
  edition:editionId=>call('edition',{action:'inspect',editionId}),
  review:reviewId=>call('review',{action:'inspect',reviewId}),
  planInput:(editionId,query)=>call('plan_input',{editionId,query}),
  comparison:comparisonId=>call('compare',{action:'inspect',comparisonId}),
  intake:input=>call('intake',input),
  createEdition:input=>call('edition',{...input,action:'create'}),
  reviewEdition:input=>call('review',{...input,action:'run'}),
  select:input=>call('select',input),
  savePlan:input=>call('plan',input),
  compare:input=>call('compare',{...input,action:'create'}),
  export:input=>call('export',{...input,action:'create'}),
  inspectExport:requestId=>call('export',{action:'inspect',requestId}),
  request:(requestId,action='inspect')=>call('request',{requestId,action}),
  cancel:input=>call('cancel',input),
  browser:(action='open',port=0)=>call('browser',{action,...(action==='open'?{port}:{})}),
  close:input=>call('close',input),file:input=>call('file',input),
  fileRelease:readId=>call('file_release',{readId}),
  async wait(requestId,{signal:waitingSignal=signal,intervalMs=400,onProgress}={}){
   if(!Number.isSafeInteger(intervalMs)||intervalMs<100||intervalMs>10000)throw failure('FRICTIONLESS_CLIENT_INTERVAL','Choose a status interval from 100 to 10000 ms.');
   for(;;){
    waitingSignal?.throwIfAborted();const state=await call('request',{requestId,action:'inspect'},{requestSignal:waitingSignal});await onProgress?.(state);
    if(state.state!=='RUNNING')return state;
    await new Promise((resolve,reject)=>{
     const finish=()=>{waitingSignal?.removeEventListener('abort',abort);resolve();};
     const timer=setTimeout(finish,intervalMs),abort=()=>{clearTimeout(timer);waitingSignal?.removeEventListener('abort',abort);
      reject(waitingSignal.reason??failure('FRICTIONLESS_CLIENT_CANCELLED','Status observation stopped; the original source request remains retained.'));};
     waitingSignal?.addEventListener('abort',abort,{once:true});if(waitingSignal?.aborted)abort();
    });
   }
  },
  async downloadExport(options){
   const binding=scoped(),adapter={endpoint:transport.endpoint+'#frictionless='+workspace+'/'+binding.workspaceId,
    call:(name,args,callOptions)=>transport.call(name,{...args,...binding},callOptions)};
   const receiver=createRetainedDownload({
    manifestName:FRICTIONLESS_DOWNLOAD_MANIFEST,maximumBytes:FRICTIONLESS_FILE_BYTES,nestedFiles:true,
    maximumManifestBytes:64*1024*1024,maximumCheckpointBytes:64*1024*1024,
    parseManifest:(raw,exportId)=>{const manifest=parseFrictionlessDownloadManifest(raw,exportId);
     if(manifest.workspaceId!==binding.workspaceId)throw failure('FRICTIONLESS_DOWNLOAD_BINDING','The retained source belongs to a different workspace.');return manifest;},
    stateSchema:'stellar-forge.frictionless-source-download-state.v1',resultSchema:'stellar-forge.frictionless-source-downloaded.v1',
    toolPrefix:'merchant_frictionless_export',errorPrefix:'FRICTIONLESS',clientName:'starforge-frictionless-source',
    validateExportId:id=>{if(!UUID.test(id))throw failure('FRICTIONLESS_DOWNLOAD_BINDING','Use the completed original export request UUID.');},
    describe:manifest=>({workspaceId:manifest.workspaceId,editionId:manifest.editionId,sourceHash:manifest.sourceHash,
     captureSha256:manifest.captureSha256,nativeManifestSha256:manifest.nativeManifestSha256})});
   return receiver.download({...options,client:adapter});
  }
 };
 return Object.freeze(raw);
}
