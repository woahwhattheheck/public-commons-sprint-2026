// MIT. Typed original reviewer calls and the maintained complete-file receiver.
import {join,resolve} from 'node:path';
import {readSourceFile} from '../workspace.mjs';
import {openMerchantFileClient,createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {reviewerActions,validateReviewerArguments} from './catalog.mjs';
import {TOOL_PREFIX,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,SHA,UUID,ALIAS,need,checked,
  decode,encode,digest,parseReviewerExport} from './contracts.mjs';
export {reviewerActions} from './catalog.mjs';
export async function openReviewerMerchantClient(options={}){
  const original=await openMerchantFileClient({...options,errorPrefix:'GRANT_REVIEWER',
    clientName:'starforge-grant-reviewer-client',maximumResponseBytes:3*1024*1024});
  const call=(action,args={},requestOptions)=>{
    validateReviewerArguments(action,args);
    return original.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args,requestOptions);
  };
  const named=Object.fromEntries(Object.keys(reviewerActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},requestOptions)=>call(action,args,requestOptions)]));
  return Object.freeze({endpoint:original.endpoint,call,...named,
    reviewFile:args=>reviewReviewerFile({...args,client:{endpoint:original.endpoint,call}}),
    readValue:args=>readReviewerValue({...args,client:{endpoint:original.endpoint,call}})});
}
function retained(result){
  need(result?.retention?.state==='COMPLETE' && result.exportId,'GRANT_REVIEWER_RETENTION_REQUIRED',
    'The original operation returned but its complete file is not retained. Recover the same action after restoring storage.');
  return result;
}
export async function reviewReviewerFile({workspace,file,title,requestId,expectedSha256,client,...options}={}){
  checked(workspace,ALIAS,'workspace alias');
  const bytes=await readSourceFile(resolve(file),{maxBytes:MAX_PACKET_BYTES}),sha256=digest(bytes);
  if(expectedSha256!==undefined)need(checked(expectedSha256,SHA,'packet SHA256')===sha256,'GRANT_REVIEWER_INPUT_CHANGED');
  const native=client??await openReviewerMerchantClient(options);
  return native.call('review',{workspace,source:'upload',title,requestId,expectedSha256:sha256,base64:bytes.toString('base64')});
}
const transfers=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseReviewerExport,maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  stateSchema:'stellar-forge.grant-reviewer-file-download.v1',resultSchema:'stellar-forge.grant-reviewer-file-receipt.v1',
  toolPrefix:TOOL_PREFIX.slice(0,-1),errorPrefix:'GRANT_REVIEWER',clientName:'starforge-grant-reviewer-file-receiver',
  validateExportId:id=>checked(id,SHA,'export ID'),
  describe:manifest=>({workspace:manifest.workspace,workbenchId:manifest.workbenchId,kind:manifest.kind,source:manifest.source})
});
async function boundClient({workspace,exportId,client,...options}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  const original=client??await openReviewerMerchantClient(options);
  const call=(name,args,requestOptions)=>original.call(name,{workspace,...args},requestOptions);
  const info=await call(TOOL_PREFIX+'manifest',{exportId});
  need(info.state==='MANIFEST_RETAINED' && info.exportId===exportId,'GRANT_REVIEWER_MANIFEST_INVALID');
  const manifest=parseReviewerExport(encode(info.manifest),exportId);
  need(manifest.workspace===workspace,'GRANT_REVIEWER_MANIFEST_INVALID');
  // The file identity belongs to this immutable original workbench/export, not a temporary MCP port.
  // The normal downloader still verifies every exact manifest/file/prefix byte on resume.
  return {endpoint:'stellar-forge:grant-reviewer:'+manifest.workbenchId+':'+workspace,call};
}
export async function downloadReviewerExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.download({...options,signal,client:bound});
}
export async function inspectReviewerExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.inspect({...options,signal,client:bound});
}
export async function reopenReviewerExport({directory,workspace,exportId,expectedManifestSha256}={}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  return transfers.lockedDownload(resolve(directory),async context=>{
    const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),65000),
      manifest=parseReviewerExport(bytes,exportId),manifestSha256=digest(bytes);
    need(manifest.workspace===workspace &&
      (expectedManifestSha256===undefined || checked(expectedManifestSha256,SHA,'manifest SHA256')===manifestSha256),
    'GRANT_REVIEWER_DOWNLOAD_EXPORT_CHANGED');
    await transfers.loadContext(context,bytes,exportId);
    for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.grant-reviewer-file-receipt.v1',state:'REOPENED',workspace,
      workbenchId:manifest.workbenchId,exportId,manifestSha256,files:manifest.files.length,
      bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),directory:context.root,kind:manifest.kind,source:manifest.source};
  });
}
/** Read the entire immutable JSON response into memory through the same native range protocol. */
export async function readReviewerValue({workspace,result,exportId,file='original-response.json',
  expectedManifestSha256,client,...options}={}){
  if(result){retained(result);exportId=result.exportId;expectedManifestSha256=result.manifestSha256;workspace??=result.workspace;}
  const original=client??await openReviewerMerchantClient(options);
  const bound=await boundClient({workspace,exportId,client:original});
  const info=await bound.call(TOOL_PREFIX+'manifest',{exportId}),
    manifest=parseReviewerExport(encode(info.manifest),exportId),
    item=manifest.files.find(item=>item.name===file);
  need(item && item.bytes<=MAX_RESPONSE_BYTES && info.manifestFile.sha256===expectedManifestSha256,
    'GRANT_REVIEWER_FILE_CHANGED','Select the complete original JSON file and manifest identity.');
  const chunks=[];let offset=0,readId=null;
  try{
    while(offset<item.bytes){
      let page;
      const args={exportId,file,expectedManifestSha256,expectedSha256:item.sha256,offset,limit:65536,
        ...(readId?{readId}:{})};
      try{page=await bound.call(TOOL_PREFIX+'file',args);}
      catch(error){
        if(error.code!=='GRANT_REVIEWER_READ_NOT_FOUND'||!readId)throw error;
        readId=null;delete args.readId;page=await bound.call(TOOL_PREFIX+'file',args);
      }
      const chunk=Buffer.from(page.data??'','base64'),count=Math.min(65536,item.bytes-offset);
      need(page.exportId===exportId && page.manifestSha256===expectedManifestSha256 &&
        page.file?.name===file && page.file.sha256===item.sha256 && page.file.bytes===item.bytes &&
        page.offset===offset && page.bytesRead===count && chunk.length===count && chunk.toString('base64')===page.data &&
        page.nextOffset===(offset+count<item.bytes?offset+count:null) &&
        typeof page.readId==='string' && new RegExp(UUID).test(page.readId) && (!readId||readId===page.readId),
      'GRANT_REVIEWER_DOWNLOAD_CHUNK_CONFLICT');
      chunks.push(chunk);offset+=chunk.length;readId=page.nextOffset===null?null:page.readId;
    }
  }finally{
    if(readId)await bound.call(TOOL_PREFIX+'file_release',{exportId,readId},{requestSignal:null,timeoutMs:2000}).catch(()=>{});
  }
  const bytes=Buffer.concat(chunks,offset);need(bytes.length===item.bytes && digest(bytes)===item.sha256,
    'GRANT_REVIEWER_FILE_CHANGED');return decode(bytes);
}
