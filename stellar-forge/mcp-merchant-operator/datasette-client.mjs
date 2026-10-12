// MIT. Datasette customer operations and receiving through the original merchant transport.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DATASETTE_OPERATIONS } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/client.mjs';
import { datasetteWorkspaceTools } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/provider.mjs';
import { datasetteReceivingTools } from './catalog/datasette-workspace.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { exact, failure, identifier } from './host-files.mjs';
import { DATASETTE_DOWNLOAD_MANIFEST, DATASETTE_MAX_FILE_BYTES, DATASETTE_MAX_MANIFEST_BYTES,
  parseDatasetteDownloadManifest, validateDatasetteExportId } from './datasette-download-contract.mjs';

const PREFIX = 'merchant_datasette_';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const describeTool = (name, description, properties, required, annotations = {}) => ({
  name, description, inputSchema: {type:'object', properties, required, additionalProperties:false}, annotations,
});
export const datasetteActions = Object.freeze(Object.fromEntries([
  ...datasetteWorkspaceTools(describeTool), ...datasetteReceivingTools(describeTool),
].map(tool => [tool.name.slice(PREFIX.length), tool])));
function checkedTool(action, args) {
  if (typeof action !== 'string') throw failure('INVALID_PARAMS', 'Choose a declared Datasette merchant action.');
  const name = action.startsWith(PREFIX) ? action : PREFIX + action, definition = datasetteActions[name.slice(PREFIX.length)];
  if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose a declared Datasette merchant action.');
  exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
  return name;
}
const operationMethod = name => name.replace(/[.-]([a-z])/g, (_, letter) => letter.toUpperCase());

/** This client attaches the existing merchant listener; it never owns the Datasette source workspace. */
export async function openDatasetteClient({workspace, ...options} = {}) {
  if (workspace !== undefined) identifier(workspace, 'Datasette workspace alias');
  const original = await openMerchantFileClient({...options, errorPrefix:'DATASETTE',
    clientName:'starforge-datasette-customer', maximumResponseBytes:128 * 1024 * 1024});
  const call = (action, args = {}, requestOptions) => {
    const local = {...args};
    const short = typeof action === 'string' && action.startsWith(PREFIX) ? action.slice(PREFIX.length) : action;
    if (workspace !== undefined && short !== 'workspaces') {
      if (local.workspace !== undefined && local.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      local.workspace = workspace;
    }
    return original.call(checkedTool(action, local), local, requestOptions);
  };
  const namedTools = Object.fromEntries(Object.keys(datasetteActions).map(action => [
    action.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    (args = {}, requestOptions) => call(action, args, requestOptions),
  ]));
  const nativeOperations = Object.fromEntries(DATASETTE_OPERATIONS.map(operation => [
    operationMethod(operation),
    ({input = {}, workspace: selected = workspace} = {}, requestOptions) =>
      call('operation', {workspace:selected, operation, input}, requestOptions),
  ]));
  return Object.freeze({
    endpoint:original.endpoint, call, ...namedTools, ...nativeOperations,
    nativeOperation(operation, input, requestOptions) {
      if (workspace === undefined) throw failure('DATASETTE_CLIENT_BINDING', 'Select the original workspace alias or call operation with explicit arguments.');
      return call('operation', {workspace, operation, input}, requestOptions);
    },
    uploadFile(args = {}) {
      if (workspace !== undefined && args.workspace !== undefined && args.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      return uploadDatasetteFile({...args, workspace:args.workspace ?? workspace, client:{endpoint:original.endpoint,call}});
    },
    downloadExport(args = {}) {
      if (workspace !== undefined && args.workspace !== undefined && args.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      return downloadDatasetteExport({...args, workspace:args.workspace ?? workspace, client:original});
    },
    inspectExport(args = {}) {
      if (workspace !== undefined && args.workspace !== undefined && args.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      return inspectDatasetteExport({...args, workspace:args.workspace ?? workspace, client:original});
    },
  });
}

const downloads = createRetainedDownload({
  manifestName:DATASETTE_DOWNLOAD_MANIFEST, parseManifest:parseDatasetteDownloadManifest,
  maximumBytes:DATASETTE_MAX_FILE_BYTES, maximumManifestBytes:DATASETTE_MAX_MANIFEST_BYTES,
  maximumCheckpointBytes:128 * 1024 * 1024, nestedFiles:true,
  stateSchema:'stellar-forge.datasette-download-state.v1',
  resultSchema:'stellar-forge.datasette-download-result.v1',
  toolPrefix:'merchant_datasette_export', errorPrefix:'DATASETTE',
  clientName:'starforge-datasette-receiving', validateExportId:validateDatasetteExportId,
  describe:manifest => ({workspaceId:manifest.workspaceId, native:manifest.native}),
});
async function selectedTransport({client, workspace, url, tokenEnv, environment, signal}) {
  identifier(workspace, 'Datasette workspace alias');
  if (client !== undefined && url !== undefined)
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Supply the original client or its endpoint once.');
  const original = client ?? await openMerchantFileClient({url, tokenEnv, environment, signal,
    errorPrefix:'DATASETTE', clientName:'starforge-datasette-receiving', maximumResponseBytes:128 * 1024 * 1024});
  if (!original || typeof original.call !== 'function' || typeof original.endpoint !== 'string')
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Use one original merchant file client.');
  return {endpoint:original.endpoint + '#datasette=' + workspace,
    call:(tool, args, options) => original.call(tool, {...args, workspace}, options)};
}
export async function downloadDatasetteExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.download({...rest, signal, client:selected});
}
export async function inspectDatasetteExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.inspect({...rest, signal, client:selected});
}

/** Verify every original received file with both native and merchant listeners closed. */
export async function reopenDatasetteExport({directory, exportId, expectedManifestSha256} = {}) {
  validateDatasetteExportId(exportId);
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Select the retained directory and its original manifest identity.');
  const root = resolve(directory), raw = await downloads.bytesAt(join(root, DATASETTE_DOWNLOAD_MANIFEST), DATASETTE_MAX_MANIFEST_BYTES);
  const manifestSha256 = sha(raw), manifest = parseDatasetteDownloadManifest(raw, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw failure('DATASETTE_DOWNLOAD_EXPORT_CHANGED', 'The completed manifest differs from its reviewed original digest.');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, raw, exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld();
      await downloads.verifiedFile(join(root, file.name), file);
    }
    return {schema:'stellar-forge.datasette-download-result.v1', state:'REOPENED',
      directory:root, exportId, workspaceId:manifest.workspaceId, native:manifest.native,
      manifestSha256, files:manifest.files.length, bytes:manifest.totalBytes,
      verifiedFiles:manifest.files};
  });
}

