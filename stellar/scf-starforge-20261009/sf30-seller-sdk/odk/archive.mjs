// MIT. Streaming original workspace archives; Python uses only its standard library.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fault, now } from '../odata/state.mjs';

const helper=fileURLToPath(new URL('./archive.py',import.meta.url));
async function run(args,{signal}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.PYTHON??'python3',[helper,...args],{stdio:['ignore','pipe','pipe'],shell:false,signal});
    let output='',error='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-16384);});
    child.once('error',reject);
    child.once('close',code=>{
      if(code!==0){reject(fault('CENTRAL_ARCHIVE',error.trim()||'The portable workspace operation ended before completion.',422));return;}
      try{resolve(JSON.parse(output));}catch{reject(fault('CENTRAL_ARCHIVE_RESULT','The archive operation did not return its original result.',502));}
    });
  });
}
const jobs=new WeakMap();
export async function createCentralArchive(store,{id=randomUUID()}={}) {
  const existing=store.get('archive',id,false);
  if(existing?.files?.length)return existing;
  if(existing?.priorTransfer)throw fault('CENTRAL_ARCHIVE_EXTERNAL','That archive was created on the previous host; choose a new archive ID.');
  if(!jobs.has(store))jobs.set(store,new Map());
  const active=jobs.get(store);if(active.has(id))return active.get(id);
  const operation=(async()=>{
    const snapshot=await store.snapshot(id),filename='central-workspace.tar.gz',output=join(snapshot.directory,filename);
    const result=await run(['create','--snapshot',snapshot.path,'--root',store.directory,'--output',output]);
    const {files:fileCount,...receipt}=result;
    return store.put('archive',snapshot.id,{...receipt,id:snapshot.id,kind:'archive',directory:snapshot.directory,createdAt:now(),
      files:[filename],fileCount,receipts:{[filename]:{sha256:result.sha256,bytes:result.bytes}}},0);
  })();
  active.set(id,operation);
  try{return await operation;}finally{active.delete(id);}
}

export async function restoreCentralArchive({archive,directory,expectedSha256,signal}={}) {
  if(!archive||!directory)throw fault('CENTRAL_RESTORE_INPUT','Select an original archive and a new workspace directory.');
  if(expectedSha256&&!/^[a-f0-9]{64}$/.test(expectedSha256))throw fault('CENTRAL_RESTORE_HASH','Use a SHA-256 archive identity.');
  return run(['restore','--archive',resolve(archive),'--directory',resolve(directory),
    ...(expectedSha256?['--expected-sha256',expectedSha256]:[])],{signal});
}
