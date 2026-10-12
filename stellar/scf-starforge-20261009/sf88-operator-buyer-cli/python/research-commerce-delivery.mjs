// MIT. Scientific Python operates the original Research commerce and archive engines.
import {resolve,join,isAbsolute} from 'node:path';
import {CONTROL_LIMIT,copy,same,fingerprint,fields,need} from '../research-dossiers/customer-commerce/contracts.mjs';
import {exists,readCustomerJson,retainCustomerBytes,withCustomerOperation}
 from '../research-dossiers/customer-commerce/files.mjs';
import {submitResearchCommerce,replayResearchCommerce,readResearchCommerceOperation,retainResearchCommerceFile}
 from '../research-dossiers/customer-commerce/operator.mjs';
import {inspectResearchPaidArchive,receiveResearchPaidArchive} from '../research-dossiers/customer-commerce/archive.mjs';

const MODE='RESEARCH_WORKSPACE_BRIDGE';
const RESPONSE='sf88-research-commerce-python-response/v1';
const FILE='sf88-research-commerce-python-file/v1';
export const RESEARCH_COMMERCE_PYTHON_RESPONSE_LIMIT=66*1024*1024+65536;
const writes=Object.freeze({
 'commerce-publication-prepare':'publication-prepare',
 'commerce-publication-enroll':'publication-enroll',
 'commerce-purchase-receive':'purchase-receive',
 'commerce-purchase-prepare':'purchase-prepare',
 'commerce-execute':'purchase-execute',
 'commerce-retrieve':'purchase-retrieve',
 'commerce-recover':'purchase-recover',
 'commerce-finalize':'purchase-finalize',
 'commerce-cancel':'purchase-cancel',
 'commerce-reconcile':'purchase-reconcile',
 'commerce-receive-dossier':'purchase-receive-dossier',
});
const allowed=Object.freeze({
 'commerce-configuration':[],
 'commerce-list':['kind','options'],
 'commerce-publication':['id'],
 'commerce-purchase':['id','options'],
 'commerce-file':['kind','id','part'],
 ...Object.fromEntries(Object.keys(writes).map(action=>[action,['directory','input']])),
 'commerce-export':['directory','kind','id','part','expectedSha256'],
 'commerce-operation':['directory'],
 'commerce-replay':['directory','sourceDirectory','original'],
 'commerce-archive-inspect':['path','expectedSha256','expectedBytes'],
 'commerce-archive-receive':['directory','path','expectedSha256','expectedBytes','manifestSha256'],
});
const local=new Set(['commerce-operation','commerce-archive-inspect','commerce-archive-receive']);
const mutable=new Set([...Object.keys(writes),'commerce-export','commerce-replay','commerce-archive-receive']);
export const isResearchCommerceCall=action=>Object.hasOwn(allowed,action);
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,120}$/.test(value)?value:'RESEARCH_COMMERCE_PYTHON_CALL_FAILED';
function stopped(signal){
 if(signal?.aborted)throw Object.assign(new Error('RESEARCH_COMMERCE_PYTHON_CANCELLED'),
  {code:'RESEARCH_COMMERCE_PYTHON_CANCELLED'});
}
function errorRecord(error){
 const result={error:safeCode(error?.code)};
 for(const key of ['status','outcomeUnknown','method','route','recovery','requestId','operationId',
  'destinationPublished','file','sourceCleanupFailed','clientWarnings','researchCommerce','closeError'])
  if(error?.[key]!==undefined)result[key]=error[key];
 return result;
}
function encoded(value){
 const bytes=Buffer.from(JSON.stringify(value)+'\n');
 need(bytes.length<=RESEARCH_COMMERCE_PYTHON_RESPONSE_LIMIT,'RESEARCH_COMMERCE_PYTHON_RESPONSE_TOO_LARGE');
 return bytes;
}
function descriptor(file,body){
 return {schema:FILE,callSha256:body.callSha256,workspaceId:body.workspaceId,
  file:{file:file.path,bytes:file.bytes,sha256:file.sha256,contentType:'application/json; charset=utf-8'}};
}
function lazyOriginal(openClient,signal){
 let original=null,opening=null,workspaceId=null;
 const get=()=>{
  stopped(signal);
  if(!opening){
   need(typeof openClient==='function','RESEARCH_COMMERCE_ORIGINAL_CLIENT_REQUIRED');
   original=openClient();
   need(original&&typeof original.status==='function'&&typeof original.customerCommerce==='function',
    'RESEARCH_COMMERCE_ORIGINAL_CLIENT_REQUIRED');
   opening=original.status({signal}).then(status=>{workspaceId=status.workspaceId;return original;});
  }
  return opening;
 };
 return {get,get workspaceId(){return workspaceId;},
  async close(){if(original)await original.close();}};
}
async function execute(action,input,original,signal,{completed=false}={}){
 if(Object.hasOwn(writes,action))
  return submitResearchCommerce({client:completed?null:original.get,directory:input.directory,
   command:writes[action],input:input.input});
 switch(action){
  case 'commerce-export':
   return retainResearchCommerceFile({client:completed?null:original.get,...input});
  case 'commerce-replay':{
   if(completed)return submitResearchCommerce({client:null,directory:input.directory});
   const selected=input.original;
   fields(selected,['action','input','workspaceId']);
   need(Object.hasOwn(writes,selected.action)&&/^research_[a-f0-9]{64}$/.test(selected.workspaceId??'')&&
    typeof input.sourceDirectory==='string'&&isAbsolute(input.sourceDirectory),
    'RESEARCH_COMMERCE_REPLAY_SOURCE_REQUIRED');
   if(await exists(join(input.sourceDirectory,'request.json'))){
    const source=await readResearchCommerceOperation(input.sourceDirectory),saved=source.files['request.json'];
    need(saved.workspaceId===selected.workspaceId&&saved.selection.command===writes[selected.action]&&
     same(saved.selection.input,selected.input),'RESEARCH_COMMERCE_REPLAY_SOURCE_CHANGED');
    return replayResearchCommerce({client:original.get,directory:input.directory,
     sourceDirectory:input.sourceDirectory});
   }
   // A Python call can stop before its original native operator writes request.json.
   // Its complete retained input still identifies the same native UUID. Submit
   // that exact input into this separate replay attempt after binding its owner.
   await original.get();
   need(original.workspaceId===selected.workspaceId,'RESEARCH_COMMERCE_REPLAY_SOURCE_CHANGED');
   return submitResearchCommerce({client:original.get,directory:input.directory,
    command:writes[selected.action],input:selected.input});
  }
  case 'commerce-operation':
   return readResearchCommerceOperation(input.directory);
  case 'commerce-archive-inspect':
   return inspectResearchPaidArchive({...input,signal});
  case 'commerce-archive-receive':{
   const {path,...selected}=input;
   return receiveResearchPaidArchive({...selected,...(!completed&&path?{path}:{}),signal});
  }
  default:{
   const client=await original.get(),commerce=client.customerCommerce(),options={signal};
   switch(action){
    case 'commerce-configuration':return commerce.configuration(options);
    case 'commerce-list':return commerce.list(input.kind,input.options??{},options);
    case 'commerce-publication':return commerce.publication(input.id,options);
    case 'commerce-purchase':return commerce.purchase(input.id,input.options??{},options);
    case 'commerce-file':return commerce.file(input.kind,input.id,input.part,options);
    default:need(false,'RESEARCH_COMMERCE_PYTHON_ACTION_INVALID');
   }
  }
 }
}
/** Responses retain every original byte before the Python invocation completes. */
export async function runResearchCommerceCall(request,{signal,openClient}={}){
 need(isResearchCommerceCall(request.action),'RESEARCH_COMMERCE_PYTHON_ACTION_INVALID');
 fields(request.input,[...allowed[request.action],'responseDirectory'],['responseDirectory']);
 need(typeof request.input.responseDirectory==='string'&&isAbsolute(request.input.responseDirectory),
  'RESEARCH_COMMERCE_PYTHON_RESPONSE_DIRECTORY_REQUIRED');
 need(request.expectedWorkspaceId===undefined||/^research_[a-f0-9]{64}$/.test(request.expectedWorkspaceId),
  'RESEARCH_WORKSPACE_ID_INVALID');
 const {responseDirectory,...value}=request.input,input=copy(value);
 need(Buffer.byteLength(JSON.stringify(input))<=CONTROL_LIMIT+65536,'RESEARCH_COMMERCE_PYTHON_INPUT_TOO_LARGE');
 if(input.directory!==undefined)
  need(typeof input.directory==='string'&&isAbsolute(input.directory)&&resolve(input.directory)!==resolve(responseDirectory),
   'RESEARCH_COMMERCE_PYTHON_DIRECTORY_COLLISION');
 if(mutable.has(request.action))need(typeof input.directory==='string','RESEARCH_COMMERCE_RUN_DIRECTORY_REQUIRED');
 const call={action:request.action,input,expectedWorkspaceId:request.expectedWorkspaceId??null},
  callSha256=fingerprint(call),original=lazyOriginal(openClient,signal);
 let response,dispatched=false;
 const cleanup=new Set(),closeRemaining=async()=>{
  let first;
  try{await original.close();}catch(error){first=error;}
  for(const owner of [...cleanup]){
   try{await owner.close();cleanup.delete(owner);}catch(error){first??=error;}
  }
  if(first)throw first;
 };
 try{
  response=await withCustomerOperation(responseDirectory,async root=>{
   await retainCustomerBytes(root,'request.json',encoded({
    schema:'sf88-research-commerce-python-call/v1',call,callSha256}));
   const responsePath=join(root,'response.json');
   if(await exists(responsePath)){
    const saved=await readCustomerJson(responsePath,RESEARCH_COMMERCE_PYTHON_RESPONSE_LIMIT);
    need(saved.value.schema===RESPONSE&&same(saved.value.call,call)&&
     saved.value.callSha256===callSha256,'RESEARCH_COMMERCE_PYTHON_RESPONSE_CHANGED');
    // Reopen completed native files and operations without dispatching a new call.
    if(mutable.has(call.action))
     await execute(call.action,input,original,signal,{completed:true});
    const retained=await retainCustomerBytes(root,'response.json',saved.body);
    return {mode:MODE,ok:true,workspaceId:saved.value.workspaceId,result:descriptor(retained,saved.value)};
   }
   stopped(signal);dispatched=true;
   const result=await execute(call.action,input,original,signal),
    workspaceId=local.has(call.action)?null:original.workspaceId??result?.workspaceId??null;
   need(local.has(call.action)||/^research_[a-f0-9]{64}$/.test(workspaceId??''),'RESEARCH_WORKSPACE_ID_INVALID');
   need(!workspaceId||!call.expectedWorkspaceId||workspaceId===call.expectedWorkspaceId,'RESEARCH_WORKSPACE_CHANGED');
   const body={schema:RESPONSE,call,callSha256,workspaceId,result},
    file=await retainCustomerBytes(root,'response.json',encoded(body));
   return {mode:MODE,ok:true,workspaceId,result:descriptor(file,body)};
  });
 }catch(error){
  if(typeof error?.close==='function')cleanup.add(error);
  response={mode:MODE,ok:false,workspaceId:original.workspaceId,...errorRecord(error)};
  if(response.outcomeUnknown===undefined&&mutable.has(call.action))response.outcomeUnknown=dispatched;
 }finally{
  try{await closeRemaining();}
  catch(error){
   response??={mode:MODE,ok:false,workspaceId:original.workspaceId,error:safeCode(error?.code)};
   response.sourceCleanupFailed=safeCode(error?.code);
   // The maintained bridge owns this handle until its CLI/library cleanup completes.
   Object.defineProperty(response,'close',{configurable:true,enumerable:false,value:closeRemaining});
  }
 }
 return response;
}
