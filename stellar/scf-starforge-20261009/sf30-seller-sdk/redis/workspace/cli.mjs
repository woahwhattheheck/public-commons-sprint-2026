#!/usr/bin/env node
// MIT. Same retained Redis authoring workspace for terminal and browser operators.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRedisAuthoringWorkspace, openRedisAuthoringWorkspace, redisWorkspaceBinding } from './model.mjs';
import { startRedisAuthoringServer } from './server.mjs';

const HELP = [
  'Redis merchant workspace (Node 22.16+)',
  '  create     --directory NEW --source SOURCE_JSON --plan PLAN_JSON [--label NAME]',
  '  open       --directory WORKSPACE [--port 8438] [--expected-workspace-id ID] [--expected-profile-sha256 SHA256]',
  '  inspect    --directory WORKSPACE',
  '  revisions  --directory WORKSPACE [--after REVISION] [--limit 30]',
  '  operations --directory WORKSPACE [--after REQUEST_ID] [--limit 30]',
  '  revision   --directory WORKSPACE --id REVISION',
  '  operation  --directory WORKSPACE --id REQUEST_ID',
  '  review     --directory WORKSPACE --input REVIEW_JSON',
  '  save       --directory WORKSPACE --input SAVE_JSON',
  '  restore    --directory WORKSPACE --input RESTORE_JSON',
  '  preview    --directory WORKSPACE --input PREVIEW_JSON',
  '  prepare    --directory WORKSPACE --input PREPARE_JSON',
  '  stage      --directory WORKSPACE --input STAGE_JSON',
  '  resume     --directory WORKSPACE --id REQUEST_ID',
  '  export     --directory WORKSPACE --package REQUEST_ID --name CUSTOMER_FILE --output NEW_FILE',
  '',
  'Mutating JSON inputs carry requestId and their exact selected revision.',
  'Open owns the workspace until SIGINT/SIGTERM; close it before using a terminal command.',
  'Credentials come from the imported connection host environment references.',
  'Saved operations and outcomes remain in the workspace after the process closes.',
].join('\n');
async function readJson(filename){
  const file=await open(resolve(filename),'r');
  try{
    const before=await file.stat();
    if(!before.isFile()||before.size>524288)throw new TypeError('Use an operation JSON file within 512 KiB.');
    const data=Buffer.alloc(before.size+1);let size=0;
    while(size<data.length){const result=await file.read(data,size,data.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}
    const after=await file.stat();
    if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('The operation input changed during reading.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,size)));
  }finally{await file.close();}
}
function integer(value,label,fallback){
  value??=String(fallback);
  if(!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new TypeError('Use a whole number for '+label+'.');
  return Number(value);
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['--help','help'].includes(args[0])){process.stdout.write(HELP+'\n');return;}
  const [command,...tail]=args,options=new Map(),allowed={
    create:['directory','source','plan','label'],open:['directory','port','expected-workspace-id','expected-profile-sha256'],inspect:['directory'],
    revisions:['directory','after','limit'],operations:['directory','after','limit'],
    revision:['directory','id'],operation:['directory','id'],
    review:['directory','input'],save:['directory','input'],restore:['directory','input'],
    preview:['directory','input'],prepare:['directory','input'],stage:['directory','input'],
    resume:['directory','id'],export:['directory','package','name','output'],
  };
  if(!Object.hasOwn(allowed,command))throw new TypeError(HELP);
  for(let i=0;i<tail.length;i+=2){
    const key=tail[i]?.slice(2),value=tail[i+1];
    if(!tail[i]?.startsWith('--')||!allowed[command].includes(key)||options.has(key)||typeof value!=='string'||!value||value.startsWith('--'))
      throw new TypeError('Use each supported flag and value once.\n'+HELP);
    options.set(key,value);
  }
  function required(key){if(!options.has(key))throw new TypeError('Missing --'+key+'.');return options.get(key);}
  const directory=required('directory');
  let workspace=command==='create'
    ?await createRedisAuthoringWorkspace({directory,sourceFile:required('source'),planFile:required('plan'),label:options.get('label')})
    :await openRedisAuthoringWorkspace(directory,{expectedWorkspaceId:options.get('expected-workspace-id'),
      expectedProfileSha256:options.get('expected-profile-sha256')}),session;
  try{
    if(command==='open'){
      const selected=redisWorkspaceBinding(workspace.metadata());
      session=await startRedisAuthoringServer({workspace,port:integer(options.get('port'),'port',8438)});
      process.stdout.write(JSON.stringify({schema:'stellar-forge.redis-workspace-startup.v1',status:'REDIS_WORKSPACE_READY',
        workspaceId:selected.workspaceId,profileSha256:selected.profileSha256,head:selected.head,
        directory:workspace.root,operatorUrl:session.operatorUrl})+'\n');
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>session.close().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));
      return session;
    }
    let result;
    if(command==='create'||command==='inspect')result=workspace.state();
    else if(['revisions','operations'].includes(command)){
      const page=workspace.page(command,{after:options.get('after')??'',limit:integer(options.get('limit'),'limit',30)});
      result={...page,items:page.items.map(item=>command==='revisions'?workspace.summary(item):workspace.operationSummary(item))};
    }else if(command==='revision'||command==='operation')result=workspace[command](required('id'));
    else if(command==='resume')result=await workspace.resume(required('id'));
    else if(command==='export'){
      const file=await workspace.file(required('package'),required('name')),target=resolve(required('output'));
      const output=await open(target,'wx',0o600);
      try{await output.writeFile(file.bytes);await output.sync();}finally{await output.close();}
      result={path:target,name:file.name,bytes:file.bytes.length};
    }else result=await workspace[command](await readJson(required('input')));
    process.stdout.write(JSON.stringify(result)+'\n');
    if(result?.status==='FAILED')process.exitCode=1;
    return result;
  }finally{if(!session)await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'REDIS_WORKSPACE_FAILED',message:error.message})+'\n');process.exitCode=1;});
