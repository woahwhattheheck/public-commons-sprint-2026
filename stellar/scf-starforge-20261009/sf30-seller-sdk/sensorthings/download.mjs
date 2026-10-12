// MIT. Complete SensorThings file receiving through the original retained downloader.
import {randomUUID} from 'node:crypto';
import {createRetainedDownload,openMerchantFileClient} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
import {identity,json,plain,fields,sha,stable,fault} from './contract.mjs';
import {ALIAS,SHA,UUID,validateSensorThingsField,sensorThingsToolDefinitions} from './mcp-protocol.mjs';

export const DOWNLOAD_SCHEMA='stellar-forge.sensorthings-download-manifest.v1';
export const DOWNLOAD_MANIFEST='sensorthings-download.json';
export const DOWNLOAD_LIMITS=Object.freeze({files:25000,fileBytes:8*1024*1024*1024,totalBytes:8*1024*1024*1024,
  manifestBytes:16*1024*1024,checkpointBytes:32*1024*1024});
const PREFIX='SENSORTHINGS_RECEIVE',TOOL='sensorthings_retained',FLAT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const fail=(code,message,details={})=>fault('RECEIVE_'+code,message,409,details);
function selection(value){
  const schema=sensorThingsToolDefinitions.get('merchant_sensorthings_files').properties.selection;
  validateSensorThingsField(value,schema,'selection');return value;
}
function exact(value,names,required=names){fields(value,names,required);return value;}
function integer(value,maximum,label){if(!Number.isSafeInteger(value)||value<0||value>maximum)throw fail('MANIFEST','Invalid '+label+'.');return value;}
function exportId(value){if(!SHA.test(value??''))throw fail('IDENTITY','Select the exact client-bound native file-set identity.');return value;}
function manifestBody(value){const {id,...body}=value;return body;}
/** This manifest records the client's exact selections. Provider manifests and
 * every received native file remain unmodified, with their own original hashes. */
