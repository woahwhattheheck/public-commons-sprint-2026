#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspectDestination,previewRelease,applyRelease,readbackRelease,rollbackRelease,snapshotDestinationPost,bindDestinationItem } from './wordpress.mjs';

const args=process.argv.slice(2),command=args.shift(),options={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Use named --option value arguments.');options[args[i].slice(2)]=args[++i];}
const required=name=>{if(!options[name])throw new Error('Provide --'+name+'.');return options[name];};
try{
  const config=JSON.parse(await readFile(resolve(required('config')),'utf8'));let result;
  if(command==='inspect')result=await inspectDestination(config);
  else if(command==='preview'||command==='apply'){
    const input={manifestBytes:await readFile(resolve(required('manifest'))),sha256:required('sha256')};
    if(command==='apply'){input.operationId=required('operation');input.planSha256=required('plan-sha256');}
    result=await(command==='preview'?previewRelease(config,input):applyRelease(config,input));
  }else if(command==='readback')result=await readbackRelease(config,{releaseId:required('release')});
  else if(command==='rollback')result=await rollbackRelease(config,{releaseId:required('release'),operationId:required('operation')});
  else if(command==='native')result=await snapshotDestinationPost(config,{postId:Number(required('post-id'))});
  else if(command==='bind')result=await bindDestinationItem(config,{sourceOrigin:required('source-origin'),source:{kind:required('source-kind'),wpId:Number(required('source-id'))},postId:Number(required('post-id')),expectedFingerprint:required('fingerprint')});
  else throw new Error('Choose inspect, preview, apply, readback, rollback, native or bind. See destination/WORDPRESS.md.');
  const bytes=JSON.stringify(result,null,2)+'\n';if(options.out)await writeFile(resolve(options.out),bytes,{flag:'wx',mode:0o600});else process.stdout.write(bytes);
  if(result.status==='CONFLICT'||result.status==='PARTIALLY_ROLLED_BACK')process.exitCode=2;
}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code||'destination_command',message:error.message,status:error.status,detail:error.detail}},null,2)+'\n');process.exitCode=1;}
