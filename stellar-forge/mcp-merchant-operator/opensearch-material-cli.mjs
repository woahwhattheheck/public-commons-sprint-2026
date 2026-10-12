#!/usr/bin/env node
// MIT. Operator CLI for the original material/supplier MCP and complete export receiver.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createOpenSearchMaterialClient, OPENSEARCH_MATERIAL_CLIENT_METHODS } from './opensearch-material-client.mjs';
import { openSearchMaterialTools } from './catalog/opensearch-materials.mjs';

const MAX_INPUT_BYTES=2097152;
const failure=(code,message)=>Object.assign(new Error(message),{code});
const commands=Object.freeze(Object.fromEntries(Object.entries(OPENSEARCH_MATERIAL_CLIENT_METHODS)
  .map(([method,suffix])=>[suffix.replaceAll('_','-'),method])));
const toolCatalog=()=>openSearchMaterialTools((name,description,properties,required,annotations)=>
  ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations}));
const HELP=[
  'Operate the original saved OpenSearch material catalog and supplier submissions.',
  '',
  '  opensearch-materials-client tools',
  '  opensearch-materials-client open --url MCP_URL --workspace ALIAS',
  '  opensearch-materials-client material-list --url MCP_URL --workspace ALIAS --input request.json --all-pages',
  '  opensearch-materials-client supplier-review --url MCP_URL --workspace ALIAS --input original-request.json',
  '  opensearch-materials-client supplier-templates --url MCP_URL --workspace ALIAS --input xchange-target.json',
  '  opensearch-materials-client supplier-recipient-rows --url MCP_URL --workspace ALIAS --input retained-review.json --all-pages',
  '  opensearch-materials-client inspect-export --url MCP_URL --workspace ALIAS --export-id ORIGINAL_ID',
  '  opensearch-materials-client download-export --url MCP_URL --workspace ALIAS --export-id ORIGINAL_ID --directory PRIVATE_DIRECTORY',
  '  opensearch-materials-client close --url MCP_URL --workspace ALIAS',
  '',
  'Every material/supplier tool is available by its suffix with hyphens.',
  'Use call --tool merchant_opensearch_NAME for the exact tool name.',
  'Requests omit workspace; the client binds the original alias.',
  'Open/close are explicit original handle operations. Saved requests and files remain in that workspace.',
  'Retain the exact input JSON and requestId after an interrupted mutation.',
  '',
  '--input FILE                 Read original JSON; a single - reads stdin (maximum2 MiB).',
  '--all-pages                  Emit every complete read page as one JSON line.',
  '--token-env NAME             Existing bearer-token environment variable (default MCP_ACCESS_TOKEN).',
  '--timeout-ms N               Original call timeout; no automatic mutation retry (default120000).',
  '--chunk-size N               Retained download bytes per call, from1 to196608.',
  '--expected-manifest-sha256 H Pin the reviewed original completion manifest before downloading.',
  '',
  'STARFORGE_MCP_URL supplies the endpoint when --url is omitted.',
  'Single results are JSON on stdout. Download progress is JSON on stderr.',
  'Keep the same download directory to resume its original manifest, file hashes and saved byte offsets.',
  ''
].join('\n');
function parse(argv){
  if(!argv.length||argv.includes('--help'))return {help:true};
  const [command,...remaining]=argv,result={command};
  if(command.startsWith('--'))throw failure('OPENSEARCH_CLI_ARGUMENTS','Choose a command before its options.');
  const values=new Set(['--url','--workspace','--input','--tool','--export-id','--directory',
    '--token-env','--timeout-ms','--chunk-size','--expected-manifest-sha256']);
  for(let i=0;i<remaining.length;i++){
    const flag=remaining[i];
    if(flag==='--all-pages'){
      if(result.allPages)throw failure('OPENSEARCH_CLI_ARGUMENTS','Use --all-pages once.');
      result.allPages=true;continue;
    }
    if(!values.has(flag)||remaining[i+1]===undefined||remaining[i+1].startsWith('--'))
      throw failure('OPENSEARCH_CLI_ARGUMENTS','Choose a supported option and its original value.');
    const key=flag.slice(2);
    if(Object.hasOwn(result,key))throw failure('OPENSEARCH_CLI_ARGUMENTS','Use each option once.');
    result[key]=remaining[++i];
  }
  if(result['timeout-ms']!==undefined&&(!/^[1-9][0-9]*$/.test(result['timeout-ms'])||
      Number(result['timeout-ms'])>3600000))
    throw failure('OPENSEARCH_CLI_ARGUMENTS','Choose an original request timeout from1 to3600000 milliseconds.');
  if(result['chunk-size']!==undefined&&(!/^[1-9][0-9]*$/.test(result['chunk-size'])||
      Number(result['chunk-size'])>196608))
    throw failure('OPENSEARCH_CLI_ARGUMENTS','Choose a chunk size from1 to196608 bytes.');
  return result;
}
async function originalInput(filename,stdin){
  if(filename===undefined)return {};
  let bytes;
  if(filename==='-'){
    const chunks=[];let length=0;
    for await(const chunk of stdin){
      const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      length+=part.length;if(length>MAX_INPUT_BYTES)throw failure('OPENSEARCH_CLI_INPUT','The original JSON input exceeds2 MiB.');
      chunks.push(part);
    }
    bytes=Buffer.concat(chunks,length);
  }else{
    const handle=await open(resolve(filename),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const before=await handle.stat({bigint:true});
      if(!before.isFile()||before.size>BigInt(MAX_INPUT_BYTES))
        throw failure('OPENSEARCH_CLI_INPUT','Select a regular original request JSON file of at most2 MiB.');
      bytes=await handle.readFile();
      const after=await handle.stat({bigint:true});
      if(bytes.length>MAX_INPUT_BYTES||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
        throw failure('OPENSEARCH_CLI_INPUT','The original request file changed while being read.');
    }finally{await handle.close();}
  }
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('OPENSEARCH_CLI_INPUT','The original request file must contain complete UTF-8 JSON.');}
  if(value===null||typeof value!=='object'||Array.isArray(value))
    throw failure('OPENSEARCH_CLI_INPUT','The original request input must be a JSON object.');
  return value;
}
async function write(stream,text){if(stream.write(text)===false)await once(stream,'drain');}
function required(value,label){
  if(typeof value!=='string'||!value.length)throw failure('OPENSEARCH_CLI_ARGUMENTS',label+' is required.');
  return value;
}
export async function runOpenSearchMaterialCLI(argv,{environment=process.env,stdin=process.stdin,stdout=process.stdout,stderr=process.stderr}={}){
  const options=parse(argv);
  if(options.help){await write(stdout,HELP);return {help:true};}
  if(options.command==='tools'){
    const result={tools:toolCatalog(),commands,receiving:['inspect-export','download-export']};
    await write(stdout,JSON.stringify(result,null,2)+'\n');return result;
  }
  const method=commands[options.command];
  if(!method&&!['call','inspect-export','download-export'].includes(options.command))
    throw failure('OPENSEARCH_CLI_ARGUMENTS','Choose an original material/supplier tool or complete export receiver.');
  const input=await originalInput(options.input,stdin);
  const callOptions={timeoutMs:options['timeout-ms']===undefined?120000:Number(options['timeout-ms'])};
  const client=await createOpenSearchMaterialClient({
    workspace:required(options.workspace,'--workspace'),
    url:required(options.url??environment.STARFORGE_MCP_URL,'--url or STARFORGE_MCP_URL'),
    tokenEnv:options['token-env'],environment,callOptions
  });
  if(options.allPages){
    if(!method)throw failure('OPENSEARCH_CLI_ARGUMENTS','Use --all-pages with a paged material/supplier command.');
    let pages=0;
    for await(const page of client.pages(method,input,callOptions)){await write(stdout,JSON.stringify(page)+'\n');pages++;}
    return {pages};
  }
  let result;
  if(options.command==='inspect-export')
    result=await client.inspectExport(required(options['export-id'],'--export-id'));
  else if(options.command==='download-export')
    result=await client.downloadExport({
      exportId:required(options['export-id'],'--export-id'),directory:required(options.directory,'--directory'),
      chunkSize:options['chunk-size']===undefined?undefined:Number(options['chunk-size']),
      expectedManifestSha256:options['expected-manifest-sha256'],
      onProgress:value=>write(stderr,JSON.stringify(value)+'\n')
    });
  else if(options.command==='call')
    result=await client.call(required(options.tool,'--tool'),input,callOptions);
  else result=await client[method](input,callOptions);
  await write(stdout,JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{await runOpenSearchMaterialCLI(process.argv.slice(2));}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'OPENSEARCH_CLI_FAILED',message:error.message}})+'\n');process.exitCode=1;}
}
