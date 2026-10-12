#!/usr/bin/env node
// MIT. Finish or reopen accounting for one existing original Buyer attempt.
import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Buyer} from '../index.mjs';
import {absolute,need,object,jsonBytes,writeBytes,safeCode} from '../store.mjs';

const HELP=[
  'Original Node operation accounting',
  '',
  'node operation_accounting.mjs finalize --runtime ABS_SF88 --state ABS_PRIVATE_STATE --intent ID [--workspace ABS_ORIGINAL_WORKSPACE]',
  'node operation_accounting.mjs recover --runtime ABS_SF88 --state ABS_PRIVATE_STATE --intent ID [--command finalize-XXXXXX]',
  'node operation_accounting.mjs export --runtime ABS_SF88 --state ABS_PRIVATE_STATE --intent ID --output ABS_NEW_FILE [--command finalize-XXXXXX]',
  '',
  'finalize also accepts paired --outbox / --merchant-route and --view-file ABS_NEW_FILE.',
  'The existing operation supplies its request and attempt. No command creates or executes a Buyer.',
  'runtime selects the complete maintained accounting implementation; the producing runtime remains retained.',
].join('\n');

export async function runOperationAccounting(argv){
  if(argv.length===0||argv.length===1&&argv[0]==='--help')return{help:HELP};
  const action=argv[0];
  need(['finalize','recover','export'].includes(action),'ACCOUNTING_EXAMPLE_ACTION_INVALID');
  const allowed=new Set(['runtime','state','intent','workspace','outbox','merchant-route','command','output','view-file']);
  const options={};
  for(let index=1;index<argv.length;index+=2){
    const name=argv[index]?.slice(2),value=argv[index+1];
    need(argv[index]?.startsWith('--')&&allowed.has(name)&&value!==undefined&&
      !Object.hasOwn(options,name),'ACCOUNTING_EXAMPLE_ARGUMENT_INVALID');
    options[name]=value;
  }
  need(options.runtime&&options.state&&options.intent,'ACCOUNTING_EXAMPLE_SELECTION_REQUIRED');
  need(action==='finalize'||!options.workspace&&!options.outbox&&!options['merchant-route'],
    'ACCOUNTING_EXAMPLE_FINALIZATION_OPTIONS_ONLY');
  need(action==='export'?Boolean(options.output):options.output===undefined,
    'ACCOUNTING_EXAMPLE_EXPORT_OUTPUT_REQUIRED');
  need(action!=='finalize'||options.command===undefined,'ACCOUNTING_EXAMPLE_RECOVERY_COMMAND_ONLY');
  const buyer=new Buyer({runtimeDirectory:absolute(options.runtime),stateDirectory:absolute(options.state),
    outputLimit:4_194_304,timeoutMs:480000});
  const operation=buyer.operation(options.intent);
  const controller=new AbortController(),abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  let result;
  try{
    if(action==='finalize')result=await operation.finalize({
      ...(options.workspace?{workspaceDirectory:absolute(options.workspace)}:{}),
      ...(options.outbox?{outboxDirectory:absolute(options.outbox)}:{}),
      ...(options['merchant-route']?{merchantRoute:options['merchant-route']}:{}),
      signal:controller.signal,
    });
    else if(action==='recover')result=await operation.recoverAccounting(
      options.command?{commandId:options.command}:{});
    else result=await operation.exportAccounting(absolute(options.output),
      {...(options.command?{commandId:options.command}:{}),signal:controller.signal});
    if(options['view-file'])await writeBytes(absolute(options['view-file']),jsonBytes({
      schema:'stellar-forge.node-operation-accounting-example.v1',action,intentId:operation.intentId,result,
    }),{exclusive:true});
    return result;
  }finally{
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  }
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
  runOperationAccounting(process.argv.slice(2)).then(value=>{
    if(object(value)&&typeof value.help==='string')process.stdout.write(value.help+'\n');
    else process.stdout.write(jsonBytes(value));
  }).catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'ACCOUNTING_EXAMPLE_FAILED'),
      ...(typeof error.commandId==='string'?{commandId:error.commandId}:{}),
      ...(typeof error.commandDirectory==='string'?{commandDirectory:error.commandDirectory}:{})})+'\n');
    process.exitCode=2;
  });
}
