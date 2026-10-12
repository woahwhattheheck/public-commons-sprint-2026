// MIT. Durable terminal requests and complete exports use the original private publisher.
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {readResearchHostFile} from '../workspace-files.mjs';
import {customerDirectory,withCustomerOperation,readCustomerJson,retainCustomerBytes,
 describeCustomerFile,copyCustomerFile} from '../customer-updates/files.mjs';
import {exists,digest} from '../../node/store.mjs';
import {QUOTES_SCHEMA,QUOTE_FILE_LIMIT,QUOTE_REQUEST_LIMIT,id,hash,alias,need,same,fingerprint,
 caseSelection,briefSelection,responseSelection,normalizePublicationSelection,realizedSelection,applySelection} from './contracts.mjs';
import {captureResearchQuoteInput,validateResearchQuoteOperation,RESEARCH_QUOTES_CASE_ACTIONS,
 RESEARCH_QUOTES_PRICING_ACTIONS} from './client.mjs';

export const RESEARCH_QUOTES_WRITES=Object.freeze([
 'create-case','native-case','pricing','prepare','apply','prepare-response','prepare-publication','enroll-publication','prepare-report',
]);
const REQUEST='sf88-research-quote-operator-request/v1',RESULT='sf88-research-quote-operator-result/v1',
 EXPORT='sf88-research-quote-export-selection/v1',EXPORTED='sf88-research-quote-export-result/v1';
