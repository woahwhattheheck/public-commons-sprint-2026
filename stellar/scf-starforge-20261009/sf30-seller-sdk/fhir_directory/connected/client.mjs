// MIT. Typed original Human Services Directory calls and the maintained complete-file receiver.
import {join,resolve} from 'node:path';
import {readSourceFile,directory as privateDirectory} from './files.mjs';
import {openMerchantFileClient,createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {humanServicesDirectoryActions,validateHumanServicesDirectoryArguments} from './catalog.mjs';
import {TOOL_PREFIX,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,SHA,UUID,ALIAS,need,checked,
  decode,encode,digest,parseHumanServicesDirectoryExport} from './contracts.mjs';
export {humanServicesDirectoryActions} from './catalog.mjs';
export async function openHumanServicesDirectoryMerchantClient(options={}){
  const original=await openMerchantFileClient({...options,errorPrefix:'HUMAN_SERVICES_DIRECTORY',
    clientName:'starforge-human-services-directory-client',maximumResponseBytes:3*1024*1024});
  const call=(action,args={},requestOptions)=>{
    validateHumanServicesDirectoryArguments(action,args);
    return original.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args,requestOptions);
  };
  const named=Object.fromEntries(Object.keys(humanServicesDirectoryActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={},requestOptions)=>call(action,args,requestOptions)]));
  return Object.freeze({endpoint:original.endpoint,call,...named,close:async()=>{},
    readValue:args=>readHumanServicesDirectoryValue({...args,client:{endpoint:original.endpoint,call}})});
}
/** Local CLI/SDK access shares the same native operator and retained-file runtime without another MCP listener. */
export async function openHumanServicesDirectoryLocalClient({connection,exportsDirectory}={}){
  const {readHumanServicesDirectoryConfiguration}=await import('./connection.mjs');
  const {MerchantHumanServicesDirectory}=await import('./runtime.mjs');
  const humanServicesDirectory=await readHumanServicesDirectoryConfiguration(resolve(connection)),
    owner=new MerchantHumanServicesDirectory({humanServicesDirectory,exportsDirectory:await privateDirectory(resolve(exportsDirectory))});
  const call=(action,args={})=>{
    validateHumanServicesDirectoryArguments(action,args);
    return owner.call(action.startsWith(TOOL_PREFIX)?action:TOOL_PREFIX+action,args);
  };
  const endpoint='stellar-forge:human-services-directory-local:'+digest(Buffer.from(resolve(connection)));
  const named=Object.fromEntries(Object.keys(humanServicesDirectoryActions).map(action=>[
    action.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase()),(args={})=>call(action,args)]));
  return Object.freeze({endpoint,call,...named,close:()=>owner.close(),
    readValue:args=>readHumanServicesDirectoryValue({...args,client:{endpoint,call}})});
}
function retained(result){
  need(result?.retention?.state==='COMPLETE' && result.exportId,'HUMAN_SERVICES_DIRECTORY_RETENTION_REQUIRED',
    'The original operation returned but its complete file is not retained. Recover the same action after restoring storage.');
  return result;
}
const transfers=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseHumanServicesDirectoryExport,maximumBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES,
  stateSchema:'stellar-forge.human-services-directory-file-download.v1',resultSchema:'stellar-forge.human-services-directory-file-receipt.v1',
  toolPrefix:TOOL_PREFIX.slice(0,-1),errorPrefix:'HUMAN_SERVICES_DIRECTORY',clientName:'starforge-human-services-directory-file-receiver',
  validateExportId:id=>checked(id,SHA,'export ID'),
  describe:manifest=>({workspace:manifest.workspace,workspaceId:manifest.workspaceId,kind:manifest.kind,source:manifest.source})
});
async function boundClient({workspace,exportId,client,...options}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  const original=client??await openHumanServicesDirectoryMerchantClient(options);
  const call=(name,args,requestOptions)=>original.call(name,{workspace,...args},requestOptions);
  const info=await call(TOOL_PREFIX+'manifest',{exportId});
  need(info.state==='MANIFEST_RETAINED' && info.exportId===exportId,'HUMAN_SERVICES_DIRECTORY_MANIFEST_INVALID');
  const manifest=parseHumanServicesDirectoryExport(encode(info.manifest),exportId);
  need(manifest.workspace===workspace,'HUMAN_SERVICES_DIRECTORY_MANIFEST_INVALID');
  // The file identity belongs to this immutable original workbench/export, not a temporary MCP port.
  // The normal downloader still verifies every exact manifest/file/prefix byte on resume.
  return {endpoint:'stellar-forge:human-services-directory:'+manifest.workspaceId+':'+workspace,call};
}
export async function downloadHumanServicesDirectoryExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.download({...options,signal,client:bound});
}
export async function inspectHumanServicesDirectoryExport({workspace,client,url,tokenEnv,environment,signal,...options}={}){
  const bound=await boundClient({workspace,client,url,tokenEnv,environment,signal,exportId:options.exportId});
  return transfers.inspect({...options,signal,client:bound});
}
export async function reopenHumanServicesDirectoryExport({directory,workspace,exportId,expectedManifestSha256}={}){
  checked(workspace,ALIAS,'workspace alias');checked(exportId,SHA,'export ID');
  return transfers.lockedDownload(resolve(directory),async context=>{
    const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),65000),
      manifest=parseHumanServicesDirectoryExport(bytes,exportId),manifestSha256=digest(bytes);
    need(manifest.workspace===workspace &&
      (expectedManifestSha256===undefined || checked(expectedManifestSha256,SHA,'manifest SHA256')===manifestSha256),
    'HUMAN_SERVICES_DIRECTORY_DOWNLOAD_EXPORT_CHANGED');
    await transfers.loadContext(context,bytes,exportId);
    for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file);
    return {schema:'stellar-forge.human-services-directory-file-receipt.v1',state:'REOPENED',workspace,
      workspaceId:manifest.workspaceId,exportId,manifestSha256,files:manifest.files.length,
      bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),directory:context.root,kind:manifest.kind,source:manifest.source};
  });
}
/** Read the entire immutable JSON response into memory through the same native range protocol. */
export async function readHumanServicesDirectoryValue({workspace,result,exportId,file='original-response.json',
  expectedManifestSha256,client,...options}={}){
  if(result){retained(result);exportId=result.exportId;expectedManifestSha256=result.manifestSha256;workspace??=result.workspace;}
  const original=client??await openHumanServicesDirectoryMerchantClient(options);
  const bound=await boundClient({workspace,exportId,client:original});
  const info=await bound.call(TOOL_PREFIX+'manifest',{exportId}),
    manifest=parseHumanServicesDirectoryExport(encode(info.manifest),exportId),
    item=manifest.files.find(item=>item.name===file);
  expectedManifestSha256??=info.manifestFile.sha256;
  need(item && item.bytes<=MAX_RESPONSE_BYTES && info.manifestFile.sha256===expectedManifestSha256,
    'HUMAN_SERVICES_DIRECTORY_FILE_CHANGED','Select the complete original JSON file and manifest identity.');
  const chunks=[];let offset=0,readId=null;
  try{
    while(offset<item.bytes){
      let page;
      const args={exportId,file,expectedManifestSha256,expectedSha256:item.sha256,offset,limit:65536,
        ...(readId?{readId}:{})};
      try{page=await bound.call(TOOL_PREFIX+'file',args);}
      catch(error){
        if(error.code!=='HUMAN_SERVICES_DIRECTORY_READ_NOT_FOUND'||!readId)throw error;
        readId=null;delete args.readId;page=await bound.call(TOOL_PREFIX+'file',args);
      }
      const chunk=Buffer.from(page.data??'','base64'),count=Math.min(65536,item.bytes-offset);
      need(page.exportId===exportId && page.manifestSha256===expectedManifestSha256 &&
        page.file?.name===file && page.file.sha256===item.sha256 && page.file.bytes===item.bytes &&
        page.offset===offset && page.bytesRead===count && chunk.length===count && chunk.toString('base64')===page.data &&
        page.nextOffset===(offset+count<item.bytes?offset+count:null) &&
        typeof page.readId==='string' && new RegExp(UUID).test(page.readId) && (!readId||readId===page.readId),
      'HUMAN_SERVICES_DIRECTORY_DOWNLOAD_CHUNK_CONFLICT');
      chunks.push(chunk);offset+=chunk.length;readId=page.nextOffset===null?null:page.readId;
    }
  }finally{
    if(readId)await bound.call(TOOL_PREFIX+'file_release',{exportId,readId},{requestSignal:null,timeoutMs:2000}).catch(()=>{});
  }
  const bytes=Buffer.concat(chunks,offset);need(bytes.length===item.bytes && digest(bytes)===item.sha256,
    'HUMAN_SERVICES_DIRECTORY_FILE_CHANGED');return decode(bytes);
}

