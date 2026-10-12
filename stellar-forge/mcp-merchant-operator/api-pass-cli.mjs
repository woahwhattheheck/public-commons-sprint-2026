#!/usr/bin/env node
// MIT. Retain exact original API-pass operations and reopen complete downloaded files.
import {mkdir,lstat,open,rename,unlink,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate} from './host-files.mjs';
import {apiPassPrivateDirectory,readApiPassPrivateFile,apiPassHostPath} from './api-pass-connection.mjs';
import {apiPassOperationId} from './api-pass-operations.mjs';
import {connectApiPassWorkspaceClient,downloadApiPassExport,reopenApiPassExportDownload,inspectApiPassExportDownload} from './api-pass-client.mjs';
import {API_PASS_ALIAS,API_PASS_UUID,API_PASS_SHA,API_PASS_PREFIX,apiPassChecked,apiPassArguments,apiPassNeed,apiPassPlain,apiPassExact,apiPassFingerprint,apiPassFailure} from './api-pass-protocol.mjs';
const REQUEST='stellar-forge.sf101.api-pass-client-operation.v1',STATE='stellar-forge.sf101.api-pass-client-operation-state.v1',RESULT='stellar-forge.sf101.api-pass-client-result.v1';
const WRITES=new Set(['connect','purchase_prepare','purchase_attach','update','prepare_request','adopt_request','enqueue','cancel','decide','capture']);
const now=()=>new Date().toISOString();
const issue=error=>({code:/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'API_PASS_CLIENT_FAILED',outcomeUnknown:error?.outcomeUnknown!==false});
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function readJson(path,maximum=4*1024*1024){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readApiPassPrivateFile(path,maximum)));}
async function sync(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function atomic(directory,name,value){
 const temporary=join(directory,'.'+name+'.next');await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 await writePrivate(temporary,value);await rename(temporary,join(directory,name));await sync(directory);
}
function endpoint(value){
 let url;try{url=new URL(value);}catch{}
 apiPassNeed(url&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)),'Use the original HTTPS or loopback merchant MCP endpoint.','API_PASS_CLIENT_CONNECTION');return url.href;
}
function validate(request){
 apiPassExact(request,['schema','preparedAt','url','workspace','workspaceId','tokenEnv','kind','arguments','requestSha256'],['schema','preparedAt','url','workspace','workspaceId','tokenEnv','kind','arguments','requestSha256']);
 const {requestSha256,...content}=request;
 apiPassNeed(request.schema===REQUEST&&WRITES.has(request.kind)&&Number.isFinite(Date.parse(request.preparedAt))&&apiPassFingerprint(content)===requestSha256&&endpoint(request.url)===request.url,'The retained original client operation changed.','API_PASS_CLIENT_OPERATION_CHANGED');
 apiPassChecked(request.workspace,API_PASS_ALIAS,'workspace alias');apiPassChecked(request.workspaceId,API_PASS_UUID,'original workspace ID');apiPassChecked(request.tokenEnv,/^[A-Za-z_][A-Za-z0-9_]*$/,'token environment name');
 const normalized=apiPassArguments(request.kind,{...request.arguments,workspace:request.workspace});delete normalized.workspace;
 apiPassNeed(apiPassFingerprint(normalized)===apiPassFingerprint(request.arguments),'The retained original arguments changed.','API_PASS_CLIENT_OPERATION_CHANGED');return request;
}
async function locked(directory,work,{create=false}={}){
 directory=apiPassHostPath(directory);
 if(create){await apiPassPrivateDirectory(dirname(directory));try{await mkdir(directory,{mode:0o700});await sync(dirname(directory));}catch(error){if(error.code!=='EEXIST')throw error;}}
 await apiPassPrivateDirectory(directory);let lease;
 try{lease=await acquireStateLease(directory);}catch{throw apiPassFailure('API_PASS_CLIENT_OPERATION_BUSY','Another client owns this exact operation directory.');}
 try{return await work({directory,lease});}finally{await lease.close();}
}
/** Preparation chooses an ID once; every execution/reconciliation reopens its bytes. */
export async function prepareApiPassOperation({directory,url,workspace,workspaceId,tokenEnv='MCP_ACCESS_TOKEN',kind,arguments:input={},operationId}={}){
 apiPassNeed(WRITES.has(kind),'Choose an original write or capture operation.');
 apiPassNeed(apiPassPlain(input)&&!Object.hasOwn(input,'workspace'),'Pass only the operation’s native wire arguments.');
 const args={...input};
 if(kind!=='decide'&&kind!=='capture'){
  if(operationId!==undefined)apiPassNeed(args.operationId===undefined||args.operationId===operationId,'The chosen stable operation ID differs from its arguments.');
  args.operationId??=operationId??randomUUID();
 }else apiPassNeed(operationId===undefined,'Approval and capture already have their native selected identity.');
 const normalized=apiPassArguments(kind,{...args,workspace});delete normalized.workspace;
 const content={schema:REQUEST,preparedAt:now(),url:endpoint(url),workspace,workspaceId,tokenEnv,kind,arguments:normalized},request=validate({...content,requestSha256:apiPassFingerprint(content)});
 return locked(directory,async({directory,lease})=>{
  const path=join(directory,'request.json');
  if(await exists(path)){
   const old=validate(await readJson(path));
   const selected=value=>({...value,preparedAt:undefined,requestSha256:undefined});
   const candidate=kind!=='decide'&&kind!=='capture'&&input.operationId===undefined&&operationId===undefined
    ?{...request,arguments:{...request.arguments,operationId:old.arguments.operationId}}:request;
   apiPassNeed(apiPassFingerprint(selected(old))===apiPassFingerprint(selected(candidate)),'This client operation directory belongs to another exact request. Reopen its saved preparation.','API_PASS_CLIENT_OPERATION_ID_REUSED');
   return {directory,phase:'PREPARED',request:old};
  }
  const allowed=new Set(['lease.lock','.request.json.next']);apiPassNeed((await readdir(directory)).every(name=>allowed.has(name)),'Choose this operation’s own directory or a new private directory.','API_PASS_CLIENT_DIRECTORY_IN_USE');
  lease.assertHeld();await atomic(directory,'request.json',request);
  return {directory,phase:'PREPARED',request};
 },{create:true});
}
async function clientState(directory,request){
 if(!await exists(join(directory,'state.json')))return {schema:STATE,requestSha256:request.requestSha256,phase:'PREPARED',attempts:0,updatedAt:request.preparedAt,error:null};
 const state=await readJson(join(directory,'state.json'));
 apiPassNeed(state.schema===STATE&&state.requestSha256===request.requestSha256&&Number.isSafeInteger(state.attempts)&&state.attempts>=0,'The local original operation state changed.','API_PASS_CLIENT_OPERATION_CHANGED');return state;
}
async function retainedResult(directory,request){
 if(!await exists(join(directory,'result.json')))return null;
 const result=await readJson(join(directory,'result.json')),copy={...result};delete copy.sha256;
 apiPassNeed(result.schema===RESULT&&result.requestSha256===request.requestSha256&&apiPassFingerprint(copy)===result.sha256&&apiPassPlain(result.native),'The complete saved client result changed.','API_PASS_CLIENT_RESULT_CHANGED');return result;
}
async function lookup(client,request,options){
 if(request.kind==='capture'){
  let result;try{result=await client.manifest({exportId:request.arguments.exportId},options);}catch(error){if(error.code==='ENOENT')return {found:false};throw error;}
  apiPassNeed(apiPassFingerprint(result.selection)===apiPassFingerprint(request.arguments.selection)&&(!request.arguments.expectedSha256||result.file.sha256===request.arguments.expectedSha256),'This retained export ID belongs to another original file selection.','API_PASS_CLIENT_OPERATION_ID_REUSED');
  return {found:true,native:result};
 }
 const id=apiPassOperationId(request.kind,{...request.arguments,workspace:request.workspace}),value=await client.operation({operationId:id},options);
 if(!value.found)return {found:false};
 apiPassNeed(value.kind===request.kind&&apiPassFingerprint(value.originalArguments)===apiPassFingerprint({...request.arguments,workspace:request.workspace}),'The host-retained operation belongs to another exact request.','API_PASS_CLIENT_OPERATION_ID_REUSED');
 if(value.phase!=='COMPLETE')return {found:false,observation:value};
 return {found:true,native:{...value.result,operation:{id,requestSha256:value.requestSha256,phase:'COMPLETE',replayed:true}}};
}
/** Reconcile exact host receipt first; execute at most one original HTTP dispatch. */
export async function runApiPassOperation({directory,execute=false,client:providedClient,environment=process.env,signal}={}){
 apiPassNeed(typeof execute==='boolean','Choose execute or read-only reconciliation.');
 return locked(directory,async({directory,lease})=>{
  const request=validate(await readJson(join(directory,'request.json'))),state=await clientState(directory,request),existing=await retainedResult(directory,request);
  if(existing)return {directory,phase:'REOPENED',found:true,requestSha256:request.requestSha256,native:existing.native};
  apiPassNeed(state.phase!=='RETURNED','The completed client operation lost its retained result. Reopen its original host receipt.','API_PASS_CLIENT_RESULT_MISSING');
  const client=providedClient??await connectApiPassWorkspaceClient({url:request.url,workspace:request.workspace,workspaceId:request.workspaceId,tokenEnv:request.tokenEnv,environment,signal});
  let current={...state},primaryError;
  async function checkpoint(changes){current={...current,...changes,updatedAt:now()};lease.assertHeld();await atomic(directory,'state.json',current);}
  async function complete(native){
   const content={schema:RESULT,requestSha256:request.requestSha256,receivedAt:now(),native},record={...content,sha256:apiPassFingerprint(content)};
   lease.assertHeld();await atomic(directory,'result.json',record);await checkpoint({phase:'RETURNED',error:null});
   return {directory,phase:'RETURNED',found:true,requestSha256:request.requestSha256,native};
  }
  try{
   apiPassNeed(client.workspace===request.workspace&&(!client.workspaceId||client.workspaceId===request.workspaceId)&&(!client.endpoint||client.endpoint===request.url),'Use this operation’s original endpoint and workspace identity.','API_PASS_CLIENT_CONNECTION_CHANGED');
   signal?.throwIfAborted();let observed=await lookup(client,request,{requestSignal:signal});
   apiPassNeed(client.workspaceId===request.workspaceId,'The host reply belongs to another original workspace.','API_PASS_CLIENT_CONNECTION_CHANGED');
   if(observed.found)return await complete(observed.native);
   if(!execute){await checkpoint({phase:'NOT_OBSERVED',observation:observed.observation??null});return {directory,phase:'NOT_OBSERVED',found:false,requestSha256:request.requestSha256,observation:observed.observation??null};}
   apiPassNeed(current.attempts<1000,'This local operation has reached its retained dispatch limit.','API_PASS_CLIENT_ATTEMPT_LIMIT');
   await checkpoint({phase:'SENDING',attempts:current.attempts+1,error:null});let native;
   try{native=await client.invoke(request.kind,request.arguments,{requestSignal:signal});}
   catch(error){
    await checkpoint({phase:'ATTENTION',error:issue(error)});
    try{observed=await lookup(client,request,{requestSignal:null,timeoutMs:15000});}catch(readError){await checkpoint({lookupError:issue(readError)});throw error;}
    if(!observed.found)throw error;native=observed.native;
   }
   return await complete(native);
  }catch(error){primaryError=error;throw error;}
  finally{if(!providedClient)try{await client.disconnect();}catch(error){if(!primaryError)throw error;}}
 });
}
export async function reopenApiPassOperation({directory}={}){
 return locked(directory,async({directory})=>{
  const request=validate(await readJson(join(directory,'request.json'))),state=await clientState(directory,request),result=await retainedResult(directory,request);
  return {directory,request,phase:result?'REOPENED':state.phase,found:Boolean(result),state,native:result?.native??null};
 });
}
const HELP=`API-pass customer workspace over the original merchant MCP

  init-host --directory PRIVATE_MERCHANT --connection PRIVATE_CONNECTION_JSON
      [--name NAME] [--release-store EXISTING_ORIGINAL_STORE]
  read --url MCP_URL --workspace ALIAS --workspace-id UUID --kind OPERATION
      [--request PRIVATE_ARGUMENTS_JSON] [--token-env NAME]
  prepare --directory PRIVATE_OPERATION --url MCP_URL --workspace ALIAS
      --workspace-id UUID --kind OPERATION --request PRIVATE_ARGUMENTS_JSON
      [--operation-id STABLE_ID] [--token-env NAME]
  run|reconcile|reopen --directory PRIVATE_OPERATION
  inspect-export --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id ID
      [--token-env NAME]
  download --url MCP_URL --workspace ALIAS --workspace-id UUID --export-id ID
      --directory PRIVATE_RECEIVING [--manifest-sha256 SHA] [--token-env NAME]
  reopen-download --directory PRIVATE_RECEIVING [--manifest-sha256 SHA]
      [--workspace ALIAS] [--workspace-id UUID]

Read operations: open, status, passes, pass, call, call_preview, body_preview,
remote_calls, history, task, approval, input, operation, exports, manifest.
Use exact documented tool argument names in the private JSON, without workspace.
Writes: connect, purchase_prepare, purchase_attach, update, prepare_request,
adopt_request, enqueue, cancel, decide, capture. Preparation saves the exact
arguments and generates a missing native operation ID once. run reconciles
its original host journal first and sends at most one exact selected action.
reconcile is read-only. Repeating run/reopen keeps the saved original result.
A queued native task is observed through task/history; its HTTP receipt is
separate from task completion. Keep exact original review and request IDs.
Download uses the original manifest/chunk transport and a private receiving
lease. Completed files are rehashed on reopening. Tokens remain in their named
process environment. Exit 0: returned/read/prepared; 3: not yet observed; 2: error.
`;
function opts(args,allowed){const out={};for(let i=0;i<args.length;i+=2){apiPassNeed(allowed.includes(args[i])&&!Object.hasOwn(out,args[i])&&args[i+1]!==undefined,'Use the documented option/value pairs without duplicates.');out[args[i]]=args[i+1];}return out;}
function required(values,key){apiPassNeed(typeof values[key]==='string'&&values[key].length>0,'Supply '+key+'.');return values[key];}
export async function main(args=process.argv.slice(2)){
 if(args.length===0||args.length===1&&['--help','help','-h'].includes(args[0])){process.stdout.write(HELP);return;}
 const [command,...tail]=args,connectionFlags=['--url','--workspace','--workspace-id','--token-env'];let result;
 if(command==='init-host'){
  const values=opts(tail,['--directory','--connection','--name','--release-store']),{initializeApiPassWorkspaceMerchant}=await import('./api-pass-setup.mjs');
  result=await initializeApiPassWorkspaceMerchant({directory:required(values,'--directory'),connection:required(values,'--connection'),name:values['--name'],releaseStore:values['--release-store']});
 }else if(command==='prepare'){
  const values=opts(tail,['--directory',...connectionFlags,'--kind','--request','--operation-id']);
  result=await prepareApiPassOperation({directory:required(values,'--directory'),url:required(values,'--url'),workspace:required(values,'--workspace'),workspaceId:required(values,'--workspace-id'),tokenEnv:values['--token-env']??'MCP_ACCESS_TOKEN',
   kind:required(values,'--kind'),arguments:await readJson(resolve(required(values,'--request'))),operationId:values['--operation-id']});
 }else if(['run','reconcile','reopen'].includes(command)){
  const values=opts(tail,['--directory']),directory=required(values,'--directory');
  result=command==='reopen'?await reopenApiPassOperation({directory}):await runApiPassOperation({directory,execute:command==='run'});
 }else if(command==='reopen-download'){
  const values=opts(tail,['--directory','--manifest-sha256','--workspace','--workspace-id']);
  result=await reopenApiPassExportDownload({directory:required(values,'--directory'),expectedManifestSha256:values['--manifest-sha256'],workspace:values['--workspace'],workspaceId:values['--workspace-id']});
 }else{
  apiPassNeed(['read','inspect-export','download'].includes(command),'Choose a documented API-pass command.');
  const values=opts(tail,[...connectionFlags,...(command==='read'?['--kind','--request']:['--export-id','--directory','--manifest-sha256'])]);
  const selected={url:required(values,'--url'),workspace:required(values,'--workspace'),workspaceId:required(values,'--workspace-id'),tokenEnv:values['--token-env']??'MCP_ACCESS_TOKEN'};
  if(command==='download')result=await downloadApiPassExport({...selected,exportId:required(values,'--export-id'),directory:required(values,'--directory'),expectedManifestSha256:values['--manifest-sha256']});
  else if(command==='inspect-export')result=await inspectApiPassExportDownload({...selected,exportId:required(values,'--export-id')});
  else{
   const kind=required(values,'--kind');apiPassNeed(!WRITES.has(kind)&&!['file','file_release','workspaces'].includes(kind),'Use preparation for writes and the complete download commands for files.');
   const client=await connectApiPassWorkspaceClient(selected);
   try{result=await client.invoke(kind,values['--request']?await readJson(resolve(values['--request'])):{});}finally{await client.disconnect();}
  }
 }
 process.stdout.write(JSON.stringify(result)+'\n');if(result?.found===false)process.exitCode=3;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
 process.stderr.write(JSON.stringify({error:issue(error)})+'\n');process.exitCode=2;
});