const timestamp=()=>new Date().toISOString();
const compact=value=>Buffer.from(JSON.stringify(value));
function json(body){
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
 catch(error){throw Object.assign(new Error('RESEARCH_QUOTE_INPUT_JSON_INVALID'),{code:'RESEARCH_QUOTE_INPUT_JSON_INVALID',cause:error});}
}
async function save(root,name,value){
 const body=compact(value);need(body.length<=QUOTE_FILE_LIMIT,'RESEARCH_QUOTE_OPERATOR_RECORD_TOO_LARGE',413);
 return retainCustomerBytes(root,name,body);
}
async function stored(root,name){
 const path=join(root,name);if(!await exists(path))return null;
 const original=await readCustomerJson(path,QUOTE_FILE_LIMIT);
 // Retire only this original exact file's stopped hard-link publication.
 await retainCustomerBytes(root,name,original.body);return original.value;
}
function binding(command,value,{caseId,action,profile}={}){
 need(RESEARCH_QUOTES_WRITES.includes(command),'RESEARCH_QUOTE_COMMAND_INVALID');
 let input=captureResearchQuoteInput(value),extra={};
 const validators={'create-case':caseSelection,prepare:briefSelection,apply:applySelection,
  'prepare-response':responseSelection,'prepare-publication':normalizePublicationSelection,
  'enroll-publication':applySelection,'prepare-report':realizedSelection};
 if(validators[command])input=validators[command](input);
 else if(command==='native-case'){
  id(caseId);need(RESEARCH_QUOTES_CASE_ACTIONS.includes(action),'RESEARCH_QUOTE_CASE_ACTION_REQUIRED');
  need(input.id===undefined||input.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');extra={caseId,action};
 }else{
  alias(profile);need(RESEARCH_QUOTES_PRICING_ACTIONS.includes(action),'RESEARCH_QUOTE_PRICING_ACTION_REQUIRED');
  extra={profile,action};
 }
 return {command,...extra,input};
}
function requestRecord(value){
 need(value?.schema===REQUEST&&/^research_[a-f0-9]{64}$/.test(value.workspaceId??'')&&
  value.requestSha256===fingerprint(value.selection)&&
  same(value.selection,binding(value.selection.command,value.selection.input,value.selection))&&
  value.input?.name==='input.json'&&Number.isSafeInteger(value.input.bytes)&&value.input.bytes>0&&
  value.input.bytes<=QUOTE_REQUEST_LIMIT,'RESEARCH_QUOTE_OPERATOR_REQUEST_CHANGED');
 hash(value.input.sha256);return value;
}
function reply(value,selection,workspaceId){
 need(value?.workspaceId===workspaceId,'RESEARCH_QUOTE_OPERATOR_WORKSPACE_CHANGED');
 if(selection.command==='native-case'||selection.command==='pricing'){
  need(value.schema===QUOTES_SCHEMA&&value.action===selection.action&&Object.hasOwn(value,'result')&&
   (selection.command==='native-case'?value.caseId===selection.caseId:value.profile===selection.profile),
   'RESEARCH_QUOTE_OPERATOR_RESULT_CHANGED');return value;
 }
 const kinds={'create-case':'CASE',prepare:'BRIEF','prepare-response':'RESPONSE','prepare-publication':'PUBLICATION','prepare-report':'REALIZED'};
 validateResearchQuoteOperation(value,kinds[selection.command]?{
  requestId:selection.input.requestId,kind:kinds[selection.command],input:selection.input
 }:{requestId:selection.input.id,reviewSha256:selection.input.reviewSha256});
 if(selection.command==='apply')need(['BRIEF','RESPONSE'].includes(value.kind)&&value.status==='COMPLETE','RESEARCH_QUOTE_OPERATOR_RESULT_CHANGED');
 if(selection.command==='enroll-publication')need(value.kind==='PUBLICATION'&&value.status==='COMPLETE','RESEARCH_QUOTE_OPERATOR_RESULT_CHANGED');
 return value;
}
function resultRecord(value,request){
 need(value?.schema===RESULT&&value.workspaceId===request.workspaceId&&value.requestSha256===request.requestSha256&&
  value.resultSha256===fingerprint(value.result),'RESEARCH_QUOTE_OPERATOR_RESULT_CHANGED');
 reply(value.result,request.selection,request.workspaceId);return value;
}
async function originalClient(source,workspaceId,signal){
 const client=typeof source==='function'?await source():source;
 need(client&&typeof client.status==='function'&&typeof client.customerQuotes==='function',
  'RESEARCH_QUOTE_ORIGINAL_CLIENT_REQUIRED');
 const status=await client.status({signal});
 need(/^research_[a-f0-9]{64}$/.test(status?.workspaceId??'')&&
  (workspaceId===undefined||status.workspaceId===workspaceId),'RESEARCH_QUOTE_OPERATOR_WORKSPACE_CHANGED');
 return {client,quotes:client.customerQuotes(),workspaceId:status.workspaceId};
}
async function retainedInput(root,expected){
 const body=await readResearchHostFile(join(root,'input.json'),QUOTE_REQUEST_LIMIT);
 need(body.length===expected.bytes&&digest(body)===expected.sha256,'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
 await retainCustomerBytes(root,'input.json',body);return {body,value:json(body)};
}
async function suppliedInput(root,inputFile,input){
 need(!(inputFile&&input!==undefined),'RESEARCH_QUOTE_SELECT_ONE_INPUT');
 let body;
 if(inputFile)body=await readResearchHostFile(inputFile,QUOTE_REQUEST_LIMIT);
 else if(input!==undefined)body=compact(input);
 else if(await exists(join(root,'input.json')))body=await readResearchHostFile(join(root,'input.json'),QUOTE_REQUEST_LIMIT);
 need(body&&body.length>0&&body.length<=QUOTE_REQUEST_LIMIT,'RESEARCH_QUOTE_OPERATOR_INPUT_REQUIRED');
 return {body,value:json(body)};
}
async function compareExternal(file,input,request,root){
 if(file&&await exists(file)){
  const bytes=await readResearchHostFile(file,QUOTE_REQUEST_LIMIT);
  need(bytes.length===request.input.bytes&&digest(bytes)===request.input.sha256,'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
 }
 if(input!==undefined)need(same(binding(request.selection.command,input,request.selection),request.selection),
  'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
 const retained=await retainedInput(root,request.input);
 need(same(binding(request.selection.command,retained.value,request.selection),request.selection),
  'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
}
function errorRecord(error){
 const value={code:typeof error?.code==='string'?error.code:'RESEARCH_QUOTE_COMMAND_FAILED'};
 for(const key of ['status','outcomeUnknown','requestState','requestId','destinationPublished','file','metadata'])
  if(error?.[key]!==undefined)try{value[key]=JSON.parse(JSON.stringify(error[key]));}catch{}
 return value;
}
async function invoke(quotes,selection,signal){
 const methods={'create-case':'createCase',prepare:'prepare',apply:'apply','prepare-response':'prepareResponse',
  'prepare-publication':'preparePublication','enroll-publication':'enrollPublication','prepare-report':'prepareReport'};
 if(selection.command==='native-case')return quotes.caseAction(selection.caseId,selection.action,selection.input,{signal});
 if(selection.command==='pricing')return quotes.pricing(selection.profile,selection.action,selection.input,{signal});
 return quotes[methods[selection.command]](selection.input,{signal});
}
/** Repeat reopens the first complete reply before opening a connection or current settings. */
export function submitResearchQuote({client,directory,command,inputFile,input,caseId,action,profile,signal}={}){
 const file=inputFile?resolve(inputFile):null,selected=input===undefined?undefined:captureResearchQuoteInput(input),
  controls={command,caseId,action,profile};
 need(!(file&&selected!==undefined),'RESEARCH_QUOTE_SELECT_ONE_INPUT');
 return withCustomerOperation(directory,async root=>{
  need(!await exists(join(root,'export.json')),'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
  let request=await stored(root,'request.json');
  if(request){
   requestRecord(request);
   for(const key of ['command','caseId','action','profile'])if(controls[key]!==undefined)
    need(controls[key]===request.selection[key],'RESEARCH_QUOTE_OPERATOR_SELECTION_CHANGED');
   await compareExternal(file,selected,request,root);
  }else{
   const original=await suppliedInput(root,file,selected),selection=binding(command,original.value,controls),
    connected=await originalClient(client,undefined,signal);
   await retainCustomerBytes(root,'input.json',original.body);
   request={schema:REQUEST,workspaceId:connected.workspaceId,selection,requestSha256:fingerprint(selection),
    input:{name:'input.json',bytes:original.body.length,sha256:digest(original.body)},createdAt:timestamp()};
   await save(root,'request.json',request);
  }
  const previous=await stored(root,'result.json');
  if(previous)return {...resultRecord(previous,request),directory:root,reused:true};
  const connected=await originalClient(client,request.workspaceId,signal),attemptId=randomUUID(),
   attempt={schema:'sf88-research-quote-operator-attempt/v1',id:attemptId,
    workspaceId:request.workspaceId,requestSha256:request.requestSha256,startedAt:timestamp()};
  signal?.throwIfAborted();
  await save(root,'attempt-'+attemptId+'.json',attempt);
  try{
   const value=reply(await invoke(connected.quotes,request.selection,signal),request.selection,request.workspaceId);
   const result={schema:RESULT,workspaceId:request.workspaceId,requestSha256:request.requestSha256,
    attemptId,result:value,resultSha256:fingerprint(value),completedAt:timestamp()};
   await save(root,'result.json',result);
   return {...result,directory:root,reused:false};
  }catch(error){
   error.researchQuoteRun={directory:root,requestSha256:request.requestSha256,attemptId};
   try{await save(root,'error-'+attemptId+'.json',{...attempt,endedAt:timestamp(),error:errorRecord(error)});}
   catch(retainError){error.researchQuoteRetentionError=retainError.code??'RESEARCH_QUOTE_ERROR_RETENTION_FAILED';}
   throw error;
  }
 });
}
/** A deliberate separate replay keeps the original input, workspace and native request IDs. */
export async function replayResearchQuote({client,directory,sourceDirectory,signal}={}){
 const source=await customerDirectory(sourceDirectory,{create:false}),target=resolve(directory);
 need(source!==target,'RESEARCH_QUOTE_DISTINCT_REPLAY_DIRECTORY_REQUIRED');
 const original=await withCustomerOperation(source,async root=>{
  const request=requestRecord(await stored(root,'request.json')),input=await retainedInput(root,request.input);
  need(same(binding(request.selection.command,input.value,request.selection),request.selection),'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
  return {request,body:input.body};
 });
 await withCustomerOperation(target,async root=>{
  need(!await exists(join(root,'export.json')),'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
  const previous=await stored(root,'request.json');
  if(previous)need(same(requestRecord(previous),original.request),'RESEARCH_QUOTE_OPERATOR_SELECTION_CHANGED');
  await save(root,'original.json',{schema:'sf88-research-quote-original-replay/v1',sourceDirectory:source,
   workspaceId:original.request.workspaceId,requestSha256:original.request.requestSha256});
  await retainCustomerBytes(root,'input.json',original.body);
  await save(root,'request.json',original.request);
 });
 return submitResearchQuote({client,directory:target,signal});
}
function fileDescriptor(value){
 need(value&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value.name??'')&&
  Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=QUOTE_FILE_LIMIT&&
  typeof value.contentType==='string','RESEARCH_QUOTE_EXPORT_FILE_CHANGED');hash(value.sha256);return value;
}
function exportRecord(value,kind){
 need(['operation','case','tariff'].includes(kind)&&value?.schema===EXPORT&&value.request?.kind===kind&&/^research_[a-f0-9]{64}$/.test(value.workspaceId??'')&&
  value.selectionSha256===fingerprint(value.selection)&&Array.isArray(value.selection.files)&&value.selection.files.length<=103,
  'RESEARCH_QUOTE_EXPORT_SELECTION_CHANGED');
 value.selection.files.forEach(fileDescriptor);
 need(new Set(value.selection.files.map(file=>file.name)).size===value.selection.files.length,'RESEARCH_QUOTE_EXPORT_SELECTION_CHANGED');
 if(kind==='operation'){
  id(value.request.id);validateResearchQuoteOperation(value.selection.operation,{requestId:value.request.id});
  need(value.selection.operation.workspaceId===value.workspaceId,'RESEARCH_QUOTE_EXPORT_WORKSPACE_CHANGED');
 }else{
  id(value.request.caseId);
  need(value.selection.metadata?.workspaceId===value.workspaceId&&value.selection.metadata.caseId===value.request.caseId&&
   value.selection.metadata.case?.id===value.request.caseId&&value.selection.files.length===1&&
   same(value.selection.files[0],value.selection.metadata.descriptor)&&
   value.selection.input?.revision===value.selection.metadata.case.revision,'RESEARCH_QUOTE_EXPORT_CASE_CHANGED');
  hash(value.selection.input.revision);
 }
 return value;
}
async function completeExport(root,selected){
 const paths=[],filesRoot=await customerDirectory(join(root,'files'));
 for(const descriptor of selected.selection.files){
  const file=await describeCustomerFile(join(filesRoot,descriptor.name),{
   sha256:descriptor.sha256,bytes:descriptor.bytes,maximum:QUOTE_FILE_LIMIT});
  paths.push({...descriptor,path:file.path});
 }
 let result=await stored(root,'result.json'),reused=!!result;
 if(!result){
  result={schema:EXPORTED,workspaceId:selected.workspaceId,selectionSha256:selected.selectionSha256,
   request:selected.request,files:selected.selection.files,completedAt:timestamp()};
  await save(root,'result.json',result);
 }
 need(result.schema===EXPORTED&&result.workspaceId===selected.workspaceId&&result.selectionSha256===selected.selectionSha256&&
  same(result.request,selected.request)&&same(result.files,selected.selection.files),'RESEARCH_QUOTE_EXPORT_RESULT_CHANGED');
 return {...result,directory:root,selection:selected.selection,files:paths,reused};
}
/** Freeze the whole native operation and its complete file roster before any download. */
export function retainResearchQuoteOperation({client,directory,id:requestId,expectedOperationSha256,signal}={}){
 if(requestId!==undefined)id(requestId);if(expectedOperationSha256!==undefined)hash(expectedOperationSha256);
 return withCustomerOperation(directory,async root=>{
  need(!await exists(join(root,'request.json')),'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
  let selected=await stored(root,'export.json');
  if(selected){
   exportRecord(selected,'operation');
   need((requestId===undefined||requestId===selected.request.id)&&
    (expectedOperationSha256===undefined||expectedOperationSha256===selected.request.expectedOperationSha256),
    'RESEARCH_QUOTE_EXPORT_SELECTION_CHANGED');
  }else{
   id(requestId);const connected=await originalClient(client,undefined,signal),
    operation=await connected.quotes.operation(requestId,{signal}),
    listed=await connected.quotes.files(requestId,{signal}),
    after=await connected.quotes.operation(requestId,{signal});
   need(operation.workspaceId===connected.workspaceId&&listed.workspaceId===connected.workspaceId&&same(operation,after)&&
    (expectedOperationSha256===undefined||fingerprint(operation)===expectedOperationSha256),
    'RESEARCH_QUOTE_EXPORT_OPERATION_CHANGED');
   const selection={operation,files:listed.files};
   selected={schema:EXPORT,workspaceId:connected.workspaceId,
    request:{kind:'operation',id:requestId,expectedOperationSha256:expectedOperationSha256??null},
    selection,selectionSha256:fingerprint(selection),createdAt:timestamp()};
   exportRecord(selected,'operation');await save(root,'export.json',selected);
  }
  const filesRoot=await customerDirectory(join(root,'files'));let connected;
  for(const file of selected.selection.files){
   const target=join(filesRoot,file.name);
   if(!await exists(target)){
    connected??=await originalClient(client,selected.workspaceId,signal);
    await connected.quotes.download(selected.request.id,file.name,{file:target,
     expectedSha256:file.sha256,expectedBytes:file.bytes,signal});
   }
  }
  return completeExport(root,selected);
 });
}
/** Retain the original case request and selected revision; tariff files use the same publisher. */
export function retainResearchQuoteCaseFile({client,directory,caseId,inputFile,input,tariff=false,expectedSha256,expectedBytes,signal}={}){
 const file=inputFile?resolve(inputFile):null,value=input===undefined?undefined:captureResearchQuoteInput(input);
 need(!(file&&value!==undefined),'RESEARCH_QUOTE_SELECT_ONE_INPUT');need(typeof tariff==='boolean','RESEARCH_QUOTE_EXPORT_KIND_REQUIRED');
 if(caseId!==undefined)id(caseId);if(expectedSha256!==undefined)hash(expectedSha256);
 if(expectedBytes!==undefined)need(Number.isSafeInteger(expectedBytes)&&expectedBytes>=0&&expectedBytes<=QUOTE_FILE_LIMIT,'RESEARCH_QUOTE_FILE_SIZE_INVALID');
 return withCustomerOperation(directory,async root=>{
  need(!await exists(join(root,'request.json')),'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
  let selected=await stored(root,'export.json');const kind=tariff?'tariff':'case';
  if(selected){
   exportRecord(selected,kind);
   need((caseId===undefined||caseId===selected.request.caseId)&&
    (expectedSha256===undefined||expectedSha256===selected.request.expectedSha256)&&
    (expectedBytes===undefined||expectedBytes===selected.request.expectedBytes),'RESEARCH_QUOTE_EXPORT_SELECTION_CHANGED');
   const original=await retainedInput(root,selected.originalInput);
   need(same(captureResearchQuoteInput(original.value),selected.selection.original),'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
   if(value!==undefined)need(same(value,selected.selection.original),'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
   if(file&&await exists(file)){
    const bytes=await readResearchHostFile(file,QUOTE_REQUEST_LIMIT);
    need(bytes.length===selected.originalInput.bytes&&digest(bytes)===selected.originalInput.sha256,'RESEARCH_QUOTE_OPERATOR_INPUT_CHANGED');
   }
  }else{
   id(caseId);const original=await suppliedInput(root,file,value),input=captureResearchQuoteInput(original.value),
    connected=await originalClient(client,undefined,signal),
    metadata=await connected.quotes[tariff?'tariffFileInfo':'caseFileInfo'](caseId,input,{signal});
   need(metadata.workspaceId===connected.workspaceId&&(expectedSha256===undefined||metadata.descriptor.sha256===expectedSha256)&&
    (expectedBytes===undefined||metadata.descriptor.bytes===expectedBytes),'RESEARCH_QUOTE_EXPORT_SELECTION_CHANGED');
   const selection={metadata,original:input,input:{...input,revision:metadata.case.revision},files:[metadata.descriptor]};
   selected={schema:EXPORT,workspaceId:connected.workspaceId,
    request:{kind,caseId,expectedSha256:expectedSha256??null,expectedBytes:expectedBytes??null},
    originalInput:{name:'input.json',bytes:original.body.length,sha256:digest(original.body)},
    selection,selectionSha256:fingerprint(selection),createdAt:timestamp()};
   exportRecord(selected,kind);await retainCustomerBytes(root,'input.json',original.body);await save(root,'export.json',selected);
  }
  const filesRoot=await customerDirectory(join(root,'files')),descriptor=selected.selection.files[0],target=join(filesRoot,descriptor.name);
  if(!await exists(target)){
   const connected=await originalClient(client,selected.workspaceId,signal),
    downloaded=await connected.quotes[tariff?'downloadTariff':'downloadCase'](selected.request.caseId,selected.selection.input,
     {file:target,expectedSha256:descriptor.sha256,expectedBytes:descriptor.bytes,signal});
   const expected=selected.selection.metadata,actual=downloaded.metadata;
   need(actual?.workspaceId===expected.workspaceId&&actual.caseId===expected.caseId&&
    actual.case?.id===expected.case.id&&actual.case.revision===expected.case.revision&&
    same(actual.descriptor,expected.descriptor)&&['workspaceSha256','supportSha256'].every(key=>
     expected.case[key]===undefined||same(actual.case[key],expected.case[key])),'RESEARCH_QUOTE_EXPORT_CASE_CHANGED');
  }
  return completeExport(root,selected);
 });
}
export async function readResearchQuoteRun(directory){
 const selected=await customerDirectory(directory,{create:false});
 return withCustomerOperation(selected,async root=>{
  const request=await stored(root,'request.json'),selection=await stored(root,'export.json');
  need(Boolean(request)!==Boolean(selection),'RESEARCH_QUOTE_OPERATOR_SELECTION_REQUIRED');
  let result;
  if(request){
   requestRecord(request);await compareExternal(null,undefined,request,root);
   const saved=await stored(root,'result.json');result=saved?resultRecord(saved,request):null;
  }else{
   exportRecord(selection,selection.request.kind);
   if(selection.originalInput)await retainedInput(root,selection.originalInput);
   if(await exists(join(root,'result.json')))result=await completeExport(root,selection);
   else result=null;
  }
  const attempts=[];
  for(const name of (await readdir(root)).filter(name=>/^(attempt|error)-[a-f0-9-]{36}\.json$/.test(name)).sort()){
   need(attempts.length<10000,'RESEARCH_QUOTE_OPERATOR_ATTEMPT_LIMIT');
   attempts.push({name,value:await stored(root,name)});
  }
  return {schema:'sf88-research-quote-operator-inspected/v1',directory:root,request,selection,result,attempts,
   original:await stored(root,'original.json')};
 });
}
export async function copyResearchQuoteResult(directory,destination){
 const root=await customerDirectory(directory,{create:false}),file=await describeCustomerFile(join(root,'result.json'),{maximum:QUOTE_FILE_LIMIT});
 return copyCustomerFile(file.path,resolve(destination),{sha256:file.sha256,bytes:file.bytes,maximum:QUOTE_FILE_LIMIT});
}
export function copyResearchQuoteExport(result,destination){
 const selected=JSON.parse(JSON.stringify(result)),target=resolve(destination);
 need(selected?.schema===EXPORTED&&Array.isArray(selected.files)&&typeof selected.directory==='string'&&
  selected.selectionSha256===fingerprint(selected.selection)&&
  same(selected.files.map(({path,...file})=>file),selected.selection.files),'RESEARCH_QUOTE_EXPORT_REQUIRED');
 need(target!==resolve(selected.directory),'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
 need(selected.files.every(file=>!['quote-export-selection.json','quote-export.json'].includes(file.name)),
  'RESEARCH_QUOTE_EXPORT_RESERVED_FILE_CHANGED');
 return withCustomerOperation(target,async root=>{
  const priorRequest=await stored(root,'request.json'),priorExport=await stored(root,'export.json');
  need(priorRequest?.schema!==REQUEST&&priorExport?.schema!==EXPORT,'RESEARCH_QUOTE_DISTINCT_RUN_DIRECTORY_REQUIRED');
  const selection={schema:'sf88-research-quote-export-copy/v1',workspaceId:selected.workspaceId,
   selectionSha256:selected.selectionSha256,request:selected.request,selection:selected.selection,
   files:selected.files.map(({path,...file})=>file)};
  // Bind the complete source before copying any member; a stopped copy reuses it.
  await save(root,'quote-export-selection.json',selection);
  const copied=[];
  for(const file of selected.files)copied.push(await copyCustomerFile(file.path,join(root,file.name),{
   sha256:file.sha256,bytes:file.bytes,maximum:QUOTE_FILE_LIMIT}));
  await save(root,'quote-export.json',{...selection,schema:EXPORTED});
  return {directory:root,files:copied};
 });
}
