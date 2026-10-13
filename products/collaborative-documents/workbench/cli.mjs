import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApplicationServer } from './server.mjs';
import { inspectRuntime } from './native/selection.mjs';
import { hashFile } from './core/objects.mjs';
import { atomicBytes, requireValue, sha, publicError } from './core/common.mjs';
import { CHUNK_LIMIT } from './core/uploads.mjs';

const [command='help',...tail]=process.argv.slice(2),args={};
for(let i=0;i<tail.length;i++){requireValue(tail[i].startsWith('--'),'CLI_ARGUMENT','Use named command arguments.');args[tail[i].slice(2)]=tail[++i];}
const emit=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function request(path,{method='GET',value,bytes,headers={}}={}){
  const token=process.env[args['token-env']??'TIPTAP_OPERATOR_TOKEN'];requireValue(token,'AUTH_REQUIRED','Set the selected installation token environment variable; do not put it in an argument or URL.');
  const origin=new URL(args.origin);requireValue(['http:','https:'].includes(origin.protocol)&&!origin.username&&!origin.password,'INVALID_ORIGIN','Use the selected application HTTP(S) origin.');
  const response=await fetch(new URL(path,origin),{method,headers:{Authorization:'Bearer '+token,...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:value!==undefined?JSON.stringify(value):bytes});
  if(!response.ok){let value;try{value=await response.json();}catch{}const error=value?.error??{};throw Object.assign(new Error(error.message??'Original application request failed.'),{code:error.code??'HTTP_'+response.status,status:response.status,details:error.details});}
  return response;
}
async function upload(){
  const path=resolve(args.file),info=hashFile(path),uploadId=args['upload-id'];requireValue(uploadId,'UPLOAD_ID_REQUIRED','Keep the original upload ID for all resumed source chunks.');
  const filename=args.filename??path.split('/').at(-1),mediaType=args['media-type']??'application/octet-stream';
  let retained=await (await request('/api/uploads',{method:'POST',value:{uploadId,filename,mediaType,...info}})).json();
  const content=readFileSync(path);
  while(!retained.complete&&retained.offset<content.length){
    const start=retained.offset,end=Math.min(content.length,start+CHUNK_LIMIT),chunk=content.subarray(start,end);
    retained=await (await request('/api/uploads/'+encodeURIComponent(uploadId),{method:'PATCH',bytes:chunk,headers:{'Content-Range':'bytes '+start+'-'+(end-1)+'/'+content.length,'X-Chunk-SHA256':sha(chunk)}})).json();
  }
  return (await request('/api/uploads/'+encodeURIComponent(uploadId)+'/finish',{method:'POST',bytes:Buffer.alloc(0)})).json();
}
try{
  if(command==='help')process.stdout.write([
    'Original Tiptap/Hocuspocus operator','',
    '  node cli.mjs runtime',
    '  node cli.mjs serve --directory PRIVATE --auth PRIVATE_AUTH [--port 8785 --runtime-ready RECEIPT]',
    '  node cli.mjs list --origin URL',
    '  node cli.mjs show --origin URL --project ID [--revision N]',
    '  node cli.mjs create --origin URL --input EXACT_REQUEST_JSON',
    '  node cli.mjs action --origin URL --input EXACT_ACTION_JSON',
    '  node cli.mjs upload --origin URL --file SOURCE --upload-id ORIGINAL_ID [--media-type TYPE]',
    '  node cli.mjs receive --origin URL --project PLACEHOLDER --expected-revision N --request-id ORIGINAL_ID --upload-id ORIGINAL_UPLOAD --file HANDOFF',
    '  node cli.mjs download --origin URL --path ORIGINAL_API_DOWNLOAD --output FILE',
    '  node cli.mjs id','',
    'API commands read TIPTAP_OPERATOR_TOKEN (or --token-env NAME). Keep exact action inputs and original request/upload IDs for recovery. Downloads verify the full SHA and never replace different retained bytes.',''
  ].join('\n'));
  else if(command==='id')process.stdout.write(randomUUID()+'\n');
  else if(command==='runtime')emit(await inspectRuntime());
  else if(command==='serve'){
    const app=await createApplicationServer({directory:args.directory,authFile:args.auth,host:args.host??'127.0.0.1',port:args.port===undefined?8785:Number(args.port),runtimeReadyFile:args['runtime-ready'],publicOrigin:args['public-origin']});
    emit({origin:app.origin,instanceId:app.instanceId});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)).catch(error=>{emit({error:publicError(error)});process.exitCode=1;}));
  }
  else if(command==='list')emit(await (await request('/api/projects')).json());
  else if(command==='show')emit(await (await request('/api/projects/'+encodeURIComponent(args.project)+(args.revision!==undefined?'?revision='+encodeURIComponent(args.revision):''))).json());
  else if(command==='create'||command==='action'){const value=JSON.parse(readFileSync(resolve(args.input),'utf8'));emit(await (await request(command==='create'?'/api/projects':'/api/actions',{method:'POST',value})).json());}
  else if(command==='upload')emit(await upload());
  else if(command==='receive'){
    const uploaded=await upload();emit(await (await request('/api/actions',{method:'POST',value:{action:'handoff.receive',projectId:args.project,expectedRevision:Number(args['expected-revision']),requestId:args['request-id'],payload:{uploadId:uploaded.id}}})).json());
  }
  else if(command==='download'){
    requireValue(args.path.startsWith('/api/projects/')&&!args.path.includes('://'),'DOWNLOAD_ROUTE','Use a retained project download route.');
    const response=await request(args.path),bytes=Buffer.from(await response.arrayBuffer()),expected=response.headers.get('x-content-sha256');
    requireValue(expected&&sha(bytes)===expected,'DOWNLOAD_IDENTITY','The received file differs from its original complete SHA.',409);
    atomicBytes(resolve(args.output),bytes,{immutable:true});emit({path:resolve(args.output),bytes:bytes.length,sha256:expected,mediaType:response.headers.get('content-type'),contentDisposition:response.headers.get('content-disposition')});
  }else requireValue(false,'CLI_COMMAND','The selected original operator command is not supported.');
}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'ERROR',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;}
