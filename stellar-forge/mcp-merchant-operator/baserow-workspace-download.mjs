#!/usr/bin/env node
// MIT. Complete Baserow receiving through the maintained retained-download engine.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRetainedDownload } from './retained-download.mjs';
import { BASEROW_EXPORT_MAX_BYTES, BASEROW_EXPORT_MANIFEST, parseBaserowExportManifest,
  baserowExportId } from './baserow-workspace-files.mjs';
import { openBaserowAuthoring } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/workspace/model.mjs';

const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail=(code,message=code)=>Object.assign(new Error(message),{code:'BASEROW_FILE_'+code});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const transport=createRetainedDownload({
  manifestName:BASEROW_EXPORT_MANIFEST,parseManifest:parseBaserowExportManifest,
  maximumBytes:BASEROW_EXPORT_MAX_BYTES,stateSchema:'stellar-forge.baserow-download-state.v1',
  resultSchema:'stellar-forge.baserow-download.v1',toolPrefix:'merchant_baserow_export',
  errorPrefix:'BASEROW_FILE',clientName:'starforge-baserow-receiver',validateExportId:baserowExportId,
  describe:manifest=>({workspace:manifest.workspace,kind:manifest.selection.kind,
    selection:manifest.selection,source:manifest.source}),
});
function reviewed(options) {
  baserowExportId(options.exportId);
  if(!HASH.test(options.expectedManifestSha256??''))throw fail('REVIEWED_MANIFEST_REQUIRED','Use the inspected completion manifest SHA256.');
}
export async function inspectBaserowExport(options={}) {return transport.inspect(options);}
export async function downloadBaserowExport(options={}) {
  reviewed(options);return transport.download(options);
}
export async function reopenBaserowExport(options={}) {
  reviewed(options);
  return transport.lockedDownload(options.directory,async context=>{
    const content=await transport.bytesAt(join(context.root,BASEROW_EXPORT_MANIFEST),65000);
    if(sha(content)!==options.expectedManifestSha256)throw fail('DOWNLOAD_EXPORT_CHANGED');
    await transport.loadContext(context,content,options.exportId);
    for(const file of context.manifest.files)await transport.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.baserow-download.v1',state:'COMPLETE',directory:context.root,
      exportId:options.exportId,manifestSha256:options.expectedManifestSha256,
      workspace:context.manifest.workspace,kind:context.manifest.selection.kind,
      selection:context.manifest.selection,source:context.manifest.source,
      files:context.manifest.files.length,bytes:context.manifest.files.reduce((sum,file)=>sum+file.bytes,0),
      manifestBytes:content.length,reopened:true};
  });
}
/** The original recipient source model retains import identity, metadata, full
 * rows and attachment bytes. A repeat request reopens its original result. */
