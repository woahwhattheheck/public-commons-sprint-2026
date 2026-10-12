#!/usr/bin/env node
// MIT. Call the original running private merchant workspace; retain full request JSON for recovery.
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {open,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {accountingOrigin} from './accounting.mjs';
import {need,hash,json,object,RESOLUTION_RECEIVING_BYTES} from './contract.mjs';
import {readPrivate} from './storage.mjs';

export const HELP='Paid-job resolution\n\n'+
'  jobs-resolution list|runs|connect|inspect|bind|reply|case|job|refresh|preview|record|verify|withdraw|recover|resume|export|accountingexport|receive\n'+
'    --url http://127.0.0.1:PORT --token-file /private/operator-token\n'+
'    [--job ORIGINAL_JOB_ID] [--input /private/request.json] [--out /private/new-file.json]\n\n'+
'--url may also be the original printed private workspace URL with its fragment token.\n'+
'Mutation input retains requestId and expectedRevision. Preview and record use the same saved adjustment UUID.\n'+
'Recover reads original state; resume explicitly continues the same request. verify checks an already returned transaction.\n'+
'Export writes complete bytes to a new destination. Add --deadline-ms 30000 for the request deadline.\n';

export async function createOnlyFile(destination,bytes){
  destination=resolve(destination);const stage=destination+'.'+randomUUID()+'.pending';
  try{
    const file=await open(stage,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    await link(stage,destination);
    const dir=await open(dirname(destination),'r');try{await dir.sync();}finally{await dir.close();}
    return {path:destination,bytes:bytes.length,sha256:hash(bytes)};
  }finally{await unlink(stage).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export function parseArguments(argv,allowed){
  const options=Object.create(null);
  for(let i=0;i<argv.length;i+=2){need(allowed.has(argv[i])&&typeof argv[i+1]==='string'&&!argv[i+1].startsWith('--')&&
    !Object.hasOwn(options,argv[i]),'JOB_RESOLUTION_ARGUMENT_INVALID');options[argv[i]]=argv[i+1];}
  return options;
}
export async function readInput(path,max=RESOLUTION_RECEIVING_BYTES){
  need(path,'JOB_RESOLUTION_INPUT_FILE_REQUIRED');const value=JSON.parse(await readPrivate(resolve(path),max));
  need(object(value),'JOB_RESOLUTION_INPUT_INVALID');return value;
}
export async function runJobResolutionCommand(argv,{signal}={}){
  if(argv.length===0||argv[0]==='--help')return {help:HELP};
  const [command,...args]=argv;
  need(['list','runs','connect','inspect','bind','reply','case','job','refresh','preview','record','verify','withdraw',
    'recover','resume','export','accountingexport','receive'].includes(command),'JOB_RESOLUTION_COMMAND_REQUIRED');
  const opt=parseArguments(args,new Set(['--url','--token-file','--job','--input','--out','--deadline-ms']));
  let target;try{target=new URL(opt['--url']);}catch{need(false,'JOB_RESOLUTION_OPERATOR_URL_REQUIRED');}
  let token=target.hash.slice(1);target.hash='';
  const origin=accountingOrigin(target.href);
  if(opt['--token-file']){
    need(!token,'JOB_RESOLUTION_TOKEN_SELECTION_AMBIGUOUS');
    token=(await readPrivate(resolve(opt['--token-file']),1024)).toString('utf8').trim();
  }
  need(/^[a-f0-9]{64}$/.test(token),'JOB_RESOLUTION_OPERATOR_TOKEN_REQUIRED');
  const global={list:'/api/resolutions',runs:'/api/resolutions/accounting',connect:'/api/resolutions/connection',receive:'/api/resolutions/receive'};
  let path=global[command];
  if(!path){need(/^[A-Za-z0-9._:-]{1,80}$/.test(opt['--job']??''),'JOB_RESOLUTION_JOB_REQUIRED');
    path='/api/jobs/'+encodeURIComponent(opt['--job'])+'/resolution'+(command==='inspect'?'':'/'+command);}
  const mutating=!['list','runs','inspect','export','accountingexport'].includes(command);
  const value=mutating?(command==='refresh'?{}:await readInput(opt['--input'],command==='receive'?RESOLUTION_RECEIVING_BYTES:24000)):undefined;
  need(['export','accountingexport'].includes(command)||!opt['--out'],'JOB_RESOLUTION_OUTPUT_ARGUMENT_INVALID');
  if(['export','accountingexport'].includes(command))need(opt['--out'],'JOB_RESOLUTION_OUTPUT_REQUIRED');
  const timeoutMs=Number(opt['--deadline-ms']??30000);
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000,'JOB_RESOLUTION_DEADLINE_INVALID');
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
    const response=await fetch(origin+path,{method:mutating?'POST':'GET',redirect:'error',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,...(mutating?{'Content-Type':'application/json'}:{Accept:'application/json'})},
      ...(mutating?{body:JSON.stringify(value)}:{})});
    const chunks=[];let total=0;
    for await(const chunk of response.body??[]){total+=chunk.length;need(total<=RESOLUTION_RECEIVING_BYTES,'JOB_RESOLUTION_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks),length=response.headers.get('content-length');
    if(length!==null)need(/^\d+$/.test(length)&&total===Number(length),'JOB_RESOLUTION_RESPONSE_TRUNCATED');
    if(!response.ok){let error;try{error=JSON.parse(bytes).error;}catch{}throw Object.assign(new Error(error??'JOB_RESOLUTION_HTTP_ERROR'),{code:error??'JOB_RESOLUTION_HTTP_ERROR',status:response.status});}
    if(['export','accountingexport'].includes(command)){
      const expected=response.headers.get('x-content-sha256');
      if(expected)need(hash(bytes)===expected,'JOB_RESOLUTION_EXPORT_BYTES_CHANGED');
      return createOnlyFile(opt['--out'],bytes);
    }
    return JSON.parse(bytes);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await runJobResolutionCommand(process.argv.slice(2),{signal:controller.signal});
    process.stdout.write(result.help??JSON.stringify(result)+'\n');
    if(result.case?.operations?.some(o=>['FAILED','UNKNOWN','DISPATCHING'].includes(o.state)))process.exitCode=2;
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'JOB_RESOLUTION_COMMAND_FAILED'})+'\n');process.exitCode=1;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
