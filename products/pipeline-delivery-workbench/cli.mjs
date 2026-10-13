#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Forward the original complete staff CLI in its prepared Dagster/dbt runtime.
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {need,readLaunchConfiguration} from './connection.mjs';
import {inspectOriginalSource,managedOptions} from './managed.mjs';
import {inspectPipelineDeliveryRuntime} from './prepare.mjs';

export function cliOptions(argv){
  const at=argv.indexOf('--');
  need(at>0&&at<argv.length-1,'PIPELINE_DELIVERY_CLI_ARGUMENT','Select --configuration ABS_LAUNCH -- ORIGINAL_COMMAND_ARGS.');
  const options=managedOptions(argv.slice(0,at));
  need(!argv.slice(0,at).includes('--port'),'PIPELINE_DELIVERY_CLI_ARGUMENT','The original CLI does not open a managed listener.');
  const original=argv.slice(at+1);
  need(original.every(x=>typeof x==='string'&&!(x.startsWith('--')&&x.split('=',1)[0].length>2&&
    ['--workspace','--source-root'].some(flag=>flag.startsWith(x.split('=',1)[0])))),
    'PIPELINE_DELIVERY_CLI_SELECTION','The reviewed launch configuration selects the original workspace and source root.');
  return{...options,original};
}
export async function runOriginalPipelineDeliveryCLI(options){
  const selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(!options.expectedConfigurationSha256||selected.sha256===options.expectedConfigurationSha256,
    'PIPELINE_DELIVERY_CONFIGURATION_CHANGED','Select the reviewed original CLI configuration.',409);
  await inspectOriginalSource({directory:v.applicationDirectory,programmeDirectory:v.programmeDirectory});
  const runtime=await inspectPipelineDeliveryRuntime({runtimeReadyFile:v.runtimeReadyFile,applicationDirectory:v.applicationDirectory,python:v.python});
  need(runtime.programmeDirectory===v.programmeDirectory,'PIPELINE_DELIVERY_PROGRAMME_CHANGED','Select the complete prepared original programme.',409);
  const env={...process.env};
  for(const key of['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[key];
  env.PYTHONDONTWRITEBYTECODE='1';env.PATH=[dirname(runtime.dbt),dirname(v.python),process.env.PATH??''].join(':');
  const bootstrap="import runpy,sys; root=sys.argv.pop(1); sys.path.insert(0,root); sys.argv[0]=root+'/cli.py'; runpy.run_path(sys.argv[0],run_name='__main__')";
  const args=['-I','-B','-c',bootstrap,v.applicationDirectory,'--workspace',v.directory,'--source-root',v.applicationDirectory,...options.original];
  const child=spawn(v.python,args,{cwd:dirname(selected.path),env,stdio:'inherit'});
  let failure=null,closed=false;
  const close=new Promise(resolveClose=>{child.on('error',e=>{failure=e;});child.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});});
  const stop=signal=>{if(!closed&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{
    const result=await close;if(failure)throw failure;
    return{...result,exitCode:result.code??(result.signal==='SIGINT'?130:result.signal==='SIGTERM'?143:1)};
  }finally{
    process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
    if(!closed){stop('SIGTERM');await close;}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    const result={command:'pipeline-delivery-workbench',
      usage:'--configuration ABS_PRIVATE_LAUNCH [--configuration-sha256 FULL_SHA256] -- ORIGINAL_COMMAND_ARGS',
      commands:['init','read','invoke','import-project','backup','release','inspect-archive','receive','received','received-catalog','wait'],
      originalHelp:'--configuration ABS_PRIVATE_LAUNCH -- --help',
      ownership:'Writer commands acquire the original selected workspace lease. Use the existing Staff application while it owns that writer; read-only archive inspection opens no writer.',
      native:'The selected original Python/Dagster/dbt runtime executes the unchanged original CLI. This process waits for its actual child close; accepted native workers retain their original lease and request.'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await runOriginalPipelineDeliveryCLI(cliOptions(argv));process.exitCode=result.exitCode;return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'PIPELINE_DELIVERY_CLI_FAILED',message:e.message}})+'\n');process.exitCode=1;});
