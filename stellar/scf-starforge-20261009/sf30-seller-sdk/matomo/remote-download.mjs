// MIT. Exact Matomo artifact transfer using the original retained-download writer.
import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRetainedDownload} from '../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {MAX_RETAINED_IMMUTABLE_FILE_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

export const MATOMO_TRANSFER_SCHEMA='stellar-forge.matomo-artifact-transfer.v1';
export const MATOMO_TRANSFER_MANIFEST='matomo-transfer.json';
const STATE='stellar-forge.matomo-artifact-download-state.v1';
const RESULT='stellar-forge.matomo-artifact-download.v1';
const PREFIX='matomo_retained_transfer',ERROR='MATOMO_REMOTE';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const ARTIFACTS=['capture','edition','database','comparison','delivery','handover','source'];
const KINDS=['csv','config','manifest','archive','scan'];
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
  exact(value,['workspace','workspaceId','workspaceIdentity','artifact','id','kind','file']);
  if(!ALIAS.test(value.workspace??'')||!UUID.test(value.workspaceId??'')||!HASH.test(value.workspaceIdentity??'')||
    !ARTIFACTS.includes(value.artifact)||!ID.test(value.id??'')||value.kind!==null&&!KINDS.includes(value.kind))
    throw fail('SELECTION_INVALID','Select the exact host alias, original workspace identity and native artifact.');
  return {workspace:value.workspace,workspaceId:value.workspaceId,workspaceIdentity:value.workspaceIdentity,
    artifact:value.artifact,id:value.id,kind:value.kind,file:file(value.file)};
}
function manifestFor(selected){
  const transferId=digest(bytes(selected));
  return {schema:MATOMO_TRANSFER_SCHEMA,transferId,
    provenance:'CLIENT_SELECTION_OF_ORIGINAL_MATOMO_ARTIFACT',source:selected,
    files:[{name:'payload',bytes:selected.file.bytes,sha256:selected.file.sha256}]};
}
/**
 * This is a client transfer selection, not a new provider receipt or payment
 * assertion. The payload is the exact existing native artifact. Its original
 * download name and content type stay in source.file; it is saved locally as
 * payload so remote filenames cannot select paths.
 */
