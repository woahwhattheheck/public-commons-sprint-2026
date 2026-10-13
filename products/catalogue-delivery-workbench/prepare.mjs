#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Generic wrapper only: the selected original application and its customer data stay private.
import {spawn} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const HELPER=resolve(HERE,'preparation.py');
const SCHEMA='stellar-forge.catalogue-delivery-preparation.v1';
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'CATALOGUE_DELIVERY_PREPARATION'});}
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'Use each selected absolute normalized path.');return value;}
function environment(){
  const result={...process.env};
  for(const key of ['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP'])delete result[key];
  result.PYTHONDONTWRITEBYTECODE='1';return result;
}
export function parseArguments(argv){
  const [mode,...rest]=argv;need(['prepare','receive','inspect','export'].includes(mode),'Use prepare, receive, inspect or export.');
  const allowed=new Set(['directory','python','source','source-manifest','source-manifest-sha256','archive','archive-sha256','output','resume']);
  const options={mode};
  for(let i=0;i<rest.length;i++){
    need(/^--[a-z][a-z0-9-]*$/.test(rest[i]),'Use complete option names.');
    const key=rest[i].slice(2);need(allowed.has(key)&&!Object.hasOwn(options,key),'Use each documented option once.');
    if(key==='resume')options[key]=true;
    else{need(typeof rest[i+1]==='string'&&!rest[i+1].startsWith('--'),'Supply the complete option value.');options[key]=rest[++i];}
  }
  return options;
}
async function selectedPython(value){
  const path=absolute(value),physical=await realpath(path),info=await lstat(physical);
  need(info.isFile(),'Select the actual CPython executable.');return path;
}
async function invoke(options){
  need(options&&typeof options==='object'&&!Array.isArray(options),'Supply the complete selected preparation options.');
  const allowed=new Set(['mode','directory','python','source','source-manifest','source-manifest-sha256','archive','archive-sha256','output','resume','signal']);
  need(Object.keys(options).every(key=>allowed.has(key)),'Unknown preparation option.');
  const mode=options.mode;need(['prepare','receive','inspect','export'].includes(mode),'Select the original preparation action.');
  absolute(options.directory);const python=await selectedPython(options.python);
  const argv=['-I','-B',HELPER,mode,'--directory',options.directory,'--python',python];
  for(const key of ['source','source-manifest','source-manifest-sha256','archive','archive-sha256','output']){
    if(options[key]!==undefined){
      if(key.endsWith('sha256'))need(/^[a-f0-9]{64}$/.test(options[key]),'Select the exact complete SHA256 digest.');
      else absolute(options[key]);
      argv.push('--'+key,options[key]);
    }
  }
  if(options.resume)argv.push('--resume');
  need(options.signal===undefined||options.signal===null||typeof options.signal.addEventListener==='function','Use an AbortSignal when supplied.');
  need(!options.signal?.aborted,'Preparation was stopped before child entry.');
  let child,closedPromise,spawnError=null,closed=false,exit=null;
  const stdout=[],stderr=[];let outBytes=0,errBytes=0,streamError=null;
  const stop=()=>{if(child&&!closed)child.kill('SIGTERM');};
  const nativeStop=()=>stop();
  try{
    child=spawn(python,argv,{cwd:HERE,env:environment(),stdio:['ignore','pipe','pipe'],windowsHide:true});
    closedPromise=new Promise(resolveClose=>{
      child.once('error',error=>{spawnError=error;});
      child.once('close',code=>{closed=true;exit=code;resolveClose();});
    });
    child.stdout.on('data',bytes=>{
      outBytes+=bytes.length;
      if(outBytes>8*1024*1024){streamError??=new Error('The full preparation result exceeds its declared output capacity.');stop();}
      else stdout.push(Buffer.from(bytes));
    });
    child.stderr.on('data',bytes=>{
      errBytes+=bytes.length;
      if(errBytes<=1024*1024)stderr.push(Buffer.from(bytes));
      process.stderr.write(bytes);
    });
    options.signal?.addEventListener('abort',stop,{once:true});
    process.on('SIGTERM',nativeStop);process.on('SIGINT',nativeStop);
    if(options.signal?.aborted)stop();
    await closedPromise;
    if(spawnError)throw spawnError;
    if(streamError)throw streamError;
    need(exit===0&&!options.signal?.aborted,'Original preparation closed without a successful result: '+Buffer.concat(stderr).toString('utf8').slice(-4000));
    let result;try{result=JSON.parse(Buffer.concat(stdout).toString('utf8'));}catch{throw Object.assign(new Error('Retain the original complete preparation stdout; it is not one JSON result.'),{code:'CATALOGUE_DELIVERY_PREPARATION_RESULT'});}
    need(result?.schema===SCHEMA&&['READY','EXPORTED'].includes(result.state),'The original private preparation returned another result.');
    return result;
  }finally{
    if(closedPromise){if(!closed)stop();await closedPromise;}
    options.signal?.removeEventListener('abort',stop);
    process.off('SIGTERM',nativeStop);process.off('SIGINT',nativeStop);
  }
}
export const prepareCatalogueDeliveryRuntime=options=>invoke({...options,mode:'prepare'});
export const receiveCatalogueDeliveryRuntime=options=>invoke({...options,mode:'receive'});
export const inspectCatalogueDeliveryPreparation=options=>invoke({...options,mode:'inspect'});
export const exportCatalogueDeliveryRuntime=options=>invoke({...options,mode:'export'});
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){
    const result={command:'catalogue-delivery-workbench-prepare',
      prepare:'prepare --directory PRIVATE_ROOT --python ABS_CPYTHON --source PRIVATE_APPLICATION --source-manifest PRIVATE_AUTHORITY --source-manifest-sha256 SHA [--resume]',
      receive:'receive --directory PRIVATE_ROOT --python ABS_CPYTHON --archive TRUSTED_PRIVATE_ZIP --archive-sha256 SHA [--source-manifest PRIVATE_AUTHORITY --source-manifest-sha256 SHA] [--resume]',
      inspect:'inspect --directory PRIVATE_ROOT --python ORIGINAL_CPYTHON',
      export:'export --directory PRIVATE_ROOT --python ORIGINAL_CPYTHON --output PRIVATE_ZIP'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await invoke(parseArguments(argv));process.stdout.write(JSON.stringify(result)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:error.code??'CATALOGUE_DELIVERY_PREPARATION',message:error.message}})+'\n');process.exitCode=1;
});
