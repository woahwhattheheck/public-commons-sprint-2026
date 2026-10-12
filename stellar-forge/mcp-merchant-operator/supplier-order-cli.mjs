#!/usr/bin/env node
// MIT. Complete command-line access to the original supplier-order MCP client.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSupplierOrderClient, SUPPLIER_ORDER_CLIENT_METHODS } from './supplier-order-client.mjs';
import { supplierOrderTools } from './catalog/supplier-orders.mjs';
import { SUPPLIER_ORDER_PAGED_METHODS } from './supplier-order-contracts.mjs';

export const SUPPLIER_ORDER_CLIENT_HELP=[
  'Supplier-order client',
  '',
  '  supplier-order-client tools',
  '  supplier-order-client call METHOD --url MCP_URL --workspace ALIAS [--args REQUEST.json]',
  '  supplier-order-client pages METHOD --url MCP_URL --workspace ALIAS [--args PAGE.json]',
  '  supplier-order-client inspect --url MCP_URL --workspace ALIAS --export-id FILE_ID',
  '  supplier-order-client download --url MCP_URL --workspace ALIAS --export-id FILE_ID --out PRIVATE_DIRECTORY',
  '       [--manifest-sha256 SHA256] [--chunk-bytes BYTES]',
  '',
  'Common connection options: --token-env ENV_NAME and --timeout-ms MILLISECONDS.',
  'Methods: '+Object.keys(SUPPLIER_ORDER_CLIENT_METHODS).join(', ')+'.',
  'Paged methods: '+SUPPLIER_ORDER_PAGED_METHODS.join(', ')+'.',
  '',
  'Open and close are explicit call methods. Other commands reuse that same opened native workspace.',
  'Request JSON retains the original requestId, selected revisions, order-state hashes and complete document.',
  'Use saveDraftInput with a pinned host input for drafts larger than the 2 MiB tool request limit.',
  'A FAILED or INTERRUPTED operation is printed with its original identity before the command exits unsuccessfully.',
  'pages writes each complete page as one JSONL record, preserving original nextOffset and selected revision.',
  'download resumes the same exact manifest, endpoint, alias, original file ID and private output directory.',
  ''
].join('\n');
const failure=(code,message)=>Object.assign(new Error(message),{code});
async function write(stream,value){
  if(!stream.write(value))await once(stream,'drain');
}
function options(args,allowed){
  const result=new Map();
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!allowed.includes(key)||value===undefined||result.has(key))throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','Use each declared option once with its complete value.');
    result.set(key,value);
  }
  return result;
}
async function requestJson(path){
  if(path===undefined)return{};
  const file=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size<1n||before.size>2097152n)throw failure('SUPPLIER_ORDER_CLI_INPUT','Use one complete regular request JSON file of at most 2 MiB.');
    const bytes=Buffer.allocUnsafe(Number(before.size));let offset=0;
    while(offset<bytes.length){const part=await file.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!part.bytesRead)throw failure('SUPPLIER_ORDER_CLI_INPUT_CHANGED','The original request file ended early.');offset+=part.bytesRead;}
    const after=await file.stat({bigint:true});
    if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))
      throw failure('SUPPLIER_ORDER_CLI_INPUT_CHANGED','The original request file changed while it was read.');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw failure('SUPPLIER_ORDER_CLI_INPUT','The complete request must contain UTF-8 JSON.');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw failure('SUPPLIER_ORDER_CLI_INPUT','Use the complete original request object.');
    return value;
  }finally{await file.close();}
}
export async function main(args=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr,environment=process.env}={}){
  if(!args.length||args.length===1&&['help','--help'].includes(args[0])){
    await write(stdout,SUPPLIER_ORDER_CLIENT_HELP);return;
  }
  const [command,...rest]=args;
  if(command==='tools'){
    if(rest.length)throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','tools has no connection arguments.');
    const result={schema:'stellar-forge.supplier-order-client-tools.v1',methods:SUPPLIER_ORDER_CLIENT_METHODS,
      tools:supplierOrderTools((name,description,properties,required,annotations)=>({name,description,properties,required,annotations}))};
    await write(stdout,JSON.stringify(result,null,2)+'\n');return result;
  }
  const calling=['call','pages'].includes(command),method=calling?rest.shift():null;
  if(!['call','pages','inspect','download'].includes(command))throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','Choose tools, call, pages, inspect or download.');
  if(calling&&!Object.hasOwn(SUPPLIER_ORDER_CLIENT_METHODS,method))throw failure('SUPPLIER_ORDER_CLI_METHOD','Choose one complete method from tools.');
  if(command==='pages'&&!SUPPLIER_ORDER_PAGED_METHODS.includes(method))throw failure('SUPPLIER_ORDER_CLI_METHOD','Choose an original paged method.');
  const selected=options(rest,['--url','--workspace','--token-env','--timeout-ms',
    ...(calling?['--args']:['--export-id']),...(command==='download'?['--out','--manifest-sha256','--chunk-bytes']:[])]);
  for(const key of ['--url','--workspace',...(calling?[]:['--export-id']),...(command==='download'?['--out']:[])])
    if(!selected.has(key))throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','Supply '+key+'.');
  const rawTimeout=selected.get('--timeout-ms'),timeoutMs=rawTimeout===undefined?120000:Number(rawTimeout);
  if(rawTimeout!==undefined&&!/^[1-9][0-9]*$/.test(rawTimeout)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)
    throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','Use a call timeout from 1 to 3600000 milliseconds.');
  const rawChunk=selected.get('--chunk-bytes'),chunkSize=rawChunk===undefined?undefined:Number(rawChunk);
  if(rawChunk!==undefined&&(!/^[1-9][0-9]*$/.test(rawChunk)||!Number.isSafeInteger(chunkSize)||chunkSize>196608))
    throw failure('SUPPLIER_ORDER_CLI_ARGUMENTS','Use an original retained chunk size from 1 to 196608 bytes.');
  const controller=new AbortController(),stop=()=>controller.abort(failure('SUPPLIER_ORDER_CLI_INTERRUPTED','Continue the same original request or download after interruption.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const client=await createSupplierOrderClient({url:selected.get('--url'),workspace:selected.get('--workspace'),
      tokenEnv:selected.get('--token-env')??'MCP_ACCESS_TOKEN',environment,signal:controller.signal,
      callOptions:{timeoutMs,requestSignal:controller.signal}});
    let result;
    if(command==='call'){
      result=await client[method](await requestJson(selected.get('--args')));
      await write(stdout,JSON.stringify(result,null,2)+'\n');
      if(result.kind&&result.requestSha256&&result.state!=='COMPLETE'){
        const error=failure(result.error?.code??'SUPPLIER_ORDER_OPERATION_PENDING',result.error?.message??('The original operation is '+result.state+'.'));
        error.operation={id:result.id,kind:result.kind,state:result.state};throw error;
      }
      return result;
    }
    if(command==='pages'){
      let pages=0,items=0;
      for await(const page of client.pages(method,await requestJson(selected.get('--args')))){
        controller.signal.throwIfAborted();await write(stdout,JSON.stringify(page)+'\n');pages++;items+=page.items.length;
      }
      return{schema:'stellar-forge.supplier-order-client-pages.v1',method,pages,items};
    }
    if(command==='inspect')result=await client.inspectExport(selected.get('--export-id'));
    else result=await client.downloadExport({exportId:selected.get('--export-id'),directory:resolve(selected.get('--out')),chunkSize,
      expectedManifestSha256:selected.get('--manifest-sha256'),signal:controller.signal,
      onProgress:progress=>write(stderr,JSON.stringify(progress)+'\n')});
    await write(stdout,JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'SUPPLIER_ORDER_CLI_FAILED',message:error.message,
    ...(error.operation?{operation:error.operation}:{})}})+'\n');process.exitCode=2;});
