// MIT. Complete local and connected clients using the original retained downloader.
import {resolve,join} from 'node:path';
import {openMerchantFileClient,createRetainedDownload} from '../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {MerchantWebhookFeeds} from './provider.mjs';
import {readWebhookFeedConfiguration} from './connection.mjs';
import {restoreWebhookSnapshot} from './receiving.mjs';
import {webhookFeedDefinitions,validateWebhookArguments} from './catalog.mjs';
import {PREFIX,MANIFEST_NAME,MAX_FILE_BYTES,parseSnapshotManifest,need,id,digest} from './contracts.mjs';
export {webhookFeedDefinitions} from './catalog.mjs';
const transfers=createRetainedDownload({manifestName:MANIFEST_NAME,parseManifest:parseSnapshotManifest,maximumBytes:MAX_FILE_BYTES,stateSchema:'stellar-forge.webhook-feed-download-state.v1',resultSchema:'stellar-forge.webhook-feed-download-receipt.v1',toolPrefix:PREFIX.slice(0,-1),errorPrefix:'WEBHOOK_OPERATIONS',clientName:'starforge-webhook-feed-client',maximumManifestBytes:65536,maximumCheckpointBytes:65536,validateExportId:value=>id(value,'snapshot name'),describe:manifest=>({storeId:manifest.storeId,originalManifestSha256:manifest.originalManifestSha256,highWatermark:manifest.highWatermark})});
function scoped(client,workspace,signal){
 id(workspace,'workspace alias');need(client&&typeof client.endpoint==='string'&&typeof client.call==='function','WEBHOOK_OPERATIONS_CLIENT_REQUIRED');
 return {endpoint:client.endpoint+'#webhook-feed='+workspace,call(name,args={},options){need(args.workspace===undefined||args.workspace===workspace,'WEBHOOK_OPERATIONS_WORKSPACE_CHANGED');return client.call(name,{...args,workspace},options?.requestSignal!==undefined||options?.signal!==undefined?options:{...options,signal});}};
}
export async function downloadWebhookSnapshot({client,workspace,exportId,directory,expectedManifestSha256,signal,onProgress,chunkSize}={}){
 return transfers.download({client:scoped(client,workspace,signal),exportId:id(exportId,'snapshot name'),directory:resolve(directory),expectedManifestSha256,signal,onProgress,...(chunkSize===undefined?{}:{chunkSize})});
}
export async function inspectWebhookSnapshot({client,workspace,exportId,signal}={}){
 return transfers.inspect({client:scoped(client,workspace,signal),exportId:id(exportId,'snapshot name'),signal});
}
export async function reopenWebhookSnapshot({directory,exportId,expectedManifestSha256,signal}={}){
 return transfers.lockedDownload(resolve(directory),async context=>{
  const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),65536),manifest=parseSnapshotManifest(bytes,id(exportId,'snapshot name')),sha256=digest(bytes);
  need(expectedManifestSha256===undefined||expectedManifestSha256===sha256,'WEBHOOK_OPERATIONS_MANIFEST_CHANGED');
  await transfers.loadContext(context,bytes,exportId);
  for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file,signal);
  return {state:'REOPENED',directory:context.root,exportId,storeId:manifest.storeId,manifestSha256:sha256,files:manifest.files.length,bytes:manifest.bytes};
 });
}
function clientApi(original,close){
 const call=(name,args={},options)=>{const action=validateWebhookArguments(name,args);return original.call(PREFIX+action,args,options?.requestSignal!==undefined&&options?.signal===undefined?{...options,signal:options.requestSignal}:options);};
 const core={endpoint:original.endpoint,call},named=Object.fromEntries(webhookFeedDefinitions.map(item=>[item.action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},options)=>call(item.action,args,options)]));
 return Object.freeze({...core,...named,close:close??(async()=>{}),
  downloadSnapshot:options=>downloadWebhookSnapshot({...options,client:core}),
  inspectSnapshot:options=>inspectWebhookSnapshot({...options,client:core}),
  reopenSnapshot:reopenWebhookSnapshot,
  restoreDownloaded:restoreWebhookSnapshot});
}
export async function openWebhookFeedClient({connection}={}){
 need(typeof connection==='string'&&connection.length>0,'WEBHOOK_OPERATIONS_CONNECTION_REQUIRED');
 const file=resolve(connection),configuration=await readWebhookFeedConfiguration(file),provider=new MerchantWebhookFeeds({webhookFeeds:configuration});
 return clientApi({endpoint:'webhook-operations:'+file,call:(name,args,options)=>provider.call(name,args,options)},()=>provider.close());
}
export async function openWebhookFeedMerchantClient(options={}){
 const native=await openMerchantFileClient({...options,errorPrefix:'WEBHOOK_OPERATIONS',clientName:'starforge-webhook-feed-client',maximumResponseBytes:16*1024*1024});
 return clientApi({endpoint:native.endpoint,call:(name,args,options={})=>native.call(name,args,{...options,...(Object.hasOwn(options,'signal')?{requestSignal:options.signal}:{})})});
}
