#!/usr/bin/env node
// MIT. Operate the same saved commissioning contracts from the original workspace CLI.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRedisAuthoringWorkspace } from './model.mjs';

const HELP=[
  'Redis customer commissioning in an existing workspace',
  '  template --directory WORKSPACE [--revision SHA256]',
  '  review --directory WORKSPACE --input WORKBOOK_JSON',
  '  save --directory WORKSPACE --input WORKBOOK_JSON --request ID --review-digest SHA256',
  '  receive --directory WORKSPACE --contract SAVED_REQUEST --request ID',
  '  continue --directory WORKSPACE --id ORIGINAL_REQUEST',
  '  history --directory WORKSPACE [--after REQUEST] [--limit 20]',
  '  inspect --directory WORKSPACE --id REQUEST',
  '  rows --directory WORKSPACE --run REQUEST --check EXAMPLE [--cursor PAGE:ROW] [--limit 50]',
  '  handover --directory WORKSPACE --run REQUEST --request ID',
  '  export --directory WORKSPACE --id HANDOVER_REQUEST --output NEW_ZIP',
  '',
  'Close the existing browser workspace process before acquiring its original writer from this CLI.',
  'A browser operator can use Customer commissioning from the original workspace URL.',
].join('\n');
async function inputFile(path){
  const file=await open(resolve(path),'r');
  try{
    const before=await file.stat();
    if(!before.isFile()||before.size>5242880)throw new TypeError('Use a complete commissioning input or workbook within 5 MiB.');
    const bytes=Buffer.alloc(before.size+1);let size=0;
    while(size<bytes.length){const read=await file.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await file.stat();
    if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('The commissioning input changed while reading.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  }finally{await file.close();}
}
export async function redisCommissioningOperatorCli(args=process.argv.slice(2)){
  if(!args.length||args.length===1&&['help','--help'].includes(args[0])){process.stdout.write(HELP+'\n');return;}
  const [command,...rest]=args,options=new Map(),allowed={
    template:['directory','revision'],review:['directory','input'],save:['directory','input','request','review-digest'],
    receive:['directory','contract','request'],continue:['directory','id'],history:['directory','after','limit'],
    inspect:['directory','id'],rows:['directory','run','check','cursor','limit'],handover:['directory','run','request'],
    export:['directory','id','output'],
  };
  if(!Object.hasOwn(allowed,command))throw new TypeError(HELP);
  for(let index=0;index<rest.length;index+=2){
    const name=rest[index]?.slice(2),value=rest[index+1];
    if(!rest[index]?.startsWith('--')||!allowed[command].includes(name)||options.has(name)||!value||value.startsWith('--'))
      throw new TypeError('Use each supported flag and value once.\n'+HELP);
    options.set(name,value);
  }
  const required=name=>{const value=options.get(name);if(!value)throw new TypeError('Missing --'+name+'.');return value;};
  const workspace=await openRedisAuthoringWorkspace(required('directory'));let result;
  try{
    if(command==='template'){
      const selected=await workspace.commissioningTemplate({revisionId:options.get('revision')});
      result={schema:'stellar-forge.redis-commissioning-workbook.v1',...selected,note:''};
    }else if(command==='review'||command==='save'){
      const supplied=await inputFile(required('input'));
      const input=supplied.schema==='stellar-forge.redis-commissioning-input.v1'
        ?{revisionId:workspace.metadata().head,input:supplied,customerPlan:null}
        :supplied.schema==='stellar-forge.redis-commissioning-workbook.v1'
          ?{revisionId:supplied.revisionId,input:supplied.input,customerPlan:supplied.customerPlan??null}:null;
      if(!input)throw new TypeError('Choose an original commissioning input or workbook.');
      result=command==='review'?await workspace.commissioningReview(input):
        await workspace.commissioningSave({...input,requestId:required('request'),digest:required('review-digest'),note:supplied.note??''});
    }else if(command==='receive'||command==='handover'){
      const id=required('request');
      if(command==='receive')workspace.commissioningReceive({requestId:id,contractId:required('contract')});
      else await workspace.commissioningHandover({requestId:id,runId:required('run')});
      await workspace.queue;result=workspace.operation(id);
    }else if(command==='continue'){
      const id=required('id'),record=workspace.operation(id);
      if(record.kind==='commission-contract')await workspace.resume(id);
      else workspace.commissioningContinue(id);
      await workspace.queue;result=workspace.operation(id);
    }else if(command==='history')result=await workspace.commissioningHistory({after:options.get('after')??'',limit:Number(options.get('limit')??20)});
    else if(command==='inspect'){
      result=workspace.operation(required('id'));
      if(!result.kind.startsWith('commission-'))throw new TypeError('Choose an original commissioning operation.');
    }else if(command==='rows')result=await workspace.commissioningRows({runId:required('run'),checkId:required('check'),cursor:options.get('cursor')??'',limit:Number(options.get('limit')??50)});
    else if(command==='export'){
      const file=await workspace.commissioningFile(required('id')),path=resolve(required('output')),output=await open(path,'wx',0o600);
      try{await output.writeFile(file.bytes);await output.sync();}finally{await output.close();}
      result={path,name:file.name,bytes:file.bytes.length,sha256:file.sha256};
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(result?.status==='FAILED')process.exitCode=1;
    if(result?.result?.status==='ACCEPTANCE_MISMATCH')process.exitCode=2;
    return result;
  }finally{await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  redisCommissioningOperatorCli().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'REDIS_COMMISSIONING_FAILED',message:error.message})+'\n');process.exitCode=1;});
