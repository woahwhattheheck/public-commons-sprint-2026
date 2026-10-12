// MIT. Retain complete terminal input/result before advancing the original product.
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readResearchHostFile} from '../workspace-files.mjs';
import {describeCustomerFile,copyCustomerFile} from '../customer-updates/files.mjs';
import {withCustomerOperation,customerDirectory,optionalJson,retainCustomerJson,retainCustomerBytes,
 readCustomerJson,jsonBytes,digest,exists,stamp} from './files.mjs';
import {CONTROL_LIMIT,COMMERCE_SCHEMA,identifier,fields,hash,need,copy,same,fingerprint} from './contracts.mjs';
export const RESEARCH_COMMERCE_WRITES=Object.freeze([
 'publication-prepare','publication-enroll','purchase-receive','purchase-prepare',
 'purchase-execute','purchase-retrieve','purchase-recover','purchase-finalize','purchase-cancel',
 'purchase-reconcile','purchase-receive-dossier',
]);
const requestSchema='sf88-research-commerce-operator-request/v1';
const resultSchema='sf88-research-commerce-operator-result/v1';
async function originalClient(client,workspaceId){
 const selected=typeof client==='function'?await client():client;
 need(selected&&typeof selected.customerCommerce==='function','RESEARCH_COMMERCE_ORIGINAL_CLIENT_REQUIRED');
 const status=await selected.status();
 need(!workspaceId||status.workspaceId===workspaceId,'RESEARCH_COMMERCE_RECEIVING_WORKSPACE_CHANGED');
 return {client:selected,workspaceId:status.workspaceId,commerce:selected.customerCommerce()};
}
function binding(command,input){
 need(RESEARCH_COMMERCE_WRITES.includes(command),'RESEARCH_COMMERCE_COMMAND_INVALID');
 const id=command==='publication-prepare'||command==='purchase-receive'?input?.requestId:input?.id;
 identifier(id);return {command,id,input:copy(input)};
}
function validateRequest(saved){
 need(saved?.schema===requestSchema&&saved.requestSha256===fingerprint(saved.selection)&&
  same(binding(saved.selection.command,saved.selection.input),saved.selection)&&
  /^[a-f0-9]{64}$/.test(saved.input.sha256)&&Number.isSafeInteger(saved.input.bytes)&&
  saved.input.bytes>0&&saved.input.bytes<=CONTROL_LIMIT&&/^research_[a-f0-9]{64}$/.test(saved.workspaceId),
  'RESEARCH_COMMERCE_OPERATOR_REQUEST_CHANGED');return saved;
}
async function optionalInput(path,expected){
 if(path&&await exists(path)){const body=await readResearchHostFile(path,CONTROL_LIMIT);
  need(digest(body)===expected.sha256&&body.length===expected.bytes,'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');}
}
async function invoke(commerce,command,input){
 const methods={'publication-prepare':'preparePublication','publication-enroll':'enrollPublication',
  'purchase-receive':'receivePurchase','purchase-prepare':'preparePurchase',
  'purchase-reconcile':'reconcile','purchase-receive-dossier':'receiveDossier'};
 return methods[command]?commerce[methods[command]](input):commerce.action(command.slice('purchase-'.length),input);
}
/** Without new input, reopen the complete original command or dispatch its exact retained request. */
export async function submitResearchCommerce({client,directory,command,inputFile,input}={}){
 const selectedFile=inputFile?resolve(inputFile):null,selectedInput=input===undefined?undefined:copy(input);
 need(!(selectedFile&&selectedInput!==undefined),'RESEARCH_COMMERCE_SELECT_ONE_INPUT');
 return withCustomerOperation(directory,async root=>{
  let retained=await optionalJson(root,'request.json');
  if(retained){
   validateRequest(retained);
   need(command===undefined||retained.selection.command===command,'RESEARCH_COMMERCE_OPERATOR_COMMAND_CHANGED');
   if(selectedInput!==undefined)need(same(selectedInput,retained.selection.input),'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');
   await optionalInput(selectedFile,retained.input);
   const bytes=await readResearchHostFile(join(root,'input.json'),CONTROL_LIMIT);
   need(bytes.length===retained.input.bytes&&digest(bytes)===retained.input.sha256&&
    same(JSON.parse(bytes.toString('utf8')),retained.selection.input),'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');
  }else{
   need(selectedFile||selectedInput!==undefined,'RESEARCH_COMMERCE_OPERATOR_INPUT_REQUIRED');
   const body=selectedFile?await readResearchHostFile(selectedFile,CONTROL_LIMIT):jsonBytes(selectedInput);
   const selected=binding(command,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));
   const original=await originalClient(client);
   await retainCustomerBytes(root,'input.json',body);
   retained={schema:requestSchema,selection:selected,requestSha256:fingerprint(selected),
    workspaceId:original.workspaceId,input:{bytes:body.length,sha256:digest(body)},createdAt:stamp()};
   await retainCustomerJson(root,'request.json',retained);
  }
  const saved=await optionalJson(root,'result.json');
  if(saved){
   need(saved.schema===resultSchema&&saved.requestSha256===retained.requestSha256&&saved.workspaceId===retained.workspaceId&&
    saved.resultSha256===fingerprint(saved.result)&&saved.result.schema===COMMERCE_SCHEMA&&saved.result.id===retained.selection.id,
    'RESEARCH_COMMERCE_OPERATOR_RESULT_CHANGED');
   return {...saved,directory:root,reused:true};
  }
  const original=await originalClient(client,retained.workspaceId);
  const result=await invoke(original.commerce,retained.selection.command,retained.selection.input);
  need(result?.schema===COMMERCE_SCHEMA&&result.id===retained.selection.id,'RESEARCH_COMMERCE_OPERATOR_RESULT_CHANGED');
  const savedResult={schema:resultSchema,workspaceId:retained.workspaceId,requestSha256:retained.requestSha256,
   result,resultSha256:fingerprint(result),completedAt:stamp()};
  // Preserve the first actual native reply before exposing a completed terminal command.
  await retainCustomerJson(root,'result.json',savedResult);
  return {...savedResult,directory:root,reused:false};
 });
}
/** A separate retained attempt submits the original native request again, preserving both results. */
export async function replayResearchCommerce({client,directory,sourceDirectory}={}){
 const root=await customerDirectory(sourceDirectory,{create:false}),selected=await optionalJson(root,'request.json');
 validateRequest(selected);
 const target=resolve(directory);need(target!==root,'RESEARCH_COMMERCE_REPLAY_DIRECTORY_REQUIRED');
 return withCustomerOperation(target,async replayRoot=>{
  const source={schema:'sf88-research-commerce-original-replay/v1',sourceDirectory:root,
   requestSha256:selected.requestSha256,workspaceId:selected.workspaceId,selection:copy(selected.selection),input:copy(selected.input)};
  await retainCustomerJson(replayRoot,'original.json',source);
  const bytes=await readResearchHostFile(join(root,'input.json'),CONTROL_LIMIT);
  need(bytes.length===selected.input.bytes&&digest(bytes)===selected.input.sha256,'RESEARCH_COMMERCE_OPERATOR_INPUT_CHANGED');
  await retainCustomerBytes(replayRoot,'input.json',bytes);
  await retainCustomerJson(replayRoot,'request.json',{schema:requestSchema,selection:source.selection,
   requestSha256:source.requestSha256,workspaceId:source.workspaceId,input:source.input,createdAt:selected.createdAt});
 }).then(()=>submitResearchCommerce({client,directory:target}));
}
export async function readResearchCommerceOperation(directory){
 const root=await customerDirectory(directory,{create:false}),files={};
 for(const name of ['request.json','original.json','export.json','result.json'])
  if(await exists(join(root,name)))files[name]=(await readCustomerJson(join(root,name))).value;
 if(files['request.json'])validateRequest(files['request.json']);
 return {schema:'sf88-research-commerce-operator-inspected/v1',directory:root,files};
}
export async function retainResearchCommerceFile({client,directory,kind,id,part,expectedSha256}={}){
 fields({kind,id,part},['kind','id','part']);identifier(id);
 need(['publications','purchases'].includes(kind)&&['publication','handoff','archive','received'].includes(part),
  'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');if(expectedSha256!==undefined)hash(expectedSha256);
 const request={kind,id,part,expectedSha256:expectedSha256??null};
 return withCustomerOperation(directory,async root=>{
  let retained=await optionalJson(root,'export.json');
  if(retained){
   need(retained.schema==='sf88-research-commerce-export-selection/v1'&&same(retained.request,request)&&
    retained.selectionSha256===fingerprint(retained.selection),'RESEARCH_COMMERCE_EXPORT_CHANGED');
  }else{
   const original=await originalClient(client),selection=await original.commerce.file(kind,id,part);
   need(selection.workspaceId===original.workspaceId&&
    (expectedSha256===undefined||selection.descriptor.sha256===expectedSha256),'RESEARCH_COMMERCE_EXPORT_CHANGED');
   retained={schema:'sf88-research-commerce-export-selection/v1',request,workspaceId:original.workspaceId,
    selection,selectionSha256:fingerprint(selection),createdAt:stamp()};
   await retainCustomerJson(root,'export.json',retained);
  }
  const target=join(root,retained.selection.descriptor.name),descriptor=retained.selection.descriptor;
  if(!await exists(target)){
   const original=await originalClient(client,retained.workspaceId);
   await original.commerce.download(kind,id,part,{file:target,expectedSha256:descriptor.sha256,expectedBytes:descriptor.bytes});
  }
  const file=await describeCustomerFile(target,{sha256:descriptor.sha256,bytes:descriptor.bytes});
  let saved=await optionalJson(root,'result.json');const reused=!!saved;
  if(!saved){
   saved={schema:'sf88-research-commerce-export-result/v1',workspaceId:retained.workspaceId,
    selectionSha256:retained.selectionSha256,file:{...descriptor},completedAt:stamp()};
   await retainCustomerJson(root,'result.json',saved);
  }
  need(saved.selectionSha256===retained.selectionSha256&&saved.workspaceId===retained.workspaceId&&
   same(saved.file,descriptor),'RESEARCH_COMMERCE_EXPORT_RESULT_CHANGED');
  return {...saved,file:{...saved.file,path:file.path},directory:root,reused};
 });
}
export async function copyResearchCommerceExport(result,destination){
 need(result?.schema==='sf88-research-commerce-export-result/v1','RESEARCH_COMMERCE_EXPORT_REQUIRED');
 return copyCustomerFile(result.file.path,resolve(destination),{sha256:result.file.sha256,bytes:result.file.bytes});
}
