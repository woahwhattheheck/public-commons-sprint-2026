#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Receive the original encrypted SF101 directory through the maintained download engine.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initializationDirectory as privateDirectory}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {createRetainedDownload,openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
const SCHEMA='stellar-forge.mcp-native-collection-recovery.v1';
const DOWNLOAD='stellar-forge.collection-recovery-download.v1';
const MANIFEST='stellar-forge.merchant-recovery.v1';
const TOOL='collection_recovery',PREFIX='MCP_COLLECTION_RECOVERY';
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OBJECT=/^objects\/[0-9]{6}\.gcm$/;
const MAX_MANIFEST=32*1024*1024,MAX_CHECKPOINT=64*1024*1024;
const MAX_FILE=2*1024**3+64,MAX_CHUNK=65536;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,code){if(!value)throw Object.assign(new Error(code),{code:PREFIX+'_DOWNLOAD_'+code});}
function selection(options){
  need([options.recoveryWorkspace,options.profile,options.profileSha256,options.requestId,options.recordSha256].every(v=>typeof v==='string')&&
    ALIAS.test(options.recoveryWorkspace??'')&&ALIAS.test(options.profile??'')&&
    HASH.test(options.profileSha256??'')&&UUID.test(options.requestId??'')&&
    HASH.test(options.recordSha256??''),'SELECTION_REQUIRED');
  return {recoveryWorkspace:options.recoveryWorkspace,profile:options.profile,
    expectedProfileSha256:options.profileSha256,requestId:options.requestId,
    expectedRecordSha256:options.recordSha256};
}
function unpack(value,workspace,operation){
  need(value?.schema===SCHEMA&&value.workspace===workspace&&value.operation===operation&&plain(value.value),
    'ORIGINAL_RESPONSE_CHANGED');return value.value;
}
export async function openNativeCollectionRecoveryClient(options={}){
  need(typeof options.recoveryWorkspace==='string'&&ALIAS.test(options.recoveryWorkspace),'WORKSPACE_REQUIRED');
  const client=await openMerchantFileClient({...options,errorPrefix:PREFIX,clientName:'starforge-collection-recovery'});
  return {endpoint:client.endpoint,recoveryWorkspace:options.recoveryWorkspace,
    async call(operation,body,context){
      return unpack(await client.call('sf43_discover_review_and_pay',{action:'collection-recovery',
        recoveryWorkspace:options.recoveryWorkspace,recoveryOperation:operation,recoveryRequest:body},context),
        options.recoveryWorkspace,operation);
    }};
}
function receiver(options){
  need(options.client===undefined||options.url===undefined,'ONE_CONNECTION_REQUIRED');
  const selected=selection(options),sourceSuffix='#collection-recovery='+encodeURIComponent(JSON.stringify(selected));
  const sourceBody=()=>({profile:selected.profile,expectedProfileSha256:selected.expectedProfileSha256,
    requestId:selected.requestId,expectedRecordSha256:selected.expectedRecordSha256});
  let manifestBytes=0,parsed=null;
  function parseManifest(raw,exportId){
    need(exportId===selected.requestId&&raw.length<=MAX_MANIFEST,'ORIGINAL_MANIFEST_CHANGED');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{need(false,'MANIFEST_INVALID');}
    need(value?.schema===MANIFEST&&Array.isArray(value.entries),'MANIFEST_INVALID');
    const entries=value.entries.filter(v=>v?.kind==='file');
    need(entries.length>=1&&entries.length<=10000&&new Set(entries.map(v=>v.object)).size===entries.length,
      'MANIFEST_INVALID');
    const record=entries.filter(v=>v.path==='record');
    need(record.length===1&&record[0].sha256===selected.expectedRecordSha256,'ORIGINAL_RECORD_CHANGED');
    const files=entries.map(v=>{
      need(OBJECT.test(v.object??'')&&Number.isSafeInteger(v.size)&&v.size>=0&&v.size<=MAX_FILE&&
        HASH.test(v.cipherSha256??''),'MANIFEST_INVALID');
      return {name:v.object,bytes:v.size,sha256:v.cipherSha256};
    });
    manifestBytes=raw.length;
    parsed={schema:value.schema,exportId,recordSha256:selected.expectedRecordSha256,files};
    return parsed;
  }
  async function connect(transportOptions){
    const client=options.client??await openNativeCollectionRecoveryClient({...transportOptions,
      recoveryWorkspace:selected.recoveryWorkspace});
    need(typeof client?.call==='function'&&typeof client.endpoint==='string'&&
      client.recoveryWorkspace===selected.recoveryWorkspace,'CLIENT_REQUIRED');
    let metadata;
    async function original(){
      metadata??=await client.call('files',{...sourceBody(),offset:0,limit:1});
      const file=metadata.manifest;
      need(metadata.requestId===selected.requestId&&metadata.recordSha256===selected.expectedRecordSha256&&
        file?.name==='manifest.json'&&Number.isSafeInteger(file.bytes)&&file.bytes>=1&&
        file.bytes<=MAX_MANIFEST&&HASH.test(file.sha256??''),'ORIGINAL_MANIFEST_CHANGED');
      return metadata;
    }
    return {endpoint:client.endpoint+sourceSuffix,async call(tool,args,context){
      need(args.exportId===selected.requestId,'ORIGINAL_OPERATION_CHANGED');
      const info=await original(),manifest=info.manifest;
      if(tool===TOOL+'_manifest')return {state:'MANIFEST_RETAINED',exportId:selected.requestId,manifestFile:manifest};
      need(tool===TOOL+'_file'&&args.readId===undefined,'FILE_OPERATION_REQUIRED');
      const file=args.file==='manifest.json'?manifest:parsed?.files.find(v=>v.name===args.file);
      need(file&&args.expectedManifestSha256===manifest.sha256&&args.expectedSha256===file.sha256,
        'ORIGINAL_FILE_CHANGED');
      const offset=args.offset??0,maxBytes=args.limit??MAX_CHUNK;
      need(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
      const value=await client.call('file',{...sourceBody(),filename:file.name,expectedFileSha256:file.sha256,
        byteOffset:offset,maxBytes},context),part=value.file;
      need(value.requestId===selected.requestId&&value.recordSha256===selected.expectedRecordSha256&&
        value.manifestSha256===manifest.sha256&&value.filename===file.name&&
        part?.verifiedSavedFile===true&&part.bytes===file.bytes&&part.sha256===file.sha256,
        'ORIGINAL_FILE_CHANGED');
      return {exportId:selected.requestId,manifestSha256:manifest.sha256,file,
        offset:part.byteOffset,bytesRead:part.returnedBytes,encoding:part.encoding,
        nextOffset:part.nextByteOffset,data:part.data};
    }};
  }
  const transport=createRetainedDownload({manifestName:'manifest.json',parseManifest,maximumBytes:MAX_FILE,
    maximumManifestBytes:MAX_MANIFEST,maximumCheckpointBytes:MAX_CHECKPOINT,nestedFiles:true,readLease:false,
    validateExportId:value=>need(value===selected.requestId,'ORIGINAL_OPERATION_CHANGED'),
    stateSchema:'stellar-forge.collection-recovery-download-state.v1',resultSchema:DOWNLOAD,
    toolPrefix:TOOL,errorPrefix:PREFIX,clientName:'starforge-collection-recovery',connect,
    describe:manifest=>({recordSha256:manifest.recordSha256,manifestBytes,encrypted:true})});
  return {transport,selected,sourceSuffix};
}
export async function inspectNativeCollectionRecovery(options={}){
  const {transport,selected}=receiver(options);
  const {client,...request}=options;
  return transport.inspect({...request,exportId:selected.requestId});
}
export async function downloadNativeCollectionRecovery(options={}){
  need(HASH.test(options.expectedManifestSha256??''),'REVIEWED_MANIFEST_REQUIRED');
  const {transport,selected}=receiver(options),{client,...request}=options,chunkSize=options.chunkSize??MAX_CHUNK;
  need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
  const result=await transport.download({...request,exportId:selected.requestId,chunkSize});
  return {...result,requestId:selected.requestId,encryptedMembers:result.files,files:result.files+1,
    bytes:result.bytes+result.manifestBytes,decrypted:false,restored:false,executionStarted:false};
}
export async function reopenNativeCollectionRecovery(options={}){
  need(HASH.test(options.expectedManifestSha256??''),'REVIEWED_MANIFEST_REQUIRED');
  const {transport,selected,sourceSuffix}=receiver(options);
  // Reopen requires an existing completed receiving directory and its original control state.
  await privateDirectory(resolve(options.directory));
  await privateDirectory(join(resolve(options.directory),'download-state'));
  return transport.lockedDownload(options.directory,async context=>{
    const raw=await transport.bytesAt(join(context.root,'manifest.json'),MAX_MANIFEST);
    need(sha(raw)===options.expectedManifestSha256,'ORIGINAL_MANIFEST_CHANGED');
    await transport.loadContext(context,raw,selected.requestId);
    need(typeof context.state.endpoint==='string'&&context.state.endpoint.endsWith(sourceSuffix),
      'ORIGINAL_SOURCE_SELECTION_CHANGED');
    for(const file of context.manifest.files){
      await transport.verifiedFile(join(context.root,file.name),file);
      context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    }
    await transport.checkpoint(context);
    return {schema:DOWNLOAD,state:'COMPLETE',directory:context.root,requestId:selected.requestId,
      recordSha256:selected.expectedRecordSha256,manifestSha256:sha(raw),resumed:true,
      encryptedMembers:context.manifest.files.length,files:context.manifest.files.length+1,
      bytes:raw.length+context.manifest.files.reduce((sum,file)=>sum+file.bytes,0),
      encrypted:true,decrypted:false,restored:false,executionStarted:false};
  });
}
function argumentsFor(args){
  const [command,...rest]=args;
  const common=['--workspace','--profile','--profile-sha256','--request-id','--record-sha256'];
  const allowed={inspect:[...common,'--url','--token-env'],
    download:[...common,'--url','--token-env','--dir','--manifest-sha256','--chunk-size'],
    reopen:[...common,'--dir','--manifest-sha256']};
  need(Object.hasOwn(allowed,command)&&rest.length%2===0,'ARGUMENTS_INVALID');
  const values={};
  for(let i=0;i<rest.length;i+=2){
    need(allowed[command].includes(rest[i])&&!Object.hasOwn(values,rest[i])&&rest[i+1],'ARGUMENTS_INVALID');
    values[rest[i]]=rest[i+1];
  }
  return {command,options:{url:values['--url'],recoveryWorkspace:values['--workspace'],
    profile:values['--profile'],profileSha256:values['--profile-sha256'],
    requestId:values['--request-id'],recordSha256:values['--record-sha256'],
    directory:values['--dir'],expectedManifestSha256:values['--manifest-sha256'],tokenEnv:values['--token-env'],
    ...(values['--chunk-size']===undefined?{}:{chunkSize:Number(values['--chunk-size'])})}};
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&['--help','-h'].includes(args[0])){
    process.stdout.write('Original encrypted Request Collections receiving.\n'+
      'inspect --url MCP_URL --workspace ALIAS --profile PROFILE --profile-sha256 SHA --request-id UUID --record-sha256 SHA [--token-env NAME]\n'+
      'download [same selection and URL] --dir PRIVATE --manifest-sha256 ORIGINAL_MANIFEST_SHA [--chunk-size 1..65536]\n'+
      'reopen [same workspace/profile/request/record selection] --dir PRIVATE --manifest-sha256 ORIGINAL_MANIFEST_SHA\n'+
      'Download preserves encrypted native bytes; use the original receiving listener for verification and restoration.\n');
    return 0;
  }
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=argumentsFor(args);options.signal=controller.signal;
    const value=await(command==='inspect'?inspectNativeCollectionRecovery(options):
      command==='download'?downloadNativeCollectionRecovery(options):reopenNativeCollectionRecovery(options));
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return 0;
  }catch(error){
    process.stderr.write(JSON.stringify({error:controller.signal.aborted?'MCP_COLLECTION_RECOVERY_DOWNLOAD_INTERRUPTED':
      /^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:'MCP_COLLECTION_RECOVERY_DOWNLOAD_FAILED'})+'\n');
    return controller.signal.aborted?130:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
