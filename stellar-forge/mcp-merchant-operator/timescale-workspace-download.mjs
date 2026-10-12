// MIT. Full Timescale receiving through the original resumable merchant file client.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { failure, identifier } from './host-files.mjs';
import { TIMESCALE_DOWNLOAD_MANIFEST, TIMESCALE_MANIFEST_BYTES, TIMESCALE_FILE_BYTES,
  parseTimescaleDownloadManifest, timescaleExportId } from './timescale-export-contract.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function selected(options){
  identifier(options.workspace,'Timescale workspace alias');
  if(typeof options.workspaceId!=='string'||!UUID.test(options.workspaceId))
    throw failure('TIMESCALE_DOWNLOAD_CONFIGURATION','Use the original persistent workspaceId returned by merchant_timescale_open.');
  return{workspace:options.workspace,workspaceId:options.workspaceId};
}
function scopedClient(original,scope){
  if(!original||typeof original.call!=='function'||typeof original.endpoint!=='string'||!original.endpoint)
    throw failure('TIMESCALE_DOWNLOAD_CONFIGURATION','Use one original merchant file client with its endpoint identity.');
  return{endpoint:JSON.stringify([original.endpoint,'timescale',scope.workspace,scope.workspaceId]),
    async call(name,args,options){
      const value=await original.call(name,{...args,...scope},options);
      if(value?.workspace!==scope.workspace||value?.workspaceId!==scope.workspaceId||!value.result||typeof value.result!=='object')
        throw failure('TIMESCALE_DOWNLOAD_WORKSPACE_CHANGED','The original workspace changed while receiving its files.');
      return value.result;
    }};
}
function receiver(scope){
  return createRetainedDownload({
    manifestName:TIMESCALE_DOWNLOAD_MANIFEST,maximumBytes:TIMESCALE_FILE_BYTES,
    maximumManifestBytes:TIMESCALE_MANIFEST_BYTES,maximumCheckpointBytes:2*TIMESCALE_MANIFEST_BYTES,
    nestedFiles:true,stateSchema:'stellar-forge.timescale-download-state.v1',
    resultSchema:'stellar-forge.timescale-download-result.v1',toolPrefix:'merchant_timescale_export',
    errorPrefix:'TIMESCALE',clientName:'starforge-timescale-receiving',validateExportId:timescaleExportId,
    parseManifest(bytes,exportId){
      const value=parseTimescaleDownloadManifest(bytes,exportId);
      if(value.workspace!==scope.workspace||value.workspaceId!==scope.workspaceId)
        throw failure('TIMESCALE_DOWNLOAD_WORKSPACE_CHANGED','The complete manifest belongs to a different original project.');
      return value;
    },
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,nativeManifestSha256:value.nativeManifestSha256,target:value.target})
  });
}
async function nativeOptions(options){
  const scope=selected(options);
  if(options.client!==undefined&&options.url!==undefined)
    throw failure('TIMESCALE_DOWNLOAD_CONFIGURATION','Select the original native client or MCP URL, not both.');
  const original=options.client??await openMerchantFileClient({...options,errorPrefix:'TIMESCALE',clientName:'starforge-timescale-receiving'});
  const{url,workspace,workspaceId,...rest}=options;
  return{scope,options:{...rest,client:scopedClient(original,scope)}};
}
/** Reads the complete immutable download manifest without creating another export. */
export async function inspectTimescaleExport(options={}){
  const selected=await nativeOptions(options);return receiver(selected.scope).inspect(selected.options);
}
/** Reuses the original endpoint, descriptor leases, checkpoint and nested file publication. */
export async function downloadTimescaleExport(options={}){
  const selected=await nativeOptions(options);return receiver(selected.scope).download(selected.options);
}
