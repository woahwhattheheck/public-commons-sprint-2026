// MIT. Typed original Human Services Directory calls and the maintained complete-file receiver.
import {join,resolve} from 'node:path';
import {readSourceFile,directory as privateDirectory} from './files.mjs';
import {openMerchantFileClient,createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {humanServicesDirectoryActions,validateHumanServicesDirectoryArguments,directoryForeignKeyQueries} from './catalog.mjs';
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
  const foreignKeyQuery=directoryForeignKeyQueries.find(row=>row.action==='directory_conformance_'+kind);
  need(kind==='findings'||kind==='rows'||foreignKeyQuery,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_SELECTION');
  const allowed=foreignKeyQuery?foreignKeyQuery.filters:
    kind==='findings'?['severity','table','code','sourceId','recordId']:['table'];
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
    if(foreignKeyQuery)need(page.byteBudget===4194304&&Number.isSafeInteger(page.bytes)&&
      page.bytes>=0&&page.bytes<=page.byteBudget,
      'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_PAGE_CHANGED','Keep the original foreign-key page byte bound.');
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
/** Stream every selected original relationship page through the complete retained-response reader. */
export async function* iterateHumanServicesDirectoryForeignKeys({
  client,workspace,assessmentId,kind='outcomes',filters={},limit=100,requestOptions
}={}){
  const selected={outcomes:'foreign_keys',candidates:'foreign_key_candidates',matches:'foreign_key_matches'}[kind];
  need(selected,'HUMAN_SERVICES_DIRECTORY_CONFORMANCE_SELECTION','Choose outcomes, candidates or matches.');
  yield* iterateHumanServicesDirectoryConformance({client,workspace,assessmentId,kind:selected,filters,limit,requestOptions});
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

/** Prepare the complete exact native document; the caller reviews this saved preview before acceptance. */
export async function prepareHumanServicesDirectoryOperatingPlan({
  client,workspace,input,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const result=retained(await client.call('directory_operating_plan_preview',
    {workspace,operating_plan_create:input},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_OPERATING_PREVIEW_REJECTED',
    'Read the retained full native preparation response.',{exportId:result.exportId});
  const preview=await readHumanServicesDirectoryValue({workspace,result,client});
  need(preview?.schema==='stellar-forge.directory-operating-preview.v1'&&
    preview.record?.stage==='prepared'&&preview.document?.id===input.id,
    'HUMAN_SERVICES_DIRECTORY_OPERATING_PREVIEW_CHANGED');
  return {result,preview};
}
/** Accept only the caller-selected complete reviewed preview. No replacement preview is created here. */
export async function saveHumanServicesDirectoryOperatingPlan({
  client,workspace,input,previewRecordId,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(previewRecordId,SHA,'reviewed preview record');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need(!input?.previewRecordId||input.previewRecordId===previewRecordId,
    'HUMAN_SERVICES_DIRECTORY_OPERATING_PREVIEW_SELECTION','Keep the same reviewed preview selection.');
  try{
    const result=retained(await client.call('directory_operating_plan_create',
      {workspace,operating_plan_create:{...input,previewRecordId}},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_OPERATING_SAVE_REJECTED',
      'Keep the complete reviewed preview and read this original native response.',
      {previewRecordId,exportId:result.exportId});
    const saved=await readHumanServicesDirectoryValue({workspace,result,client});
    need(saved.record?.stage==='saved'&&saved.record.preparedFromId===previewRecordId&&saved.record.planId===input.id,
      'HUMAN_SERVICES_DIRECTORY_OPERATING_SAVE_CHANGED');
    return {result,saved};
  }catch(error){
    if(error&&typeof error==='object')error.details={...(error.details??{}),
      directoryOperatingPlan:{workspace,previewRecordId,planId:input?.id}};
    throw error;
  }
}
/** Reopen all complete original editing inputs using the same retained JSON range protocol. */
export async function readHumanServicesDirectoryOperatingPlan({
  client,workspace,recordId,revision,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original procedure record');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const values={},results={};
  for(const kind of ['document','draft','basis','input']){
    const result=retained(await client.call('directory_operating_'+kind,
      {workspace,recordId,...(kind==='draft'&&revision!==undefined?{revision}:{})},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_OPERATING_READ_REJECTED',
      'Read the complete original native reopening response.',{recordId,kind,exportId:result.exportId});
    results[kind]=result;values[kind]=await readHumanServicesDirectoryValue({workspace,result,client});
  }
  need(values.document?.schema==='stellar-forge.operating-plan.v1'&&
    values.draft?.schema==='stellar-forge.operating-plan-draft.v1'&&
    values.draft.planId===values.document.id&&values.draft.baseRevision===values.document.revisions.length&&
    values.basis?.schema==='stellar-forge.directory-operating-basis.v1',
    'HUMAN_SERVICES_DIRECTORY_OPERATING_READ_CHANGED');
  return {...values,results};
}
/** Export an exact saved revision or the full original JSON history, then receive every file. */
export async function downloadHumanServicesDirectoryOperatingPlan({
  client,workspace,input,requestOptions,...downloadOptions
}={}){
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const prepareResult=retained(await client.call('directory_operating_plan_export',
    {workspace,operating_plan_export:input},requestOptions));
  need(prepareResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_OPERATING_EXPORT_REJECTED',
    'Read the complete original procedure export response.',{exportId:prepareResult.exportId});
  const prepared=await readHumanServicesDirectoryValue({workspace,result:prepareResult,client});
  checked(prepared.id,SHA,'native procedure export');
  const result=retained(await client.call('directory_export_file',{workspace,exportId:prepared.id},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_OPERATING_FILE_REJECTED',
    'Keep the original native export descriptor and complete file response.',{nativeExportId:prepared.id,exportId:result.exportId});
  const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
    exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
  return {prepared,prepareResult,result,receipt};
}

/** Call one exact accepted return action. Completion and plan application remain separate calls. */
export async function changeHumanServicesDirectoryOperatingReturn({
  client,workspace,action,input,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need(['prepare','revise','complete','apply','receive'].includes(action),
    'HUMAN_SERVICES_DIRECTORY_RETURN_ACTION','Choose one original return action.');
  const selected={workspace,action,input};
  try{
    const result=retained(await client.call('directory_operating_return_'+action,
      {workspace,['operating_return_'+action]:input},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_REJECTED',
      'Preserve this complete request and inspect its retained native response.',{...selected,exportId:result.exportId});
    const saved=await readHumanServicesDirectoryValue({workspace,result,client});
    need(saved?.record?.schema==='stellar-forge.directory-operating-return-record.v1'&&
      new RegExp(SHA).test(saved.record.id)&&typeof saved.reused==='boolean',
      'HUMAN_SERVICES_DIRECTORY_RETURN_CHANGED');
    if(action==='apply')need(saved.record.stage==='applied'&&
      saved.plan?.id===saved.record.appliedPlanRecordId&&saved.plan?.planId===saved.record.planId,
      'HUMAN_SERVICES_DIRECTORY_RETURN_CHANGED','Keep the applied receipt and original native plan together.');
    return {result,saved};
  }catch(error){
    if(error&&typeof error==='object')error.details={...(error.details??{}),directoryOperatingReturn:selected};
    throw error;
  }
}
/** Reopen the complete original review, comparison and accepted input, with their saved record. */
export async function readHumanServicesDirectoryOperatingReturn({
  client,workspace,recordId,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original return record');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const values={},results={};
  for(const kind of ['record','review','comparison','input']){
    const result=retained(await client.call(kind==='record'?'directory_record':'directory_operating_return_'+kind,
      {workspace,recordId,...(kind==='record'?{collection:'operatingPlanReturns'}:{})},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_READ_REJECTED',
      'Read the complete retained response; large originals remain available through the full file route.',
      {recordId,kind,exportId:result.exportId});
    results[kind]=result;values[kind]=await readHumanServicesDirectoryValue({workspace,result,client});
  }
  need(values.record?.id===recordId&&values.record.schema==='stellar-forge.directory-operating-return-record.v1'&&
    values.review?.schema==='stellar-forge.operating-plan-return.v1'&&
    values.comparison?.schema==='stellar-forge.operating-plan-return-comparison.v1'&&
    values.record.reviewId===values.review.id&&values.comparison.reviewId===values.review.id&&
    values.record.planId===values.review.current?.id&&values.comparison.planId===values.record.planId,
    'HUMAN_SERVICES_DIRECTORY_RETURN_READ_CHANGED');
  return {...values,results};
}
/** Every exact original comparison row, including coupled command/results and order decisions. */
export async function* iterateHumanServicesDirectoryOperatingReturn({
  client,workspace,recordId,filters={},limit=100,requestOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original return record');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need(filters&&typeof filters==='object'&&!Array.isArray(filters)&&
    Object.keys(filters).every(key=>['kind','conflict','unresolved'].includes(key)),
    'HUMAN_SERVICES_DIRECTORY_RETURN_FILTERS');
  let offset=0,total,reviewId;
  while(true){
    const result=retained(await client.call('directory_operating_return_rows',
      {workspace,recordId,...filters,offset,limit},requestOptions));
    need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_PAGE_REJECTED',
      'Read the retained original comparison page.',{recordId,offset,exportId:result.exportId});
    const page=await readHumanServicesDirectoryValue({workspace,result,client});
    need(page.recordId===recordId&&typeof page.reviewId==='string'&&
      (reviewId===undefined||page.reviewId===reviewId)&&page.offset===offset&&page.limit===limit&&
      Number.isSafeInteger(page.total)&&page.total>=0&&(total===undefined||total===page.total)&&
      Array.isArray(page.rows)&&page.rows.length<=limit&&Number.isSafeInteger(page.bytes)&&
      page.bytes>=0&&page.bytes<=page.byteBudget&&page.byteBudget===4194304,
      'HUMAN_SERVICES_DIRECTORY_RETURN_PAGE_CHANGED');
    total=page.total;reviewId=page.reviewId;
    const next=offset+page.rows.length;
    need(next<=total&&(page.nextOffset===null?next===total:
      page.rows.length>0&&page.nextOffset===next&&next<total),
      'HUMAN_SERVICES_DIRECTORY_RETURN_PAGE_CHANGED');
    yield {page,result};if(page.nextOffset===null)return;offset=page.nextOffset;
  }
}
/** Receive a complete declared original file and bind it to the immutable native descriptor. */
export async function downloadHumanServicesDirectoryOperatingReturnFile({
  client,workspace,recordId,fileKind='review',requestOptions,...downloadOptions
}={}){
  checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original return record');
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  need(['review','comparison','input'].includes(fileKind),'HUMAN_SERVICES_DIRECTORY_RETURN_FILE');
  const recordResult=retained(await client.call('directory_record',
    {workspace,collection:'operatingPlanReturns',recordId},requestOptions));
  need(recordResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_READ_REJECTED');
  const record=await readHumanServicesDirectoryValue({workspace,result:recordResult,client});
  need(record?.id===recordId&&record?.files?.[fileKind],
    'HUMAN_SERVICES_DIRECTORY_RETURN_FILE_CHANGED');
  const result=retained(await client.call('directory_operating_return_file',
    {workspace,recordId,fileKind},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_FILE_REJECTED',
    'Keep the original complete file descriptor and native response.',{recordId,fileKind,exportId:result.exportId});
  const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
    payload=inspected.manifest.source?.payloadFile??'original-response.json',
    original=inspected.manifest.files.find(file=>file.name===payload),expected=record.files[fileKind];
  need(inspected.manifestSha256===result.manifestSha256&&original&&
    original.bytes===expected.bytes&&original.sha256===expected.sha256,
    'HUMAN_SERVICES_DIRECTORY_RETURN_FILE_CHANGED','The named original payload must match the saved native file.');
  const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
    exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
  return {record,recordResult,result,receipt,payload};
}
/** Export the selected full editable review, readable review or completed plan through original file receiving. */
export async function downloadHumanServicesDirectoryOperatingReturn({
  client,workspace,input,requestOptions,...downloadOptions
}={}){
  need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
  const prepareResult=retained(await client.call('directory_operating_return_export',
    {workspace,operating_return_export:input},requestOptions));
  need(prepareResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_EXPORT_REJECTED',
    'Keep the exact original export selection.',{input,exportId:prepareResult.exportId});
  const prepared=await readHumanServicesDirectoryValue({workspace,result:prepareResult,client});
  checked(prepared.id,SHA,'native return export');
  need(prepared.kind==='operating-return'&&prepared.recordId===input.recordId&&
    prepared.result?.format===input.format,'HUMAN_SERVICES_DIRECTORY_RETURN_EXPORT_CHANGED');
  const result=retained(await client.call('directory_export_file',{workspace,exportId:prepared.id},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RETURN_FILE_REJECTED');
  const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
    payload=inspected.manifest.source?.payloadFile??'original-response.json',
    original=inspected.manifest.files.find(file=>file.name===payload);
  need(inspected.manifestSha256===result.manifestSha256&&original&&
    original.bytes===prepared.file.bytes&&original.sha256===prepared.file.sha256,
    'HUMAN_SERVICES_DIRECTORY_RETURN_FILE_CHANGED');
  const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
    exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
  return {prepared,prepareResult,result,receipt,payload};
}


/** Preserve one complete correction request. Preparing, previewing and accepting are separate operations. */
export async function changeHumanServicesDirectoryCorrection({
 client,workspace,action,input,requestOptions
}={}){
 checked(workspace,ALIAS,'workspace alias');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 need(['prepare','preview','apply'].includes(action),'HUMAN_SERVICES_DIRECTORY_CORRECTION_ACTION');
 const selected={workspace,action,input};
 try{
  const result=retained(await client.call('directory_correction_'+action,
   {workspace,['correction_'+action]:input},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_REJECTED',
   'Keep this exact original request and inspect its retained native response.',{...selected,exportId:result.exportId});
  const record=await readHumanServicesDirectoryValue({workspace,result,client});
  const schema={prepare:'stellar-forge.directory-correction-plan.v1',
   preview:'stellar-forge.directory-correction-preview.v1',apply:'stellar-forge.directory-correction.v1'}[action];
  need(record?.schema===schema&&new RegExp(SHA).test(record.id||''),
   'HUMAN_SERVICES_DIRECTORY_CORRECTION_CHANGED');
  if(action==='prepare')need(record.editionId===input.editionId&&record.files?.input,
   'HUMAN_SERVICES_DIRECTORY_CORRECTION_CHANGED');
  if(action==='preview')need(record.planId===input.planId&&new RegExp(SHA).test(record.candidateEditionId||'')&&
   new RegExp(SHA).test(record.comparisonId||''),'HUMAN_SERVICES_DIRECTORY_CORRECTION_CHANGED');
  if(action==='apply')need(record.stage==='accepted'&&record.previewId===input.previewId&&
   record.beforeEditionId===input.expectedEditionId&&record.expectedEditionId===input.expectedEditionId,
   'HUMAN_SERVICES_DIRECTORY_CORRECTION_CHANGED');
  return {result,record};
 }catch(error){
  if(error&&typeof error==='object')error.details={...(error.details??{}),directoryCorrection:selected};
  throw error;
 }
}
/** Read a complete immutable correction record, retaining its exact native response. */
export async function readHumanServicesDirectoryCorrection({client,workspace,collection,recordId,requestOptions}={}){
 checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original correction record');
 need(['correctionPlans','correctionPreviews','corrections'].includes(collection),
  'HUMAN_SERVICES_DIRECTORY_CORRECTION_SELECTION');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 const result=retained(await client.call('directory_record',{workspace,collection,recordId},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_READ_REJECTED');
 const record=await readHumanServicesDirectoryValue({workspace,result,client});
 const schema={correctionPlans:'stellar-forge.directory-correction-plan.v1',
  correctionPreviews:'stellar-forge.directory-correction-preview.v1',corrections:'stellar-forge.directory-correction.v1'}[collection];
 need(record?.id===recordId&&record.schema===schema,'HUMAN_SERVICES_DIRECTORY_CORRECTION_CHANGED');
 return {result,record};
}
/** Receive every contiguous native edit/change page. Large unchanged originals stay in complete files. */
export async function* iterateHumanServicesDirectoryCorrection({
 client,workspace,collection,recordId,limit=100,requestOptions
}={}){
 checked(workspace,ALIAS,'workspace alias');checked(recordId,SHA,'original correction record');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 need(['correctionPlans','correctionPreviews','corrections'].includes(collection)&&
  Number.isSafeInteger(limit)&&limit>=1&&limit<=250,'HUMAN_SERVICES_DIRECTORY_CORRECTION_SELECTION');
 let offset=0,total;
 while(true){
  const result=retained(await client.call('directory_correction_rows',{workspace,collection,recordId,offset,limit},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_PAGE_REJECTED',
   'Read the complete retained native change response.',{recordId,offset,exportId:result.exportId});
  const page=await readHumanServicesDirectoryValue({workspace,result,client});
  need(page.kind===collection&&page.recordId===recordId&&page.offset===offset&&page.limit===limit&&
   Number.isSafeInteger(page.total)&&page.total>=0&&(total===undefined||total===page.total)&&
   Array.isArray(page.rows)&&page.rows.length<=limit&&page.byteBudget===4194304&&
   Number.isSafeInteger(page.bytes)&&page.bytes>=0&&page.bytes<=page.byteBudget,
   'HUMAN_SERVICES_DIRECTORY_CORRECTION_PAGE_CHANGED');
  total=page.total;const next=offset+page.rows.length;
  need(next<=total&&(page.nextOffset===null?next===total:
   page.rows.length>0&&page.nextOffset===next&&next<total),'HUMAN_SERVICES_DIRECTORY_CORRECTION_PAGE_CHANGED');
  yield {result,page};if(page.nextOffset===null)return;offset=page.nextOffset;
 }
}
/** Bind the full payload to the immutable native file descriptor before complete receiving. */
export async function downloadHumanServicesDirectoryCorrectionFile({
 client,workspace,collection,recordId,fileKind,requestOptions,...downloadOptions
}={}){
 const {record,result:recordResult}=await readHumanServicesDirectoryCorrection({client,workspace,collection,recordId,requestOptions});
 need((collection==='correctionPlans'?['input']:['changes','review']).includes(fileKind)&&record.files?.[fileKind],
  'HUMAN_SERVICES_DIRECTORY_CORRECTION_FILE_SELECTION');
 const result=retained(await client.call('directory_correction_file',{workspace,collection,recordId,fileKind},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  original=inspected.manifest.files.find(file=>file.name===payload),expected=record.files[fileKind];
 need(inspected.manifestSha256===result.manifestSha256&&original&&
  original.bytes===expected.bytes&&original.sha256===expected.sha256,
  'HUMAN_SERVICES_DIRECTORY_CORRECTION_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 return {record,recordResult,result,receipt,payload};
}
/** Receive the complete source/review correction packet prepared by the original native engine. */
export async function downloadHumanServicesDirectoryCorrection({
 client,workspace,input,requestOptions,...downloadOptions
}={}){
 checked(workspace,ALIAS,'workspace alias');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 const prepareResult=retained(await client.call('directory_correction_export',{workspace,correction_export:input},requestOptions));
 need(prepareResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_EXPORT_REJECTED');
 const prepared=await readHumanServicesDirectoryValue({workspace,result:prepareResult,client});
 checked(prepared.id,SHA,'native correction export');
 need(prepared.kind==='correction'&&prepared.recordId===input.correctionId&&prepared.file,
  'HUMAN_SERVICES_DIRECTORY_CORRECTION_EXPORT_CHANGED');
 const result=retained(await client.call('directory_export_file',{workspace,exportId:prepared.id},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_CORRECTION_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  original=inspected.manifest.files.find(file=>file.name===payload);
 need(inspected.manifestSha256===result.manifestSha256&&original&&
  original.bytes===prepared.file.bytes&&original.sha256===prepared.file.sha256,
  'HUMAN_SERVICES_DIRECTORY_CORRECTION_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 return {prepared,prepareResult,result,receipt,payload};
}


const worksheetSchemas=Object.freeze({
 correctionWorksheets:'stellar-forge.directory-correction-worksheet.v1',
 correctionWorksheetImports:'stellar-forge.directory-correction-worksheet-import.v1',
 correctionWorksheetReturns:'stellar-forge.directory-correction-worksheet-return-record.v1',
 correctionWorksheetReviews:'stellar-forge.directory-correction-worksheet-review.v1'
});
/** Read the exact immutable worksheet record before selecting its files or review. */
export async function readHumanServicesDirectoryWorksheet({client,workspace,collection,recordId,requestOptions}={}){
 checked(workspace,ALIAS,'workspace');checked(recordId,SHA,'worksheet record');
 need(client&&typeof client.call==='function'&&Object.hasOwn(worksheetSchemas,collection),
  'HUMAN_SERVICES_DIRECTORY_WORKSHEET_SELECTION');
 const result=retained(await client.call('directory_record',{workspace,collection,recordId},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_READ_REJECTED');
 const record=await readHumanServicesDirectoryValue({workspace,result,client});
 need(record.id===recordId&&record.schema===worksheetSchemas[collection],
  'HUMAN_SERVICES_DIRECTORY_WORKSHEET_CHANGED');
 return {record,result};
}
/** Save exact intake metadata once, then PUT a complete declared host input with the same import identity. */
export async function receiveHumanServicesDirectoryWorksheet({
 client,workspace,input,expectedSha256,profile,importId,requestOptions
}={}){
 checked(workspace,ALIAS,'workspace');checked(input,ALIAS,'host input');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 need((profile!==undefined)!==(importId!==undefined),'HUMAN_SERVICES_DIRECTORY_WORKSHEET_IMPORT_SELECTION',
  'Select a complete immutable intake profile or its already saved import ID.');
 let importResult;
 if(profile!==undefined){
  importResult=retained(await client.call('directory_correction_worksheet_import',
   {workspace,correction_worksheet_import:profile},requestOptions));
  need(importResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_IMPORT_REJECTED');
  const record=await readHumanServicesDirectoryValue({workspace,result:importResult,client});
  importId=checked(record.id,SHA,'saved worksheet import');
 }else checked(importId,SHA,'saved worksheet import');
 try{
  const result=retained(await client.call('directory_correction_worksheet_receive',
   {workspace,input,importId,...(expectedSha256===undefined?{}:{expectedSha256})},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_RETURN_REJECTED',
   'Read the retained native response and resume with this same import and original file.',
   {importId,exportId:result.exportId});
  const record=await readHumanServicesDirectoryValue({workspace,result,client});
  need(record.schema===worksheetSchemas.correctionWorksheetReturns&&record.importId===importId&&
   new RegExp(SHA).test(record.id),'HUMAN_SERVICES_DIRECTORY_WORKSHEET_RETURN_CHANGED');
  return {importId,...(importResult?{importResult}:{}),result,record};
 }catch(error){
  if(error&&typeof error==='object')error.details={...(error.details??{}),
   worksheetImport:{workspace,input,importId,...(importResult?{importExportId:importResult.exportId}:{})}};
  throw error;
 }
}
/** Every page remains bound to one immutable record and contiguous original order.
 * A native oversized-row error is returned unchanged; use the full changes/decisions/rows file. */
export async function* iterateHumanServicesDirectoryWorksheet({
 client,workspace,collection,recordId,limit=100,rowKey,state,requestOptions
}={}){
 checked(workspace,ALIAS,'workspace');checked(recordId,SHA,'worksheet record');
 need(client&&typeof client.call==='function'&&Object.hasOwn(worksheetSchemas,collection)&&
  Number.isSafeInteger(limit)&&limit>=1&&limit<=250,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_SELECTION');
 let offset=0,total;
 while(true){
  const result=retained(await client.call('directory_correction_worksheet_rows',
   {workspace,collection,recordId,offset,limit,...(rowKey===undefined?{}:{rowKey}),
    ...(state===undefined?{}:{state})},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_PAGE_REJECTED',
   'Receive the full rows, changes or decisions file when a complete row exceeds the native page budget.',
   {recordId,collection,offset,exportId:result.exportId});
  const page=await readHumanServicesDirectoryValue({workspace,result,client});
  need(page.kind===collection&&page.recordId===recordId&&page.offset===offset&&page.limit===limit&&
   Number.isSafeInteger(page.total)&&page.total>=0&&(total===undefined||total===page.total)&&
   Array.isArray(page.rows)&&page.rows.length<=limit&&page.byteBudget===4194304&&
   Number.isSafeInteger(page.bytes)&&page.bytes>=0&&page.bytes<=page.byteBudget,
   'HUMAN_SERVICES_DIRECTORY_WORKSHEET_PAGE_CHANGED');
  total=page.total;const next=offset+page.rows.length;
  need(next<=total&&(page.nextOffset===null?next===total:
   page.rows.length>0&&page.nextOffset===next&&next<total),'HUMAN_SERVICES_DIRECTORY_WORKSHEET_PAGE_CHANGED');
  yield {result,page};if(page.nextOffset===null)return;offset=page.nextOffset;
 }
}
/** Receive every original file byte. Generated worksheet documents are verified against their saved identity after download. */
export async function downloadHumanServicesDirectoryWorksheetFile({
 client,workspace,collection,recordId,fileKind,requestOptions,...downloadOptions
}={}){
 const {record,result:recordResult}=await readHumanServicesDirectoryWorksheet({client,workspace,collection,recordId,requestOptions});
 const allowed={correctionWorksheets:['input','rows','worksheet'],correctionWorksheetImports:['input'],
  correctionWorksheetReturns:['original','changes'],correctionWorksheetReviews:['input','decisions']}[collection];
 need(allowed.includes(fileKind),'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_SELECTION');
 const expected=record.files?.[fileKind];
 need(expected||collection==='correctionWorksheets'&&fileKind==='worksheet',
  'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_SELECTION');
 const result=retained(await client.call('directory_correction_worksheet_file',
  {workspace,collection,recordId,fileKind},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  descriptor=inspected.manifest.files.find(file=>file.name===payload);
 need(inspected.manifestSha256===result.manifestSha256&&descriptor&&
  (!expected||descriptor.bytes===expected.bytes&&descriptor.sha256===expected.sha256),
  'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 if(fileKind==='worksheet'){
  const {readFile}=await import('node:fs/promises');
  need(descriptor.bytes<=67108864,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_DOCUMENT_LIMIT');
  const raw=await readFile(join(receipt.directory,payload));
  need(raw.length===descriptor.bytes&&digest(raw)===descriptor.sha256,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_CHANGED');
  const document=decode(raw,'complete original worksheet');
  need(document.schema===worksheetSchemas.correctionWorksheets&&document.worksheetId===recordId&&
   document.workspaceId===record.workspaceId&&document.editionId===record.editionId&&
   Array.isArray(document.rows)&&document.rows.length===record.summary.rows,
   'HUMAN_SERVICES_DIRECTORY_WORKSHEET_DOCUMENT_CHANGED');
 }
 return {record,recordResult,result,receipt,payload,descriptor};
}
/** Prepare and receive the entire portable customer package without making any review decision. */
export async function downloadHumanServicesDirectoryWorksheet({
 client,workspace,input,requestOptions,...downloadOptions
}={}){
 const prepareResult=retained(await client.call('directory_correction_worksheet_export',
  {workspace,correction_worksheet_export:input},requestOptions));
 need(prepareResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_EXPORT_REJECTED');
 const prepared=await readHumanServicesDirectoryValue({workspace,result:prepareResult,client});
 checked(prepared.id,SHA,'worksheet export');
 need(prepared.kind==='correction-worksheet'&&prepared.recordId===input.worksheetId&&prepared.file,
  'HUMAN_SERVICES_DIRECTORY_WORKSHEET_EXPORT_CHANGED');
 const result=retained(await client.call('directory_export_file',{workspace,exportId:prepared.id},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  descriptor=inspected.manifest.files.find(file=>file.name===payload);
 need(inspected.manifestSha256===result.manifestSha256&&descriptor&&descriptor.bytes===prepared.file.bytes&&
  descriptor.sha256===prepared.file.sha256,'HUMAN_SERVICES_DIRECTORY_WORKSHEET_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 return {prepared,prepareResult,result,receipt,payload};
}


const reconciliationSchemas=Object.freeze({
 correctionWorksheetReconciliations:'stellar-forge.directory-worksheet-reconciliation.v1',
 correctionWorksheetReconciliationReviews:'stellar-forge.directory-worksheet-reconciliation-review.v1'
});
async function reconciliationAction({client,workspace,input,requestOptions},action,collection){
 checked(workspace,ALIAS,'workspace');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 const key='correction_worksheet_reconciliation_'+action;
 const result=retained(await client.call('directory_'+key,{workspace,[key]:input},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_REJECTED',
  'Read the entire retained native response and resume this exact input.',{exportId:result.exportId,action});
 const record=await readHumanServicesDirectoryValue({workspace,result,client});
 checked(record.id,SHA,'immutable reconciliation record');
 need(record.schema===reconciliationSchemas[collection]&&record.workspaceId===result.workspaceId,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_CHANGED');
 if(action==='prepare')need(record.returnId===input.returnId&&record.currentEditionId===input.currentEditionId,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_CHANGED');
 if(action==='review')need(record.reconciliationId===input.reconciliationId&&
  ['plan-prepared','no-edits-selected'].includes(record.outcome)&&
  (record.outcome==='plan-prepared'?new RegExp(SHA).test(record.planId):record.planId===null),
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_CHANGED');
 return {record,result};
}
/** Freeze every explicit original/current row binding and its typed three-way comparison. */
export async function prepareDirectoryWorksheetReconciliation(options={}){
 return reconciliationAction(options,'prepare','correctionWorksheetReconciliations');
}
/** Retain every explicit decision and prepare one current-edition plan; never preview or accept it here. */
export async function reviewDirectoryWorksheetReconciliation(options={}){
 return reconciliationAction(options,'review','correctionWorksheetReconciliationReviews');
}
export async function getDirectoryWorksheetReconciliationRecord({client,workspace,collection,recordId,requestOptions}={}){
 checked(workspace,ALIAS,'workspace');checked(recordId,SHA,'reconciliation record');
 need(client&&typeof client.call==='function'&&Object.hasOwn(reconciliationSchemas,collection),
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_SELECTION');
 const result=retained(await client.call('directory_record',{workspace,collection,recordId},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_READ_REJECTED');
 const record=await readHumanServicesDirectoryValue({workspace,result,client});
 need(record.id===recordId&&record.schema===reconciliationSchemas[collection]&&record.workspaceId===result.workspaceId,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_CHANGED');
 return {record,result};
}
/** Page every complete comparison/decision in native order; use the full file if one row exceeds4MiB. */
export async function* directoryWorksheetReconciliationRows({
 client,workspace,collection,recordId,limit=100,rowKey,state,requestOptions
}={}){
 checked(workspace,ALIAS,'workspace');checked(recordId,SHA,'reconciliation record');
 need(client&&typeof client.call==='function'&&Object.hasOwn(reconciliationSchemas,collection)&&
  Number.isSafeInteger(limit)&&limit>=1&&limit<=250,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_SELECTION');
 let offset=0,total;
 while(true){
  const result=retained(await client.call('directory_correction_worksheet_reconciliation_rows',
   {workspace,collection,recordId,offset,limit,...(rowKey===undefined?{}:{rowKey}),...(state===undefined?{}:{state})},requestOptions));
  need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_PAGE_REJECTED',
   'Receive the complete comparison or decisions file when a native row exceeds the page budget.',
   {collection,recordId,offset,exportId:result.exportId});
  const page=await readHumanServicesDirectoryValue({workspace,result,client});
  need(page.kind===collection&&page.recordId===recordId&&page.offset===offset&&page.limit===limit&&
   Number.isSafeInteger(page.total)&&page.total>=0&&(total===undefined||total===page.total)&&
   Array.isArray(page.rows)&&page.rows.length<=limit&&page.byteBudget===4194304&&
   Number.isSafeInteger(page.bytes)&&page.bytes>=0&&page.bytes<=page.byteBudget,
   'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_PAGE_CHANGED');
  total=page.total;const next=offset+page.rows.length;
  need(next<=total&&(page.nextOffset===null?next===total:page.rows.length>0&&page.nextOffset===next&&next<total),
   'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_PAGE_CHANGED');
  yield {result,page};if(page.nextOffset===null)return;offset=page.nextOffset;
 }
}
/** Receive full input/rows/comparison/decisions bound to the immutable native descriptor, up to256MiB. */
export async function directoryWorksheetReconciliationFile({
 client,workspace,collection,recordId,fileKind,requestOptions,...downloadOptions
}={}){
 const {record,result:recordResult}=await getDirectoryWorksheetReconciliationRecord({client,workspace,collection,recordId,requestOptions});
 const allowed=collection==='correctionWorksheetReconciliations'?['input','rows','comparison']:['input','decisions'];
 need(allowed.includes(fileKind)&&record.files?.[fileKind],
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_SELECTION');
 const expected=record.files[fileKind];
 need(Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&expected.bytes<=268435456&&new RegExp(SHA).test(expected.sha256),
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_CHANGED');
 const result=retained(await client.call('directory_correction_worksheet_reconciliation_file',
  {workspace,collection,recordId,fileKind},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  descriptor=inspected.manifest.files.find(file=>file.name===payload);
 need(inspected.manifestSha256===result.manifestSha256&&descriptor&&descriptor.bytes===expected.bytes&&descriptor.sha256===expected.sha256,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 return {record,recordResult,result,receipt,payload,descriptor};
}
/** Export and receive the complete reconciliation and optional review without making a new decision. */
export async function exportDirectoryWorksheetReconciliation({
 client,workspace,input,requestOptions,...downloadOptions
}={}){
 checked(workspace,ALIAS,'workspace');
 need(client&&typeof client.call==='function','HUMAN_SERVICES_DIRECTORY_CLIENT_REQUIRED');
 const prepareResult=retained(await client.call('directory_correction_worksheet_reconciliation_export',
  {workspace,correction_worksheet_reconciliation_export:input},requestOptions));
 need(prepareResult.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_EXPORT_REJECTED');
 const prepared=await readHumanServicesDirectoryValue({workspace,result:prepareResult,client});
 checked(prepared.id,SHA,'reconciliation export');
 need(prepared.kind==='correction-worksheet-reconciliation'&&prepared.recordId===input.reconciliationId&&
  (prepared.reviewId??null)===(input.reviewId??null)&&prepared.file,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_EXPORT_CHANGED');
 const result=retained(await client.call('directory_export_file',{workspace,exportId:prepared.id},requestOptions));
 need(result.native?.ok,'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_REJECTED');
 const inspected=await inspectHumanServicesDirectoryExport({workspace,client,exportId:result.exportId}),
  payload=inspected.manifest.source?.payloadFile??'original-response.json',
  descriptor=inspected.manifest.files.find(file=>file.name===payload);
 need(inspected.manifestSha256===result.manifestSha256&&descriptor&&descriptor.bytes===prepared.file.bytes&&descriptor.sha256===prepared.file.sha256,
  'HUMAN_SERVICES_DIRECTORY_RECONCILIATION_FILE_CHANGED');
 const receipt=await downloadHumanServicesDirectoryExport({...downloadOptions,workspace,client,
  exportId:result.exportId,expectedManifestSha256:result.manifestSha256});
 return {prepared,prepareResult,result,receipt,payload};
}
