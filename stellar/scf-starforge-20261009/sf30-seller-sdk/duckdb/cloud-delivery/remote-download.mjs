// MIT. Exact Cloud artifact transfer using the original retained-download writer.
import {createHash} from 'node:crypto';
import {CLOUD_ARTIFACTS} from './catalog.mjs';
import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {MAX_RETAINED_IMMUTABLE_FILE_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

export const CLOUD_TRANSFER_SCHEMA='stellar-forge.cloud-artifact-transfer.v1';
export const CLOUD_TRANSFER_MANIFEST='cloud-transfer.json';
const STATE='stellar-forge.cloud-artifact-download-state.v1';
const RESULT='stellar-forge.cloud-artifact-download.v1';
const PREFIX='cloud_retained_transfer',ERROR='CLOUD_REMOTE';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const ARTIFACTS=CLOUD_ARTIFACTS;
const KINDS=['summary','full'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function fail(code,message){return Object.assign(new Error(message),{code:ERROR+'_'+code});}
function exact(value,keys){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))
    throw fail('SELECTION_INVALID','Use the complete original inspected artifact selection.');
}
function text(value,maximum){
  return typeof value==='string'&&value.length>0&&value.length<=maximum&&!/[\x00-\x1f\x7f]/.test(value);
}
function file(value){
  exact(value,['name','contentType','bytes','sha256']);
  if(!text(value.name,255)||/[\\/]/.test(value.name)||!text(value.contentType,512)||
    !Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>MAX_RETAINED_IMMUTABLE_FILE_BYTES||!HASH.test(value.sha256??''))
    throw fail('SELECTION_INVALID','The native artifact must declare its exact name, media type, size and SHA-256.');
  return {name:value.name,contentType:value.contentType,bytes:value.bytes,sha256:value.sha256};
}
function source(value){
  exact(value,['workspace','workspaceId','artifact','id','member','kind','file']);
  if(!ALIAS.test(value.workspace??'')||!UUID.test(value.workspaceId??'')||
    !ARTIFACTS.includes(value.artifact)||!ID.test(value.id??'')||value.kind!==null&&!KINDS.includes(value.kind)||
    value.member!==null&&!text(value.member,512)||['source','package'].includes(value.artifact)!==(value.member!==null)||
    value.artifact!=='comparison'&&value.kind!==null)
    throw fail('SELECTION_INVALID','Select the exact host alias, original workspace identity and native artifact.');
  return {workspace:value.workspace,workspaceId:value.workspaceId,
    artifact:value.artifact,id:value.id,member:value.member,kind:value.kind,file:file(value.file)};
}
function manifestFor(selected){
  const transferId=digest(bytes(selected));
  return {schema:CLOUD_TRANSFER_SCHEMA,transferId,
    provenance:'CLIENT_SELECTION_OF_ORIGINAL_CLOUD_ARTIFACT',source:selected,
    files:[{name:'payload',bytes:selected.file.bytes,sha256:selected.file.sha256}]};
}
/**
 * This is a client transfer selection, not a new provider receipt or payment
 * assertion. The payload is the exact existing native artifact. Its original
 * download name and content type stay in source.file; it is saved locally as
 * payload so remote filenames cannot select paths.
 */
