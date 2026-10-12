// MIT. Durable accounting for one original Node Buyer operation.
import {mkdtemp,readdir,lstat,realpath,readFile,readlink,stat} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {absolute,privateDirectory,digest,now,intent,object,need,BuyerError,
  jsonBytes,parseJson,readBytes,readJson,writeBytes,writeJson,exists,syncDirectory,safeCode} from './store.mjs';

export const OPERATION_ACCOUNTING_COMMAND='stellar-forge.node-operation-accounting-command.v1';
export const OPERATION_ACCOUNTING_NATIVE='stellar-forge.node-operation-accounting-native.v1';
const VIEW='stellar-forge.node-operation-accounting-view.v1';
const EXPORT='stellar-forge.node-operation-accounting-export.v1';
const NODE='stellar-forge.node-buyer.v1';
const HASH=/^[a-f0-9]{64}$/;
const COMMAND=/^finalize-[A-Za-z0-9]{6}$/;
const WORKER=fileURLToPath(new URL('./operation-accounting-worker.mjs',import.meta.url));
const ADAPTER=fileURLToPath(import.meta.url);
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const LIMIT=4_194_304;
export const sameAccountingValue=isDeepStrictEqual;
const copy=value=>parseJson(jsonBytes(value));
const checkSignal=signal=>{
  need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted,'OPERATION_ABORTED_BEFORE_START');
};
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const frozen=value=>{
  if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}
  return value;
};

export async function accountingPrivateDirectory(path,{create=false}={}){
  const selected=absolute(path);
  need(selected===path,'ACCOUNTING_CANONICAL_PATH_REQUIRED');
  await privateDirectory(selected,{create});
  need(await realpath(selected)===selected,'ACCOUNTING_CANONICAL_PATH_REQUIRED');
  return selected;
}

export async function accountingPrivateFile(path,limit=65536){
  need(absolute(path)===path,'ACCOUNTING_CANONICAL_PATH_REQUIRED');
  await accountingPrivateDirectory(dirname(path));
  const before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink()&&(before.mode&0o077)===0&&
    (!process.getuid||before.uid===process.getuid()),'ACCOUNTING_PRIVATE_FILE_REQUIRED');
  const raw=await readBytes(path,limit),after=await lstat(path);
  need(after.isFile()&&!after.isSymbolicLink()&&before.dev===after.dev&&before.ino===after.ino&&
    before.size===after.size&&raw.length===after.size&&before.mtimeMs===after.mtimeMs&&
    before.ctimeMs===after.ctimeMs,'ACCOUNTING_SOURCE_CHANGED_DURING_READ');
  return{raw,descriptor:{path,bytes:raw.length,sha256:digest(raw)}};
}

async function codeFile(path){
  need(absolute(path)===path&&await realpath(path)===path,'ACCOUNTING_SOURCE_PATH_INVALID');
  const info=await lstat(path);
  need(info.isFile()&&(info.mode&0o022)===0,'ACCOUNTING_SOURCE_FILE_INVALID');
  const raw=await readBytes(path,16_777_216);
  return{path,bytes:raw.length,sha256:digest(raw)};
}

function recordedEnd(attempt){
  return ['RECORDED','NATIVE_RESULT_UNAVAILABLE'].includes(attempt.state)&&
    validTime(attempt.endedAt)&&Object.hasOwn(attempt,'exitCode')&&
    (attempt.exitCode===null||Number.isInteger(attempt.exitCode));
}

