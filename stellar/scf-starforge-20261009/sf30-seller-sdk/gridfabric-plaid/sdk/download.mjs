// MIT. Complete original native files through the maintained retained-download writer.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createRetainedDownload} from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import {GridFabricClientError,gridFabricFileId} from './contract.mjs';

export const GRIDFABRIC_FILE_MANIFEST='gridfabric-file.json';
export const GRIDFABRIC_FILE_MANIFEST_SCHEMA='commons.gridfabric-native-file-manifest.v1';
const SHA=/^[a-f0-9]{64}$/;
const ID=/^(?:file_[a-f0-9]{64}|export_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code,message)=>new GridFabricClientError(code,message);
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function exportIdentity(value){
  return gridFabricFileId(value).fileId;
}
function outputName(info){
  const name=info.name;
  if(typeof name==='string'&&name&&Buffer.byteLength(name,'utf8')<=200&&
    !/[\x00-\x1f\x7f\/\\:]/.test(name)&&!['.','..','download-state',GRIDFABRIC_FILE_MANIFEST].includes(name))
    return name;
  return 'native-'+info.sha256+'.bin';
}
export function parseGridFabricFileManifest(bytes,expectedFileId){
  let manifest;try{manifest=JSON.parse(decode(bytes));}catch{throw failure('GRIDFABRIC_MANIFEST_INVALID','The complete native-file manifest is not valid UTF-8 JSON.');}
  const file=manifest?.native_file,workspace=manifest?.workspace;
  if(!plain(manifest)||manifest.schema!==GRIDFABRIC_FILE_MANIFEST_SCHEMA||
    manifest.exportId!==expectedFileId||!plain(file)||file.file_id!==expectedFileId||
    !ID.test(file.file_id)||typeof file.name!=='string'||!file.name||
    !Number.isSafeInteger(file.bytes)||file.bytes<0||!SHA.test(file.sha256??'')||
    typeof file.content_type!=='string'||!plain(workspace)||
    typeof workspace.workspace_id!=='string'||!workspace.workspace_id||
    typeof workspace.workspace_directory!=='string'||!workspace.workspace_directory||
    !Array.isArray(manifest.files)||manifest.files.length!==1)
    throw failure('GRIDFABRIC_MANIFEST_INVALID','The original native file or workspace identity is incomplete.');
  const retained=manifest.files[0];
  if(!plain(retained)||retained.name!==outputName(file)||retained.bytes!==file.bytes||
    retained.sha256!==file.sha256||retained.file_id!==file.file_id||
    retained.content_type!==file.content_type)
    throw failure('GRIDFABRIC_MANIFEST_INVALID','The output file differs from the original retained native file.');
  return manifest;
}

/**
 * A deterministic manifest over the native immutable file identity. No second
 * export, workspace mutation, file copy, process or server is created.
 * The original native file ID is also the retained-download export identity.
 */
export async function createGridFabricFileSource({client,fileId,expectedSha256,signal}={}){
  fileId=exportIdentity(fileId);
  if(!client||typeof client.fileInfo!=='function'||typeof client.readFile!=='function'||
    !plain(client.identity)||typeof client.endpoint!=='string')
    throw failure('GRIDFABRIC_FILE_CLIENT','Attach the original GridFabric SDK client.');
  const original=await client.fileInfo(fileId,{signal});
  if(expectedSha256!==undefined&&(!SHA.test(expectedSha256)||original.sha256!==expectedSha256))
    throw failure('GRIDFABRIC_FILE_CHANGED','The selected original file digest changed.');
  const file=Object.freeze({file_id:original.file_id,name:original.name,content_type:original.content_type,
    bytes:original.bytes,sha256:original.sha256});
  const workspace=Object.freeze({workspace_id:client.identity.workspace_id,workspace_directory:client.identity.workspace_directory});
  const retained=Object.freeze({name:outputName(file),file_id:file.file_id,content_type:file.content_type,bytes:file.bytes,sha256:file.sha256});
  const manifest=Object.freeze({schema:GRIDFABRIC_FILE_MANIFEST_SCHEMA,exportId:fileId,workspace,
    native_file:file,files:Object.freeze([retained])});
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n','utf8');
  const manifestSha256=digest(manifestBytes);
  parseGridFabricFileManifest(manifestBytes,fileId);
  const manifestFile=Object.freeze({name:GRIDFABRIC_FILE_MANIFEST,bytes:manifestBytes.length,
    sha256:manifestSha256,content_type:'application/json'});
  return Object.freeze({
    endpoint:client.endpoint,exportId:fileId,manifest,manifestSha256,manifestFile,
    get manifestBytes(){return Buffer.from(manifestBytes);},
    async call(name,args={},options={}){
      if(args.exportId!==fileId)throw failure('GRIDFABRIC_FILE_CHANGED','Select this original native file identity.');
      if(name==='merchant_gridfabric_file_manifest')
        return {state:'MANIFEST_RETAINED',exportId:fileId,manifestFile,nativeFile:file,workspace};
      if(name!=='merchant_gridfabric_file')throw failure('GRIDFABRIC_FILE_TOOL','Choose an original native-file read.');
      const selected=args.file===GRIDFABRIC_FILE_MANIFEST?manifestFile:args.file===retained.name?retained:null;
      if(!selected||args.expectedManifestSha256!==manifestSha256||args.expectedSha256!==selected.sha256||
        !Number.isSafeInteger(args.offset)||args.offset<0||args.offset>selected.bytes||
        !Number.isSafeInteger(args.limit)||args.limit<1||args.limit>196608||
        args.readId!==undefined&&args.readId!==null)
        throw failure('GRIDFABRIC_FILE_CHANGED','Repeat the original manifest/file hashes and exact native byte range.');
      const length=Math.min(args.limit,selected.bytes-args.offset);
      const bytes=selected===manifestFile?manifestBytes.subarray(args.offset,args.offset+length):
        length?await client.readFile(fileId,{offset:args.offset,limit:args.limit,expectedSha256:file.sha256,
          signal:options.requestSignal??signal}):Buffer.alloc(0);
      if(bytes.length!==length)throw failure('GRIDFABRIC_FILE_CHANGED','The complete native byte range ended early.');
      return {exportId:fileId,manifestSha256,file:selected,offset:args.offset,bytesRead:bytes.length,
        encoding:'base64',data:Buffer.from(bytes).toString('base64'),
        nextOffset:args.offset+length<selected.bytes?args.offset+length:null};
    }
  });
}

