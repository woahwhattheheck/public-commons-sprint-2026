// MIT. Application continuation of the original Dataset lost-output finalizer.
import {mkdtemp,readdir,mkdir} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {VerifiedFile} from './result.mjs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {absolute,privateDirectory,digest,now,intent,object,need,BuyerError,
 readBytes,readJson,writeBytes,writeJson,exists,jsonBytes,syncDirectory,safeCode} from './store.mjs';

const SCHEMA='stellar-forge.node-dataset-recovery-command.v1';
const RESULT='stellar-forge.node-dataset-recovery-result.v1';
const ENVELOPE='stellar-forge.node-dataset-command.v1';
const PROOF='stellar-forge.sf88.lost-output-verified-transfer.v1';
const WORKER=fileURLToPath(new URL('./dataset-worker.mjs',import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
const NAME=/^lost-output-[a-f0-9]{64}$/;
const ATTEMPT=/^attempt-[A-Za-z0-9]{6}$/;
const COMMANDS=new Set(['inspect-lost-output','recover-lost-output','read-lost-output','export-lost-output']);
const MAX_PROOF=4_000_000;
const clone=value=>JSON.parse(jsonBytes(value));
const equal=(a,b)=>jsonBytes(a).equals(jsonBytes(b));
const freeze=value=>{
 if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
 return value;
};
const processView=run=>run?({exitCode:run.exitCode??null,exitSignal:run.exitSignal??null,
 errorCode:run.errorCode??null}):unknownProcess();
const unknownProcess=()=>({exitCode:null,exitSignal:null,errorCode:'PROCESS_EXIT_NOT_RECORDED'});
const optionalPath=value=>value===undefined?null:absolute(value);
function checkedSignal(signal){
 need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
 need(!signal?.aborted,'OPERATION_ABORTED_BEFORE_START');return signal;
}
function commandName(operationId){return 'lost-output-'+digest(intent(operationId));}
function sorted(value){
 if(Array.isArray(value))return value.map(sorted);
 if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));
 return value;
}
async function exactJson(path,value){
 const bytes=jsonBytes(value);
 if(!await exists(path)){
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 need((await readBytes(path,Math.max(bytes.length,65536))).equals(bytes),'DATASET_RECOVERY_RETAINED_REQUEST_CHANGED');
}
async function options(command,input={}){
 need(object(input)&&COMMANDS.has(command),'DATASET_RECOVERY_OPTIONS_REQUIRED');
 const allowed=new Set(['pageIndex','operationId','workspaceDirectory','approvedRequest','approvedRequestFile',
  'expectedRequestSha256','expectedAttemptSha256','expectedConfigSha256','transaction',
  'rpcEndpoint','rpcProxyEnv','destination','signal']);
 need(Object.keys(input).every(key=>allowed.has(key)),'DATASET_RECOVERY_OPTION_UNKNOWN');
 const {pageIndex,signal}=input;checkedSignal(signal);
 need(Number.isSafeInteger(pageIndex)&&pageIndex>=1&&pageIndex<=10000,'DATASET_RECOVERY_PAGE_REQUIRED');
 for(const name of ['expectedRequestSha256','expectedAttemptSha256','expectedConfigSha256','transaction'])
  need(input[name]===undefined||HASH.test(input[name]),'DATASET_RECOVERY_DIGEST_INVALID');
 need(input.approvedRequest===undefined||input.approvedRequestFile===undefined,'DATASET_RECOVERY_ONE_APPROVED_REQUEST_REQUIRED');
 let approvedRequest=null,approvedRequestFileSha256=null;
 if(input.approvedRequestFile!==undefined){
  const bytes=await readBytes(absolute(input.approvedRequestFile),65536);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new BuyerError('DATASET_RECOVERY_APPROVED_REQUEST_JSON_INVALID');}
  need(object(value),'DATASET_RECOVERY_APPROVED_REQUEST_REQUIRED');
  approvedRequest=sorted(clone(value));approvedRequestFileSha256=digest(bytes);
 }else if(input.approvedRequest!==undefined){
  need(object(input.approvedRequest),'DATASET_RECOVERY_APPROVED_REQUEST_REQUIRED');
  approvedRequest=sorted(clone(input.approvedRequest));
 }
 if(command==='inspect-lost-output'||command==='recover-lost-output')
  need(approvedRequest!==null,'DATASET_RECOVERY_APPROVED_REQUEST_REQUIRED');
 else need(approvedRequest===null&&input.expectedRequestSha256===undefined&&
  input.expectedAttemptSha256===undefined&&input.expectedConfigSha256===undefined&&
  input.transaction===undefined,'DATASET_RECOVERY_READ_USES_ORIGINAL_SELECTION');
 if(command==='recover-lost-output')need(HASH.test(input.transaction??'')&&
  HASH.test(input.expectedRequestSha256??''),'DATASET_RECOVERY_TRANSACTION_AND_DIGEST_REQUIRED');
 else need(input.rpcEndpoint===undefined&&input.rpcProxyEnv===undefined&&input.transaction===undefined,
  'DATASET_RECOVERY_RPC_OPTIONS_ONLY_FOR_FINALIZATION');
 if(input.rpcEndpoint!==undefined)need(typeof input.rpcEndpoint==='string'&&
  input.rpcEndpoint.length<=2048,'DATASET_RECOVERY_RPC_ENDPOINT_INVALID');
 if(input.rpcProxyEnv!==undefined)need(typeof input.rpcProxyEnv==='string'&&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.rpcProxyEnv),'DATASET_RECOVERY_RPC_PROXY_ENV_INVALID');
 need(command==='export-lost-output'||input.destination===undefined,'DATASET_RECOVERY_DESTINATION_ONLY_FOR_EXPORT');
 const request={pageIndex,workspaceDirectory:optionalPath(input.workspaceDirectory),approvedRequest,
  approvedRequestFileSha256,expectedRequestSha256:input.expectedRequestSha256??null,
  expectedAttemptSha256:input.expectedAttemptSha256??null,expectedConfigSha256:input.expectedConfigSha256??null,
  transaction:input.transaction??null,rpcEndpoint:input.rpcEndpoint??null,rpcProxyEnv:input.rpcProxyEnv??null,
  destination:optionalPath(input.destination)};
 need(jsonBytes(request).length<=60000,'DATASET_RECOVERY_REQUEST_LIMIT');
 return {operationId:intent(input.operationId??randomUUID()),request,signal};
}
function validateRequest(command,request){
 need(object(request)&&COMMANDS.has(command)&&
  Number.isSafeInteger(request.pageIndex)&&request.pageIndex>=1&&request.pageIndex<=10000,
 'DATASET_RECOVERY_COMMAND_CHANGED');
 // Reconstruct the normalized public request without reopening an external input file.
 const names=['pageIndex','workspaceDirectory','approvedRequest','approvedRequestFileSha256',
  'expectedRequestSha256','expectedAttemptSha256','expectedConfigSha256','transaction',
  'rpcEndpoint','rpcProxyEnv','destination'];
 need(Object.keys(request).length===names.length&&names.every(name=>Object.hasOwn(request,name)),
  'DATASET_RECOVERY_COMMAND_CHANGED');
 for(const key of ['workspaceDirectory','destination'])if(request[key]!==null)absolute(request[key]);
 for(const key of ['approvedRequestFileSha256','expectedRequestSha256','expectedAttemptSha256','expectedConfigSha256','transaction'])
  need(request[key]===null||HASH.test(request[key]),'DATASET_RECOVERY_COMMAND_CHANGED');
 need(request.approvedRequest===null||object(request.approvedRequest),'DATASET_RECOVERY_COMMAND_CHANGED');
 if(command==='inspect-lost-output'||command==='recover-lost-output')
  need(object(request.approvedRequest),'DATASET_RECOVERY_COMMAND_CHANGED');
 else need(request.approvedRequest===null&&request.approvedRequestFileSha256===null&&
  request.expectedRequestSha256===null&&request.expectedAttemptSha256===null&&request.expectedConfigSha256===null&&
  request.transaction===null,'DATASET_RECOVERY_COMMAND_CHANGED');
 if(command==='recover-lost-output')need(HASH.test(request.transaction??'')&&
  HASH.test(request.expectedRequestSha256??''),'DATASET_RECOVERY_COMMAND_CHANGED');
 else need(request.rpcEndpoint===null&&request.rpcProxyEnv===null&&request.transaction===null,'DATASET_RECOVERY_COMMAND_CHANGED');
 need(command==='export-lost-output'||request.destination===null,'DATASET_RECOVERY_COMMAND_CHANGED');
 need(request.rpcEndpoint===null||typeof request.rpcEndpoint==='string'&&request.rpcEndpoint.length<=2048,
  'DATASET_RECOVERY_COMMAND_CHANGED');
 need(request.rpcProxyEnv===null||typeof request.rpcProxyEnv==='string'&&
  /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(request.rpcProxyEnv),'DATASET_RECOVERY_COMMAND_CHANGED');
 return request;
}
async function identity(target){
 const native=await target._accountingIdentity();
 return {...native,runtimeDirectory:absolute(target.buyer.runtime.directory)};
}
function validateContext(value,selectedIdentity,directory){
 need(object(value)&&value.schema===SCHEMA&&value.commandDirectory===directory&&
  value.commandId===basename(directory)&&NAME.test(value.commandId)&&
  value.commandId===commandName(value.operationId)&&equal(value.identity,selectedIdentity)&&
  COMMANDS.has(value.command)&&Number.isFinite(Date.parse(value.startedAt))&&
  Number.isSafeInteger(value.reportLimit)&&value.reportLimit>=1048576&&value.reportLimit<=268435456,
 'DATASET_RECOVERY_COMMAND_BINDING_CHANGED');
 validateRequest(value.command,value.request);return value;
}
function sameSelection(value,request,identity){
 need(object(value)&&value.sourceKind==='dataset'&&value.sessionDirectory===identity.sessionDirectory&&
  value.pageIndex===request.pageIndex&&value.sessionConfigurationSha256===identity.configurationSha256&&
  (identity.workspace===null||value.workspace===identity.workspace)&&
  (request.workspaceDirectory===null||value.workspace===request.workspaceDirectory)&&
  typeof value.intentId==='string'&&HASH.test(value.attemptId??'')&&HASH.test(value.configSha256??'')&&
  object(value.sourceHashes)&&value.sourceHashes.attempt===value.attemptId&&
  value.sourceHashes.configuration===value.configSha256,'DATASET_RECOVERY_NATIVE_BINDING_CHANGED');
 const requestSha=value.requestSha256??value.expectedRequestSha256;
 need(HASH.test(requestSha??'')&&
  (request.expectedRequestSha256===null||requestSha===request.expectedRequestSha256)&&
  (request.expectedAttemptSha256===null||value.attemptId===request.expectedAttemptSha256)&&
  (request.expectedConfigSha256===null||value.configSha256===request.expectedConfigSha256)&&
  (request.transaction===null||value.transaction===request.transaction),
 'DATASET_RECOVERY_NATIVE_BINDING_CHANGED');
}
function proofMetadata(value,context){
 const {identity,request}=context;
 need(object(value)&&typeof value.path==='string'&&
  Number.isSafeInteger(value.bytes)&&value.bytes>=1&&value.bytes<=MAX_PROOF&&HASH.test(value.sha256??''),
 'DATASET_RECOVERY_PROOF_METADATA_INVALID');
 const expected=request.destination??join(identity.sessionDirectory,'pages',
  String(request.pageIndex).padStart(6,'0'),'lost-output','transfer.json');
 need(value.path===expected,'DATASET_RECOVERY_PROOF_PATH_CHANGED');
 const proof=value.proof;
 need(object(proof)&&proof.schema===PROOF&&proof.sourceKind==='dataset'&&
  proof.sessionDirectory===identity.sessionDirectory&&proof.pageIndex===request.pageIndex&&
  proof.sessionConfigurationSha256===identity.configurationSha256&&
  proof.origin==='ORIGINAL_SF43_VERIFIED_TRANSFER_RECOVERY'&&
  proof.proof==='RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH'&&proof.reservation==='ORIGINAL_SF36_FINALIZED'&&
  HASH.test(proof.requestSha256??'')&&HASH.test(proof.transaction??'')&&
  (request.expectedRequestSha256===null||proof.requestSha256===request.expectedRequestSha256)&&
  (request.transaction===null||proof.transaction===request.transaction)&&
  HASH.test(proof.sealedRecoverySha256??'')&&object(proof.sourceHashes)&&
  proof.sourceHashes.attempt===proof.attemptId&&proof.sourceHashes.configuration===proof.configSha256,
 'DATASET_RECOVERY_PROOF_BINDING_CHANGED');
 return value;
}
function checkedOutput(context,output){
 need(output?.schema===ENVELOPE&&output.id===context.identity.id&&output.command===context.command&&
  output.result?.schema===RESULT&&output.result.command===context.command&&
  output.result.commandContextSha256===digest(jsonBytes(context))&&
  output.result.pageIndex===context.request.pageIndex&&
  output.result.sessionDirectory===context.identity.sessionDirectory&&
  output.result.sessionId===context.identity.sessionId&&
  output.result.configurationSha256===context.identity.configurationSha256,
 'DATASET_RECOVERY_NATIVE_RESULT_CHANGED');
 const value=output.result.value;
 if(context.command==='read-lost-output'&&value===null)return output.result;
 if(context.command==='export-lost-output')proofMetadata(value,context);
 else{
  sameSelection(value,context.request,context.identity);
  need(value.schema===(context.command==='inspect-lost-output'?
   'stellar-forge.sf88.dataset-lost-output-attempt.v1':'stellar-forge.sf88.dataset-lost-output-finalization.v1'),
  'DATASET_RECOVERY_NATIVE_RESULT_CHANGED');
  if(context.command==='recover-lost-output')proofMetadata(value.transfer,context);
 }
 return output.result;
}
async function readAttempt(context,name){
 need(ATTEMPT.test(name),'DATASET_RECOVERY_ATTEMPT_ID_INVALID');
 const directory=join(context.commandDirectory,name);
 await privateDirectory(directory,{create:false});
 const attempt=await readJson(join(directory,'attempt.json'));
 need(attempt.schema===SCHEMA&&attempt.commandContextSha256===digest(jsonBytes(context))&&
  attempt.attemptDirectory===directory&&attempt.attemptId===name&&Number.isFinite(Date.parse(attempt.startedAt)),
 'DATASET_RECOVERY_ATTEMPT_CHANGED');
 let process=unknownProcess(),output=null,status='NO_COMPLETE_OUTPUT';
 if(await exists(join(directory,'completion.json'))){
  const completed=await readJson(join(directory,'completion.json'));
  need(completed.schema===SCHEMA&&completed.commandContextSha256===digest(jsonBytes(context))&&
   completed.attemptId===name&&object(completed.process),'DATASET_RECOVERY_COMPLETION_CHANGED');
  process=completed.process;
 }
 try{
  output=await readJson(join(directory,'result.json'),context.reportLimit);
  checkedOutput(context,output);status=process.exitCode===0&&!process.errorCode?'RECORDED':'OUTPUT_RECOVERED';
 }catch(error){
  if(!['ENOENT','JSON_INVALID','JSON_OBJECT_REQUIRED','FILE_SIZE_OR_TYPE_INVALID'].includes(error.code))throw error;
 }
 return {attemptId:name,attemptDirectory:directory,startedAt:attempt.startedAt,status,process,output};
}
async function attemptNames(context){
 return (await readdir(context.commandDirectory,{withFileTypes:true})).filter(row=>row.isDirectory()&&
  ATTEMPT.test(row.name)).map(row=>row.name).sort();
}
async function latestResult(context){
 let latest=null,lastComplete=null,total=0;
 const names=await attemptNames(context);
 for(const name of names){
  if(!await exists(join(context.commandDirectory,name,'attempt.json')))continue;
  const row=await readAttempt(context,name);total++;
  if(!latest||row.startedAt>latest.startedAt||row.startedAt===latest.startedAt&&row.attemptId>latest.attemptId)latest=row;
  if(row.output&&(!lastComplete||row.startedAt>lastComplete.startedAt||
   row.startedAt===lastComplete.startedAt&&row.attemptId>lastComplete.attemptId))lastComplete=row;
 }
 return {latest,lastComplete,total};
}
function receipt(context,attempt,{reused=false,viewStatus='SAVED'}={}){
 const result=checkedOutput(context,attempt.output);
 return freeze({commandId:context.commandId,operationId:context.operationId,command:context.command,
  commandDirectory:context.commandDirectory,commandContextSha256:digest(jsonBytes(context)),
  attemptId:attempt.attemptId,startedAt:context.startedAt,process:clone(attempt.process),
  native:clone(result.value),reused,viewStatus});
}
async function completedFilesAvailable(context,attempt){
 const value=checkedOutput(context,attempt.output).value;
 const metadata=context.command==='recover-lost-output'?value.transfer:
  context.command==='export-lost-output'?value:null;
 if(metadata===null)return true;
 proofMetadata(metadata,context);
 let bytes;
 try{bytes=await readBytes(metadata.path,MAX_PROOF);}
 catch(error){if(error.code==='ENOENT')return false;throw error;}
 need(bytes.length===metadata.bytes&&digest(bytes)===metadata.sha256,'DATASET_RECOVERY_PROOF_FILE_CHANGED');
 return true;
}
async function contextFor(target,commandId){
 need(NAME.test(commandId),'DATASET_RECOVERY_COMMAND_ID_INVALID');
 const selected=await identity(target),directory=join(target.directory,'commands',commandId);
 await privateDirectory(directory,{create:false});
 return validateContext(await readJson(join(directory,'context.json'),131072),selected,directory);
}
async function createCommand(target,command,input){
 const selected=await options(command,input),selectedIdentity=await identity(target);
 const parent=await privateDirectory(join(target.directory,'commands'));
 const id=commandName(selected.operationId),directory=join(parent,id);
 await privateDirectory(directory);
 const proposed={schema:SCHEMA,identity:selectedIdentity,command,operationId:selected.operationId,
  commandId:id,commandDirectory:directory,startedAt:now(),request:selected.request,
  reportLimit:target.buyer.datasetReportLimit};
 const path=join(directory,'context.json');
 if(!await exists(path)){
  try{await writeJson(path,proposed,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;}
 }
 const retained=validateContext(await readJson(path,131072),selectedIdentity,directory);
 need(retained.command===proposed.command&&equal(retained.request,proposed.request)&&
  retained.reportLimit===proposed.reportLimit,'DATASET_RECOVERY_OPERATION_ID_REUSED');
 await exactJson(join(directory,'request.json'),{...retained.request,reportLimit:retained.reportLimit,
  recoveryCommandId:retained.commandId,commandContextSha256:digest(jsonBytes(retained))});
 await syncDirectory(parent);
 return {context:retained,signal:selected.signal};
}
async function runCommand(target,context,signal){
 checkedSignal(signal);
 need(equal(context.identity,await identity(target)),'DATASET_RECOVERY_APPLICATION_BINDING_CHANGED');
 const previous=await latestResult(context);
 if(previous.lastComplete&&await completedFilesAvailable(context,previous.lastComplete))
  return receipt(context,previous.lastComplete,{reused:true,viewStatus:'RETAINED_NATIVE_OUTPUT'});
 const requestPath=join(context.commandDirectory,'request.json');
 await exactJson(requestPath,{...context.request,reportLimit:context.reportLimit,
  recoveryCommandId:context.commandId,commandContextSha256:digest(jsonBytes(context))});
 const directory=await mkdtemp(join(context.commandDirectory,'attempt-')),attemptId=basename(directory);
 const attempt={schema:SCHEMA,commandContextSha256:digest(jsonBytes(context)),
  attemptId,attemptDirectory:directory,startedAt:now()};
 await writeJson(join(directory,'attempt.json'),attempt,{exclusive:true});await syncDirectory(context.commandDirectory);
 let run;
 try{
  run=await target.buyer.runtime.run([target.buyer.runtime.directory,target.directory,context.command,
   requestPath,join(directory,'result.json')],{directory,signal,entryFile:WORKER,
   resultFile:join(directory,'result.json'),resultLimit:context.reportLimit});
 }catch(error){run={output:null,exitCode:null,exitSignal:null,errorCode:safeCode(error.code,'DATASET_RECOVERY_PROCESS_UNAVAILABLE')};}
 const process=processView(run);
 let saved=null;
 try{saved=await readAttempt(context,attemptId);}catch(error){process.errorCode=safeCode(error.code,'DATASET_RECOVERY_RESULT_INVALID');}
 let viewStatus='SAVED';
 try{await writeJson(join(directory,'completion.json'),{schema:SCHEMA,
  commandContextSha256:digest(jsonBytes(context)),attemptId,completedAt:now(),process},{exclusive:true});}
 catch{viewStatus='SAVE_FAILED';}
 if(!saved?.output)throw new BuyerError(process.errorCode??'DATASET_RECOVERY_NATIVE_RESULT_UNAVAILABLE',
  {dataset:target,commandId:context.commandId,operationId:context.operationId,
   commandDirectory:context.commandDirectory,attemptId,exitCode:process.exitCode});
 saved.process=process;
 return receipt(context,saved,{viewStatus});
}
/** Exact application command first, then the original native recovery worker. */
export async function runLostOutput(target,command,input={}){
 const {context,signal}=await createCommand(target,command,input);
 const result=await runCommand(target,context,signal);target.lastLostOutput=result;return result;
}
/** Read retained native responses without starting a process or observing the chain. */
export async function recoverLostOutputCommand(target,{commandId,operationId}={}){
 need((commandId!==undefined)!==(operationId!==undefined),'DATASET_RECOVERY_ONE_COMMAND_ID_REQUIRED');
 const context=await contextFor(target,commandId??commandName(operationId));
 const saved=await latestResult(context),lastComplete=saved.lastComplete?
  receipt(context,saved.lastComplete,{reused:true,viewStatus:'RETAINED_NATIVE_OUTPUT'}):null;
 return freeze({commandId:context.commandId,operationId:context.operationId,command:context.command,
  commandDirectory:context.commandDirectory,startedAt:context.startedAt,pageIndex:context.request.pageIndex,
  attempts:saved.total,status:lastComplete?'OUTPUT_RECOVERED':'NO_COMPLETE_OUTPUT',
  latestAttempt:saved.latest?{attemptId:saved.latest.attemptId,startedAt:saved.latest.startedAt,
   status:saved.latest.status,process:saved.latest.process}:null,lastComplete});
}
/** Continue the same frozen native command; it cannot select another payment. */
export async function resumeLostOutputCommand(target,{commandId,operationId,signal}={}){
 need((commandId!==undefined)!==(operationId!==undefined),'DATASET_RECOVERY_ONE_COMMAND_ID_REQUIRED');
 const context=await contextFor(target,commandId??commandName(operationId));
 const result=await runCommand(target,context,checkedSignal(signal));target.lastLostOutput=result;return result;
}
export async function listLostOutputCommands(target,{after,limit=50}={}){
 need(after===undefined||NAME.test(after),'DATASET_RECOVERY_CURSOR_INVALID');
 need(Number.isSafeInteger(limit)&&limit>=1&&limit<=250,'DATASET_RECOVERY_RANGE_INVALID');
 await target._metadata();const parent=join(target.directory,'commands');
 if(!await exists(parent))return {commands:[],nextAfter:null};
 await privateDirectory(parent,{create:false});
 const names=(await readdir(parent,{withFileTypes:true})).filter(row=>row.isDirectory()&&NAME.test(row.name)&&
  (after===undefined||row.name>after)).map(row=>row.name).sort();
 const commands=[];
 for(const name of names.slice(0,limit)){
  if(!await exists(join(parent,name,'context.json')))continue;
  const context=await contextFor(target,name);
  commands.push({commandId:name,operationId:context.operationId,command:context.command,
   pageIndex:context.request.pageIndex,startedAt:context.startedAt});
 }
 return freeze({commands,nextAfter:names.length>limit?names[limit-1]:null});
}
export class DatasetRecoveryProof extends VerifiedFile{
 constructor(metadata,context){
  super();proofMetadata(metadata,context);
  this.metadata=freeze(clone(metadata));this.context=freeze(clone(context));
 }
 _metadata(){proofMetadata(this.metadata,this.context);return this.metadata;}
}
export function recoveryProofFile(result){
 need(result&&object(result.native),'DATASET_RECOVERY_PROOF_REQUIRED');
 const metadata=result.command==='export-lost-output'?result.native:result.native.transfer;
 need(metadata,'DATASET_RECOVERY_PROOF_REQUIRED');
 const proof=metadata.proof;
 const context={identity:{sessionDirectory:proof.sessionDirectory,
  configurationSha256:proof.sessionConfigurationSha256},
  request:{pageIndex:proof.pageIndex,destination:metadata.path,
   expectedRequestSha256:proof.requestSha256,transaction:proof.transaction}};
 return new DatasetRecoveryProof(metadata,context);
}

/** Called only by the fixed original Dataset application worker. Its lifetime
 * lock survives loss of the calling application while native work completes. */
export async function executeLostOutputCommand({runtime,entry,metadata,binding,request,requestPath,
 resultPath,command,signal}){
 need(COMMANDS.has(command)&&binding,'DATASET_INITIALIZE_OR_ATTACH_REQUIRED');
 const commandDirectory=dirname(requestPath);
 need(commandDirectory===join(entry,'commands',request.recoveryCommandId)&&NAME.test(request.recoveryCommandId),
  'DATASET_RECOVERY_COMMAND_PATH_CHANGED');
 await privateDirectory(commandDirectory,{create:false});
 const selectedIdentity={kind:'dataset',id:metadata.id,entryDirectory:entry,
  sessionDirectory:metadata.sessionDirectory,sessionId:binding.sessionId,
  configurationSha256:binding.configurationSha256,workspace:binding.workspaceDirectory,
  runtimeDirectory:runtime};
 const context=validateContext(await readJson(join(commandDirectory,'context.json'),131072),selectedIdentity,commandDirectory);
 need(context.command===command&&digest(jsonBytes(context))===request.commandContextSha256&&
  equal(request,{...context.request,reportLimit:context.reportLimit,recoveryCommandId:context.commandId,
   commandContextSha256:digest(jsonBytes(context))}),'DATASET_RECOVERY_RETAINED_REQUEST_CHANGED');
 const attemptDirectory=dirname(resultPath),name=basename(attemptDirectory);
 need(dirname(attemptDirectory)===commandDirectory&&ATTEMPT.test(name)&&
  resultPath===join(attemptDirectory,'result.json'),'DATASET_RECOVERY_RESULT_PATH_CHANGED');
 const active=await readAttempt(context,name);
 need(active.output===null,'DATASET_RECOVERY_RESULT_ALREADY_SAVED');
 let lease;
 try{lease=await acquireStateLease(commandDirectory);}catch(error){throw new BuyerError(
  error.message==='FLEET_STATE_ALREADY_OWNED'?'DATASET_RECOVERY_COMMAND_ACTIVE':safeCode(error.message,'DATASET_RECOVERY_LEASE_FAILED'));}
 const retain=async result=>{
  const bytes=jsonBytes({schema:ENVELOPE,id:metadata.id,command,result});
  need(bytes.length<=context.reportLimit,'DATASET_REPORT_LIMIT_EXCEEDED');
  await writeBytes(resultPath,bytes,{exclusive:true});return result;
 };
 try{
  lease.assertHeld();checkedSignal(signal);
  const saved=await latestResult(context);
  if(saved.lastComplete&&await completedFilesAvailable(context,saved.lastComplete))
   return await retain(checkedOutput(context,saved.lastComplete.output));
  const api=await import(pathToFileURL(join(runtime,'dataset-session.mjs')).href);
  const raw=await readJson(join(metadata.sessionDirectory,'session.json'),262144);
  const definition=api.validateDatasetDefinition(raw,metadata.sessionDirectory);
  const {canonical}=await import(pathToFileURL(join(runtime,'dataset-page.mjs')).href);
  need(definition.configurationSha256===binding.configurationSha256&&
   definition.config.operation.intentId===binding.sessionId&&
   definition.expectedSnapshot===binding.expectedSnapshot&&canonical(definition.limits)===canonical(binding.limits)&&
   (definition.workspaceDirectory??null)===binding.workspaceDirectory,'DATASET_APPLICATION_BINDING_CHANGED');
  const original=await import(pathToFileURL(join(runtime,'dataset-lost-output.mjs')).href);
  const selected=context.request;
  const opts={directory:metadata.sessionDirectory,index:selected.pageIndex,
   ...(selected.workspaceDirectory===null?{}:{workspace:selected.workspaceDirectory}),
   ...(selected.approvedRequest===null?{}:{approvedRequest:selected.approvedRequest}),
   ...(selected.expectedRequestSha256===null?{}:{expectedRequestSha256:selected.expectedRequestSha256}),
   ...(selected.expectedAttemptSha256===null?{}:{expectedAttemptSha256:selected.expectedAttemptSha256}),
   ...(selected.expectedConfigSha256===null?{}:{expectedConfigSha256:selected.expectedConfigSha256}),
   ...(selected.transaction===null?{}:{transaction:selected.transaction}),
   ...(selected.rpcEndpoint===null?{}:{rpcEndpoint:selected.rpcEndpoint}),
   ...(selected.rpcProxyEnv===null?{}:{rpcProxyEnv:selected.rpcProxyEnv}),
   node:process.execPath,environment:process.env,signal};
  let value;
  if(command==='inspect-lost-output')value=await original.inspectDatasetLostOutput(opts);
  else if(command==='recover-lost-output')value=await original.recoverDatasetLostOutput(opts);
  else if(command==='read-lost-output')value=await original.readDatasetLostOutputRecovery(opts);
  else value=await original.exportDatasetLostOutputProof({...opts,
   ...(selected.destination===null?{}:{output:selected.destination})});
  const result={schema:RESULT,command,commandContextSha256:digest(jsonBytes(context)),
   pageIndex:selected.pageIndex,sessionDirectory:metadata.sessionDirectory,sessionId:binding.sessionId,
   configurationSha256:binding.configurationSha256,value};
  checkedOutput(context,{schema:ENVELOPE,id:metadata.id,command,result});
  return await retain(result);
 }finally{await lease.close();}
}

/** A complete retained command report; the native response is kept verbatim. */
export async function exportLostOutputReport(target,destination,selection={}){
 destination=absolute(destination);
 const {commandId,operationId}=selection;
 need((commandId!==undefined)!==(operationId!==undefined),'DATASET_RECOVERY_ONE_COMMAND_ID_REQUIRED');
 const context=await contextFor(target,commandId??commandName(operationId)),attemptRecords=[];
 // Freeze the named attempt set once. Derive every report summary from those
 // exact original records, including complete outputs whose parent reply was lost.
 const names=await attemptNames(context);
 for(const name of names){
  if(!await exists(join(context.commandDirectory,name,'attempt.json')))continue;
  const row=await readAttempt(context,name);
  attemptRecords.push({attemptId:row.attemptId,startedAt:row.startedAt,
   status:row.status,process:row.process,native:row.output?checkedOutput(context,row.output).value:null,
   outputPresent:row.output!==null});
 }
 attemptRecords.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.attemptId.localeCompare(b.attemptId));
 const last=attemptRecords.filter(row=>row.outputPresent).at(-1)??null;
 const report={schema:'stellar-forge.node-dataset-recovery-report.v1',
  commandId:context.commandId,operationId:context.operationId,command:context.command,
  startedAt:context.startedAt,commandContextSha256:digest(jsonBytes(context)),
  dataset:{id:context.identity.id,sessionId:context.identity.sessionId,
   configurationSha256:context.identity.configurationSha256,sessionDirectory:context.identity.sessionDirectory},
  pageIndex:context.request.pageIndex,status:last?'OUTPUT_RECOVERED':'NO_COMPLETE_OUTPUT',
  attempts:attemptRecords,lastComplete:last?.native??null};
 const bytes=jsonBytes(report);need(bytes.length<=268435456,'DATASET_RECOVERY_REPORT_LIMIT');
 await privateDirectory(dirname(destination),{create:false});await exactJson(destination,report);
 return new DatasetRecoveryDocument({path:destination,bytes:bytes.length,sha256:digest(bytes),
  commandId:context.commandId,format:'json',scope:'COMPLETE_ORIGINAL_RECOVERY_COMMAND'});
}
class DatasetRecoveryDocument extends VerifiedFile{
 constructor(metadata){super();this.metadata=freeze(clone(metadata));}
 _metadata(){
  const value=this.metadata;absolute(value.path);
  need(Number.isSafeInteger(value.bytes)&&value.bytes>=1&&value.bytes<=268435456&&HASH.test(value.sha256??''),
   'DATASET_RECOVERY_REPORT_METADATA_INVALID');return value;
 }
}
