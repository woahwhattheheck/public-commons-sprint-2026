#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';

export async function main(argv=process.argv.slice(2)){
  argv=[...argv];let python=process.env.STELLAR_FORGE_PYTHON||'python3';
  if(argv[0]==='--python'){
    if(typeof argv[1]!=='string'||!isAbsolute(argv[1]))throw new TypeError('Select an absolute existing Python executable.');
    python=argv[1];argv=argv.slice(2);
  }
  const routes=new Map([
    ['roda','./roda.py'],['roda-client','./roda_client.py'],
    ['preservica','./preservica.py'],['preservica-client','./preservica_client.py'],
    ['workbench','./workbench.py'],
    ['libnova','./libnova.py'],['libnova-client','./libnova_client.py'],
  ]);
  const route=routes.get(argv[0]);
  const script=fileURLToPath(new URL(route||'./preservation.py',import.meta.url));
  const child=spawn(python,['-B',script,...(route?argv.slice(1):argv)],{stdio:'inherit'});
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
