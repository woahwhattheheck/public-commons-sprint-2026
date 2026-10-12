#!/usr/bin/env node
// MIT. Full customer operations over the original Tyk model or its existing private HTTP owner.
import { open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openTykWorkspace } from './model.mjs';
import { startTykWorkspaceServer } from './server.mjs';
import { TYK_WORKSPACE_ACTIONS,TYK_MAX_JSON_BYTES,validateTykAction } from './actions.mjs';
import { TykWorkspaceHttpClient,readTykPrivateFile,retainTykResponse } from './http-client.mjs';
import { need,privateDirectory } from '../../../distribution/runtime-workspace/storage.mjs';
const HELP=[
  'Tyk migration and rollout workspace',
  '',
  'tyk-workspace open --dir DIRECTORY [--connections FILE] [--port 0] [--url-output FILE]',
  'tyk-workspace call --dir DIRECTORY --method ACTION [--input FILE] [--output FILE]',
  'tyk-workspace call --url-file FILE --method ACTION [--input FILE] [--output FILE]',
  'tyk-workspace download --url-file FILE --id DELIVERY_ID --output FILE',
  'tyk-workspace inspect --url-file FILE --file HANDOVER --request-id UUID [--label TEXT]',
  'tyk-workspace request-id',
  '',
  'Use --url-env NAME instead of --url-file to resolve an existing private connection.',
  'Use --workspace-id UUID to pin the original HTTP workspace identity.',
  'Every write input contains its stable requestId. Reuse the exact original input to recover a reply.',
  'A --dir call owns that original local workspace until it returns; use its HTTP connection while the UI is open.',
  'JSON inputs and original connection files are private UTF-8 files. Output files must have a private parent directory.',
  '',
  'Actions:',
  ...Object.entries(TYK_WORKSPACE_ACTIONS).map(([name,value])=>'  '+name+' — '+value.description),
].join('\n');
function options(argv){
  const result={command:argv[0]?.startsWith('--')?'open':argv[0]??'open'};
  const allowed=new Set(['dir','connections','port','url-output','url-file','url-env','workspace-id','method','input','output','id','file','request-id','label']);
  for(let index=result.command===argv[0]?1:0;index<argv.length;index++){
    const flag=argv[index];if(flag==='--help'||flag==='-h'){result.help=true;continue;}
    need(/^--[a-z-]+$/.test(flag)&&allowed.has(flag.slice(2)),'TYK_CLI_OPTION_INVALID','Unknown option: '+flag);
    const key=flag.slice(2);need(result[key]===undefined&&index+1<argv.length,'TYK_CLI_OPTION_INVALID','Supply one value for '+flag);
    result[key]=argv[++index];
  }
  return result;
}
async function jsonFile(path){
  const bytes=await readTykPrivateFile(resolve(path),TYK_MAX_JSON_BYTES);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'TYK_JSON_REQUIRED','Use a complete private UTF-8 JSON file.');}
}
async function outputJSON(value,path,stdout){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(!path){stdout.write(bytes);return;}
  await retainTykResponse(new Response(bytes,{headers:{'content-type':'application/json','content-length':String(bytes.length)}}),resolve(path));
}
async function saveConnectionUrl(path,value){
  path=resolve(path);await privateDirectory(dirname(path));
  try{await readTykPrivateFile(path,4096);}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    try{await handle.writeFile(value+'\n');await handle.sync();}finally{await handle.close();}
    await rename(temporary,path);const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function connection(input,environment,signal){
  need(Boolean(input['url-file'])!==Boolean(input['url-env']),'TYK_CLI_CONNECTION_REQUIRED','Choose one existing URL file or environment name.');
  let url;
  if(input['url-file'])url=new TextDecoder('utf-8',{fatal:true}).decode(await readTykPrivateFile(resolve(input['url-file']),4096)).trim();
  else{need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(input['url-env']),'TYK_ENV_NAME_INVALID');url=environment[input['url-env']];}
  return new TykWorkspaceHttpClient({url,workspaceId:input['workspace-id'],signal});
}
export async function runTykWorkspaceCLI(argv=process.argv.slice(2),{environment=process.env,stdout=process.stdout,signal}={}){
  const input=options(argv);
  if(input.help||['help','--help','-h'].includes(input.command)){stdout.write(HELP+'\n');return;}
  if(input.command==='request-id'){stdout.write(randomUUID()+'\n');return;}
  const local=Boolean(input.dir),remote=Boolean(input['url-file']||input['url-env']);
  need(local!==remote,'TYK_CLI_TARGET_REQUIRED','Choose the original directory or existing private HTTP connection.');
  if(input.command==='open'){
    need(local,'TYK_CLI_DIRECTORY_REQUIRED','Opening a workspace requires its original directory.');
    const declarations=input.connections?await jsonFile(input.connections):[];
    need(Array.isArray(declarations),'TYK_CONNECTIONS_INVALID','Use a JSON array of Gateway or Dashboard connections.');
    const port=input.port===undefined?0:Number(input.port);
    const server=await startTykWorkspaceServer({directory:resolve(input.dir),connections:declarations,environment,signal,port});
    let closing,resolveStopped;
    const stopped=new Promise(done=>{resolveStopped=done;});
    const close=()=>closing??=(async()=>{await server.close();resolveStopped();})();
    const onStop=()=>{void close().catch(error=>{process.stderr.write((error.code??'TYK_CLOSE_FAILED')+': '+error.message+'\n');process.exitCode=1;resolveStopped();});};
    process.once('SIGINT',onStop);process.once('SIGTERM',onStop);signal?.addEventListener('abort',onStop,{once:true});
    try{
      if(input['url-output'])await saveConnectionUrl(input['url-output'],server.url);
      await outputJSON({schema:'stellar-forge.tyk-workspace-listener.v1',workspaceId:server.workspaceId,
        directory:server.directory,origin:server.origin,url:server.url},undefined,stdout);
      if(signal?.aborted)onStop();await stopped;
    }finally{process.off('SIGINT',onStop);process.off('SIGTERM',onStop);signal?.removeEventListener('abort',onStop);await close();}
    return;
  }
  if(input.command==='call'){
    const args=input.input?await jsonFile(input.input):{};validateTykAction(input.method,args);
    if(remote){
      const client=await connection(input,environment,signal);
      try{
        if(input.output){const file=await client.actionToFile(input.method,args,resolve(input.output),{signal});
          await outputJSON({...file,workspaceId:client.workspaceId},undefined,stdout);}
        else await outputJSON(await client.action(input.method,args,{signal}),undefined,stdout);
      }finally{await client.close();}
    }else{
      const model=await openTykWorkspace({directory:resolve(input.dir),environment,signal});
      try{await outputJSON(await model[input.method]({...args,signal}),input.output,stdout);}
      finally{await model.close();}
    }
    return;
  }
  need(remote,'TYK_CLI_HTTP_CONNECTION_REQUIRED','Use the existing private workspace URL for complete file transfer.');
  const client=await connection(input,environment,signal);
  try{
    if(input.command==='download'){
      need(input.id&&input.output,'TYK_CLI_INPUT_REQUIRED','Select the saved delivery ID and output file.');
      await outputJSON(await client.downloadDelivery(input.id,resolve(input.output),{signal}),undefined,stdout);
    }else if(input.command==='inspect'){
      need(input.file&&input['request-id'],'TYK_CLI_INPUT_REQUIRED','Select the complete handover and original request ID.');
      await outputJSON(await client.inspectFile(resolve(input.file),{requestId:input['request-id'],
        label:input.label??basename(input.file),signal}),input.output,stdout);
    }else need(false,'TYK_CLI_COMMAND_INVALID','Choose open, call, download, inspect or request-id.');
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runTykWorkspaceCLI().catch(error=>{
    process.stderr.write(JSON.stringify({error:typeof error.code==='string'?error.code:'TYK_COMMAND_FAILED',message:error.message})+'\n');
    process.exitCode=1;
  });
}