/** Retain the full import profile, then stream the same host-declared source into it. */
export async function importHumanServicesDirectorySource({
  client,workspace,input,expectedSha256,profile,importProfileId
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(input,ALIAS,'host input alias');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need((profile!==undefined)!==(importProfileId!==undefined),'HUMAN_SERVICES_DIRECTORY_IMPORT_SELECTION',
    'Select the complete metadata profile or an existing saved import profile ID.');
  let profileResult;
  if(profile!==undefined){
    profileResult=await client.call('directory_import_profile_save',{workspace,profile});
    retained(profileResult);
    need(profileResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_IMPORT_PROFILE_REJECTED',
      'The native directory rejected the selected import profile.',{profileExportId:profileResult.exportId});
    const original=await readHumanServicesDirectoryValue({workspace,result:profileResult,client});
    importProfileId=checked(original.id,SHA,'saved directory import profile');
  }else checked(importProfileId,SHA,'saved directory import profile');
  try{
    const sourceResult=await client.call('directory_source_import',{workspace,input,importProfileId,
      ...(expectedSha256===undefined?{}:{expectedSha256})});
    retained(sourceResult);
    need(sourceResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_SOURCE_IMPORT_REJECTED',
      'Read the retained native source response with this same import profile.',
      {importProfileId,sourceExportId:sourceResult.exportId});
    const source=await readHumanServicesDirectoryValue({workspace,result:sourceResult,client});
    return {importProfileId,...(profileResult?{profileResult}:{}),sourceResult,source};
  }catch(error){
    if(error&&typeof error==='object')error.details={...(error.details??{}),
      directoryImport:{workspace,input,importProfileId,...(profileResult?{profileExportId:profileResult.exportId}:{})}};
    throw error;
  }
}

/** Save a complete conformance plan, then assess its selected original population. */
export async function assessHumanServicesDirectoryConformance({
  client,workspace,plan,planId,assessment,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need((plan!==undefined)!==(planId!==undefined),'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_SELECTION',
    'Select a complete plan input or an existing conformance plan ID.');
  let planResult;
  if(plan!==undefined){
    planResult=retained(await client.call('directory_conformance_plan',{workspace,conformance_plan:plan},requestOptions));
    need(planResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_PLAN_REJECTED',
      'Read the retained native response for this conformance plan.',{planExportId:planResult.exportId});
    const saved=await readHumanServicesDirectoryValue({workspace,result:planResult,client});
    planId=checked(saved.id,SHA,'saved conformance plan ID');
  }else checked(planId,SHA,'saved conformance plan ID');
  try{
    const result=retained(await client.call('directory_conformance_assess',{
      workspace,conformance_assess:{...assessment,planId}},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_ASSESSMENT_REJECTED',
      'Read the retained response and continue with the same saved conformance plan.',{planId,assessmentExportId:result.exportId});
    const value=await readHumanServicesDirectoryValue({workspace,result,client});
    return {planId,...(planResult?{planResult}:{}),result,assessment:value};
  }catch(error){
    if(error&&typeof error==='object')error.details={...(error.details??{}),
      directoryConformance:{workspace,planId,...(planResult?{planExportId:planResult.exportId}:{})}};
    throw error;
  }
}
/** Iterate complete native pages without loading an entire assessment into memory. */
export async function* iterateHumanServicesDirectoryConformance({
  client,workspace,assessmentId,kind='findings',filters={},limit=100,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(assessmentId,SHA,'conformance assessment ID');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need(kind==='findings'||kind==='rows','HUMAN_SERVICES_DIRECTORY_CONFORMANCE_SELECTION');
  const allowed=kind==='findings'?['severity','table','code','sourceId','recordId']:['table'];
  need(filters&&typeof filters==='object'&&!Array.isArray(filters)&&
    Object.keys(filters).every(key=>allowed.includes(key)),'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_FILTERS');
  let offset=0,total;
  while(true){
    const result=retained(await client.call('directory_conformance_'+kind,
      {workspace,assessmentId,...filters,offset,limit},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_PAGE_REJECTED',
      'Read the complete retained native finding or row response.',{exportId:result.exportId,assessmentId,offset});
    const page=await readHumanServicesDirectoryValue({workspace,result,client});
    need(page.assessmentId===assessmentId&&page.offset===offset&&page.limit===limit&&
      Number.isSafeInteger(page.total)&&page.total>=0&&Array.isArray(page.rows)&&
      page.rows.length<=limit&&(total===undefined||page.total===total),
      'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_PAGE_CHANGED');
    total=page.total;
    const next=offset+page.rows.length;
    need(next<=total&&(page.nextOffset===null?next===total:
      page.rows.length>0&&page.nextOffset===next&&next<total),
      'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_PAGE_CHANGED');
    yield {page,result};
    if(page.nextOffset===null)return;
    offset=page.nextOffset;
  }
}
/** Receive the full selected native conformance file using the standard retained downloader. */
export async function downloadHumanServicesDirectoryConformance({
  client,workspace,collection,recordId,fileKind='package',requestOptions,...downloadOptions
}={}){
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const result=retained(await client.call('directory_conformance_file',
    {workspace,collection,recordId,fileKind},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_FILE_REJECTED',
    'Choose a file declared by the selected saved conformance record.',{exportId:result.exportId});
  const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
    exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
  return {result,receipt};
}
