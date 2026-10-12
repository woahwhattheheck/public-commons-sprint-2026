#!/usr/bin/env node
// MIT. Operate the original paired receiving directories through the same model.
import {open,lstat,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openRedisCutoverWorkspace} from './cutover-workspace.mjs';
import {startRedisCutoverServer} from './cutover-server.mjs';
import {redisCutoverTemplate,readRedisCutoverJson} from './cutover.mjs';
import {redisCutoverFileDigest} from './cutover-files.mjs';
import {acquirePrivateDirectoryWriter} from '../../operations/history.mjs';

const HELP=[
  'Redis / Valkey application cutover operator',
  '  template',
  '  open --directory ORIGINAL [--input COMPLETE_JSON] [--port 8440]',
  '  status --directory ORIGINAL [--edition original]',
  '  review --directory ORIGINAL [--edition original] [--input COMPLETE_JSON]',
  '  save --directory ORIGINAL --input COMPLETE_JSON --request ID --expected-draft SHA256_OR_none [--edition original]',
  '  start --directory ORIGINAL --mode create|receive|compare|handover --review-digest SHA256 [--edition original]',
  '  continue --directory ORIGINAL [--edition original]',
  '  new-edition --directory ORIGINAL --operation ID --request ID --source-sha SHA256 --note TEXT [--edition original]',
  '  history --directory ORIGINAL [--after EDITION] [--limit 25]',
  '  difference --directory ORIGINAL --check ID --kind changed|removed|added [--offset 0] [--limit 25] [--edition original]',
  '  export --directory ORIGINAL --kind input|difference|handover --output FILE [--check ID] [--edition original]',
  '',
  'Start and Continue keep the original operation attached until its retained result returns.',
  'SIGINT/SIGTERM pause between retained native operations and close the original workspace owners.',
  'Export resumes only a verified prefix of the same complete original file; a complete identical output is reused.',
].join('\n');
const encode=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const issue=(code,message)=>Object.assign(new Error(message),{code});
async function sync(directory){const file=await open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function exportFile(original,path,sourceDirectory){
  const target=resolve(path),directory=dirname(target);
  const existing=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing){
    const actual=await redisCutoverFileDigest(target,{sha256:original.sha256,maximum:536870912});
    if(actual.bytes!==original.bytes)throw issue('REDIS_CUTOVER_EXPORT_CHANGED','The existing output has a different original length.');
    return {path:target,...actual,reused:true,resumedBytes:original.bytes};
  }
  const staging=join(directory,'.'+basename(target)+'.cutover-'+sha(sourceDirectory+'\n'+original.sha256)+'.partial');
  let file;
  try{file=await open(staging,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);}
  catch(error){if(error.code!=='EEXIST')throw error;file=await open(staging,constants.O_RDWR|(constants.O_NOFOLLOW??0));}
  let initial;
  try{
    initial=await file.stat({bigint:true});
    if(!initial.isFile()||initial.nlink!==1n||initial.size>BigInt(original.bytes)||process.platform!=='win32'&&
        ((Number(initial.mode)&0o077)||typeof process.getuid==='function'&&initial.uid!==BigInt(process.getuid())))
      throw issue('REDIS_CUTOVER_EXPORT_STAGE_CHANGED','Keep the original owner-private export prefix.');
    // The selected source is already fully verified. Hold its original handle
    // and compare every existing byte before appending any missing byte.
    let offset=0;const saved=Number(initial.size),digest=createHash('sha256');
    for await(const chunk of original.stream()){
      const bytes=Buffer.from(chunk);digest.update(bytes);
      const retained=Math.max(0,Math.min(bytes.length,saved-offset));
      if(retained){
        const before=Buffer.allocUnsafe(retained);let read=0;
        while(read<retained){const value=await file.read(before,read,retained-read,offset+read);
          if(!value.bytesRead)throw issue('REDIS_CUTOVER_EXPORT_STAGE_CHANGED','The retained export prefix ended unexpectedly.');read+=value.bytesRead;}
        if(!before.equals(bytes.subarray(0,retained)))
          throw issue('REDIS_CUTOVER_EXPORT_STAGE_CHANGED','The retained output prefix differs from the complete original file.');
      }
      if(retained<bytes.length){
        let written=retained;
        while(written<bytes.length){const value=await file.write(bytes,written,bytes.length-written,offset+written);
          if(!value.bytesWritten)throw issue('REDIS_CUTOVER_EXPORT_WRITE_INCOMPLETE','The original export stopped writing.');written+=value.bytesWritten;}
      }
      offset+=bytes.length;
    }
    if(offset!==original.bytes||digest.digest('hex')!==original.sha256)
      throw issue('REDIS_CUTOVER_EXPORT_SOURCE_CHANGED','The complete export source changed.');
    await file.sync();
    const final=await file.stat({bigint:true}),named=await lstat(staging,{bigint:true});
    if(final.size!==BigInt(original.bytes)||final.dev!==initial.dev||final.ino!==initial.ino||
        named.dev!==initial.dev||named.ino!==initial.ino||named.nlink!==1n||named.isSymbolicLink())
      throw issue('REDIS_CUTOVER_EXPORT_STAGE_CHANGED','The original export staging path changed before publication.');
    await redisCutoverFileDigest(staging,{sha256:original.sha256,maximum:536870912});
    try{await link(staging,target);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const actual=await redisCutoverFileDigest(target,{sha256:original.sha256,maximum:536870912});
      if(actual.bytes!==original.bytes)throw issue('REDIS_CUTOVER_EXPORT_CHANGED','The concurrent complete output differs.');
    }
    await sync(directory);await unlink(staging);await sync(directory);
    return {path:target,bytes:original.bytes,sha256:original.sha256,reused:false,resumedBytes:saved};
  }finally{await file?.close();}
}
export async function redisCutoverOperatorCli(args=process.argv.slice(2),{environment=process.env}={}){
  if(!args.length||args.length===1&&['help','--help'].includes(args[0])){process.stdout.write(HELP+'\n');return;}
  if(args.length===1&&args[0]==='template'){const result=await redisCutoverTemplate();process.stdout.write(encode(result));return result;}
  const [command,...rest]=args,options=new Map(),allowed={
    open:['directory','input','port'],status:['directory','edition'],review:['directory','edition','input'],
    save:['directory','edition','input','request','expected-draft'],start:['directory','edition','mode','review-digest'],
    continue:['directory','edition'],history:['directory','after','limit'],
    'new-edition':['directory','edition','operation','request','source-sha','note'],
    difference:['directory','edition','check','kind','offset','limit'],export:['directory','edition','kind','check','output'],
  };
  if(!Object.hasOwn(allowed,command))throw new TypeError(HELP);
  for(let i=0;i<rest.length;i+=2){
    const name=rest[i]?.slice(2),value=rest[i+1];
    if(!rest[i]?.startsWith('--')||!allowed[command].includes(name)||options.has(name)||value===undefined||value.startsWith('--'))
      throw new TypeError('Use each supported flag and value once.\n'+HELP);
    options.set(name,value);
  }
  const required=name=>{const value=options.get(name);if(!value)throw new TypeError('Missing --'+name+'.');return value;};
  const input=options.has('input')?await readRedisCutoverJson(resolve(options.get('input')),8388608):null;
  const workspace=await openRedisCutoverWorkspace({directory:required('directory'),environment,
    ...(input&&command==='open'?{input:input.value,inputSha256:input.sha256}:{})});
  const edition=options.get('edition')??'original';let server,result,signalTask=null,stopRequested=false;
  const close=()=>{stopRequested=true;if(!signalTask)signalTask=(server?server.close():workspace.close()).catch(error=>{
    process.stderr.write(encode({error:error.code??'REDIS_CUTOVER_CLOSE_FAILED',message:error.message}));process.exitCode=1;});};
  process.once('SIGINT',close);process.once('SIGTERM',close);
  try{
    if(command==='open'){
      server=await startRedisCutoverServer({workspace,port:Number(options.get('port')??8440)});
      if(stopRequested){await server.close();await signalTask;return;}
      const state=await workspace.state({edition});
      result={schema:'stellar-forge.redis-cutover-operator-ready.v1',status:'REDIS_CUTOVER_OPERATOR_READY',
        directory:workspace.root,operatorUrl:server.operatorUrl,operationId:state.operationId,inputSha256:state.inputSha256};
      if(stopRequested){await server.close();await signalTask;return;}
      process.stdout.write(encode(result));
      if(server.server.listening)await new Promise(done=>server.server.once('close',done));return result;
    }
    if(command==='status')result=await workspace.state({edition});
    else if(command==='review')result=await workspace.review({edition,...(input?{input:input.value}:{})});
    else if(command==='save'){
      if(!input)throw new TypeError('Choose the complete --input file.');
      const expected=required('expected-draft');
      result=await workspace.save({edition,input:input.value,requestId:required('request'),expectedDraftSha256:expected==='none'?null:expected});
    }else if(command==='start'){
      await workspace.start({edition,mode:required('mode'),digest:required('review-digest')});
      result=await workspace.wait({edition});
    }else if(command==='continue'){
      await workspace.continue({edition});result=await workspace.wait({edition});
    }else if(command==='history')result=await workspace.history({after:options.get('after')??'',limit:Number(options.get('limit')??25)});
    else if(command==='new-edition')result=await workspace.newEdition({edition,operationId:required('operation'),
      requestId:required('request'),sourceInputCanonicalSha256:required('source-sha'),note:required('note')});
    else if(command==='difference')result=await workspace.difference({edition,checkId:required('check'),kind:required('kind'),
      offset:Number(options.get('offset')??0),limit:Number(options.get('limit')??25)});
    else if(command==='export'){
      const sourceDirectory=await workspace.path(edition),lease=await acquirePrivateDirectoryWriter(sourceDirectory);
      let original;
      try{original=await workspace.file({edition,kind:required('kind'),...(options.has('check')?{checkId:options.get('check')}:{})});
        result=await exportFile(original,required('output'),sourceDirectory);}
      finally{await original?.close();await lease.release();}
    }
    process.stdout.write(encode(result));
    if(result?.lastFailure||result?.state==='FAILED')process.exitCode=1;
    else if(result?.result?.status==='CONTRACT_MISMATCH')process.exitCode=2;
    return result;
  }finally{
    process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);
    if(server)await server.close();else await workspace.close();await signalTask;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  redisCutoverOperatorCli().catch(error=>{process.stderr.write(encode({error:error.code??'REDIS_CUTOVER_OPERATOR_FAILED',
    message:error.message,details:error.details??null}));process.exitCode=1;});
