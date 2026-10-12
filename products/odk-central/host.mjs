#!/usr/bin/env node
// MIT. Installed entry for the original Central host controller.
import {spawn} from 'node:child_process';
import {constants} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const CENTRAL_HOST_ENTRY=fileURLToPath(new URL(
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/central-host/central_host.py',import.meta.url));
export const CENTRAL_RELEASED_RECEIVING_ENTRY=fileURLToPath(new URL(
  '../../stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/run-released-fixtures.py',import.meta.url));

/** Forward the selected original operation and its child exit status. */
export function runOriginalCentralPython(filename,args){
  return new Promise((resolveRun,reject)=>{
    const child=spawn('python3',[filename,...args],{
      stdio:'inherit',shell:false,windowsHide:true,
    });
    const interrupt=()=>child.kill('SIGINT');
    const terminate=()=>child.kill('SIGTERM');
    const detach=()=>{
      process.off('SIGINT',interrupt);
      process.off('SIGTERM',terminate);
    };
    process.on('SIGINT',interrupt);
    process.on('SIGTERM',terminate);
    child.once('error',error=>{
      detach();
      if(error.code==='ENOENT')Object.assign(error,{
        code:'CENTRAL_PRODUCT_PYTHON',
        message:'Install Python 3.10 or newer on this original Linux host, then continue the same Central command.',
      });
      reject(error);
    });
    child.once('exit',(code,signal)=>{
      detach();
      resolveRun(code??128+(constants.signals[signal]??1));
    });
  });
}

export async function main(args=process.argv.slice(2)){
  return runOriginalCentralPython(CENTRAL_HOST_ENTRY,args);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write(JSON.stringify({code:error.code??error.name,message:error.message})+'\n');
    process.exitCode=1;
  });
