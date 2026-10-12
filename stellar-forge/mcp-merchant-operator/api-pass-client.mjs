// MIT. Reusable typed control and complete-file receiving over one original merchant MCP.
import {join} from 'node:path';
import {openMerchantFileClient,createRetainedDownload} from './retained-download.mjs';
import {API_PASS_PREFIX,API_PASS_ALIAS,API_PASS_UUID,API_PASS_SHA,API_PASS_EXPORT_MANIFEST,API_PASS_MAX_FILE_BYTES,
 apiPassPlain,apiPassNeed,apiPassChecked,apiPassArguments,apiPassHash,parseApiPassExport} from './api-pass-protocol.mjs';
const METHODS={open:'open',status:'status',passes:'passes',pass:'pass',callDetail:'call',callPreview:'call_preview',bodyPreview:'body_preview',
 remoteCalls:'remote_calls',history:'history',task:'task',approval:'approval',input:'input',operation:'operation',
 connectPass:'connect',preparePurchase:'purchase_prepare',attachPurchase:'purchase_attach',updatePass:'update',prepareRequest:'prepare_request',
 adoptRequest:'adopt_request',enqueue:'enqueue',cancel:'cancel',decide:'decide',capture:'capture',exports:'exports',manifest:'manifest',readFileChunk:'file',releaseFile:'file_release'};
