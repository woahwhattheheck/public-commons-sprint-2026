#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function main(argv=process.argv.slice(2)){
  const script=fileURLToPath(new URL('./preservation.py',import.meta.url));
  const child=spawn(process.env.STELLAR_FORGE_PYTHON||'python3',['-B',script,...argv],{stdio:'inherit'});
  const handlers=new Map();
  for(const signal of ['SIGINT','SIGTERM']){
    const handler=()=>child.kill(signal);handlers.set(signal,handler);process.on(signal,handler);
  }
  try{
    return await new Promise((done,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>done(code??(signal==='SIGINT'?130:143)));
    });
  }finally{for(const [signal,handler] of handlers)process.removeListener(signal,handler);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=await main();}
  catch(error){process.stderr.write(JSON.stringify({error:error.code||error.name,message:error.message})+'\n');process.exitCode=1;}
}