// Read the original captured identity. This never sends a signal or substitutes
// a current PID for the captured process. Completed native exits remain usable
// when a later container cannot inspect the producer's procfs namespace.
export async function accountingProducerState(attempt){
  const id=attempt.processIdentity;
  let observation={state:'UNKNOWN',basis:'ORIGINAL_PROCESS_IDENTITY_UNAVAILABLE'};
  if(id?.schema==='stellar-forge.node-process-identity.v1'&&id.status==='RECORDED'&&
      Number.isSafeInteger(id.procPid)&&id.procPid>0&&/^[0-9]+$/.test(id.startTicks??'')&&
      /^pid:\[[0-9]+\]$/.test(id.namespace??'')&&typeof id.bootId==='string'&&
      typeof id.procfsDevice==='string'){
    let inspected=false;
    try{
      const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
      if(boot!==id.bootId)observation={state:'ENDED',basis:'ORIGINAL_BOOT_ENDED'};
      else if((await stat('/proc',{bigint:true})).dev.toString()===id.procfsDevice){
        inspected=true;
        const readStat=async()=>{
          const raw=await readFile('/proc/'+id.procPid+'/stat','utf8');
          const close=raw.lastIndexOf(')'),fields=raw.slice(close+2).trim().split(/\s+/);
          need(close>0&&fields.length>=20,'ACCOUNTING_PROCESS_STAT_INVALID');
          return{state:fields[0],startTicks:fields[19]};
        };
        const first=await readStat();
        if(first.startTicks!==id.startTicks)observation={state:'ENDED',basis:'ORIGINAL_PROCESS_REPLACED'};
        else if(['Z','X'].includes(first.state))observation={state:'ENDED',basis:'ORIGINAL_PROCESS_EXITED'};
        else{
          const namespace=await readlink('/proc/'+id.procPid+'/ns/pid'),last=await readStat();
          if(last.startTicks!==id.startTicks||namespace!==id.namespace)
            observation={state:'ENDED',basis:'ORIGINAL_PROCESS_REPLACED'};
          else observation={state:['Z','X'].includes(last.state)?'ENDED':'LIVE',basis:'CAPTURED_PROCESS_IDENTITY'};
        }
      }
    }catch(error){
      if(inspected&&['ENOENT','ESRCH'].includes(error.code))observation={state:'ENDED',basis:'ORIGINAL_PROCESS_ABSENT'};
      else observation={state:'UNKNOWN',basis:safeCode(error.code,'ORIGINAL_PROCESS_NOT_OBSERVED')};
    }
  }
  if(observation.state==='UNKNOWN'&&recordedEnd(attempt))
    observation={state:'ENDED',basis:'ORIGINAL_NATIVE_EXIT_RECORDED'};
  return observation;
}

/** Reuse the original Operation binding, including its selected preapproval
 * chain. This projection creates no financial record and loads no keys. */
