#!/usr/bin/env node
import { readFileSync,existsSync,mkdirSync,openSync,closeSync,readSync,copyFileSync,fsyncSync,renameSync,unlinkSync,constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join,resolve,dirname,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createApplicationServer } from './application/server.mjs';
import { Workspace } from './application/workspace.mjs';
import { hashFile } from './vendor/dlt/vendor/sling/core/objects.mjs';
import { atomicJson,identity,sha,requireValue,id,integer,now,fsyncDirectory } from './vendor/dlt/vendor/sling/core/common.mjs';
const ROOT=resolve(fileURLToPath(new URL('.',import.meta.url)));
const HELP='Definian Migration Acceptance\n\n'+
'node cli.mjs serve --directory PRIVATE --auth PRIVATE_AUTH.json [--runtime-ready READY --python PYTHON --host 127.0.0.1 --port 8781]\n'+
'node cli.mjs list --directory PRIVATE\n'+
'node cli.mjs create --directory PRIVATE --request-id ID --title TITLE [--notes TEXT]\n'+
'node cli.mjs show --directory PRIVATE --project ID [--revision N]\n'+
'node cli.mjs retain --directory PRIVATE --project ID --request-id ID --file ORIGINAL --role ROLE --title TITLE [--source-url URL]\n'+
'node cli.mjs action --directory PRIVATE --input EXACT_REQUEST.json\n'+
'node cli.mjs download --directory PRIVATE --project ID --kind plan|replication|comparison|observations|handoff|downstream --id ID --output FILE [--revision N]\n'+
'node cli.mjs receive --directory PRIVATE --project RECEIVING_PROJECT --request-id ID --file COMPLETE.ndjson [original .ndjson.gz also accepted]\n'+
'node cli.mjs inspect-package --directory PRIVATE --file COMPLETE.ndjson [original .ndjson.gz also accepted]\n'+
'node cli.mjs consumer --directory PRIVATE --project ID --stream JSON_STREAM_ID [--offset N --limit N]\n\n'+
'Local commands use the owned private workspace and its original cross-process writer lease.\n'+
'--actor names the local operator (default local-console). Never open a second writer while the server owns the workspace.\n'+
'Every mutation keeps its exact request in cli-requests before dispatch. Reuse the original request ID and file to continue.\n'+
'The original locked dlt/DuckDB runtime and complete pipeline state remain bound to every native stage.\n';
function args(argv){const [command='help',...rest]=argv,options={};for(let i=0;i<rest.length;i++){const key=rest[i];requireValue(key.startsWith('--')&&rest[i+1]&&!rest[i+1].startsWith('--'),'ARGUMENT','Options use --name VALUE.');requireValue(!Object.hasOwn(options,key.slice(2)),'ARGUMENT','An option cannot be repeated.');options[key.slice(2)]=rest[++i];}return{command,options};}
const json=v=>JSON.stringify(v,null,2)+'\n';
function selected(v,name){requireValue(typeof v==='string'&&v.length>0,'ARGUMENT','Supply --'+name+'.');return v;}
async function upload(workspace,actor,file,requestId){
  const path=resolve(file),info=hashFile(path),uploadId='cli_'+identity({actorId:actor.id,requestId,sha256:info.sha256}).slice(0,32);
  let current=await workspace.uploads.start(actor,{uploadId,filename:basename(path),mediaType:path.endsWith('.ndjson')?'application/x-ndjson':path.endsWith('.json')?'application/json':path.endsWith('.gz')?'application/gzip':'application/octet-stream',...info});
  const fd=openSync(path,'r');try{
    const buffer=Buffer.alloc(8*1024*1024);
    while(current.offset<info.bytes){const start=current.offset,n=readSync(fd,buffer,0,Math.min(buffer.length,info.bytes-start),start);requireValue(n>0,'UPLOAD_SOURCE','The original source ended before its declared length.');const body=buffer.subarray(0,n);current=await workspace.uploads.chunk(actor,uploadId,{start,end:start+n-1,total:info.bytes,sha256:sha(body)},body);}
  }finally{closeSync(fd);}
  await workspace.uploads.finish(actor,uploadId);return{uploadId,...info};
}
function retainedInput(workspace,actor,requestId,intent,make){
  id(requestId,'requestId');const path=join(workspace.directory,'cli-requests',identity({actorId:actor.id,requestId})+'.json');
  if(existsSync(path)){const old=JSON.parse(readFileSync(path));requireValue(old.intentSha256===identity(intent),'CLI_REQUEST_CHANGED','The original CLI request already has another complete input.',409);return old.input;}
  const input=make();atomicJson(path,{schema:'tjlabs.sling-cli-request.v1',actorId:actor.id,requestId,intentSha256:identity(intent),input,createdAt:now()},{immutable:true});return input;
}
function saveDownload(path,source,expected){
  const out=resolve(path);mkdirSync(dirname(out),{recursive:true,mode:0o700});
  if(existsSync(out)){const info=hashFile(out);requireValue(info.sha256===expected.sha256&&info.bytes===expected.bytes,'OUTPUT_CHANGED','The selected output path contains another retained edition.',409);}
  else{const temp=out+'.receiving-'+randomUUID();try{copyFileSync(source,temp,constants.COPYFILE_EXCL);const info=hashFile(temp);requireValue(info.sha256===expected.sha256&&info.bytes===expected.bytes,'OUTPUT_CHANGED','The copied output does not match its original bytes.',409);const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,out);fsyncDirectory(dirname(out));}catch(error){try{unlinkSync(temp);}catch{}throw error;}}
  return{path:out,...expected};
}
export async function main(argv=process.argv.slice(2)){
  const {command,options:o}=args(argv);
  if(['help','--help','-h'].includes(command)){process.stdout.write(HELP);return;}
  const directory=resolve(selected(o.directory,'directory')),python=o.python??'python3';
  if(command==='serve'){
    const app=await createApplicationServer({directory,authFile:resolve(selected(o.auth,'auth')),runtimeReadyFile:o['runtime-ready']?resolve(o['runtime-ready']):undefined,python,consumerRoot:o['consumer-root']?resolve(o['consumer-root']):undefined});
    const info=await app.listen({host:o.host??'127.0.0.1',port:Number(o.port??8781)});process.stdout.write(json(info));
    let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};process.once('SIGTERM',()=>close().then(()=>process.exit(0)));process.once('SIGINT',()=>close().then(()=>process.exit(0)));return;
  }
  const workspace=await Workspace.open({directory,sourceRoot:ROOT,runtimeReadyFile:o['runtime-ready']?resolve(o['runtime-ready']):undefined,python,consumerRoot:o['consumer-root']?resolve(o['consumer-root']):undefined});
  const actor={id:id(o.actor??'local-console','actor'),name:o.actor??'Local console',roles:['operator']};
  try{
    let result;
    if(command==='list')result=workspace.list(actor);
    else if(command==='create'){
      const requestId=selected(o['request-id'],'request-id'),intent={command,title:selected(o.title,'title'),notes:o.notes??''};
      const input=retainedInput(workspace,actor,requestId,intent,()=>({requestId,title:intent.title,notes:intent.notes}));result=workspace.create(actor,input);
    }else if(command==='show')result=await workspace.get(actor,id(selected(o.project,'project')),o.revision===undefined?undefined:integer(Number(o.revision),'revision'));
    else if(command==='action'){
      const path=resolve(selected(o.input,'input')),supplied=JSON.parse(readFileSync(path));id(supplied.requestId,'requestId');const input=retainedInput(workspace,actor,supplied.requestId,supplied,()=>supplied);result=await workspace.dispatch(actor,input);
    }else if(command==='retain'||command==='receive'){
      const requestId=selected(o['request-id'],'request-id'),projectId=id(selected(o.project,'project')),file=resolve(selected(o.file,'file')),info=hashFile(file);
      const intent={command,projectId,source:info,title:o.title??basename(file),role:o.role??'other',sourceUrl:o['source-url']??'',notes:o.notes??''};
      const input=retainedInput(workspace,actor,requestId,intent,()=>{
        const uploadId='cli_'+identity({actorId:actor.id,requestId,sha256:info.sha256}).slice(0,32);
        return{projectId,requestId,expectedRevision:workspace.store.head(projectId),action:command==='receive'?'handoff.receive':'source.retain',payload:command==='receive'?{uploadId}:{uploadId,title:intent.title,role:intent.role,url:intent.sourceUrl,notes:intent.notes}};
      });
      const old=workspace.store.request(actor.id,requestId,input);
      if(!old)await upload(workspace,actor,file,requestId);
      result=await workspace.dispatch(actor,input);
    }else if(command==='download'){
      const item=await workspace.readObject(actor,id(selected(o.project,'project')),selected(o.kind,'kind'),id(selected(o.id,'id')),o.revision===undefined?undefined:integer(Number(o.revision),'revision'));
      result=saveDownload(selected(o.output,'output'),item.path,item.descriptor);
    }else if(command==='inspect-package'){
      const packet=await workspace.archives.inspect(resolve(selected(o.file,'file')),{retainObjects:false});
      result={header:packet.header,headerSha256:packet.headerSha,archiveSha256:packet.archiveSha256,versions:packet.versions.length,requests:packet.requests.length,unpackedBytes:packet.unpackedBytes,acceptanceValidation:packet.acceptanceValidation};
    }else if(command==='consumer'){
      const projectId=id(selected(o.project,'project'));await workspace.get(actor,projectId);
      result=workspace.consumer(actor,projectId,{streamId:o.stream,offset:Number(o.offset??0),limit:Number(o.limit??100)});
    }else requireValue(false,'COMMAND','Select one documented CLI command.');
    process.stdout.write(json(result));
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code??'OPERATION_FAILED',message:e.message,details:e.details??{}})+'\n');process.exitCode=1;});
