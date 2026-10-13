#!/usr/bin/env node
// MIT. Run the one existing, explicitly configured settlement stream.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJSON,need,publicError} from './lib/files.mjs';
import {startSettlementStreamWorker} from './lib/settlement-stream.mjs';
export async function runSettlementStreamCLI(argv=process.argv.slice(2)){
 if(argv.length===0||argv[0]==='--help'){
  process.stdout.write('node settlement-stream.mjs --directory /private/workspace --configuration /private/config.json --stream-id ORIGINAL_STREAM_ID\n');
  return;
 }
 const flags={};
 for(let i=0;i<argv.length;i+=2){
  need(['--directory','--configuration','--stream-id','--idle-ms'].includes(argv[i])&&argv[i+1]!==undefined,'STREAM_ARGUMENT_REQUIRED');
  const key=argv[i].slice(2);need(!Object.hasOwn(flags,key),'STREAM_DUPLICATE_ARGUMENT');flags[key]=argv[i+1];
 }
 need(flags.directory&&flags.configuration&&flags['stream-id'],'STREAM_ARGUMENT_REQUIRED');
 const configuration=await readJSON(path.resolve(flags.configuration));
 const worker=await startSettlementStreamWorker({directory:path.resolve(flags.directory),configuration,streamId:flags['stream-id'],
  ...(flags['idle-ms']?{idleMilliseconds:Number(flags['idle-ms'])}:{}),
  onResult:row=>process.stdout.write(JSON.stringify(row)+'\n')});
 const stop=()=>{worker.close().catch(()=>{});};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 process.stdout.write('PAYCASHLESS_SETTLEMENT_STREAM_READY '+JSON.stringify({streamId:worker.streamId,workspaceId:worker.workspace.describe().workspace.id,identity:worker.identity})+'\n');
 try{return await worker.done;}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 runSettlementStreamCLI().catch(error=>{process.stderr.write(JSON.stringify(publicError(error))+'\n');process.exitCode=1;});
}