/** Transfer a complete reviewed local archive through the original native upload authority.
 * The UUID and full file declaration are supplied by the caller before any request.
 * A failed mutating response stops the call; only an explicit later invocation continues.
 */
export async function uploadDatasetteFile({
  workspace,client,url,tokenEnv,environment,path,uploadId,name,bytes,sha256,
  chunkSize=1024*1024,signal,timeoutMs=300000,onProgress,
}={}) {
  identifier(workspace,'Datasette workspace alias');
  const fail=(code,message,details)=>{const error=failure('DATASETTE_UPLOAD_'+code,message);
    if(details!==undefined)error.details=details;throw error;};
  const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&
    Number.isSafeInteger(Number(value))&&Number(value)<=DATASETTE_MAX_FILE_BYTES;
  if(typeof path!=='string'||!path||path.includes('\0')||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(uploadId??'')||
      typeof name!=='string'||!name||Buffer.byteLength(name)>240||/[\\/\u0000-\u001f\u007f]/.test(name)||
      !decimal(bytes)||!/^[a-f0-9]{64}$/.test(sha256??'')||
      !Number.isSafeInteger(chunkSize)||chunkSize<65536||chunkSize>8*1024*1024||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000||
      onProgress!==undefined&&typeof onProgress!=='function'||client!==undefined&&url!==undefined)
    fail('CONFIGURATION','Supply the original upload UUID, reviewed file declaration and selected original endpoint.');
  const transport=client??await openDatasetteClient({url,tokenEnv,environment,workspace,signal});
  if(!transport||typeof transport.call!=='function')fail('CONFIGURATION','Use the original Datasette merchant client.');
  const declaration={uploadId,name,bytes,sha256},requestOptions={requestSignal:signal,timeoutMs};
  const nativeCall=async(action,input)=> {
    const reply=await transport.call(checkedTool(action,{workspace,...input}),{workspace,...input},requestOptions);
    if(reply?.workspace!==workspace||!reply.native)fail('REPLY_INVALID','Read the complete original upload response.');
    const value=reply.native;
    if(value.schema!=='stellar-forge.datasette-upload.v1'||!['RECEIVING','FINALIZABLE','COMPLETE','REJECTED'].includes(value.state)||
        !['uploadId','name','bytes','sha256'].every(key=>value[key]===declaration[key])||
        !decimal(value.receivedBytes)||!decimal(value.uncheckpointedBytes)||Number(value.receivedBytes)>Number(bytes)||
        !/^[a-f0-9]{64}$/.test(value.prefixSha256??''))
      fail('REPLY_CHANGED','The response differs from the original upload declaration or durable prefix.',{uploadId});
    return value;
  };
  const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true}),signature=value=>[
      value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.mode,value.nlink].join(':');
    if(!before.isFile()||(before.mode&0o077n)!==0n||before.nlink!==1n||before.size!==BigInt(bytes))
      fail('PRIVATE_FILE_REQUIRED','Use the complete reviewed private regular archive with its exact byte count.');
    const unchanged=async()=>{signal?.throwIfAborted();
      if(signature(await handle.stat({bigint:true}))!==signature(before))
        fail('SOURCE_CHANGED','The reviewed local archive changed; the original upload remains retained.',{uploadId});};
    const hashPrefix=async length=>{
      const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;
      while(offset<length){signal?.throwIfAborted();
        const part=await handle.read(buffer,0,Math.min(buffer.length,length-offset),offset);
        if(!part.bytesRead)fail('SOURCE_CHANGED','The reviewed local archive ended before its declared range.',{uploadId});
        hash.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;
      }
      await unchanged();return hash;
    };
    const complete=await hashPrefix(Number(bytes));
    if(complete.digest('hex')!==sha256)fail('SOURCE_CHANGED','The complete local archive does not match its reviewed SHA-256.',{uploadId});
    let current;
    try{current=await nativeCall('upload_status',{uploadId});}
    catch(error){
      if(error.code!=='DATASETTE_UPLOAD_NOT_FOUND'||error.details?.status!==404||error.details?.operationId!==uploadId)throw error;
    }
    const resumedBytes=current?Number(current.receivedBytes):0;
    const result=value=>({state:value.state,workspace,native:value,source:{path:resolve(path),bytes,sha256},
      resumedBytes:String(resumedBytes)});
    if(current?.state==='REJECTED')return result(current);
    let position=resumedBytes,hash=await hashPrefix(position);
    if(current&&hash.copy().digest('hex')!==current.prefixSha256)
      fail('PREFIX_CHANGED','The retained native prefix differs from this exact reviewed archive.',{uploadId,receivedBytes:current.receivedBytes});
    if(current?.state==='COMPLETE')return result(current);
    for(;;){
      signal?.throwIfAborted();
      const length=Math.min(chunkSize,Number(bytes)-position),raw=Buffer.alloc(length);let read=0;
      while(read<length){const part=await handle.read(raw,read,length-read,position+read);
        if(!part.bytesRead)fail('SOURCE_CHANGED','The complete original chunk is unavailable.',{uploadId});read+=part.bytesRead;}
      await unchanged();
      current=await nativeCall('upload_chunk',{...declaration,offset:String(position),length:String(length),data:raw.toString('base64')});
      hash.update(raw);position+=length;
      if(current.state==='REJECTED')return result(current);
      if(current.receivedBytes!==String(position)||current.prefixSha256!==hash.copy().digest('hex'))
        fail('PREFIX_CHANGED','Read the original upload status before continuing a different native prefix.',{uploadId,receivedBytes:current.receivedBytes});
      await onProgress?.({workspace,uploadId,state:current.state,receivedBytes:current.receivedBytes,bytes,sha256});
      if(current.state==='COMPLETE') {
        if(position!==Number(bytes)||current.prefixSha256!==sha256||!current.archiveFile||
            current.retainedFile?.sha256!==sha256||current.retainedFile?.bytes!==bytes)
          fail('REPLY_INVALID','The native owner must publish the exact complete original archive.',{uploadId});
        await unchanged();return result(current);
      }
      if(length===0||position>=Number(bytes))
        fail('FINALIZATION_PENDING','The original bytes are retained; inspect and explicitly finalize this same upload.',{uploadId,state:current.state});
    }
  }finally{await handle.close();}
}
