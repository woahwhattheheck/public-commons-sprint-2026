// MIT. Python uses the original Research quotation operator and complete file publisher.
import {resolve,join,isAbsolute} from 'node:path';
import {readResearchHostFile} from '../research-dossiers/workspace-files.mjs';
import {exists,digest} from '../node/store.mjs';
import {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerBytes,describeCustomerFile}
 from '../research-dossiers/customer-updates/files.mjs';
import {QUOTE_REQUEST_LIMIT,QUOTE_FILE_LIMIT,fields,need,same,fingerprint,id,hash}
 from '../research-dossiers/customer-quotes/contracts.mjs';
import {submitResearchQuote,replayResearchQuote,readResearchQuoteRun,retainResearchQuoteOperation,
 retainResearchQuoteCaseFile,copyResearchQuoteExport}
 from '../research-dossiers/customer-quotes/operator.mjs';

const MODE='RESEARCH_WORKSPACE_BRIDGE';
const RESPONSE='sf88-research-quotes-python-response/v1';
const RESPONSE_FILE='sf88-research-quotes-python-file/v1';
export const RESEARCH_QUOTES_PYTHON_RESPONSE_LIMIT=QUOTE_FILE_LIMIT;
const INPUT_FIELDS=['inputFile','inputSha256','inputBytes'];
const CONTROL_LIMIT=1024*1024;
const COMMANDS=new Set(['create-case','native-case','pricing','prepare','apply','prepare-response',
 'prepare-publication','enroll-publication','prepare-report']);
const allowed=Object.freeze({
 'quotes-configuration':[],
 'quotes-cases':['options'],
 'quotes-case':['caseId','options'],
 'quotes-list':['options'],
 'quotes-operation':['id'],
 'quotes-files':['id'],
 'quotes-file-info':['id','name'],
 'quotes-case-file-info':['caseId',...INPUT_FIELDS],
 'quotes-tariff-file-info':['caseId',...INPUT_FIELDS],
 'quotes-submit':['directory','command','caseId','action','profile',...INPUT_FIELDS],
 'quotes-export-operation':['directory','id','expectedOperationSha256'],
 'quotes-export-case':['directory','caseId','expectedSha256','expectedBytes',...INPUT_FIELDS],
 'quotes-export-tariff':['directory','caseId','expectedSha256','expectedBytes',...INPUT_FIELDS],
 'quotes-download':['directory','id','name','expectedSha256','expectedBytes'],
 'quotes-replay':['directory','sourceDirectory','original'],
 'quotes-run-inspect':['directory'],
 'quotes-copy-export':['directory','sourceDirectory','expectedSelectionSha256','expectedWorkspaceId'],
});
const local=new Set(['quotes-run-inspect','quotes-copy-export']);
const mutable=new Set(['quotes-submit','quotes-export-operation','quotes-export-case','quotes-export-tariff',
 'quotes-download','quotes-replay','quotes-copy-export']);
