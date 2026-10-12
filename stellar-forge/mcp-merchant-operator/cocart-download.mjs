// MIT. Complete CoCart files through the original resumable merchant receiver.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { failure, identifier, plain } from './host-files.mjs';
import { CartWorkspace, inspectReceiving } from '../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/cocart/workspace.mjs';

const SCHEMA='stellar-forge.cocart-workspace-export.v1',MAX_BYTES=256_000_000;
const sha=b=>createHash('sha256').update(b).digest('hex'),validHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(ok,message)=>{if(!ok)throw failure('COCART_MCP_DOWNLOAD_MANIFEST_INVALID',message);};
export function parseCocartManifest(bytes,exportId) {
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('COCART_MCP_DOWNLOAD_MANIFEST_INVALID','Select the original UTF-8 CoCart manifest.');}
 need(plain(manifest)&&manifest.schema===SCHEMA&&manifest.exportId===exportId&&validHash(manifest.workspaceVersion)&&Array.isArray(manifest.files)&&manifest.files.length===1,'Select the exact original CoCart export manifest.');
 identifier(manifest.exportId,'Export ID');identifier(manifest.workspace,'Workspace alias');
 const file=manifest.files[0];need(plain(file)&&file.name==='CoCart_Receiving_Workspace.json'&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=MAX_BYTES&&validHash(file.sha256),'The complete CoCart receiving file is required.');
 need(Number.isSafeInteger(manifest.objects)&&manifest.objects>=0&&manifest.objects<=100000&&plain(manifest.source)&&typeof manifest.createdAt==='string','The original export metadata is required.');
 return manifest;
}
function scopedClient(original,workspace) {
 if(!original||typeof original.call!=='function'||typeof original.endpoint!=='string')throw failure('COCART_MCP_DOWNLOAD_CONFIGURATION','Select the original merchant file client.');
 const names={merchant_cocart_export_manifest:'merchant_cocart_export_status',merchant_cocart_export_file:'merchant_cocart_file',merchant_cocart_export_file_release:'merchant_cocart_file_release'};
 return{endpoint:original.endpoint+'#cocart-workspace='+workspace,call:(name,args,options)=>{
  const selected=names[name];if(!selected)throw failure('COCART_MCP_DOWNLOAD_TOOL_UNKNOWN','Select an original CoCart file operation.');
  const input=selected==='merchant_cocart_file_release'?{workspace,readId:args.readId}:{workspace,...args};
  return original.call(selected,input,options);
 }};
}
function receiver(workspace) {
 identifier(workspace,'Workspace alias');
 return createRetainedDownload({
  manifestName:'manifest.json',parseManifest:(bytes,exportId)=>{const m=parseCocartManifest(bytes,exportId);need(m.workspace===workspace,'The export belongs to another workspace alias.');return m;},
  maximumBytes:MAX_BYTES,stateSchema:'stellar-forge.cocart-download-state.v1',resultSchema:'stellar-forge.cocart-download-result.v1',
  toolPrefix:'merchant_cocart_export',errorPrefix:'COCART_MCP',clientName:'starforge-cocart-download',
  describe:manifest=>({workspace:manifest.workspace,workspaceVersion:manifest.workspaceVersion,objects:manifest.objects,source:manifest.source}),
  connect:async options=>scopedClient(await openMerchantFileClient(options),workspace)
 });
}
export async function inspectCocartExport({workspace,client,...options}={}) {return receiver(workspace).inspect({...options,...(client?{client:scopedClient(client,workspace)}:{})});}
export async function downloadCocartExport({workspace,client,...options}={}) {return receiver(workspace).download({...options,...(client?{client:scopedClient(client,workspace)}:{})});}
export async function reopenCocartExport({directory,destination,workspace,exportId,expectedManifestSha256}={}) {
 identifier(workspace,'Workspace alias');identifier(exportId,'Export ID');
 if(typeof directory!=='string'||!directory||typeof destination!=='string'||!destination||resolve(destination)==='/')
  throw failure('COCART_MCP_DOWNLOAD_CONFIGURATION','Select the original completed download and customer workspace destination.');
 const transfer=receiver(workspace),root=resolve(directory);
 const bytes=await transfer.bytesAt(join(root,'manifest.json'),65000),manifest=parseCocartManifest(bytes,exportId);
 need(manifest.workspace===workspace,'The selected original export belongs to another workspace alias.');
 if(expectedManifestSha256!==undefined)need(validHash(expectedManifestSha256)&&sha(bytes)===expectedManifestSha256,'The selected manifest differs from the reviewed original.');
 const file=manifest.files[0],path=join(root,file.name);await transfer.verifiedFile(path,file);
 const input=await transfer.bytesAt(path,MAX_BYTES),original=inspectReceiving(input);
 need(sha(input)===file.sha256&&original.workspace_version===manifest.workspaceVersion&&original.objects.length===manifest.objects,'The original receiving file differs from its completion manifest.');
 const model=CartWorkspace.receive({root:resolve(destination),bytes:input}),view=model.view();
 return{schema:'stellar-forge.cocart-download-receiving.v1',state:'RECEIVED',directory:resolve(destination),workspace,exportId,manifestSha256:sha(bytes),sourceWorkspaceVersion:manifest.workspaceVersion,workspaceVersion:view.version,objects:original.objects.length,carts:view.carts.length};
}
