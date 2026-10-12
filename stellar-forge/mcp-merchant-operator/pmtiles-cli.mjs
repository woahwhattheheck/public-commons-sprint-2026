#!/usr/bin/env node
// MIT. Authenticated PMTiles tools and resumable original package receiving.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {failure} from './host-files.mjs';
import {openMerchantFileClient} from './retained-download.mjs';
import {downloadPMTilesPackage,inspectPMTilesPackageDownload} from './pmtiles-download.mjs';
import {pmtilesWorkspaceTools} from './catalog/pmtiles-workspace.mjs';
const known=new Set(pmtilesWorkspaceTools(name=>name));
const HELP='PMTiles merchant MCP\n\n'+
'starforge pmtiles-mcp call TOOL_SUFFIX --url ORIGINAL_MCP_URL --request /PRIVATE/request.json [--token-env MCP_ACCESS_TOKEN] [--timeout-ms 600000]\n'+
'starforge pmtiles-mcp inspect-package --url ORIGINAL_MCP_URL --export-id workspace:package-request [--token-env MCP_ACCESS_TOKEN]\n'+
'starforge pmtiles-mcp download-package --url ORIGINAL_MCP_URL --export-id workspace:package-request --manifest-sha256 ORIGINAL_DOWNLOAD_MANIFEST_SHA256 --directory /PRIVATE/download [--chunk-size 196608] [--token-env MCP_ACCESS_TOKEN]\n\n'+
'Tool suffixes use catalog names such as status, open, import, save, inspect, review, prepare, publish, restore, package, package_info and receive.\n'+
'Keep the same request JSON and durable requestId after an interrupted call. Repeat the exact download command to resume its verified byte prefix.\n';
function optionsFor(values,allowed){
  const out={};
  for(let i=0;i<values.length;i+=2){
    const name=values[i],value=values[i+1];
    if(!allowed.includes(name)||value===undefined||value.startsWith('--')||Object.hasOwn(out,name))
      throw failure('INVALID_PARAMS','Supply each documented option once, with its value.');
    out[name]=value;
  }
  return out;
}
function required(options,key){
  const value=options[key];if(typeof value!=='string'||!value)throw failure('INVALID_PARAMS','Supply '+key+'.');return value;
}
function integer(value,fallback,min,max){
  if(value===undefined)return fallback;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)
    throw failure('INVALID_PARAMS','Use a documented integer option value.');
  return Number(value);
}
async function requestFile(path){
  const file=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    if(!info.isFile()||info.size>2*1024*1024||process.platform!=='win32'&&
      ((info.mode&0o077)||process.getuid&&info.uid!==process.getuid()))
      throw failure('PMTILES_PRIVATE_REQUEST_REQUIRED','Use an owned private request JSON file, at most two MiB.');
    const bytes=await file.readFile();
    if(bytes.length>2*1024*1024)throw failure('PMTILES_REQUEST_SIZE_LIMIT','The request grew beyond two MiB.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{await file.close();}
}
export async function runPMTilesMcpCommand(argv,{environment=process.env,signal,onProgress}={}){
  const [command,...rest]=argv;
  if(!command||command==='help'||command==='--help')return {help:HELP};
  if(command==='call'){
    const [selected,...pairs]=rest,name=selected?.startsWith('merchant_pmtiles_')?selected:'merchant_pmtiles_'+selected;
    if(!known.has(name))throw failure('TOOL_NOT_FOUND','Select an original PMTiles tool from the installed catalog.');
    const options=optionsFor(pairs,['--url','--request','--token-env','--timeout-ms']);
    const args=await requestFile(required(options,'--request'));
    const client=await openMerchantFileClient({url:required(options,'--url'),tokenEnv:options['--token-env'],
      environment,signal,errorPrefix:'PMTILES',clientName:'starforge-pmtiles-workspace',maximumResponseBytes:32*1024*1024});
    return client.call(name,args,{requestSignal:signal,timeoutMs:integer(options['--timeout-ms'],600000,1000,3600000)});
  }
  if(command==='inspect-package'||command==='download-package'){
    const options=optionsFor(rest,command==='inspect-package'?['--url','--export-id','--token-env']:
      ['--url','--export-id','--token-env','--directory','--manifest-sha256','--chunk-size']);
    const input={url:required(options,'--url'),exportId:required(options,'--export-id'),tokenEnv:options['--token-env'],environment,signal};
    if(command==='inspect-package')return inspectPMTilesPackageDownload(input);
    return downloadPMTilesPackage({...input,directory:resolve(required(options,'--directory')),
      expectedManifestSha256:required(options,'--manifest-sha256'),
      chunkSize:integer(options['--chunk-size'],196608,1,196608),onProgress});
  }
  throw failure('INVALID_PARAMS','Choose call, inspect-package or download-package.');
}
export async function main(argv=process.argv.slice(2)){
  const abort=new AbortController(),stop=()=>abort.abort(new Error('PMTILES_CLIENT_STOPPED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await runPMTilesMcpCommand(argv,{signal:abort.signal});
    process.stdout.write(result?.help??JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write((error.code??'PMTILES_CLIENT_FAILED')+': '+error.message+'\n');process.exitCode=1;});
}
