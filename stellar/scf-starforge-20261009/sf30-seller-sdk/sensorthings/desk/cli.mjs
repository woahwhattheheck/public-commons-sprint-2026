#!/usr/bin/env node
// MIT. Launch/reopen the same native Desk; the managed Applications owner supervises this command.
import {resolve,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned,atomicJSON} from '../../stellar-expert/store.mjs';
import {serveSensorThingsDesk} from './server.mjs';
import {fault} from '../contract.mjs';
function options(args){
  const out={},allowed=new Set(['--workspace','--source-inbox','--buyer-workspace','--release-runtime','--expected-workspace-id','--host','--port']);
  for(let i=0;i<args.length;i++){const key=args[i];if(!allowed.has(key)||Object.hasOwn(out,key)||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))throw fault('DESK_ARGUMENT','Use one value for each declared native Desk option.');out[key]=args[++i];}
  for(const key of ['--workspace','--source-inbox','--buyer-workspace','--release-runtime'])if(out[key]!==undefined&&(!isAbsolute(out[key])||resolve(out[key])!==out[key]))throw fault('DESK_ARGUMENT','Use an absolute canonical private path for '+key+'.');
  if(!out['--workspace'])throw fault('DESK_ARGUMENT','Supply the original private workspace directory.');
  if(out['--source-inbox']&&(out['--source-inbox']===out['--workspace']||out['--source-inbox'].startsWith(out['--workspace']+'/')))throw fault('DESK_INBOX_BINDING','Select the source inbox separately from the native workspace and its private state.');
  if(out['--port']!==undefined&&!/^(0|[1-9]\d*)$/.test(out['--port']))throw fault('DESK_ARGUMENT','Use an integer local port.');
  const port=Number(out['--port']??0);if(!Number.isSafeInteger(port)||port<0||port>65535)throw fault('DESK_ARGUMENT','Use a local port from 0 to 65535.');
  return {directory:out['--workspace'],sourceInboxDirectory:out['--source-inbox'],buyerWorkspaceDirectory:out['--buyer-workspace'],
    releaseRuntimeFile:out['--release-runtime'],expectedWorkspaceId:out['--expected-workspace-id'],host:out['--host']??'127.0.0.1',port};
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&args[0]==='--help'){console.log('sensorthings-desk --workspace ABSOLUTE_PRIVATE_DIRECTORY [--source-inbox ABSOLUTE_PRIVATE_DIRECTORY] [--buyer-workspace ABSOLUTE_PRIVATE_DIRECTORY] [--release-runtime PRIVATE_JSON] [--expected-workspace-id UUID] [--port 0]\nOpens the original native workspace, private session, complete Operations Desk and source-file receiving.');return;}
  const selected=options(args);if(selected.releaseRuntimeFile){let runtime;try{runtime=JSON.parse((await readOwned(selected.releaseRuntimeFile,65536)).toString('utf8'));}catch(e){throw fault('DESK_RUNTIME','Read the original private merchant runtime JSON: '+e.message);}
    if(!runtime||typeof runtime!=='object'||Array.isArray(runtime))throw fault('DESK_RUNTIME','Use the original native runtime settings object.');selected.releaseRuntime=runtime;}
  const running=await serveSensorThingsDesk(selected);let finish,closing=false;
  const stopped=new Promise(resolve=>{finish=resolve;});
  const close=async()=>{if(closing)return;closing=true;try{await running.close();finish();}catch(e){finish(e);}};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  process.stdout.write(JSON.stringify(running.record)+'\n');
  try{const error=await stopped;if(error)throw error;}finally{process.off('SIGTERM',close);process.off('SIGINT',close);await running.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code??'DESK_FAILED',message:e.message})+'\n');process.exitCode=1;});