const retainedDownload=createRetainedDownload({
  manifestName:GRIDFABRIC_FILE_MANIFEST,parseManifest:parseGridFabricFileManifest,
  maximumBytes:Number.MAX_SAFE_INTEGER,
  stateSchema:'commons.gridfabric-native-file-download.v1',resultSchema:'commons.gridfabric-native-file-receiving.v1',
  toolPrefix:'merchant_gridfabric_file',errorPrefix:'GRIDFABRIC',clientName:'starforge-gridfabric-native-files',
  validateExportId:exportIdentity,readLease:false,
  describe:manifest=>({workspace:manifest.workspace,nativeFile:manifest.native_file})
});
/* The maintained writer appends _manifest/_file to its family prefix. */
function writerClient(source){
  return {endpoint:source.endpoint,call:(name,args,options)=>source.call(
    name==='merchant_gridfabric_file_manifest'?'merchant_gridfabric_file_manifest':
    name==='merchant_gridfabric_file_file'?'merchant_gridfabric_file':name,args,options)};
}
export async function downloadGridFabricFile({client,fileId,directory,expectedSha256,expectedManifestSha256,
  chunkSize,signal,onProgress}={}){
  fileId=exportIdentity(fileId);
  const source=await createGridFabricFileSource({client,fileId,expectedSha256,signal});
  const result=await retainedDownload.download({client:writerClient(source),exportId:fileId,directory,
    expectedManifestSha256,chunkSize,signal,onProgress});
  return {...result,originalFile:{...source.manifest.native_file,
    path:join(result.directory,source.manifest.files[0].name)},manifest:source.manifest};
}
export async function reopenGridFabricDownload({directory,expectedManifestSha256,expectedWorkspaceId,
  expectedFileId,signal}={}){
  return retainedDownload.lockedDownload(directory,async context=>{
    const bytes=await retainedDownload.bytesAt(join(context.root,GRIDFABRIC_FILE_MANIFEST),65000);
    const decoded=JSON.parse(decode(bytes)),fileId=exportIdentity(decoded.exportId);
    if(expectedFileId!==undefined&&fileId!==expectedFileId||
      expectedManifestSha256!==undefined&&digest(bytes)!==expectedManifestSha256)
      throw failure('GRIDFABRIC_FILE_CHANGED','This download belongs to a different original file manifest.');
    const manifest=parseGridFabricFileManifest(bytes,fileId);
    if(expectedWorkspaceId!==undefined&&manifest.workspace.workspace_id!==expectedWorkspaceId)
      throw failure('GRIDFABRIC_BINDING_CHANGED','This download belongs to a different original workspace.');
    await retainedDownload.loadContext(context,bytes,fileId);
    for(const file of manifest.files)await retainedDownload.verifiedFile(join(context.root,file.name),file,signal);
    return {schema:'commons.gridfabric-native-file-receiving.v1',state:'REOPENED',directory:context.root,
      exportId:fileId,manifestSha256:digest(bytes),workspace:manifest.workspace,
      nativeFile:manifest.native_file,files:manifest.files.length,bytes:manifest.native_file.bytes,
      originalFile:{...manifest.native_file,path:join(context.root,manifest.files[0].name)},manifest};
  });
}

/** Use the same writer over an original merchant file client or provider. */
export async function downloadGridFabricMerchantFile({fileClient,workspace,fileId,directory,
  expectedSha256,expectedManifestSha256,chunkSize,signal,onProgress}={}){
  fileId=exportIdentity(fileId);
  if(!fileClient||typeof fileClient.call!=='function'||typeof fileClient.endpoint!=='string'||
    typeof workspace!=='string'||!workspace)
    throw failure('GRIDFABRIC_FILE_CLIENT','Supply the original merchant file client and declared workspace alias.');
  const metadata=await fileClient.call('merchant_gridfabric_file_manifest',{workspace,exportId:fileId,
    ...(expectedSha256===undefined?{}:{expectedSha256})});
  if(expectedSha256!==undefined&&metadata.nativeFile?.sha256!==expectedSha256)
    throw failure('GRIDFABRIC_FILE_CHANGED','The merchant native file differs from its reviewed digest.');
  const expected=expectedManifestSha256??metadata.manifestFile?.sha256;
  const adapter={endpoint:fileClient.endpoint,call:(name,args,options)=>fileClient.call(
    name==='merchant_gridfabric_file_file'?'merchant_gridfabric_file':name,{workspace,...args},options)};
  const result=await retainedDownload.download({client:adapter,exportId:fileId,directory,
    expectedManifestSha256:expected,chunkSize,signal,onProgress});
  const bytes=await retainedDownload.bytesAt(join(result.directory,GRIDFABRIC_FILE_MANIFEST),65000);
  const manifest=parseGridFabricFileManifest(bytes,fileId);
  return {...result,originalFile:{...manifest.native_file,path:join(result.directory,manifest.files[0].name)},manifest};
}
