// SPDX-License-Identifier: MIT
// Thin installed entry to the source-owned original runtime preparation.
import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute,dirname} from 'node:path';

const HELPER=fileURLToPath(new URL('./preparation.py',import.meta.url));
const LIMIT=32*1024*1024;
function need(condition,message){if(!condition)throw new Error(message);}
function path(value,label){need(typeof value==='string'&&isAbsolute(value)&&!value.includes('\0'),'Use an absolute '+label+'.');return resolve(value);}
export async function runHivePreparation(action,options={}){
  const allowed={
    prepare:['directory','python','source','router','wheel'],
    inspect:['resultPath','python'],
    export:['directory','out','python'],
    receive:['archive','archiveSha256','directory','python']
  };
  need(allowed[action]&&Object.keys(options).every(k=>allowed[action].includes(k)||k==='signal'),'Select the declared full preparation command.');
  const selected=options.python??process.env.CODEX_PRIMARY_RUNTIME_PYTHON;
  need(typeof selected==='string'&&isAbsolute(selected),'Select the canonical existing Python with --python or CODEX_PRIMARY_RUNTIME_PYTHON.');
  const python=await realpath(selected);need((await stat(python)).isFile(),'Select an existing Python executable.');
  const argv=['-I','-B',HELPER,action];
  for(const key of allowed[action]){
    if(key==='python'&&['inspect','export'].includes(action))continue;
    const value=key==='python'?python:options[key];if(value===undefined)continue;
    const flag={resultPath:'result',archiveSha256:'archive-sha256'}[key]??key;
    if(key==='archiveSha256')need(/^[a-f0-9]{64}$/.test(value),'Use the complete original portable SHA-256.');
    else path(value,key);
    argv.push('--'+flag,String(value));
  }
  for(const required of {prepare:['directory'],inspect:['resultPath'],export:['directory','out'],receive:['directory','archive','archiveSha256']}[action])
    need(options[required]!==undefined,'Supply '+required+' for the original '+action+' operation.');
  if(options.signal?.aborted)throw options.signal.reason??new Error('Preparation cancelled before child entry.');
  let child,closed=false,overflow=false,childError=null;
  const stdout=[],stderr=[];let outBytes=0,errBytes=0;
  const exit=new Promise((resolveExit,reject)=>{
    try{child=spawn(python,argv,{cwd:dirname(HELPER),stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}
    catch(error){reject(error);return;}
    child.on('error',error=>{childError??=error;});
    child.once('close',(code,signal)=>{closed=true;resolveExit({code,signal});});
    child.stdout.on('data',part=>{outBytes+=part.length;if(outBytes<=LIMIT)stdout.push(part);else{overflow=true;child.kill('SIGTERM');}});
    child.stderr.on('data',part=>{errBytes+=part.length;if(errBytes<=LIMIT)stderr.push(part);else{overflow=true;child.kill('SIGTERM');}});
  });
  const cancel=()=>{if(child&&!closed)child.kill('SIGTERM');};
  options.signal?.addEventListener('abort',cancel,{once:true});
  try{
    const outcome=await exit;
    if(childError)throw childError;
    const diagnostic=Buffer.concat(stderr).toString('utf8');
    need(!overflow,'Preparation output exceeded its retained bound; its original child was closed.');
    if(options.signal?.aborted)throw options.signal.reason??new Error('Original preparation child closed after cancellation.');
    need(outcome.code===0,'Original Hive preparation failed'+(outcome.signal?' ('+outcome.signal+')':'')+': '+diagnostic.slice(-12000));
    const text=Buffer.concat(stdout).toString('utf8').trim();need(text,'Original preparation returned no result.');
    const result=JSON.parse(text);
    need(result&&typeof result==='object'&&result.state==='READY','Original preparation did not return its complete READY record.');
    return result;
  }finally{
    options.signal?.removeEventListener('abort',cancel);
    if(child&&!closed){cancel();await exit.catch(()=>{});}
  }
}
export const prepareHiveRuntime=options=>runHivePreparation('prepare',options);
export const inspectHivePreparation=options=>runHivePreparation('inspect',options);
export const exportHiveRuntime=options=>runHivePreparation('export',options);
export const receiveHiveRuntime=options=>runHivePreparation('receive',options);

export async function main(argv=process.argv.slice(2)){
  const action=argv.shift();need(['prepare','inspect','export','receive'].includes(action),'Use prepare, inspect, export or receive.');
  const options={};const names={'archive-sha256':'archiveSha256','result':'resultPath'};
  while(argv.length){
    const key=argv.shift();need(/^--[a-z-]+$/.test(key)&&argv.length,'Supply complete --name value pairs.');
    const name=names[key.slice(2)]??key.slice(2);need(!Object.hasOwn(options,name),'Do not repeat a preparation selection.');
    options[name]=argv.shift();
  }
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Original preparation interrupted.'));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try{const result=await runHivePreparation(action,{...options,signal:controller.signal});process.stdout.write(JSON.stringify(result,null,2)+'\n');}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({schema:'stellar-forge.hive-preparation-error.v1',error:error.name,message:error.message})+'\n');process.exitCode=1;});