export const isResearchQuotesCall=action=>Object.hasOwn(allowed,action);
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,120}$/.test(value)?value:'RESEARCH_QUOTES_PYTHON_CALL_FAILED';
function stopped(signal){signal?.throwIfAborted();}
function errorRecord(error){
 const result={error:safeCode(error?.code)};
 for(const key of ['status','outcomeUnknown','method','route','recovery','requestId','requestState','operationId',
  'destinationPublished','file','metadata','sourceCleanupFailed','clientWarnings','researchQuoteRun',
  'researchQuoteRetentionError','closeError'])
  if(error?.[key]!==undefined)result[key]=error[key];
 return result;
}
function encoded(value){
 const body=Buffer.from(JSON.stringify(value)+'\n');
 need(body.length<=RESEARCH_QUOTES_PYTHON_RESPONSE_LIMIT,'RESEARCH_QUOTES_PYTHON_RESPONSE_TOO_LARGE');
 return body;
}
function descriptor(file,body){
 return {schema:RESPONSE_FILE,callSha256:body.callSha256,workspaceId:body.workspaceId,
  file:{file:file.path,bytes:file.bytes,sha256:file.sha256,contentType:'application/json; charset=utf-8'}};
}
function lazyOriginal(openClient,signal){
 let original=null,opening=null,workspaceId=null;
 const get=()=>{
  stopped(signal);
  if(!opening){
   need(typeof openClient==='function','RESEARCH_QUOTE_ORIGINAL_CLIENT_REQUIRED');
   original=openClient();
   need(original&&typeof original.status==='function'&&typeof original.customerQuotes==='function',
    'RESEARCH_QUOTE_ORIGINAL_CLIENT_REQUIRED');
   opening=original.status({signal}).then(status=>{workspaceId=status.workspaceId;return original;});
  }
  return opening;
 };
 return {get,get workspaceId(){return workspaceId;},async close(){if(original)await original.close();}};
}
async function selectedInput(value){
 need(typeof value.inputFile==='string'&&isAbsolute(value.inputFile)&&
  Number.isSafeInteger(value.inputBytes)&&value.inputBytes>0&&value.inputBytes<=QUOTE_REQUEST_LIMIT,
  'RESEARCH_QUOTE_PYTHON_INPUT_REQUIRED');
 hash(value.inputSha256);
 const raw=await readResearchHostFile(value.inputFile,QUOTE_REQUEST_LIMIT,{privateFile:true});
 need(raw.length===value.inputBytes&&digest(raw)===value.inputSha256,'RESEARCH_QUOTE_PYTHON_INPUT_CHANGED');
 let input;
 try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
 catch(error){throw Object.assign(new Error('RESEARCH_QUOTE_INPUT_JSON_INVALID'),
  {code:'RESEARCH_QUOTE_INPUT_JSON_INVALID',cause:error});}
 need(input!==null&&typeof input==='object'&&!Array.isArray(input),'RESEARCH_QUOTE_FIELDS_INVALID');
 return input;
}
function controls(input){
 need(COMMANDS.has(input.command),'RESEARCH_QUOTE_COMMAND_INVALID');
 return Object.fromEntries(['command','caseId','action','profile'].filter(key=>input[key]!==undefined)
  .map(key=>[key,input[key]]));
}
async function stored(directory,name){
 const path=join(directory,name);if(!await exists(path))return null;
 const item=await readCustomerJson(path,QUOTE_FILE_LIMIT);
 await retainCustomerBytes(directory,name,item.body);return item.value;
}
async function downloadFile(input,original,signal,completed){
 id(input.id);hash(input.expectedSha256);
 need(typeof input.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(input.name)&&
  Number.isSafeInteger(input.expectedBytes)&&input.expectedBytes>=0&&input.expectedBytes<=QUOTE_FILE_LIMIT,
  'RESEARCH_QUOTE_FILE_SELECTION_INVALID');
 return withCustomerOperation(input.directory,async root=>{
  const fileRoot=await customerDirectory(join(root,'files'));
  let metadata=await stored(root,'file-selection.json');
  if(!metadata){
   need(!completed,'RESEARCH_QUOTE_RETAINED_FILE_MISSING');
   const client=await original.get();
   metadata=await client.customerQuotes().fileInfo(input.id,input.name,{signal});
   need(metadata.id===input.id&&metadata.descriptor?.name===input.name&&
    metadata.descriptor.sha256===input.expectedSha256&&metadata.descriptor.bytes===input.expectedBytes,
    'RESEARCH_QUOTE_FILE_CHANGED');
   await retainCustomerBytes(root,'file-selection.json',encoded(metadata));
  }
  need(metadata.schema==='sf88-research-customer-quotes/v1'&&metadata.id===input.id&&
   /^research_[a-f0-9]{64}$/.test(metadata.workspaceId??'')&&metadata.descriptor?.name===input.name&&
   metadata.descriptor.sha256===input.expectedSha256&&metadata.descriptor.bytes===input.expectedBytes,
   'RESEARCH_QUOTE_FILE_CHANGED');
  const target=join(fileRoot,input.name);
  let transfer=null;
  if(!await exists(target)){
   need(!completed,'RESEARCH_QUOTE_RETAINED_FILE_MISSING');
   const client=await original.get();
   need(original.workspaceId===metadata.workspaceId,'RESEARCH_WORKSPACE_CHANGED');
   transfer=await client.customerQuotes().download(input.id,input.name,{
    file:target,expectedSha256:input.expectedSha256,expectedBytes:input.expectedBytes,signal});
  }
  const file=await describeCustomerFile(target,{sha256:input.expectedSha256,bytes:input.expectedBytes,
   maximum:QUOTE_FILE_LIMIT});
  let saved=await stored(root,'download-result.json');
  if(!saved){
   saved={schema:'sf88-research-quotes-python-download/v1',workspaceId:metadata.workspaceId,
    id:input.id,metadata,file,transfer,directory:root};
   await retainCustomerBytes(root,'download-result.json',encoded(saved));
  }
  need(saved.schema==='sf88-research-quotes-python-download/v1'&&saved.workspaceId===metadata.workspaceId&&
   saved.id===input.id&&same(saved.metadata,metadata)&&saved.file?.path===file.path&&
   saved.file.bytes===file.bytes&&saved.file.sha256===file.sha256,'RESEARCH_QUOTE_FILE_CHANGED');
  return saved;
 });
}
async function execute(action,input,original,signal,{completed=false}={}){
 const client=completed?null:original.get;
 switch(action){
  case 'quotes-submit':{
   const value=await selectedInput(input);
   return submitResearchQuote({client,directory:input.directory,...controls(input),input:value,signal});
  }
  case 'quotes-export-operation':
   return retainResearchQuoteOperation({client,...input,signal});
  case 'quotes-export-case':
  case 'quotes-export-tariff':{
   const value=await selectedInput(input);
   return retainResearchQuoteCaseFile({client,directory:input.directory,caseId:input.caseId,input:value,
    tariff:action==='quotes-export-tariff',expectedSha256:input.expectedSha256,
    expectedBytes:input.expectedBytes,signal});
  }
  case 'quotes-download':return downloadFile(input,original,signal,completed);
  case 'quotes-replay':{
   if(completed)return submitResearchQuote({client:null,directory:input.directory,signal});
   const selected=input.original;
   fields(selected,['command','caseId','action','profile',...INPUT_FIELDS,'workspaceId'],
    ['command',...INPUT_FIELDS,'workspaceId']);
   need(/^research_[a-f0-9]{64}$/.test(selected.workspaceId??'')&&
    typeof input.sourceDirectory==='string'&&isAbsolute(input.sourceDirectory),
    'RESEARCH_QUOTE_REPLAY_SOURCE_REQUIRED');
   const value=await selectedInput(selected),selectedControls=controls(selected);
   if(await exists(join(input.sourceDirectory,'request.json'))){
    const inspected=await readResearchQuoteRun(input.sourceDirectory),request=inspected.request;
    const originalBody=Buffer.from(JSON.stringify(value));
    need(request?.workspaceId===selected.workspaceId&&
     request.input?.bytes===originalBody.length&&request.input.sha256===digest(originalBody)&&
     Object.entries(selectedControls).every(([key,item])=>request.selection[key]===item),
     'RESEARCH_QUOTE_REPLAY_SOURCE_CHANGED');
    return replayResearchQuote({client:original.get,directory:input.directory,
     sourceDirectory:input.sourceDirectory,signal});
   }
   await original.get();
   need(original.workspaceId===selected.workspaceId,'RESEARCH_QUOTE_REPLAY_SOURCE_CHANGED');
   return submitResearchQuote({client:original.get,directory:input.directory,
    ...selectedControls,input:value,signal});
  }
  case 'quotes-run-inspect':return readResearchQuoteRun(input.directory);
  case 'quotes-copy-export':{
   hash(input.expectedSelectionSha256);
   need(/^research_[a-f0-9]{64}$/.test(input.expectedWorkspaceId??'')&&
    typeof input.sourceDirectory==='string'&&isAbsolute(input.sourceDirectory),
    'RESEARCH_QUOTE_EXPORT_SOURCE_REQUIRED');
   const inspected=await readResearchQuoteRun(input.sourceDirectory),selected=inspected.result;
   need(selected?.schema==='sf88-research-quote-export-result/v1'&&
    selected.selectionSha256===input.expectedSelectionSha256&&selected.workspaceId===input.expectedWorkspaceId,
    'RESEARCH_QUOTE_EXPORT_SOURCE_CHANGED');
   const copied=await copyResearchQuoteExport(selected,input.directory);
   const manifest=await describeCustomerFile(join(copied.directory,'quote-export.json'),{maximum:QUOTE_FILE_LIMIT});
   return {schema:'sf88-research-quotes-python-export-copy/v1',workspaceId:selected.workspaceId,
    selectionSha256:selected.selectionSha256,directory:copied.directory,manifest,files:copied.files};
  }
  default:{
   const owner=await original.get(),quotes=owner.customerQuotes(),options={signal};
   switch(action){
    case 'quotes-configuration':return quotes.configuration(options);
    case 'quotes-cases':return quotes.listCases(input.options??{},options);
    case 'quotes-case':return quotes.readCase(input.caseId,input.options??{},options);
    case 'quotes-list':return quotes.list(input.options??{},options);
    case 'quotes-operation':return quotes.operation(input.id,options);
    case 'quotes-files':return quotes.files(input.id,options);
    case 'quotes-file-info':return quotes.fileInfo(input.id,input.name,options);
    case 'quotes-case-file-info':return quotes.caseFileInfo(input.caseId,await selectedInput(input),options);
    case 'quotes-tariff-file-info':return quotes.tariffFileInfo(input.caseId,await selectedInput(input),options);
    default:need(false,'RESEARCH_QUOTES_PYTHON_ACTION_INVALID');
   }
  }
 }
}
/** Complete native replies are retained as files; stdout contains only their descriptors. */
export async function runResearchQuotesCall(request,{signal,openClient}={}){
 need(isResearchQuotesCall(request.action),'RESEARCH_QUOTES_PYTHON_ACTION_INVALID');
 fields(request.input,[...allowed[request.action],'responseDirectory'],['responseDirectory']);
 need(typeof request.input.responseDirectory==='string'&&isAbsolute(request.input.responseDirectory),
  'RESEARCH_QUOTES_PYTHON_RESPONSE_DIRECTORY_REQUIRED');
 need(request.expectedWorkspaceId===undefined||/^research_[a-f0-9]{64}$/.test(request.expectedWorkspaceId),
  'RESEARCH_WORKSPACE_ID_INVALID');
 const {responseDirectory,...value}=request.input,input=structuredClone(value);
 need(Buffer.byteLength(JSON.stringify(input))<=CONTROL_LIMIT,'RESEARCH_QUOTES_PYTHON_CONTROL_TOO_LARGE');
 if(input.directory!==undefined)
  need(typeof input.directory==='string'&&isAbsolute(input.directory)&&resolve(input.directory)!==resolve(responseDirectory),
   'RESEARCH_QUOTES_PYTHON_DIRECTORY_COLLISION');
 if(mutable.has(request.action))need(typeof input.directory==='string','RESEARCH_QUOTE_RUN_DIRECTORY_REQUIRED');
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
    schema:'sf88-research-quotes-python-call/v1',call,callSha256}));
   const responsePath=join(root,'response.json');
   if(await exists(responsePath)){
    const saved=await readCustomerJson(responsePath,RESEARCH_QUOTES_PYTHON_RESPONSE_LIMIT);
    need(saved.value.schema===RESPONSE&&same(saved.value.call,call)&&saved.value.callSha256===callSha256&&
     (local.has(call.action)?saved.value.workspaceId===null:
      /^research_[a-f0-9]{64}$/.test(saved.value.workspaceId??'')&&
       (!call.expectedWorkspaceId||saved.value.workspaceId===call.expectedWorkspaceId)),
     'RESEARCH_QUOTES_PYTHON_RESPONSE_CHANGED');
    if(mutable.has(call.action))await execute(call.action,input,original,signal,{completed:true});
    const retained=await retainCustomerBytes(root,'response.json',saved.body);
    return {mode:MODE,ok:true,workspaceId:saved.value.workspaceId,result:descriptor(retained,saved.value)};
   }
   stopped(signal);dispatched=true;
   const result=await execute(call.action,input,original,signal),
    workspaceId=local.has(call.action)?null:original.workspaceId??result?.workspaceId??null;
   need(local.has(call.action)||/^research_[a-f0-9]{64}$/.test(workspaceId??''),'RESEARCH_WORKSPACE_ID_INVALID');
   need(!workspaceId||!call.expectedWorkspaceId||workspaceId===call.expectedWorkspaceId,'RESEARCH_WORKSPACE_CHANGED');
   const body={schema:RESPONSE,call,callSha256,workspaceId,result},
    retained=await retainCustomerBytes(root,'response.json',encoded(body));
   return {mode:MODE,ok:true,workspaceId,result:descriptor(retained,body)};
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
   Object.defineProperty(response,'close',{configurable:true,enumerable:false,value:closeRemaining});
  }
 }
 return response;
}
