// MIT. Typed original eLTSS calls and the maintained complete-file receiver.
import {join,resolve} from 'node:path';
import {readSourceFile,directory as privateDirectory} from './files.mjs';
import {openMerchantFileClient,createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {eltssActions,validateEltssArguments} from './catalog.mjs';
import {TOOL_PREFIX,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,SHA,UUID,ALIAS,need,checked,
  decode,encode,digest,parseEltssExport} from './contracts.mjs';
export {eltssActions} from './catalog.mjs';
export async function openEltssMerchantClient(options={}){
  const original=await openMerchantFileClient({...options,errorPrefix:'ELTSS',
    clientName:'starforge-eltss-client',maximumResponseBytes:3*1024*1024});
  const call=(action,args={},requestOptions)=>{
    validateEltssArguments(action,args);
    return original.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args,requestOptions);
  };
  const named=Object.fromEntries(Object.keys(eltssActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},requestOptions)=>call(action,args,requestOptions)]));
  return Object.freeze({endpoint:original.endpoint,call,...named,close:async()=>{},
    readValue:args=>readEltssValue({...args,client:{endpoint:original.endpoint,call}})});
}
/** Local CLI/SDK access shares the same native operator and retained-file runtime without another MCP listener. */
export async function openEltssLocalClient({connection,exportsDirectory}={}){
  const {readEltssConfiguration}=await import('./connection.mjs');
  const {MerchantEltss}=await import('./runtime.mjs');
  const eltssCareplans=await readEltssConfiguration(resolve(connection)),
    owner=new MerchantEltss({eltssCareplans,exportsDirectory:await privateDirectory(resolve(exportsDirectory))});
  const call=(action,args={})=>{
    validateEltssArguments(action,args);
    return owner.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args);
  };
  const endpoint='stellar-forge:eltss-local:'+digest(Buffer.from(resolve(connection)));
  const named=Object.fromEntries(Object.keys(eltssActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={})=>call(action,args)]));
  return Object.freeze({endpoint,call,...named,close:()=>owner.close(),
    readValue:args=>readEltssValue({...args,client:{endpoint,call}})});
}
function retained(result){
  need(result?.retention?.state==='COMPLETE' && result.exportId,'ELTSS_RETENTION_REQUIRED',
    'The original operation returned but its complete file is not retained. Recover the same action after restoring storage.');
  return result;
}
const transfers=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseEltssExport,maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  stateSchema:'stellar-forge.eltss-file-download.v1',resultSchema:'stellar-forge.eltss-file-receipt.v1',
  toolPrefix:TOOL_PREFIX.slice(0,-1),errorPrefix:'ELTSS',clientName:'starforge-eltss-file-receiver',
  validateExportId:id=>checked(id,SHA,'export ID'),
  describe:manifest=>({workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,source:manifest.source})
});
async function boundClient({workspace,exportId,client,...options}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  const original=client??await openEltssMerchantClient(options);
  const call=(name,args,requestOptions)=>original.call(name,{workspace,...args},requestOptions);
  const info=await call(TOOL_PREFIX+'manifest',{exportId});
  need(info.state==='MANIFEST_RETAINED' && info.exportId===exportId,'ELTSS_MANIFEST_INVALID');
  const manifest=parseEltssExport(encode(info.manifest),exportId);
  need(manifest.workspace===workspace,'ELTSS_MANIFEST_INVALID');
  // The file identity belongs to this immutable original workbench/export, not a temporary MCP port.
  // The normal downloader still verifies every exact manifest/file/prefix byte on resume.
  return {endpoint:'stellar-forge:eltss:'+manifest.workspaceId+':'+workspace,call};
}
export async function downloadEltssExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.download({...options,signal,client:bound});
}
export async function inspectEltssExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.inspect({...options,signal,client:bound});
}
export async function reopenEltssExport({directory,workspace,exportId,expectedManifestSha256}={}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  return transfers.lockedDownload(resolve(directory),async context=>{
    const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),65000),
      manifest=parseEltssExport(bytes,exportId),manifestSha256=digest(bytes);
    need(manifest.workspace===workspace &&
      (expectedManifestSha256===undefined || checked(expectedManifestSha256,SHA,'manifest SHA256')===manifestSha256),
    'ELTSS_DOWNLOAD_EXPORT_CHANGED');
    await transfers.loadContext(context,bytes,exportId);
    for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.eltss-file-receipt.v1',state:'REOPENED',workspace,
      workspaceId:manifest.workspaceId,exportId,manifestSha256,files:manifest.files.length,
      bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),directory:context.root,kind:manifest.kind,source:manifest.source};
  });
}
/** Read the entire immutable JSON response into memory through the same native range protocol. */
export async function readEltssValue({workspace,result,exportId,file='original-response.json',
  expectedManifestSha256,client,...options}={}){
  if(result){retained(result);exportId=result.exportId;expectedManifestSha256=result.manifestSha256;workspace??=result.workspace;}
  const original=client??await openEltssMerchantClient(options);
  const bound=await boundClient({workspace,exportId,client:original});
  const info=await bound.call(TOOL_PREFIX+'manifest',{exportId}),
    manifest=parseEltssExport(encode(info.manifest),exportId),
    item=manifest.files.find(item=>item.name===file);
  expectedManifestSha256??=info.manifestFile.sha256;
  need(item && item.bytes<=MAX_RESPONSE_BYTES && info.manifestFile.sha256===expectedManifestSha256,
    'ELTSS_FILE_CHANGED','Select the complete original JSON file and manifest identity.');
  const chunks=[];let offset=0,readId=null;
  try{
    while(offset<item.bytes){
      let page;
      const args={exportId,file,expectedManifestSha256,expectedSha256:item.sha256,offset,limit:65536,
        ...(readId?{readId}:{})};
      try{page=await bound.call(TOOL_PREFIX+'file',args);}
      catch(error){
        if(error.code!=='ELTSS_READ_NOT_FOUND'||!readId)throw error;
        readId=null;delete args.readId;page=await bound.call(TOOL_PREFIX+'file',args);
      }
      const chunk=Buffer.from(page.data??'','base64'),count=Math.min(65536,item.bytes-offset);
      need(page.exportId===exportId && page.manifestSha256===expectedManifestSha256 &&
        page.file?.name===file && page.file.sha256===item.sha256 && page.file.bytes===item.bytes &&
        page.offset===offset && page.bytesRead===count && chunk.length===count && chunk.toString('base64')===page.data &&
        page.nextOffset===(offset+count<item.bytes?offset+count:null) &&
        typeof page.readId==='string' && new RegExp(UUID).test(page.readId) && (!readId||readId===page.readId),
      'ELTSS_DOWNLOAD_CHUNK_CONFLICT');
      chunks.push(chunk);offset+=chunk.length;readId=page.nextOffset===null?null:page.readId;
    }
  }finally{
    if(readId)await bound.call(TOOL_PREFIX+'file_release',{exportId,readId},{requestSignal:null,timeoutMs:2000}).catch(()=>{});
  }
  const bytes=Buffer.concat(chunks,offset);need(bytes.length===item.bytes && digest(bytes)===item.sha256,
    'ELTSS_FILE_CHANGED');return decode(bytes);
}
