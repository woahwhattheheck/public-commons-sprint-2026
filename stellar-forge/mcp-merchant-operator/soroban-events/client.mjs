// MIT. Typed Soroban operations using the original authenticated Merchant transport.
import {join,resolve} from 'node:path';
import {openMerchantFileClient,createRetainedDownload} from '../retained-download.mjs';
import {sorobanEventsDefinitions,validateSorobanEventsArguments} from '../catalog/soroban-events.mjs';
import {TOOL_PREFIX,MANIFEST_NAME,MAX_FILE_BYTES,MAX_MANIFEST_BYTES,MAX_JSON_BYTES,ALIAS,SHA,
  need,text,checked,digest,decode,parseSorobanEventsManifest} from './contracts.mjs';
export {sorobanEventsDefinitions} from '../catalog/soroban-events.mjs';
const camel=name=>name.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());

export async function openSorobanEventsMerchantClient(options={}){
  const original=await openMerchantFileClient({...options,errorPrefix:'SOROBAN_EVENTS',
    clientName:'starforge-soroban-events-client',maximumResponseBytes:128*1024*1024});
  const call=async(name,args={},requestOptions)=>{
    const action=validateSorobanEventsArguments(name,args);
    try{return await original.call(TOOL_PREFIX+action,args,requestOptions);}
    catch(error){
      if(args.requestId&&error&&typeof error==='object'){
        error.requestId??=args.requestId;error.workspace??=args.workspace;error.action??=action;
      }
      throw error;
    }
  };
  const core={endpoint:original.endpoint,call};
  const named=Object.fromEntries(sorobanEventsDefinitions.map(item=>[
    camel(item.action),(args={},requestOptions)=>call(item.action,args,requestOptions)]));
  return Object.freeze({...core,...named,
    downloadExport:options=>downloadSorobanEventsExport({...options,client:core}),
    inspectExport:options=>inspectSorobanEventsExport({...options,client:core}),
    readJson:options=>readSorobanEventsJson({...options,client:core}),
    reopenExport:options=>reopenSorobanEventsExport(options),
    receiveExport:options=>receiveSorobanEventsExport({...options,client:core})
  });
}
function selection(options){
  const workspace=checked(options.workspace,ALIAS,'workspace alias');
  const exportId=checked(options.exportId??options.result?.export?.id,SHA,'export ID');
  const expectedManifestSha256=options.expectedManifestSha256??options.result?.export?.manifestSha256;
  if(expectedManifestSha256!==undefined)checked(expectedManifestSha256,SHA,'manifest SHA256');
  return {...options,workspace,exportId,expectedManifestSha256};
}
async function bound(options){
  const selected=selection(options),original=selected.client??await openSorobanEventsMerchantClient(selected);
  need(original&&typeof original.call==='function'&&typeof original.endpoint==='string','SOROBAN_EVENTS_CLIENT_REQUIRED');
  const client={endpoint:original.endpoint+'#soroban-events='+selected.workspace,
    call(name,args={},requestOptions){
      need(args.workspace===undefined||args.workspace===selected.workspace,'SOROBAN_EVENTS_WORKSPACE_CHANGED');
      return original.call(name,{...args,workspace:selected.workspace},requestOptions);
    }};
  return {selected,client};
}
const transfers=createRetainedDownload({
  manifestName:MANIFEST_NAME,parseManifest:parseSorobanEventsManifest,maximumBytes:MAX_FILE_BYTES,
  stateSchema:'stellar-forge.soroban-events.file-download.v1',
  resultSchema:'stellar-forge.soroban-events.file-receipt.v1',
  toolPrefix:TOOL_PREFIX.slice(0,-1),errorPrefix:'SOROBAN_EVENTS',
  clientName:'starforge-soroban-events-file-receiver',nestedFiles:true,
  maximumManifestBytes:MAX_MANIFEST_BYTES,maximumCheckpointBytes:128*1024*1024,
  validateExportId:value=>checked(value,SHA,'export ID'),
  describe:manifest=>({editionId:manifest.editionId,sourceSchema:manifest.schema})
});
export async function downloadSorobanEventsExport(options={}){
  const {selected,client}=await bound(options);
  return transfers.download({client,exportId:selected.exportId,directory:resolve(text(options.directory,'private download directory',4096)),
    expectedManifestSha256:selected.expectedManifestSha256,signal:options.signal,onProgress:options.onProgress,
    ...(options.chunkSize===undefined?{}:{chunkSize:options.chunkSize})});
}
export async function inspectSorobanEventsExport(options={}){
  const {selected,client}=await bound(options);
  const inspected=await transfers.inspect({client,exportId:selected.exportId,signal:options.signal});
  need(selected.expectedManifestSha256===undefined||inspected.manifestSha256===selected.expectedManifestSha256,
    'SOROBAN_EVENTS_MANIFEST_CHANGED');
  return inspected;
}
/** Reopen complete original files locally without starting a new capture or HTTP connection. */
export async function reopenSorobanEventsExport(options={}){
  const selected=selection(options);
  return transfers.lockedDownload(resolve(text(options.directory,'private download directory',4096)),async context=>{
    const bytes=await transfers.bytesAt(join(context.root,MANIFEST_NAME),MAX_MANIFEST_BYTES);
    const manifest=parseSorobanEventsManifest(bytes,selected.exportId),manifestSha256=digest(bytes);
    need(selected.expectedManifestSha256===undefined||selected.expectedManifestSha256===manifestSha256,
      'SOROBAN_EVENTS_MANIFEST_CHANGED');
    await transfers.loadContext(context,bytes,selected.exportId);
    for(const file of manifest.files)await transfers.verifiedFile(join(context.root,file.name),file,options.signal);
    return {schema:'stellar-forge.soroban-events.file-receipt.v1',state:'REOPENED',
      workspace:selected.workspace,exportId:selected.exportId,manifestSha256,editionId:manifest.editionId,
      directory:context.root,files:manifest.files.length,bytes:manifest.bytes};
  });
}
/** Read every original JSON byte, including values too large for the page preview. */
export async function readSorobanEventsJson(options={}){
  const {selected,client}=await bound(options);
  const inspected=await transfers.inspect({client,exportId:selected.exportId,signal:options.signal});
  need(selected.expectedManifestSha256===undefined||selected.expectedManifestSha256===inspected.manifestSha256,
    'SOROBAN_EVENTS_MANIFEST_CHANGED');
  const file=inspected.manifest.files.find(item=>item.name===options.file);
  need(file&&file.bytes<=MAX_JSON_BYTES&&/json/i.test(file.contentType),
    'SOROBAN_EVENTS_JSON_FILE_REQUIRED','Select an original JSON file within 128 MiB, or download its complete source files.');
  const chunks=[];let offset=0,readId=null;
  try{
    while(offset<file.bytes){
      options.signal?.throwIfAborted();
      const limit=65536,args={exportId:selected.exportId,file:file.name,
        expectedManifestSha256:inspected.manifestSha256,expectedSha256:file.sha256,
        offset,limit,...(readId?{readId}:{})};
      let page;
      try{page=await client.call(TOOL_PREFIX+'file',args,options.signal?{requestSignal:options.signal}:undefined);}
      catch(error){
        if(error.code!=='SOROBAN_EVENTS_READ_NOT_FOUND'||!readId)throw error;
        readId=null;delete args.readId;
        page=await client.call(TOOL_PREFIX+'file',args,options.signal?{requestSignal:options.signal}:undefined);
      }
      const bytes=Buffer.from(page.data??'','base64'),count=Math.min(limit,file.bytes-offset);
      need(page.exportId===selected.exportId&&page.manifestSha256===inspected.manifestSha256&&
        page.file?.name===file.name&&page.file.bytes===file.bytes&&page.file.sha256===file.sha256&&
        page.offset===offset&&page.bytesRead===count&&page.encoding==='base64'&&bytes.length===count&&
        bytes.toString('base64')===page.data&&page.nextOffset===(offset+count<file.bytes?offset+count:null)&&
        typeof page.readId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(page.readId)&&
        (!readId||readId===page.readId),'SOROBAN_EVENTS_DOWNLOAD_CHUNK_CONFLICT');
      chunks.push(bytes);offset+=count;readId=page.nextOffset===null?null:page.readId;
    }
  }finally{
    if(readId)await client.call(TOOL_PREFIX+'file_release',{exportId:selected.exportId,readId},
      {requestSignal:null,timeoutMs:2000}).catch(()=>{});
  }
  const bytes=Buffer.concat(chunks,offset);
  need(bytes.length===file.bytes&&digest(bytes)===file.sha256,'SOROBAN_EVENTS_FILE_CHANGED');
  return decode(bytes);
}
export async function receiveSorobanEventsExport(options={}){
  const {selected,client}=await bound(options),inspected=await transfers.inspect({
    client,exportId:selected.exportId,signal:options.signal});
  need(selected.expectedManifestSha256===undefined||selected.expectedManifestSha256===inspected.manifestSha256,
    'SOROBAN_EVENTS_MANIFEST_CHANGED');
  return client.call(TOOL_PREFIX+'receive',{exportId:selected.exportId,receiver:options.receiver,
    requestId:options.requestId,expectedRevision:options.expectedRevision,
    expectedManifestSha256:inspected.manifestSha256},options.signal?{requestSignal:options.signal}:undefined);
}

/** Configure the maintained host without opening a capture or remote connection. */
export async function initializeSorobanEventsMerchant(options){
  return (await import('./setup.mjs')).initializeSorobanEventsMerchant(options);
}