export function parseMatomoTransfer(raw,expectedTransferId){
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fail('SELECTION_INVALID','Use one UTF-8 artifact selection returned by inspectMatomoArtifact.');}
  exact(value,['schema','transferId','provenance','source','files']);
  const normalized=manifestFor(source(value.source));
  if(value.schema!==MATOMO_TRANSFER_SCHEMA||value.transferId!==normalized.transferId||
    expectedTransferId!==undefined&&value.transferId!==expectedTransferId||
    value.provenance!==normalized.provenance||JSON.stringify(value.files)!==JSON.stringify(normalized.files))
    throw fail('SELECTION_INVALID','The selection does not bind its original artifact identity and exact payload.');
  return normalized;
}
function clientRequired(client){
  if(!client||typeof client.call!=='function'||typeof client.releaseArtifact!=='function'||typeof client.endpoint!=='string')
    throw fail('CLIENT_REQUIRED','Use the original connectMatomoClient instance.');
}
function selectionFields(value){
  if(!plain(value)||Object.keys(value).some(key=>!['workspace','artifact','id','kind','expectedSha256'].includes(key))||
    !ALIAS.test(value.workspace??'')||!ARTIFACTS.includes(value.artifact)||!ID.test(value.id??'')||
    value.kind!==undefined&&!KINDS.includes(value.kind)||value.expectedSha256!==undefined&&!HASH.test(value.expectedSha256??''))
    throw fail('SELECTION_INVALID','Choose an original workspace alias, artifact, ID and optional native kind/hash.');
}
async function scope(client,workspace,signal){
  const inventory=await client.call('merchant_matomo_workspaces',{}, {signal});
  const entries=inventory.workspaces;
  if(!Array.isArray(entries))throw fail('REPLY_INVALID','The original host did not return its declared workspace inventory.');
  const found=entries.filter(value=>value.workspace===workspace);
  if(found.length!==1||!found[0].open||found[0].closing||!UUID.test(found[0].workspaceId??'')||
    !HASH.test(found[0].workspaceIdentity??''))
    throw fail('WORKSPACE_NOT_OPEN','Open the selected original Matomo workspace explicitly before remote transfer.');
  const state=await client.call('merchant_matomo_status',{workspace},{signal});
  if(state.workspace!==workspace||state.workspaceIdentity!==found[0].workspaceIdentity||
    state.native?.workspaceId!==found[0].workspaceId||state.instanceId!==found[0].instanceId)
    throw fail('WORKSPACE_CHANGED','The original workspace owner changed during selection; inspect its current identity.');
  return {workspace,workspaceId:found[0].workspaceId,workspaceIdentity:found[0].workspaceIdentity};
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
    ...(request.kind!==undefined?{kind:request.kind}:{}),...(request.expectedSha256?{expectedSha256:request.expectedSha256}:{})};
  const chunk=await client.call('merchant_matomo_artifact_read',args,{signal});
  let readId=chunk.nextOffset===null?null:chunk.readId;
  try{
    const selected={...bound,artifact:request.artifact,id:request.id,kind:request.kind??null,file:file(chunk.file)};
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
        ...(selected.kind!==null?{kind:selected.kind}:{}),expectedSha256:selected.file.sha256,offset,limit,
        ...(readId?{readId}:{})};
      let result;
      try{result=await client.call('merchant_matomo_artifact_read',input,{signal:requestSignal});}
      catch(error){
        if(error.code!=='MATOMO_ARTIFACT_READ_NOT_FOUND'||!readId)throw error;
        // Only a definitively expired/completed retained read is reopened. The
        // same native artifact hash and exact offset remain in this request.
        readId=null;delete input.readId;
        result=await client.call('merchant_matomo_artifact_read',input,{signal:requestSignal});
      }
      checkedNativeChunk(result,selected,offset,limit);readId=result.nextOffset===null?null:result.readId;
      return result;
    }
    const adapter={
      // This endpoint identity intentionally survives a new local HTTP port.
      // Every invocation proves the same original UUID and source/workspace pin.
      endpoint:'matomo-artifact://'+selected.workspaceId+'/'+selected.workspaceIdentity,
      async call(name,input){
        if(input.exportId!==manifest.transferId)throw fail('SELECTION_CHANGED','Use this original artifact transfer identity.');
        if(name===PREFIX+'_manifest')return {state:'MANIFEST_RETAINED',exportId:manifest.transferId,
          manifestFile:{name:MATOMO_TRANSFER_MANIFEST,bytes:manifestBytes.length,sha256:manifestSha256}};
        if(name===PREFIX+'_file_release')return {};
        if(name!==PREFIX+'_file'||input.expectedManifestSha256!==manifestSha256)
          throw fail('SELECTION_CHANGED','Use the exact inspected client transfer manifest.');
        if(input.file===MATOMO_TRANSFER_MANIFEST){
          if(input.expectedSha256!==manifestSha256||!Number.isSafeInteger(input.offset)||input.offset<0||
            input.offset>manifestBytes.length||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>MAX_RETAINED_CHUNK_BYTES)
            throw fail('RANGE_INVALID','Use a bounded range inside this original transfer selection.');
          const chunk=manifestBytes.subarray(input.offset,input.offset+input.limit),next=input.offset+chunk.length;
          return {exportId:manifest.transferId,manifestSha256,file:{name:MATOMO_TRANSFER_MANIFEST,
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
      error.cleanup={code:cleanup.code??'MATOMO_ARTIFACT_RELEASE_FAILED',readId};});
    throw error;
  }
}
const engine=createRetainedDownload({
  manifestName:MATOMO_TRANSFER_MANIFEST,parseManifest:parseMatomoTransfer,maximumBytes:MAX_RETAINED_IMMUTABLE_FILE_BYTES,
  stateSchema:STATE,resultSchema:RESULT,toolPrefix:PREFIX,errorPrefix:ERROR,clientName:'starforge-matomo-remote',
  readLease:false,validateExportId:value=>{if(!HASH.test(value??''))throw fail('SELECTION_INVALID','Use the inspected transfer SHA-256 identity.');},
  describe:manifest=>({source:manifest.source,payload:'payload'})
});
export async function inspectMatomoArtifact({client,selection,signal}={}){
  const opened=await openSelection(client,selection,{signal});
  try{return {selection:opened.manifest,manifestSha256:opened.manifestSha256,endpoint:client.endpoint};}
  finally{await opened.close();}
}
/** No automatic source capture, publication, seller start, export or payment. */
export async function downloadMatomoArtifact({client,selection,directory,signal,chunkSize=MAX_RETAINED_CHUNK_BYTES,onProgress}={}){
  const reviewed=parseMatomoTransfer(bytes(selection));
  const request={workspace:reviewed.source.workspace,artifact:reviewed.source.artifact,id:reviewed.source.id,
    ...(reviewed.source.kind!==null?{kind:reviewed.source.kind}:{}),expectedSha256:reviewed.source.file.sha256};
  const opened=await openSelection(client,request,{signal,reviewed});
  let primary;
  try{
    return await engine.download({client:opened.adapter,exportId:reviewed.transferId,directory,signal,chunkSize,onProgress,
      expectedManifestSha256:opened.manifestSha256});
  }catch(error){primary=error;throw error;}
  finally{
    try{await opened.close();}catch(error){if(primary)primary.cleanup={code:error.code??'MATOMO_ARTIFACT_RELEASE_FAILED'};else throw error;}
  }
}
/** Verifies the complete original payload locally; opens no endpoint or workspace. */
export async function reopenMatomoArtifact({directory,signal}={}){
  if(typeof directory!=='string'||!directory.length)throw fail('DIRECTORY_REQUIRED','Choose the completed original private transfer directory.');
  const stat=await lstat(resolve(directory));
  if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('DIRECTORY_REQUIRED','Reopen an existing real private transfer directory.');
  return engine.lockedDownload(directory,async context=>{
    const raw=await engine.bytesAt(context.root+'/'+MATOMO_TRANSFER_MANIFEST,65000);
    const manifest=parseMatomoTransfer(raw),opened=await engine.loadContext(context,raw,manifest.transferId);
    for(const entry of manifest.files){signal?.throwIfAborted();await engine.verifiedFile(context.root+'/'+entry.name,entry,signal);}
    return {schema:RESULT,state:'COMPLETE',directory:context.root,exportId:manifest.transferId,source:manifest.source,
      payload:'payload',manifestSha256:opened.manifestSha256,files:manifest.files.length,bytes:manifest.source.file.bytes,reopened:true};
  });
}