export function parseCloudTransfer(raw,expectedTransferId){
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fail('SELECTION_INVALID','Use one UTF-8 artifact selection returned by inspectCloudArtifact.');}
  exact(value,['schema','transferId','provenance','source','files']);
  const normalized=manifestFor(source(value.source));
  if(value.schema!==CLOUD_TRANSFER_SCHEMA||value.transferId!==normalized.transferId||
    expectedTransferId!==undefined&&value.transferId!==expectedTransferId||
    value.provenance!==normalized.provenance||JSON.stringify(value.files)!==JSON.stringify(normalized.files))
    throw fail('SELECTION_INVALID','The selection does not bind its original artifact identity and exact payload.');
  return normalized;
}
function clientRequired(client){
  if(!client||typeof client.call!=='function'||typeof client.releaseArtifact!=='function'||typeof client.endpoint!=='string')
    throw fail('CLIENT_REQUIRED','Use the original connectCloudClient instance.');
}
function selectionFields(value){
  if(!plain(value)||Object.keys(value).some(key=>!['workspace','artifact','id','file','kind','expectedSha256'].includes(key))||
    !ALIAS.test(value.workspace??'')||!ARTIFACTS.includes(value.artifact)||!ID.test(value.id??'')||
    value.kind!==undefined&&!KINDS.includes(value.kind)||
    value.file!==undefined&&!text(value.file,512)||['source','package'].includes(value.artifact)!==(value.file!==undefined)||
    value.artifact!=='comparison'&&value.kind!==undefined||value.expectedSha256!==undefined&&!HASH.test(value.expectedSha256??''))
    throw fail('SELECTION_INVALID','Choose an original workspace alias, artifact, ID and optional native kind/hash.');
}
async function scope(client,workspace,signal){
  const inventory=await client.call('merchant_cloud_workspaces',{}, {signal});
  const entries=inventory.workspaces;
  if(!Array.isArray(entries))throw fail('REPLY_INVALID','The original host did not return its declared workspace inventory.');
  const found=entries.filter(value=>value.workspace===workspace);
  if(found.length!==1||!found[0].open||found[0].closing||!UUID.test(found[0].workspaceId??''))
    throw fail('WORKSPACE_NOT_OPEN','Open the selected original Cloud workspace explicitly before remote transfer.');
  const state=await client.call('merchant_cloud_status',{workspace},{signal});
  if(state.workspace!==workspace||
    state.native?.workspaceId!==found[0].workspaceId||state.instanceId!==found[0].instanceId)
    throw fail('WORKSPACE_CHANGED','The original workspace owner changed during selection; inspect its current identity.');
  return {workspace,workspaceId:found[0].workspaceId};
}
function checkedNativeChunk(result,selected,offset,limit){
  const original=file(result?.file),wanted=selected.file,length=Math.min(limit,wanted.bytes-offset);
  if(JSON.stringify(original)!==JSON.stringify(wanted)||!UUID.test(result.readId??'')||
    result.offset!==offset||result.bytesRead!==length||result.nextOffset!==(offset+length<wanted.bytes?offset+length:null)||
    result.encoding!=='base64'||typeof result.data!=='string')
    throw fail('ARTIFACT_CHANGED','The native retained read differs from the selected file or byte range.');
  const decoded=Buffer.from(result.data,'base64');
  if(decoded.length!==length||decoded.toString('base64')!==result.data)
    throw fail('REPLY_INVALID','The original retained artifact chunk is not canonical base64.');
  return result;
}
async function openSelection(client,request,{signal,reviewed}={}){
  clientRequired(client);selectionFields(request);
  const bound=await scope(client,request.workspace,signal);
  const args={workspace:request.workspace,artifact:request.artifact,id:request.id,offset:0,limit:1,
    ...(request.file!==undefined?{file:request.file}:{}),...(request.kind!==undefined?{kind:request.kind}:{}),...(request.expectedSha256?{expectedSha256:request.expectedSha256}:{})};
  const chunk=await client.call('merchant_cloud_artifact_read',args,{signal});
  let readId=chunk.nextOffset===null?null:chunk.readId;
  try{
    const selected={...bound,artifact:request.artifact,id:request.id,member:request.file??null,kind:request.kind??null,file:file(chunk.file)};
    checkedNativeChunk(chunk,selected,0,1);
    const manifest=manifestFor(selected),manifestBytes=bytes(manifest),manifestSha256=digest(manifestBytes);
    if(reviewed&&!manifestBytes.equals(bytes(reviewed)))
      throw fail('SELECTION_CHANGED','The current native artifact differs from its reviewed workspace/file selection.');
    let closing=null,closed=false;
    async function close(){
      if(closing)return closing;
      const pending=(async()=>{
        if(readId){await client.releaseArtifact(selected.workspace,readId);readId=null;}closed=true;
      })();
      closing=pending;void pending.catch(()=>{if(closing===pending)closing=null;});return pending;
    }
    async function native(offset,limit,requestSignal){
      if(closed)throw fail('TRANSFER_CLOSED','This artifact transfer adapter is closed.');
      const input={workspace:selected.workspace,artifact:selected.artifact,id:selected.id,
        ...(selected.member!==null?{file:selected.member}:{}),...(selected.kind!==null?{kind:selected.kind}:{}),expectedSha256:selected.file.sha256,offset,limit,
        ...(readId?{readId}:{})};
      let result;
      try{result=await client.call('merchant_cloud_artifact_read',input,{signal:requestSignal});}
      catch(error){
        if(error.code!=='CLOUD_ARTIFACT_READ_NOT_FOUND'||!readId)throw error;
        // Only a definitively expired/completed retained read is reopened. The
        // same native artifact hash and exact offset remain in this request.
        readId=null;delete input.readId;
        result=await client.call('merchant_cloud_artifact_read',input,{signal:requestSignal});
      }
      checkedNativeChunk(result,selected,offset,limit);readId=result.nextOffset===null?null:result.readId;
      return result;
    }
    const adapter={
      // This endpoint identity intentionally survives a new local HTTP port.
      // Every invocation proves the same original workspace UUID and exact artifact pin.
      endpoint:'cloud-artifact://'+selected.workspaceId,
      async call(name,input){
        if(input.exportId!==manifest.transferId)throw fail('SELECTION_CHANGED','Use this original artifact transfer identity.');
        if(name===PREFIX+'_manifest')return {state:'MANIFEST_RETAINED',exportId:manifest.transferId,
          manifestFile:{name:CLOUD_TRANSFER_MANIFEST,bytes:manifestBytes.length,sha256:manifestSha256}};
        if(name===PREFIX+'_file_release')return {};
        if(name!==PREFIX+'_file'||input.expectedManifestSha256!==manifestSha256)
          throw fail('SELECTION_CHANGED','Use the exact inspected client transfer manifest.');
        if(input.file===CLOUD_TRANSFER_MANIFEST){
          if(input.expectedSha256!==manifestSha256||!Number.isSafeInteger(input.offset)||input.offset<0||
            input.offset>manifestBytes.length||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>MAX_RETAINED_CHUNK_BYTES)
            throw fail('RANGE_INVALID','Use a bounded range inside this original transfer selection.');
          const chunk=manifestBytes.subarray(input.offset,input.offset+input.limit),next=input.offset+chunk.length;
          return {exportId:manifest.transferId,manifestSha256,file:{name:CLOUD_TRANSFER_MANIFEST,
            bytes:manifestBytes.length,sha256:manifestSha256},offset:input.offset,bytesRead:chunk.length,
            nextOffset:next<manifestBytes.length?next:null,encoding:'base64',data:chunk.toString('base64')};
        }
        if(input.file!=='payload'||input.expectedSha256!==selected.file.sha256)
          throw fail('SELECTION_CHANGED','Download only the exact inspected native artifact.');
        const result=await native(input.offset,input.limit,signal);
        return {...result,readId:undefined,exportId:manifest.transferId,manifestSha256,
          file:{name:'payload',bytes:selected.file.bytes,sha256:selected.file.sha256}};
      }
    };
    return {manifest,manifestBytes,manifestSha256,adapter,close};
  }catch(error){
    if(readId)await client.releaseArtifact(request.workspace,readId).catch(cleanup=>{
      error.cleanup={code:cleanup.code??'CLOUD_ARTIFACT_RELEASE_FAILED',readId};});
    throw error;
  }
}
const engine=createRetainedDownload({
  manifestName:CLOUD_TRANSFER_MANIFEST,parseManifest:parseCloudTransfer,maximumBytes:MAX_RETAINED_IMMUTABLE_FILE_BYTES,
  stateSchema:STATE,resultSchema:RESULT,toolPrefix:PREFIX,errorPrefix:ERROR,clientName:'starforge-cloud-remote',
  readLease:false,validateExportId:value=>{if(!HASH.test(value??''))throw fail('SELECTION_INVALID','Use the inspected transfer SHA-256 identity.');},
  describe:manifest=>({source:manifest.source,payload:'payload'})
});
export async function inspectCloudArtifact({client,selection,signal}={}){
  const opened=await openSelection(client,selection,{signal});
  try{return {selection:opened.manifest,manifestSha256:opened.manifestSha256,endpoint:client.endpoint};}
  finally{await opened.close();}
}
/** No automatic source capture, publication, seller start, export or payment. */
export async function downloadCloudArtifact({client,selection,directory,signal,chunkSize=MAX_RETAINED_CHUNK_BYTES,onProgress}={}){
  const reviewed=parseCloudTransfer(bytes(selection));
  const request={workspace:reviewed.source.workspace,artifact:reviewed.source.artifact,id:reviewed.source.id,
    ...(reviewed.source.member!==null?{file:reviewed.source.member}:{}),...(reviewed.source.kind!==null?{kind:reviewed.source.kind}:{}),expectedSha256:reviewed.source.file.sha256};
  const opened=await openSelection(client,request,{signal,reviewed});
  let primary;
  try{
    return await engine.download({client:opened.adapter,exportId:reviewed.transferId,directory,signal,chunkSize,onProgress,
      expectedManifestSha256:opened.manifestSha256});
  }catch(error){primary=error;throw error;}
  finally{
    try{await opened.close();}catch(error){if(primary)primary.cleanup={code:error.code??'CLOUD_ARTIFACT_RELEASE_FAILED'};else throw error;}
  }
}
/** Verifies the complete original payload locally; opens no endpoint or workspace. */
export async function reopenCloudArtifact({directory,signal}={}){
  if(typeof directory!=='string'||!directory.length)throw fail('DIRECTORY_REQUIRED','Choose the completed original private transfer directory.');
  const stat=await lstat(resolve(directory));
  if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('DIRECTORY_REQUIRED','Reopen an existing real private transfer directory.');
  return engine.lockedDownload(directory,async context=>{
    const raw=await engine.bytesAt(context.root+'/'+CLOUD_TRANSFER_MANIFEST,65000);
    const manifest=parseCloudTransfer(raw),opened=await engine.loadContext(context,raw,manifest.transferId);
    for(const entry of manifest.files){signal?.throwIfAborted();await engine.verifiedFile(context.root+'/'+entry.name,entry,signal);}
    return {schema:RESULT,state:'COMPLETE',directory:context.root,exportId:manifest.transferId,source:manifest.source,
      payload:'payload',manifestSha256:opened.manifestSha256,files:manifest.files.length,bytes:manifest.source.file.bytes,reopened:true};
  });
}