export async function receiveBaserowSourceExport({workspace,create=false,title,expectedDraftRevision,requestId,...options}={}) {
  reviewed(options);
  if(typeof workspace!=='string'||!workspace||typeof create!=='boolean'||!UUID.test(requestId??'')||
      !Number.isSafeInteger(expectedDraftRevision)||expectedDraftRevision<0||
      typeof title!=='string'||!title.trim()||title.length>128)
    throw fail('RECEIVING_SELECTION_REQUIRED','Choose the recipient workspace, source title, exact draft revision and one original request UUID.');
  return transport.lockedDownload(options.directory,async context=>{
    const content=await transport.bytesAt(join(context.root,BASEROW_EXPORT_MANIFEST),65000);
    if(sha(content)!==options.expectedManifestSha256)throw fail('DOWNLOAD_EXPORT_CHANGED');
    await transport.loadContext(context,content,options.exportId);
    for(const file of context.manifest.files)await transport.verifiedFile(join(context.root,file.name),file);
    if(!['capture','version','handoff'].includes(context.manifest.selection.kind))throw fail('SOURCE_PACKET_REQUIRED');
    const packetBytes=await transport.bytesAt(join(context.root,'baserow-source.json'),BASEROW_EXPORT_MAX_BYTES);
    const original=context.manifest.files.find(file=>file.name==='baserow-source.json');
    if(packetBytes.length!==original.bytes||sha(packetBytes)!==original.sha256)throw fail('DOWNLOAD_FILE_CHANGED');
    let packet;try{packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packetBytes));}
    catch{throw fail('SOURCE_PACKET_INVALID');}
    const directory=resolve(workspace);
    if(directory===context.root||directory.startsWith(context.root+'/'))throw fail('RECEIVING_DIRECTORY_OVERLAP','Keep the recipient workspace outside its original download directory.');
    const native=await openBaserowAuthoring({directory,create});
    try {
      const result=await native.importPacket({packet,title,expectedDraftRevision,requestId});
      if(result.capture?.manifestSha256!==context.manifest.selection.expectedCaptureSha256)
        throw fail('RECEIVING_CAPTURE_CHANGED');
      return {schema:'stellar-forge.baserow-source-receiving.v1',state:'IMPORTED',directory,requestId,
        exportId:options.exportId,manifestSha256:options.expectedManifestSha256,packetSha256:original.sha256,
        source:context.manifest.source,result};
    }finally{await native.close();}
  });
}
const help='Baserow complete customer receiving\n'+
  '  inspect --url MCP_URL --export-id UUID [--token-env NAME]\n'+
  '  download --url MCP_URL --export-id UUID --expected-manifest-sha256 HASH --directory DIRECTORY [--token-env NAME] [--chunk-size BYTES]\n'+
  '  reopen --export-id UUID --expected-manifest-sha256 HASH --directory DIRECTORY\n'+
  '  receive --export-id UUID --expected-manifest-sha256 HASH --directory DIRECTORY --workspace NATIVE_WORKSPACE [--create] --title TITLE --expected-draft-revision N --request-id UUID\n';
function argumentsFor(argv) {
  const input={};
  const fields={'--url':'url','--export-id':'exportId','--expected-manifest-sha256':'expectedManifestSha256',
    '--directory':'directory','--token-env':'tokenEnv','--chunk-size':'chunkSize','--workspace':'workspace',
    '--title':'title','--expected-draft-revision':'expectedDraftRevision','--request-id':'requestId'};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(key==='--create'){if(input.create!==undefined)throw fail('CLI_ARGUMENT_INVALID');input.create=true;continue;}
    const name=fields[key];
    if(!name||input[name]!==undefined||i+1>=argv.length||argv[i+1].startsWith('--'))throw fail('CLI_ARGUMENT_INVALID',help);
    const value=argv[++i];input[name]=['chunkSize','expectedDraftRevision'].includes(name)?Number(value):value;
  }
  return input;
}
export async function main(argv=process.argv.slice(2)) {
  const [command,...rest]=argv;
  if(!command||command==='--help'||command==='help'){process.stdout.write(help);return;}
  const args=argumentsFor(rest),allowed={
    inspect:['url','exportId','tokenEnv'],
    download:['url','exportId','expectedManifestSha256','directory','tokenEnv','chunkSize'],
    reopen:['exportId','expectedManifestSha256','directory'],
    receive:['exportId','expectedManifestSha256','directory','workspace','create','title','expectedDraftRevision','requestId'],
  };
  if(!allowed[command]||Object.keys(args).some(key=>!allowed[command].includes(key)))throw fail('CLI_ARGUMENT_INVALID',help);
  const actions={inspect:inspectBaserowExport,download:downloadBaserowExport,reopen:reopenBaserowExport,receive:receiveBaserowSourceExport};
  const controller=new AbortController(),stop=()=>controller.abort(fail('DOWNLOAD_INTERRUPTED','Resume the same original export and directory.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const result=await actions[command]({...args,signal:controller.signal});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue=>{process.stderr.write(JSON.stringify({error:issue.code??'BASEROW_RECEIVING_FAILED',message:issue.message})+'\n');process.exitCode=1;});