export async function readOperationAccountingSource(operation,{evidence=true,requireEnded=false,signal}={}){
  checkSignal(signal);
  const {meta,config}=await operation._bound();
  await accountingPrivateDirectory(operation.buyer.stateDirectory);
  await accountingPrivateDirectory(operation.directory);
  need(operation.directory===join(operation.buyer.stateDirectory,digest(operation.intentId))&&
    operation.configPath===join(operation.directory,'config.json'),'ACCOUNTING_OPERATION_PATH_CHANGED');
  need(meta.schema===NODE&&meta.state==='PREPARED'&&meta.intentId===operation.intentId&&
    absolute(meta.runtimeDirectory)===meta.runtimeDirectory,'ACCOUNTING_ORIGINAL_OPERATION_REQUIRED');
  let attemptDirectory=operation.directory,preapproval=null;
  if(await exists(join(operation.directory,'preapproval-continuation.json'))){
    preapproval=await operation.readPreapprovalRecovery();
    need(preapproval.pending===null&&preapproval.history.length>0,
      'ACCOUNTING_PREAPPROVAL_ATTEMPT_REQUIRED');
    attemptDirectory=await accountingPrivateDirectory(preapproval.directory);
  }
  const files={};
  for(const [name,path,limit] of [
    ['operation',join(operation.directory,'operation.json'),262144],
    ['configuration',operation.configPath,65536],
    ['attempt',join(attemptDirectory,'attempt.json'),65536],
  ])files[name]=await accountingPrivateFile(path,limit);
  const attempt=parseJson(files.attempt.raw);
  need(sameAccountingValue(meta,parseJson(files.operation.raw))&&
    sameAccountingValue(config,parseJson(files.configuration.raw))&&
    files.configuration.descriptor.sha256===meta.configSha256&&
    attempt.schema===NODE&&attempt.intentId===operation.intentId&&attempt.kind===undefined&&
    attempt.configSha256===meta.configSha256&&attempt.bodySha256===meta.bodySha256&&
    validTime(attempt.createdAt)&&
    ['STARTING','STARTED','RECORDED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(attempt.state),
    'ACCOUNTING_ORIGINAL_ATTEMPT_REQUIRED');
  const bodyPresent=config.operation.bodyFile!==undefined;
  let body=Buffer.alloc(0),bodyFile=null,ticketFile=null;
  if(bodyPresent){
    need(config.operation.bodyFile===join(operation.directory,'request.body'),
      'ACCOUNTING_REQUEST_BODY_PATH_CHANGED');
    const reader=await operation.buyer._requestFiles();
    bodyFile=await accountingPrivateFile(config.operation.bodyFile,reader.MAX_REQUEST_BODY_BYTES);
    body=bodyFile.raw;
  }
  need(digest(body)===meta.bodySha256,'ACCOUNTING_REQUEST_BODY_CHANGED');
  if(config.operation.ticketFile!==undefined){
    need(config.operation.ticketFile===join(operation.directory,'operation-ticket.json'),
      'ACCOUNTING_TICKET_PATH_CHANGED');
    ticketFile=await accountingPrivateFile(config.operation.ticketFile,16384);
  }
  need((ticketFile?.descriptor.sha256??null)===(meta.ticketSha256??null),'ACCOUNTING_TICKET_CHANGED');
  let commandSha256=null;
  if(attempt.nativeCommand!==undefined){
    need(object(attempt.nativeCommand)&&Array.isArray(attempt.nativeCommand.command)&&
      attempt.nativeCommand.command.every(v=>typeof v==='string')&&
      digest(jsonBytes(attempt.nativeCommand.command))===attempt.nativeCommand.commandSha256,
      'ACCOUNTING_PRODUCING_COMMAND_CHANGED');
    commandSha256=attempt.nativeCommand.commandSha256;
  }
  const producer=await accountingProducerState(attempt);
  if(requireEnded)need(producer.state==='ENDED',
    producer.state==='LIVE'?'ACCOUNTING_PRODUCING_ATTEMPT_LIVE':'ACCOUNTING_PRODUCER_STATE_UNAVAILABLE');
  const nativeWorkspace=meta.nativeWorkspace??null;
  if(nativeWorkspace===null)
    need(config.evidenceDir===join(operation.directory,'evidence'),'ACCOUNTING_EVIDENCE_PATH_CHANGED');
  const evidencePath=join(await accountingPrivateDirectory(config.evidenceDir),digest(operation.intentId)+'.json');
  const retained=evidence?await accountingPrivateFile(evidencePath,LIMIT):null;
  const identity={
    intentId:operation.intentId,stateDirectory:operation.buyer.stateDirectory,
    operationDirectory:operation.directory,producerRuntimeDirectory:meta.runtimeDirectory,
    operationSha256:files.operation.descriptor.sha256,configurationSha256:meta.configSha256,
    bodyPresent,bodyBytes:body.length,bodySha256:meta.bodySha256,ticketSha256:meta.ticketSha256??null,
    attemptDirectory,attemptCreatedAt:attempt.createdAt,producingCommandSha256:commandSha256,
    nativeWorkspace,preapprovalHistorySha256:preapproval?digest(jsonBytes(preapproval.history)):null,
  };
  checkSignal(signal);
  return{identity,meta,config,attempt,body,producer,evidencePath,
    files:{...Object.fromEntries(Object.entries(files).map(([key,value])=>[key,value.descriptor])),
      body:bodyFile?.descriptor??null,ticket:ticketFile?.descriptor??null,
      evidence:retained?.descriptor??null},
    attemptRaw:files.attempt.raw,evidenceRaw:retained?.raw??null};
}

function finalizeOptions(options,source){
  need(object(options)&&Object.keys(options).every(key=>
    ['workspaceDirectory','outboxDirectory','merchantRoute','signal'].includes(key)),
    'ACCOUNTING_OPTIONS_INVALID');
  checkSignal(options.signal);
  const chosen=options.workspaceDirectory??source.identity.nativeWorkspace;
  need(chosen===null||typeof chosen==='string','ACCOUNTING_ORIGINAL_WORKSPACE_REQUIRED');
  const workspaceDirectory=chosen===null?null:absolute(chosen);
  need(chosen===workspaceDirectory&&
    (source.identity.nativeWorkspace===null||workspaceDirectory===source.identity.nativeWorkspace),
    'ACCOUNTING_ORIGINAL_WORKSPACE_CHANGED');
  need((options.outboxDirectory!==undefined)===(options.merchantRoute!==undefined),
    'OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER');
  if(options.merchantRoute!==undefined)need(typeof options.merchantRoute==='string'&&
    /^[A-Za-z0-9_-]{1,80}$/.test(options.merchantRoute),'ACCOUNTING_MERCHANT_ROUTE_INVALID');
  return{workspaceDirectory,outboxDirectory:options.outboxDirectory===undefined?null:absolute(options.outboxDirectory),
    merchantRoute:options.merchantRoute??null};
}

export function accountingOutput(context,output){
  need(output?.schema===OPERATION_ACCOUNTING_NATIVE&&
    output.contextSha256===digest(jsonBytes(context))&&
    sameAccountingValue(output.identity,context.identity)&&
    output.workspace===context.request.workspaceDirectory&&
    output.accountingRuntimeDirectory===context.execution.runtimeDirectory&&
    output.evidenceSha256===context.source.evidence.sha256&&
    output.attemptSnapshotSha256===context.source.attempt.sha256&&validTime(output.completedAt)&&
    sameAccountingValue(output.workspaceSource,context.workspaceSource),
    'ACCOUNTING_NATIVE_BINDING_CHANGED');
  if(output.kind==='PAID_FINALIZATION'){
    need(output.result?.schema==='stellar-forge.sf36.finalization.v1'&&
      ['FINALIZED','IDEMPOTENT_FINALIZED','NOT_FINALIZED','WORKER_ERROR'].includes(output.result.outcome)&&
      HASH.test(output.approvedRequestSha256??''),'ACCOUNTING_ORIGINAL_FINALITY_RESULT_REQUIRED');
    if(FINALIZED.has(output.result.outcome))need(output.result.request_id===context.identity.intentId&&
      output.result.request_sha256===output.approvedRequestSha256,'ACCOUNTING_FINALIZED_REQUEST_CHANGED');
  }else need(output.kind==='UNPAID_RESPONSE'&&output.result?.outcome==='NO_PAYMENT_REQUIRED'&&
    output.approvedRequestSha256===null,'ACCOUNTING_ORIGINAL_UNPAID_RESULT_REQUIRED');
  return copy(output);
}
function returned(context,output,process,extra={}){
  return{native:accountingOutput(context,output),commandId:context.commandId,
    commandDirectory:context.commandDirectory,startedAt:context.startedAt,process:copy(process),...extra};
}

async function commandSource(directory,context){
  const savedAttempt=await accountingPrivateFile(join(directory,'attempt-source.json'),65536);
  const savedEvidence=await accountingPrivateFile(join(directory,'evidence-source.json'),LIMIT);
  need(savedAttempt.descriptor.sha256===context.source.attempt.sha256&&
    savedEvidence.descriptor.sha256===context.source.evidence.sha256,'ACCOUNTING_ARCHIVED_SOURCE_CHANGED');
  return{attempt:savedAttempt,evidence:savedEvidence};
}

export async function finalizeOperationAccounting(operation,options={}){
  need(object(options),'ACCOUNTING_OPTIONS_INVALID');
  const source=await readOperationAccountingSource(operation,{requireEnded:true,signal:options.signal});
  const request=finalizeOptions(options,source);
  if(request.workspaceDirectory!==null)await accountingPrivateDirectory(request.workspaceDirectory);
  if(request.outboxDirectory!==null)await accountingPrivateDirectory(request.outboxDirectory);
  const workspaceSource=request.workspaceDirectory===null?null:{};
  if(workspaceSource)for(const [key,name] of [['configuration','operator.json'],['manifest','workspace.json']])
    workspaceSource[key]=(await accountingPrivateFile(join(request.workspaceDirectory,name))).descriptor;
  const runtime=operation.buyer.runtime;
  const execution={runtimeDirectory:absolute(runtime.directory),node:absolute(runtime.node),
    adapter:await codeFile(ADAPTER),worker:await codeFile(WORKER),originalSource:[]};
  need(await realpath(execution.runtimeDirectory)===execution.runtimeDirectory,
    'ACCOUNTING_RUNTIME_CANONICAL_PATH_REQUIRED');
  for(const name of ['config.mjs','workspace.mjs','finalization.mjs',
    '../sf36-spend-governor/finalize.py','../sf86-rpc-transfer-reconcile/cli.mjs',
    '../sf86-rpc-transfer-reconcile/terms.mjs'])
    execution.originalSource.push(await codeFile(absolute(join(execution.runtimeDirectory,name))));
  const parent=await accountingPrivateDirectory(join(operation.directory,'accounting'),{create:true});
  const directory=await mkdtemp(join(parent,'finalize-'));
  const context={schema:OPERATION_ACCOUNTING_COMMAND,commandId:basename(directory),
    commandDirectory:directory,startedAt:now(),identity:source.identity,
    source:source.files,request,workspaceSource,execution,
    resultLimit:Math.min(runtime.outputLimit,LIMIT)};
  need(context.resultLimit>=65536,'ACCOUNTING_RUNTIME_OUTPUT_LIMIT_TOO_SMALL');
  await writeBytes(join(directory,'attempt-source.json'),source.attemptRaw,{exclusive:true});
  await writeBytes(join(directory,'evidence-source.json'),source.evidenceRaw,{exclusive:true});
  await writeJson(join(directory,'context.json'),context,{exclusive:true});
  await syncDirectory(parent);
  const contextSha256=digest(jsonBytes(context));
  let run;
  try{
    run=await runtime.run(['--context',join(directory,'context.json'),'--context-sha256',contextSha256],{
      directory,entryFile:WORKER,signal:options.signal,
      beforeSpawn:async invocation=>writeJson(join(directory,'invocation.json'),invocation,{exclusive:true}),
      started:async(pid,processIdentity)=>writeJson(join(directory,'process.json'),
        {pid,processIdentity,startedAt:now()},{exclusive:true}),
    });
  }catch(error){
    run={output:null,exitCode:null,exitSignal:null,
      errorCode:safeCode(error.code,'ACCOUNTING_PROCESS_RESULT_UNAVAILABLE')};
  }
  const process={exitCode:run.exitCode,exitSignal:run.exitSignal,errorCode:run.errorCode};
  let result=null;
  try{if(run.output)result=returned(context,run.output,process);}
  catch(error){process.errorCode=safeCode(error.code,'ACCOUNTING_NATIVE_BINDING_CHANGED');}
  let viewStatus='SAVED';
  try{
    await writeJson(join(directory,'completion.json'),{schema:OPERATION_ACCOUNTING_COMMAND,
      contextSha256,completedAt:now(),process,output:result?run.output:null},{exclusive:true});
  }catch{viewStatus='SAVE_FAILED';}
  if(!result)throw new BuyerError(process.errorCode??'ACCOUNTING_NATIVE_RESULT_UNAVAILABLE',
    {operation,commandId:context.commandId,commandDirectory:directory,exitCode:process.exitCode});
  const value=frozen({...result,viewStatus,recovered:false});
  operation.lastAccounting=value;
  return value;
}

async function readCommand(operation,identity,name){
  need(typeof name==='string'&&COMMAND.test(name),'ACCOUNTING_COMMAND_ID_INVALID');
  const directory=await accountingPrivateDirectory(join(operation.directory,'accounting',name));
  const raw=await accountingPrivateFile(join(directory,'context.json'),262144);
  const context=parseJson(raw.raw);
  need(context.schema===OPERATION_ACCOUNTING_COMMAND&&context.commandId===name&&
    context.commandDirectory===directory&&sameAccountingValue(context.identity,identity)&&
    validTime(context.startedAt)&&context.resultLimit>=65536&&context.resultLimit<=LIMIT&&
    Number.isSafeInteger(context.resultLimit),'ACCOUNTING_COMMAND_BINDING_CHANGED');
  need(digest(jsonBytes(context))===raw.descriptor.sha256,'ACCOUNTING_CONTEXT_SERIALIZATION_CHANGED');
  await commandSource(directory,context);
  let process={exitCode:null,exitSignal:null,errorCode:'PROCESS_EXIT_NOT_RECORDED'};
  let result=null,status='NO_COMPLETE_OUTPUT';
  if(await exists(join(directory,'completion.json'))){
    const completed=await readJson(join(directory,'completion.json'),context.resultLimit+262144);
    need(completed.schema===OPERATION_ACCOUNTING_COMMAND&&
      completed.contextSha256===raw.descriptor.sha256&&object(completed.process),
      'ACCOUNTING_COMPLETION_CHANGED');
    process=completed.process;
    if(completed.output){
      result=returned(context,completed.output,process,{viewStatus:'SAVED',recovered:false});
      status='RECORDED';
    }
  }
  if(!result){
    let output;
    try{output=await readJson(join(directory,'stdout.json'),context.resultLimit);}
    catch(error){
      if(!['ENOENT','JSON_INVALID','JSON_OBJECT_REQUIRED','FILE_SIZE_OR_TYPE_INVALID'].includes(error.code))throw error;
    }
    if(output){
      result=returned(context,output,process,{viewStatus:'RECOVERED_NATIVE_OUTPUT',recovered:true});
      status='OUTPUT_RECOVERED';
    }
  }
  return{commandId:name,commandDirectory:directory,startedAt:context.startedAt,status,process,result};
}

/** Pure local reopening. No key loader, RPC, finalizer or buyer is invoked. */
export async function recoverOperationAccounting(operation,{commandId}={}){
  const {identity}=await readOperationAccountingSource(operation,{evidence:false});
  const parent=join(operation.directory,'accounting');
  if(!await exists(parent))return null;
  await accountingPrivateDirectory(parent);
  if(commandId!==undefined){
    const latest=await readCommand(operation,identity,commandId);
    return frozen({schema:VIEW,intentId:operation.intentId,latest,lastComplete:latest.result,
      lastFinalized:FINALIZED.has(latest.result?.native.result?.outcome)?latest.result:null});
  }
  const choices=[];
  for(const row of await readdir(parent,{withFileTypes:true})){
    if(!row.isDirectory()||!COMMAND.test(row.name)||
      !await exists(join(parent,row.name,'context.json')))continue;
    const context=await readJson(join(parent,row.name,'context.json'),262144);
    need(validTime(context.startedAt),'ACCOUNTING_COMMAND_TIME_INVALID');
    choices.push({name:row.name,startedAt:context.startedAt});
  }
  choices.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)||b.name.localeCompare(a.name));
  if(!choices.length)return null;
  const latest=await readCommand(operation,identity,choices[0].name);
  let lastComplete=latest.result;
  let lastFinalized=FINALIZED.has(latest.result?.native.result?.outcome)?latest.result:null;
  for(let index=1;index<choices.length&&(!lastComplete||!lastFinalized);index++){
    const selected=await readCommand(operation,identity,choices[index].name);
    lastComplete??=selected.result;
    if(FINALIZED.has(selected.result?.native.result?.outcome))lastFinalized??=selected.result;
  }
  return frozen({schema:VIEW,intentId:operation.intentId,latest,lastComplete,lastFinalized});
}

