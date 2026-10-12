#!/usr/bin/env node
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const HELP = 'RenewalGuard CLI\n\n' +
  'node src/cli.mjs workspace --mode demo\n' +
  'node src/cli.mjs case --case CASE_ID --output case.json\n' +
  'node src/cli.mjs command --request-id REQUEST_ID --action capture --input command-input.json\n' +
  'node src/cli.mjs operation --request-id REQUEST_ID\n' +
  'node src/cli.mjs resume --request-id REQUEST_ID\n' +
  'node src/cli.mjs document --case CASE_ID --sha SHA256 --output original.json\n' +
  'node src/cli.mjs export --case CASE_ID --output handover.json\n\n' +
  'Options: --mode demo|sandbox, --base http://127.0.0.1:8787, --output FILE.\n' +
  'Commands retain the supplied request ID before doing provider or case work.\n';
function argumentsFor(args) {
  const operation=args.shift();
  if(!operation || ['help','--help','-h'].includes(operation))return {help:true};
  const result={operation,mode:'demo',base:'http://127.0.0.1:8787'};
  const names=new Set(['mode','base','output','case','sha','request-id','action','input']);
  for(let i=0;i<args.length;i+=2){
    const key=args[i]?.replace(/^--/,'');
    if(!args[i]?.startsWith('--')||!names.has(key)||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(result,key)&&!['base','mode'].includes(key))
      throw new Error('Unknown or repeated CLI option: '+args[i]);
    result[key]=args[i+1];
  }
  if(!['demo','sandbox'].includes(result.mode))throw new Error('Choose demo or sandbox mode');
  const base=new URL(result.base);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||
    base.pathname!=='/'||base.search||base.hash||!base.port)
    throw new Error('The base URL must name the original loopback HTTP server and port');
  result.base=base.origin;
  return result;
}
function required(options,key){if(!options[key])throw new Error('--'+key+' is required');return options[key];}
async function saveComplete(path,bytes) {
  path=resolve(path);await mkdir(dirname(path),{recursive:true});
  try {const original=await readFile(path);if(original.equals(bytes))return;
    throw new Error('The output path already contains different data; choose another filename');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=join(dirname(path),'.'+basename(path)+'.'+randomUUID()+'.part');
  let file;
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
    await link(temporary,path);
    const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
  }finally{if(file)await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function main() {
  const options=argumentsFor(process.argv.slice(2));if(options.help){process.stdout.write(HELP);return;}
  const query=new URLSearchParams({mode:options.mode});let path,body;
  if(options.operation==='workspace')path='/api/workspace';
  else if(options.operation==='case'||options.operation==='export'){
    path='/api/'+options.operation;query.set('case_id',required(options,'case'));
  }else if(options.operation==='document'){
    path='/api/document';query.set('case_id',required(options,'case'));query.set('sha',required(options,'sha'));
  }else if(options.operation==='operation'){
    path='/api/operation';query.set('request_id',required(options,'request-id'));
  }else if(options.operation==='resume'){
    path='/api/resume';body={mode:options.mode,request_id:required(options,'request-id')};
  }else if(options.operation==='command'){
    path='/api/command';body={mode:options.mode,request_id:required(options,'request-id'),
      action:required(options,'action'),input:JSON.parse(await readFile(required(options,'input'),'utf8'))};
  }else throw new Error('Unknown operation; use --help');
  const endpoint=options.base+path+(body?'':'?'+query);
  let response;
  try{response=await fetch(endpoint,{method:body?'POST':'GET',redirect:'error',
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(120000)});}
  catch(error){throw new Error(error.message+(options['request-id']?'; recover original request '+options['request-id']:''));}
  const chunks=[];let size=0;
  if(!response.body)throw new Error('The server returned no response body');
  for await(const chunk of response.body){size+=chunk.length;if(size>64*1024*1024)throw new Error('The complete response exceeds 64 MiB');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),data=JSON.parse(bytes.toString('utf8'));
  if(!response.ok)throw new Error((data.code?data.code+': ':'')+(data.error||'Request failed')+
    (options['request-id']?'; original request '+options['request-id']:''));
  const output=Buffer.from(JSON.stringify(data,null,2)+'\n');
  if(options.output){await saveComplete(options.output,output);process.stdout.write(JSON.stringify({output:resolve(options.output),bytes:output.length,
    request_id:data.request_id||null,case_id:data.case?.id||data.result?.case_id||null})+'\n');}
  else process.stdout.write(output);
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
