// MIT. Typed original FHIR calls and the maintained complete-file receiver.
import {join,resolve} from 'node:path';
import {readSourceFile,directory as privateDirectory} from './files.mjs';
import {openMerchantFileClient,createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {fhirActions,validateFhirArguments} from './catalog.mjs';
import {TOOL_PREFIX,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,SHA,UUID,ALIAS,need,checked,
  decode,encode,digest,parseFhirExport} from './contracts.mjs';
export {fhirActions} from './catalog.mjs';
export async function openFhirMerchantClient(options={}){
  const original=await openMerchantFileClient({...options,errorPrefix:'FHIR_BULK',
    clientName:'starforge-fhir-bulk-client',maximumResponseBytes:3*1024*1024});
  const call=(action,args={},requestOptions)=>{
    validateFhirArguments(action,args);
    return original.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args,requestOptions);
  };
  const named=Object.fromEntries(Object.keys(fhirActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},requestOptions)=>call(action,args,requestOptions)]));
  return Object.freeze({endpoint:original.endpoint,call,...named,close:async()=>{},
    readValue:args=>readFhirValue({...args,client:{endpoint:original.endpoint,call}})});
}
/** Local CLI/SDK access shares the same native operator and retained-file runtime without another MCP listener. */
export async function openFhirLocalClient({connection,exportsDirectory}={}){
  const {readFhirConfiguration}=await import('./connection.mjs');
  const {MerchantFhirBulk}=await import('./runtime.mjs');
  const fhirBulk=await readFhirConfiguration(resolve(connection)),
    owner=new MerchantFhirBulk({fhirBulk,exportsDirectory:await privateDirectory(resolve(exportsDirectory))});
  const call=(action,args={})=>{
    validateFhirArguments(action,args);
    return owner.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args);
  };
  const endpoint='stellar-forge:fhir-local:'+digest(Buffer.from(resolve(connection)));
  const named=Object.fromEntries(Object.keys(fhirActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={})=>call(action,args)]));
  return Object.freeze({endpoint,call,...named,close:()=>owner.close(),
    readValue:args=>readFhirValue({...args,client:{endpoint,call}})});
}
function retained(result){
  need(result?.retention?.state==='COMPLETE' && result.exportId,'FHIR_BULK_RETENTION_REQUIRED',
    'The original operation returned but its complete file is not retained. Recover the same action after restoring storage.');
  return result;
}
const transfers=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseFhirExport,maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  stateSchema:'stellar-forge.fhir-bulk-file-download.v1',resultSchema:'stellar-forge.fhir-bulk-file-receipt.v1',
  toolPrefix:TOOL_PREFIX.slice(0,-1),errorPrefix:'FHIR_BULK',clientName:'starforge-fhir-bulk-file-receiver',
  validateExportId:id=>checked(id,SHA,'export ID'),
  describe:manifest=>({workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,source:manifest.source})
});
async function boundClient({workspace,exportId,client,...options}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  const original=client??await openFhirMerchantClient(options);
  const call=(name,args,requestOptions)=>original.call(name,{workspace,...args},requestOptions);
  const info=await call(TOOL_PREFIX+'manifest',{exportId});
  need(info.state==='MANIFEST_RETAINED' && info.exportId===exportId,'FHIR_BULK_MANIFEST_INVALID');
  const manifest=parseFhirExport(encode(info.manifest),exportId);
  need(manifest.workspace===workspace,'FHIR_BULK_MANIFEST_INVALID');
  // The file identity belongs to this immutable original workbench/export, not a temporary MCP port.
  // The normal downloader still verifies every exact manifest/file/prefix byte on resume.
  return {endpoint:'stellar-forge:fhir-bulk:'+manifest.workspaceId+':'+workspace,call};
}
export async function downloadFhirExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.download({...options,signal,client:bound});
}
export async function inspectFhirExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.inspect({...options,signal,client:bound});
}
export async function reopenFhirExport({directory,workspace,exportId,expectedManifestSha256}={}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  return transfers.lockedDownload(resolve(directory),async context=>{
    const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),65000),
      manifest=parseFhirExport(bytes,exportId),manifestSha256=digest(bytes);
    need(manifest.workspace===workspace &&
      (expectedManifestSha256===undefined || checked(expectedManifestSha256,SHA,'manifest SHA256')===manifestSha256),
    'FHIR_BULK_DOWNLOAD_EXPORT_CHANGED');
    await transfers.loadContext(context,bytes,exportId);
    for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.fhir-bulk-file-receipt.v1',state:'REOPENED',workspace,
      workspaceId:manifest.workspaceId,exportId,manifestSha256,files:manifest.files.length,
      bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),directory:context.root,kind:manifest.kind,source:manifest.source};
  });
}
/** Read the entire immutable JSON response into memory through the same native range protocol. */
export async function readFhirValue({workspace,result,exportId,file='original-response.json',
  expectedManifestSha256,client,...options}={}){
  if(result){retained(result);exportId=result.exportId;expectedManifestSha256=result.manifestSha256;workspace??=result.workspace;}
  const original=client??await openFhirMerchantClient(options);
  const bound=await boundClient({workspace,exportId,client:original});
  const info=await bound.call(TOOL_PREFIX+'manifest',{exportId}),
    manifest=parseFhirExport(encode(info.manifest),exportId),
    item=manifest.files.find(item=>item.name===file);
  expectedManifestSha256??=info.manifestFile.sha256;
  need(item && item.bytes<=MAX_RESPONSE_BYTES && info.manifestFile.sha256===expectedManifestSha256,
    'FHIR_BULK_FILE_CHANGED','Select the complete original JSON file and manifest identity.');
  const chunks=[];let offset=0,readId=null;
  try{
    while(offset<item.bytes){
      let page;
      const args={exportId,file,expectedManifestSha256,expectedSha256:item.sha256,offset,limit:65536,
        ...(readId?{readId}:{})};
      try{page=await bound.call(TOOL_PREFIX+'file',args);}
      catch(error){
        if(error.code!=='FHIR_BULK_READ_NOT_FOUND'||!readId)throw error;
        readId=null;delete args.readId;page=await bound.call(TOOL_PREFIX+'file',args);
      }
      const chunk=Buffer.from(page.data??'','base64'),count=Math.min(65536,item.bytes-offset);
      need(page.exportId===exportId && page.manifestSha256===expectedManifestSha256 &&
        page.file?.name===file && page.file.sha256===item.sha256 && page.file.bytes===item.bytes &&
        page.offset===offset && page.bytesRead===count && chunk.length===count && chunk.toString('base64')===page.data &&
        page.nextOffset===(offset+count<item.bytes?offset+count:null) &&
        typeof page.readId==='string' && new RegExp(UUID).test(page.readId) && (!readId||readId===page.readId),
      'FHIR_BULK_DOWNLOAD_CHUNK_CONFLICT');
      chunks.push(chunk);offset+=chunk.length;readId=page.nextOffset===null?null:page.readId;
    }
  }finally{
    if(readId)await bound.call(TOOL_PREFIX+'file_release',{exportId,readId},{requestSignal:null,timeoutMs:2000}).catch(()=>{});
  }
  const bytes=Buffer.concat(chunks,offset);need(bytes.length===item.bytes && digest(bytes)===item.sha256,
    'FHIR_BULK_FILE_CHANGED');return decode(bytes);
}
