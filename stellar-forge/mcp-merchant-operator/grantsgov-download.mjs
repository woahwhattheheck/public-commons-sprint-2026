#!/usr/bin/env node
// MIT. Complete Grants.gov receiving through the shared retained merchant download engine.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { identifier, failure } from './host-files.mjs';
import { GRANTS_EXPORT_MANIFEST_SCHEMA, GRANTS_EXPORT_MANIFEST_NAME } from './grantsgov-workspace.mjs';

const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const maximumBytes=256000000;
export function parseGrantsExportManifest(bytes,exportId){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw failure('GRANTS_DOWNLOAD_MANIFEST_INVALID','Use the complete original Grants.gov export manifest.');}
  if(!plain(value)||value.schema!==GRANTS_EXPORT_MANIFEST_SCHEMA||value.exportId!==exportId||
    !HASH.test(exportId??'')||!/^GW-[a-f0-9-]{36}$/.test(value.workspaceId??'')||
    typeof value.kind!=='string'||!/^[a-z][a-z-]{0,79}$/.test(value.kind)||
    !Array.isArray(value.files)||value.files.length!==1||
    Object.keys(value).some(key=>!['schema','exportId','workspaceId','kind','files'].includes(key)))
    throw failure('GRANTS_DOWNLOAD_MANIFEST_INVALID','The original export identity differs.');
  const file=value.files[0];
  if(!plain(file)||Object.keys(file).some(key=>!['name','bytes','sha256'].includes(key))||
    typeof file.name!=='string'||!/^[a-z0-9-]+-[a-f0-9]{64}\.[a-z]+$/.test(file.name)||
    !file.name.startsWith(value.kind+'-'+exportId+'.')||file.sha256!==exportId||
    !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>maximumBytes)
    throw failure('GRANTS_DOWNLOAD_MANIFEST_INVALID','The retained original file descriptor differs.');
  return value;
}
function transport(workspace){
  identifier(workspace,'Grants.gov workspace alias');
  return createRetainedDownload({
    manifestName:GRANTS_EXPORT_MANIFEST_NAME,parseManifest:parseGrantsExportManifest,maximumBytes,
    stateSchema:'stellar-forge.grantsgov-download-state.v1',
    resultSchema:'stellar-forge.grantsgov-download-result.v1',
    toolPrefix:'merchant_grants',errorPrefix:'GRANTS',clientName:'starforge-grantsgov-receiver',
    describe:manifest=>({workspaceId:manifest.workspaceId,kind:manifest.kind}),
    connect:async options=>{
      const client=await openMerchantFileClient(options);
      return {endpoint:client.endpoint,call:(name,args,settings)=>client.call(name,{workspace,...args},settings)};
    },
  });
}
export async function downloadGrantsExport({workspace,...options}={}){
  return transport(workspace).download(options);
}
export async function inspectGrantsExport({workspace,...options}={}){
  return transport(workspace).inspect(options);
}
/** The shared reader has already retained every original byte. Verify the local
 * completed download, then let the native packet reader import it unchanged. */
export async function receiveGrantsExport({directory,workspaceDirectory,requestId}={}){
  const root=resolve(directory),native=transport('receiving');
  const manifestBytes=await native.bytesAt(join(root,GRANTS_EXPORT_MANIFEST_NAME),65000);
  let header;try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));}
  catch{throw failure('GRANTS_DOWNLOAD_MANIFEST_INVALID','Use a completed original download directory.');}
  const manifest=parseGrantsExportManifest(manifestBytes,header.exportId),file=manifest.files[0];
  if(!['capture','edition','workspace'].includes(manifest.kind))
    throw failure('GRANTS_RECEIVING_SOURCE_REQUIRED','Receive a complete capture, edition or workspace export into the original research application.');
  await native.verifiedFile(join(root,file.name),file);
  const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await native.bytesAt(join(root,file.name),maximumBytes)));
  const {openGrantsWorkspace}=await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/grantsgov/workspace.mjs');
  const workspace=await openGrantsWorkspace({directory:resolve(workspaceDirectory)});
  try{
    const input={requestId:requestId??'receive-'+manifest.exportId,packet,name:'Received Grants.gov research'};
    const result=manifest.kind==='workspace'?await workspace.restore(input):
      manifest.kind==='edition'?await workspace.receiveEdition(input):await workspace.importOriginal(input);
    const state=await workspace.snapshot();
    return {schema:'stellar-forge.grantsgov-receiving-result.v1',state:'RECEIVED',
      exportId:manifest.exportId,kind:manifest.kind,sourceWorkspaceId:manifest.workspaceId,
      workspaceId:state.id,revision:state.revision,result,
      counts:Object.fromEntries(['queries','captures','editions','reviews'].map(key=>[key,state[key].length]))};
  }finally{await workspace.close();}
}
const HELP='Grants.gov complete export receiving\n\n'+
'  node grantsgov-download.mjs inspect --url MCP_URL --workspace ALIAS --export-id SHA\n'+
'  node grantsgov-download.mjs download --url MCP_URL --workspace ALIAS --export-id SHA --out PRIVATE_DIRECTORY\n'+
'  node grantsgov-download.mjs receive --directory COMPLETED_DOWNLOAD --into PRIVATE_WORKSPACE [--request ID]\n\n'+
'Use --token-env NAME for the existing MCP bearer environment, --manifest-sha256 SHA to pin the reviewed\n'+
'manifest and --chunk-bytes N for each transferred chunk. Repeating download resumes its original byte\n'+
'checkpoint. Repeating receive with the same request ID reuses the native source import.\n';
function options(argv){
  const result={command:argv[0]??'help'};
  if(argv.length===1&&['--help','-h'].includes(argv[0]))return {command:'help'};
  for(let index=1;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    if(!['--url','--workspace','--export-id','--out','--token-env','--manifest-sha256','--chunk-bytes',
      '--directory','--into','--request'].includes(key)||!value||value.startsWith('--')||Object.hasOwn(result,key))
      throw failure('GRANTS_DOWNLOAD_CONFIGURATION','Use the documented receiving command and each option once.');
    result[key]=value;
  }
  return result;
}
export async function main(argv=process.argv.slice(2)){
  const args=options(argv);
  if(args.command==='help'){process.stdout.write(HELP);return;}
  const required=key=>{if(!args[key])throw failure('GRANTS_DOWNLOAD_CONFIGURATION','Supply '+key+'.');return args[key];};
  if(args.command==='receive'){
    const result=await receiveGrantsExport({directory:required('--directory'),
      workspaceDirectory:required('--into'),requestId:args['--request']});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  if(!['inspect','download'].includes(args.command))throw failure('GRANTS_DOWNLOAD_CONFIGURATION','Choose inspect, download or receive.');
  const controller=new AbortController();
  const stop=()=>controller.abort(failure('GRANTS_DOWNLOAD_INTERRUPTED','Continue the original download with the same command.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const selected={url:required('--url'),workspace:required('--workspace'),exportId:required('--export-id'),
      tokenEnv:args['--token-env']??'MCP_ACCESS_TOKEN',signal:controller.signal};
    const result=args.command==='inspect'?await inspectGrantsExport(selected):
      await downloadGrantsExport({...selected,directory:required('--out'),expectedManifestSha256:args['--manifest-sha256'],
        ...(args['--chunk-bytes']===undefined?{}:{chunkSize:Number(args['--chunk-bytes'])}),
        onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'GRANTS_RECEIVING_FAILED',message:error.message}})+'\n');process.exitCode=1;});