/** Export the complete selected native accounting view and its exact retained
 * attempt/evidence bytes. The original ledger and keys remain in their workspace. */
export async function exportOperationAccounting(operation,destination,{commandId,signal}={}){
  checkSignal(signal);
  destination=absolute(destination);
  await accountingPrivateDirectory(dirname(destination));
  const view=await recoverOperationAccounting(operation,{commandId});
  const result=commandId===undefined?view?.lastComplete:view?.latest.result;
  need(result,'ACCOUNTING_COMPLETE_OUTPUT_REQUIRED');
  const directory=result.commandDirectory;
  const contextFile=await accountingPrivateFile(join(directory,'context.json'),262144);
  const context=parseJson(contextFile.raw),sources=await commandSource(directory,context);
  const value={schema:EXPORT,intentId:operation.intentId,commandId:result.commandId,
    context,contextSha256:contextFile.descriptor.sha256,result,
    source:{attempt:{sha256:sources.attempt.descriptor.sha256,
      bytes:sources.attempt.raw.length,base64:sources.attempt.raw.toString('base64')},
      evidence:{sha256:sources.evidence.descriptor.sha256,
      bytes:sources.evidence.raw.length,base64:sources.evidence.raw.toString('base64')}},
    authority:'ORIGINAL_SF36_RESULT_AND_RETAINED_ORIGINAL_ATTEMPT'};
  const bytes=jsonBytes(value);
  checkSignal(signal);
  await writeBytes(destination,bytes,{exclusive:true});
  return frozen({path:destination,bytes:bytes.length,sha256:digest(bytes),format:'json',
    intentId:operation.intentId,commandId:result.commandId,outcome:result.native.result.outcome});
}
