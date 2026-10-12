// MIT. One source-packet worker; the original publisher and buyer stay unchanged.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail } from './config.mjs';
export async function packet(command, {directory,input,output,request,python='python3',signal}={}) {
  if(!['create','inspect','restore','project'].includes(command)) fail('WORDPRESS_PACKET_COMMAND','Select an original packet operation.');
  const args=[fileURLToPath(new URL('./packet.py',import.meta.url)),command];
  if(directory)args.push('--directory',directory);
  if(input)args.push('--input',input);
  if(output)args.push('--output',output);
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',...args],{stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='',finished=false;
    const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    child.stdout.on('data',part=>{stdout+=part;if(Buffer.byteLength(stdout)>33554432){child.kill('SIGTERM');stderr='Packet metadata exceeded 32 MiB.';}});
    child.stderr.on('data',part=>{if(stderr.length<65536)stderr+=part.toString('utf8');});
    child.once('error',error=>{finished=true;signal?.removeEventListener('abort',abort);reject(error);});
    child.once('close',code=>{
      signal?.removeEventListener('abort',abort);
      if(finished)return;
      let value;try{value=JSON.parse(stdout);}catch{}
      if(code!==0||!value?.ok){const error=new Error(value?.error?.message||stderr||'The source packet did not complete.');
        error.code=value?.error?.code||'WORDPRESS_PACKET_FAILED';error.status=409;reject(error);}
      else resolve(value.result);
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(request===undefined?'':JSON.stringify(request));
  });
}