function nativeReply(result,workspace,selectedId){
 apiPassNeed(apiPassPlain(result)&&result.workspace===workspace&&API_PASS_UUID.test(result.workspaceId??'')&&apiPassPlain(result.native),'The MCP reply is not bound to this original workspace.','API_PASS_CLIENT_REPLY_INVALID');
 if(selectedId!==undefined)apiPassNeed(result.workspaceId===selectedId,'This connection now names a different original workspace.','API_PASS_CLIENT_WORKSPACE_CHANGED');
 return result;
}
function fileTransport({workspace,workspaceId,connect}={}){
 if(workspace!==undefined)apiPassChecked(workspace,API_PASS_ALIAS,'workspace alias');
 if(workspaceId!==undefined)apiPassChecked(workspaceId,API_PASS_UUID,'original workspace ID');
 const parser=(bytes,id)=>{
  const value=parseApiPassExport(bytes,id);
  if(workspace!==undefined)apiPassNeed(value.workspace.alias===workspace,'The complete manifest belongs to another workspace alias.','API_PASS_DOWNLOAD_BINDING');
  if(workspaceId!==undefined)apiPassNeed(value.workspace.id===workspaceId,'The complete manifest belongs to another original workspace.','API_PASS_DOWNLOAD_BINDING');
  return value;
 };
 return createRetainedDownload({manifestName:API_PASS_EXPORT_MANIFEST,parseManifest:parser,maximumBytes:API_PASS_MAX_FILE_BYTES,
  stateSchema:'stellar-forge.sf101.api-pass-mcp-download-state.v1',resultSchema:'stellar-forge.sf101.api-pass-mcp-download.v1',
  toolPrefix:API_PASS_PREFIX.slice(0,-1),errorPrefix:'API_PASS',clientName:'starforge-api-pass-receiving',
  describe:manifest=>({workspace:manifest.workspace,selection:manifest.selection,source:manifest.source}),
  connect:connect??(async options=>{
   const transport=await openMerchantFileClient(options);let selectedId=workspaceId;
   return {get endpoint(){apiPassChecked(selectedId,API_PASS_UUID,'original workspace ID');return transport.endpoint+'#api-pass-workspace='+encodeURIComponent(workspace)+'&workspace-id='+selectedId;},
    async call(name,args,request){
     const result=nativeReply(await transport.call(name,{...args,workspace},request),workspace,selectedId);selectedId??=result.workspaceId;return result.native;
    }};
  })});
}
/** Public caller lifetime owns its requests, never the running customer workspace. */
export function createApiPassWorkspaceClient({workspace,workspaceId,call,endpoint}={}){
 apiPassChecked(workspace,API_PASS_ALIAS,'workspace alias');if(workspaceId!==undefined)apiPassChecked(workspaceId,API_PASS_UUID,'original workspace ID');
 apiPassNeed(typeof call==='function','Supply the existing structured MCP call.','API_PASS_CLIENT_CONFIGURATION');
 let selectedId=workspaceId,closing=false,closePromise;const pending=new Set();
 async function wire(kind,input={},options){
  apiPassNeed(apiPassPlain(input)&&!Object.hasOwn(input,'workspace'),'Use this caller’s selected workspace alias.');
  const args=apiPassArguments(kind,{...input,workspace}),name=kind.startsWith(API_PASS_PREFIX)?kind:API_PASS_PREFIX+kind;
  const result=nativeReply(await call(name,args,options),workspace,selectedId);selectedId??=result.workspaceId;return result.native;
 }
 function tracked(work){
  apiPassNeed(!closing,'This caller is draining or closed.','API_PASS_CLIENT_CLOSING');
  const promise=Promise.resolve().then(work);pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;
 }
 const client={workspace,get workspaceId(){return selectedId;},endpoint,
  invoke:(kind,args={},options)=>tracked(()=>wire(kind,args,options)),
  allPasses:(options={})=>tracked(async()=>{
   const items=[];let offset=0,observed;
   for(;;){
    const result=await wire('passes',{offset,limit:200,...(observed===undefined?{}:{expectedRevision:observed})},options);
    observed??=result.revision;
    apiPassNeed(Array.isArray(result.items)&&result.offset===offset&&result.revision===observed&&Number.isSafeInteger(result.total)&&result.total<=200,'The native pass page changed.','API_PASS_CLIENT_PAGE_CHANGED');
    items.push(...result.items);
    if(result.nextOffset===null){apiPassNeed(items.length===result.total,'The original pass inventory ended early.','API_PASS_CLIENT_PAGE_CHANGED');return {revision:observed,items};}
    apiPassNeed(result.nextOffset===offset+result.items.length&&result.nextOffset>offset&&result.nextOffset<result.total,'The original pass page did not advance.','API_PASS_CLIENT_PAGE_CHANGED');offset=result.nextOffset;
   }
  }),
  allHistory:({profileId,view},options={})=>tracked(async()=>{
   const items=[];let offset=0,observed,total;
   for(;;){
    const result=await wire('history',{profileId,view,offset,limit:200,...(observed===undefined?{}:{expectedRevision:observed})},options);
    observed??=result.revision;total??=result.total;
    apiPassNeed(Array.isArray(result.items)&&result.profileId===profileId&&result.view===view&&result.revision===observed&&result.offset===offset&&result.total===total&&Number.isSafeInteger(total)&&total>=0&&total<=(view==='calls'?5000:10000),'The complete native history page changed.','API_PASS_CLIENT_PAGE_CHANGED');
    items.push(...result.items);
    if(result.nextOffset===null){apiPassNeed(items.length===total,'The complete history ended early.','API_PASS_CLIENT_PAGE_CHANGED');return {profileId,view,revision:observed,items};}
    apiPassNeed(result.nextOffset===offset+result.items.length&&result.nextOffset>offset&&result.nextOffset<total,'The history page did not advance.','API_PASS_CLIENT_PAGE_CHANGED');offset=result.nextOffset;
   }
  }),
  downloadExport:options=>tracked(async()=>{
   apiPassNeed(typeof endpoint==='string'&&endpoint.length>0,'Retain this MCP connection’s stable endpoint identity before downloading.','API_PASS_CLIENT_ENDPOINT_REQUIRED');
   const transfer=fileTransport({workspace,workspaceId:selectedId,connect:async options=>({get endpoint(){apiPassChecked(selectedId,API_PASS_UUID,'original workspace ID');return endpoint+'#api-pass-workspace='+encodeURIComponent(workspace)+'&workspace-id='+selectedId;},
    call:(name,args,request)=>wire(name,args,{requestSignal:options.signal,...request})})});
   return transfer.download(options);
  }),
  disconnect(){if(!closePromise){closing=true;closePromise=(async()=>{await Promise.allSettled([...pending]);})();}return closePromise;}
 };
 for(const [method,kind]of Object.entries(METHODS))client[method]=(args={},options)=>tracked(()=>wire(kind,args,options));
 return Object.freeze(client);
}
export async function connectApiPassWorkspaceClient({workspace,workspaceId,...options}={}){
 const transport=await openMerchantFileClient({...options,errorPrefix:'API_PASS',clientName:'starforge-api-pass-workspace'});
 return createApiPassWorkspaceClient({workspace,workspaceId,call:transport.call,endpoint:transport.endpoint});
}
export async function downloadApiPassExport({workspace,workspaceId,...options}={}){apiPassChecked(workspace,API_PASS_ALIAS,'workspace alias');return fileTransport({workspace,workspaceId}).download(options);}
export async function inspectApiPassExportDownload({workspace,workspaceId,...options}={}){apiPassChecked(workspace,API_PASS_ALIAS,'workspace alias');return fileTransport({workspace,workspaceId}).inspect(options);}
export async function reopenApiPassExportDownload({directory,expectedManifestSha256,workspace,workspaceId}={}){
 const transfer=fileTransport({workspace,workspaceId});
 return transfer.lockedDownload(directory,async context=>{
  const bytes=await transfer.bytesAt(join(context.root,API_PASS_EXPORT_MANIFEST),65000),manifest=parseApiPassExport(bytes);
  if(workspace!==undefined)apiPassNeed(manifest.workspace.alias===workspace,'The original receiving workspace alias differs.','API_PASS_DOWNLOAD_BINDING');
  if(workspaceId!==undefined)apiPassNeed(manifest.workspace.id===workspaceId,'The original receiving workspace ID differs.','API_PASS_DOWNLOAD_BINDING');
  if(expectedManifestSha256!==undefined)apiPassNeed(apiPassHash(bytes)===apiPassChecked(expectedManifestSha256,API_PASS_SHA,'original manifest SHA'),'The saved receiving manifest differs from its reviewed SHA.','API_PASS_DOWNLOAD_CHANGED');
  await transfer.loadContext(context,bytes,manifest.exportId);
  for(const file of manifest.files)await transfer.verifiedFile(join(context.root,file.name),file);
  return {schema:'stellar-forge.sf101.api-pass-mcp-download.v1',state:'REOPENED',directory:context.root,exportId:manifest.exportId,workspace:manifest.workspace,
   selection:manifest.selection,source:manifest.source,manifestSha256:apiPassHash(bytes),files:manifest.files.length,bytes:manifest.files.reduce((n,file)=>n+file.bytes,0)};
 });
}
