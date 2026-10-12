#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export async function main(argv=process.argv.slice(2)){
  const args=[...argv];
  let executable=process.env.STELLAR_FORGE_PYTHON||'python3';
  if(args[0]==='--python'){
    if(!args[1]||args[1].startsWith('--'))throw new Error('Select the original Python executable after --python.');
    executable=args.splice(0,2)[1];
  }
  const script=fileURLToPath(new URL('./aviary.py',import.meta.url));
  const child=spawn(executable,['-B',script,...args],{stdio:'inherit',shell:false});
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