export function parseSensorThingsDownloadManifest(bytes,id){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('MANIFEST','Retain the complete UTF-8 receiving manifest.');}
  exact(value,['schema','id','kind','workspace','workspaceId','selection','nativeFilesManifestSha256','files','meaning']);
  if(value.schema!==DOWNLOAD_SCHEMA||value.kind!=='CLIENT_BOUND_NATIVE_FILE_SET'||!ALIAS.test(value.workspace??'')||
      !UUID.test(value.workspaceId??'')||!SHA.test(value.nativeFilesManifestSha256??'')||
      !Array.isArray(value.files)||!value.files.length||value.files.length>DOWNLOAD_LIMITS.files||
      typeof value.meaning!=='string'||bytes.length>DOWNLOAD_LIMITS.manifestBytes)
    throw fail('MANIFEST','The complete native file-set selection is invalid or exceeds its declared capacity.');
  selection(value.selection);
  const names=new Set(),selections=new Set();let total=0;
  for(const file of value.files){
    exact(file,['name','originalName','type','bytes','sha256','selection']);
    if(!FLAT.test(file.name??'')||file.name===DOWNLOAD_MANIFEST||file.name==='download-state'||names.has(file.name)||
        typeof file.originalName!=='string'||!file.originalName||file.originalName.length>255||
        /[\\/\u0000-\u001f\u007f]/u.test(file.originalName)||typeof file.type!=='string'||file.type.length>240||
        /[\u0000-\u001f\u007f]/u.test(file.type)||!SHA.test(file.sha256??''))
      throw fail('MANIFEST','A selected native file has invalid or repeated identity metadata.');
    selection(file.selection);const key=identity(file.selection);
    if(selections.has(key))throw fail('MANIFEST','The native file selection occurs more than once.');
    selections.add(key);names.add(file.name);total+=integer(file.bytes,DOWNLOAD_LIMITS.fileBytes,'native file byte count');
    integer(total,DOWNLOAD_LIMITS.totalBytes,'complete receiving byte count');
  }
  if(value.id!==id||identity(manifestBody(value))!==exportId(id))
    throw fail('IDENTITY','This receiving manifest belongs to a different original file selection.');
  return value;
}
function checkedReply(reply,scope){
  if(!plain(reply)||reply.workspace!==scope.workspace||reply.workspaceId!==scope.workspaceId)
    throw fail('WORKSPACE_CHANGED','The original configured workspace identity changed.');
  if(!reply.ok){
    const original=reply.native??{},code=original.error??original.code;
    if(code==='SENSORTHINGS_FILE_READ_NOT_FOUND'||code==='SENSORTHINGS_MCP_READ_NOT_FOUND')
      throw fail('READ_NOT_FOUND','The original held read expired. Reopen the same file selection, SHA256 and offset.');
    throw fail('NATIVE',typeof original.message==='string'?original.message:'The original native file request did not succeed.',
      {nativeCode:code??null,httpStatus:reply.httpStatus??null});
  }
  if(!plain(reply.native))throw fail('REPLY','The native owner did not return a complete structured reply.');
  return reply.native;
}
async function nativeCall(client,name,args,scope,signal){
  signal?.throwIfAborted();
  try{
    const reply=await client.call(name,{workspace:scope.workspace,...args});
    signal?.throwIfAborted();return checkedReply(reply,scope);
  }catch(error){
    if(error.code==='SENSORTHINGS_MCP_READ_NOT_FOUND'||error.code==='SENSORTHINGS_FILE_READ_NOT_FOUND')
      throw fail('READ_NOT_FOUND','The original held read is no longer owned. Reopen the same file selection, SHA256 and offset.');
    throw error;
  }
}
async function collectFiles(client,scope,selected,signal){
  const files=[];let offset=0,manifestSha256=null,total=null,nativeSelection=null;
  while(true){
    const page=await nativeCall(client,'merchant_sensorthings_files',{selection:selected,offset,limit:500,
      ...(manifestSha256?{manifestSha256}:{})},scope,signal);
    if(!Array.isArray(page.files)||page.offset!==offset||!Number.isSafeInteger(page.total)||
        page.total<1||page.total>DOWNLOAD_LIMITS.files||!SHA.test(page.manifestSha256??'')||
        page.files.length>500||page.files.length<1||page.total<offset+page.files.length)
      throw fail('MANIFEST','The original owner returned incomplete native file metadata.');
    if(total!==null&&(total!==page.total||manifestSha256!==page.manifestSha256||stable(nativeSelection)!==stable(page.selection)))
      throw fail('MANIFEST_CHANGED','The native file list changed while its metadata pages were received.');
    total=page.total;manifestSha256=page.manifestSha256;nativeSelection=page.selection;
    files.push(...page.files);const next=offset+page.files.length;
    if(page.nextOffset!==(next<total?next:null))throw fail('MANIFEST','The original file-list continuation is inconsistent.');
    if(page.nextOffset===null)break;offset=page.nextOffset;
  }
  if(files.length!==total)throw fail('MANIFEST','The complete original file list was not received.');
  selection(nativeSelection);
  for(const file of files){
    if(file.bytes===null||file.sha256===null)
      throw fail('GENERATED_REVIEW','This selection includes a process-local generated review. Read that snapshot through file_read; select fixed native files for durable complete-file receiving.',
        {selection:file.selection,retention:file.retention??null});
  }
  const exactListHash=identity(files.map(({selection,name,type,bytes,sha256})=>({selection,name,type,bytes,sha256})));
  if(exactListHash!==manifestSha256)throw fail('MANIFEST_CHANGED','The received complete file list differs from its native metadata hash.');
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const ordered=[...files].sort((a,b)=>compare(stable(a.selection),stable(b.selection))||compare(a.name,b.name));
  const body={schema:DOWNLOAD_SCHEMA,kind:'CLIENT_BOUND_NATIVE_FILE_SET',workspace:scope.workspace,workspaceId:scope.workspaceId,
    selection:nativeSelection,nativeFilesManifestSha256:manifestSha256,
    files:ordered.map((file,index)=>({
      name:String(index+1).padStart(5,'0')+'-'+String(file.name).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,220),
      originalName:file.name,type:file.type??file.contentType??'application/octet-stream',
      bytes:file.bytes,sha256:file.sha256,selection:file.selection
    })),
    meaning:'Client-bound receiving selection over original native manifest-owned files. Numbered local names preserve original names and selectors here. Original file bytes, provider source, licences, review history and payment accounting are unchanged.'};
  const value={...body,id:identity(body)},bytes=json(value);parseSensorThingsDownloadManifest(bytes,value.id);
  return {value,bytes,sha256:sha(bytes)};
}
function adapter(client,scope,retained,signal){
  const {value,bytes,sha256}=retained,manifestFile={name:DOWNLOAD_MANIFEST,bytes:bytes.length,sha256},
    byName=new Map(value.files.map(file=>[file.name,file])),virtualReads=new Map();
  const nativeEndpoint=typeof client.endpoint==='string'?client.endpoint:'original-native-provider';
  if(nativeEndpoint.length>3000||/[\u0000-\u001f\u007f]/u.test(nativeEndpoint))
    throw fail('CONFIGURATION','Use the original native client with a stable endpoint identity.');
  return {endpoint:JSON.stringify([nativeEndpoint,'sensorthings',scope.workspace,scope.workspaceId]),
    async call(name,args){
      signal?.throwIfAborted();exportId(args?.exportId);
      if(args.exportId!==value.id)throw fail('IDENTITY','Continue the same exact selected native file set.');
      if(name===TOOL+'_manifest')return {state:'MANIFEST_RETAINED',exportId:value.id,manifestFile};
      if(name===TOOL+'_file_release'){
        if(!UUID.test(args.readId??''))throw fail('READ_ID','Release the original returned readId.');
        if(virtualReads.delete(args.readId))return {released:true,readId:args.readId};
        return nativeCall(client,'merchant_sensorthings_file_release',{readId:args.readId},scope,null);
      }
      if(name!==TOOL+'_file')throw fail('TOOL','Use the original receiving manifest/file/release calls.');
      if(args.expectedManifestSha256!==sha256)throw fail('MANIFEST_CHANGED','The receiving manifest differs from its original reviewed identity.');
      const offset=integer(args.offset,DOWNLOAD_LIMITS.fileBytes,'byte offset'),
        limit=integer(args.limit,MAX_RETAINED_CHUNK_BYTES,'chunk byte count');
      if(limit<1)throw fail('CHUNK','Choose a positive bounded chunk length.');
      const file=args.file===DOWNLOAD_MANIFEST?manifestFile:byName.get(args.file);
      if(!file||args.expectedSha256!==file.sha256||offset>file.bytes)
        throw fail('FILE_CHANGED','Read the same original file, complete SHA256 and byte offset.');
      if(args.file===DOWNLOAD_MANIFEST){
        let readId=args.readId;
        if(readId&&!virtualReads.has(readId))throw fail('READ_NOT_FOUND','The client-bound manifest read expired; reopen its same SHA and offset.');
        readId??=randomUUID();virtualReads.set(readId,true);
        const part=bytes.subarray(offset,Math.min(bytes.length,offset+limit)),next=offset+part.length<bytes.length?offset+part.length:null;
        if(next===null)virtualReads.delete(readId);
        return {exportId:value.id,manifestSha256:sha256,readId,file:manifestFile,offset,bytesRead:part.length,
          nextOffset:next,encoding:'base64',data:part.toString('base64')};
      }
      const received=await nativeCall(client,'merchant_sensorthings_file_read',{selection:file.selection,
        expectedSha256:file.sha256,offset,limit,...(args.readId?{readId:args.readId}:{})},scope,signal);
      if(received.file?.name!==file.originalName||received.file?.bytes!==file.bytes||received.file?.sha256!==file.sha256)
        throw fail('FILE_CHANGED','The held original file differs from the frozen complete receiving selection.');
      return {...received,exportId:value.id,manifestSha256:sha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256}};
    }};
}
function receiver(scope){
  return createRetainedDownload({manifestName:DOWNLOAD_MANIFEST,parseManifest:parseSensorThingsDownloadManifest,
    maximumBytes:DOWNLOAD_LIMITS.fileBytes,maximumManifestBytes:DOWNLOAD_LIMITS.manifestBytes,
    maximumCheckpointBytes:DOWNLOAD_LIMITS.checkpointBytes,stateSchema:'stellar-forge.sensorthings-download-state.v1',
    resultSchema:'stellar-forge.sensorthings-download-result.v1',toolPrefix:TOOL,errorPrefix:PREFIX,
    clientName:'starforge-sensorthings-receiving',validateExportId:exportId,
    describe:value=>({workspace:value.workspace,workspaceId:value.workspaceId,selection:value.selection,
      originalFilesManifestSha256:value.nativeFilesManifestSha256,manifestKind:value.kind})});
}
async function selected(options){
  const {workspace,workspaceId,selection:requested,client,url,signal}=options;
  if(!ALIAS.test(workspace??'')||!UUID.test(workspaceId??''))throw fail('CONFIGURATION','Choose the actual configured alias and persistent workspace UUID.');
  selection(requested);
  if(client!==undefined&&url!==undefined)throw fail('CONFIGURATION','Choose the original native client or its MCP URL.');
  const original=client??await openMerchantFileClient({...options,errorPrefix:PREFIX,clientName:'starforge-sensorthings-receiving'});
  if(!original||typeof original.call!=='function')throw fail('CONFIGURATION','Use the original merchant tool client.');
  const scope={workspace,workspaceId},schema=await nativeCall(original,'merchant_sensorthings_schema',{},scope,signal);
  if(schema.workspaceId!==workspaceId||schema.schema!=='stellar-forge.sensorthings-schema.v1')
    throw fail('WORKSPACE_CHANGED','The original running workspace UUID differs from the selected receiving scope.');
  const retained=await collectFiles(original,scope,requested,signal);
  if(options.exportId!==undefined&&options.exportId!==retained.value.id)
    throw fail('IDENTITY','The current native file list differs from the exact receiving selection.');
  return {scope,retained,client:adapter(original,scope,retained,signal)};
}
/** Returns the complete exact file selection without creating a new export. */
export async function inspectSensorThingsFiles(options={}){
  const bound=await selected(options);
  return {manifest:bound.retained.value,manifestSha256:bound.retained.sha256};
}
/** Existing flock/checkpoints/read leases perform the whole original transfer.
 * Reopen this exact directory and selection after interruption; no new journal. */
export async function downloadSensorThingsFiles(options={}){
  const bound=await selected(options);
  return receiver(bound.scope).download({client:bound.client,exportId:bound.retained.value.id,directory:options.directory,
    signal:options.signal,chunkSize:options.chunkSize??65536,onProgress:options.onProgress,
    expectedManifestSha256:options.expectedManifestSha256});
}
