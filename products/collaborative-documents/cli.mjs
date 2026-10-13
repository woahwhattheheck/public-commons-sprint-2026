#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Preserve the original CLI's top-level dispatch and process lifetime.
import {spawn} from 'node:child_process';
import {constants} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectOriginalSource,WORKBENCH_ROOT} from './managed.mjs';
import {readLaunchConfiguration,absolute,need} from './connection.mjs';

export async function main(argv=process.argv.slice(2)){
  let sourceRoot=WORKBENCH_ROOT,args=[...argv];
  // An explicit host-selected source permits the original separately prepared runtime.
  if(args[0]==='--application'){
    need(typeof args[1]==='string','COLLABORATION_CLI_SOURCE','Select the original complete prepared application.');
    sourceRoot=absolute(args[1]);args=args.slice(2);
  }else if(args[0]==='--configuration'){
    need(typeof args[1]==='string','COLLABORATION_CLI_SOURCE','Select the original private application configuration.');
    sourceRoot=(await readLaunchConfiguration(args[1])).value.applicationDirectory;args=args.slice(2);
  }
  await inspectOriginalSource({directory:sourceRoot});
  const child=spawn(process.execPath,[join(sourceRoot,'cli.mjs'),...args],{stdio:'inherit',shell:false});
  const forward=signal=>{if(child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{
    const result=await new Promise((accept,reject)=>{
      child.once('error',reject);
      child.once('close',(exitCode,signal)=>accept({exitCode,signal}));
    });
    const code=result.exitCode??128+(constants.signals[result.signal]??1);
    if(code)process.exitCode=code;
    return result;
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'COLLABORATION_CLI_FAILED',message:error.message}})+'\n');process.exitCode=1;});
