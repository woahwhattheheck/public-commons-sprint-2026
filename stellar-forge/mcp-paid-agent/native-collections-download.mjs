#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Complete customer receiving through the existing retained-download engine.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRetainedDownload,openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';

const NATIVE='stellar-forge.mcp-native-collections.v1';
const EXPORT='stellar-forge.sf88.collection-export.v1';
const PREFIX='COLLECTION',TOOL='collection_export';
const FILES=['collection.json','results.json','requests.csv','review.html'];
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/,EXPORT_ID=/^[a-f0-9]{32}$/;
const ALIAS=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_FILE=32*1024*1024,MAX_CHUNK=65536;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code:'MCP_COLLECTION_DOWNLOAD_'+code});};
function selection(options){
  need(ALIAS.test(options.collectionWorkspace??'')&&ID.test(options.id??'')&&
    HASH.test(options.collectionManifestSha256??'')&&EXPORT_ID.test(options.exportId??''),'SELECTION_REQUIRED');
  return {workspace:options.collectionWorkspace,id:options.id,
    expectedManifestSha256:options.collectionManifestSha256,exportId:options.exportId};
}
function unpack(value,workspace,operation){
  need(value?.schema===NATIVE&&value.workspace===workspace&&value.operation===operation&&plain(value.value),
    'ORIGINAL_RESPONSE_CHANGED');return value.value;
}
export async function openNativeCollectionsClient(options={}){
  need(ALIAS.test(options.collectionWorkspace??''),'WORKSPACE_REQUIRED');
  const client=await openMerchantFileClient({...options,errorPrefix:'MCP_COLLECTION',clientName:'starforge-collection-receiver'});
  return {endpoint:client.endpoint,collectionWorkspace:options.collectionWorkspace,
    async call(operation,body,context){
      return unpack(await client.call('sf43_discover_review_and_pay',{action:'collections',
        collectionWorkspace:options.collectionWorkspace,collectionOperation:operation,
        collectionRequest:body},context),options.collectionWorkspace,operation);
    }};
}
function receiver(options){
  const selected=selection(options);let manifestBytes=0;
  function parseManifest(bytes,exportId){
    need(exportId===selected.exportId,'EXPORT_CHANGED');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{need(false,'MANIFEST_INVALID');}
    need(value?.schema===EXPORT&&value.id===selected.id&&value.manifestSha256===selected.expectedManifestSha256&&
      Array.isArray(value.files)&&value.files.length===4&&new Set(value.files.map(file=>file?.name)).size===4&&
      value.files.every(file=>FILES.includes(file?.name)&&Number.isSafeInteger(file.bytes)&&
        file.bytes>=0&&file.bytes<=MAX_FILE&&HASH.test(file.sha256??'')),'MANIFEST_CHANGED');
    manifestBytes=bytes.length;return value;
  }
  async function connect(transportOptions){
    const client=await openNativeCollectionsClient({...transportOptions,collectionWorkspace:selected.workspace});
    let retained;
    async function metadata(exportId){
      need(exportId===selected.exportId,'EXPORT_CHANGED');
      retained??=await client.call('export-status',{id:selected.id,
        expectedManifestSha256:selected.expectedManifestSha256,exportId});
      need(retained.schema===EXPORT&&retained.id===selected.id&&retained.exportId===exportId&&
        retained.manifestSha256===selected.expectedManifestSha256&&Array.isArray(retained.files)&&
        retained.files.length===5&&new Set(retained.files.map(file=>file?.name)).size===5,
        'EXPORT_CHANGED');
      for(const name of [...FILES,'manifest.json']){
        const file=retained.files.find(file=>file.name===name);
        need(file&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&HASH.test(file.sha256??''),
          'EXPORT_CHANGED');
      }
      return retained;
    }
    return {endpoint:client.endpoint,async call(tool,args,context){
      need(args.exportId===selected.exportId,'EXPORT_CHANGED');
      const info=await metadata(args.exportId),manifest=info.files.find(file=>file.name==='manifest.json');
      need(manifest.bytes>=1&&manifest.bytes<=65000,'MANIFEST_CHANGED');
      if(tool===TOOL+'_manifest')return {state:'MANIFEST_RETAINED',exportId:info.exportId,manifestFile:manifest};
      need(tool===TOOL+'_file','FILE_OPERATION_REQUIRED');
      const file=info.files.find(file=>file.name===args.file);
      need(file&&args.expectedManifestSha256===manifest.sha256&&args.expectedSha256===file.sha256&&
        args.readId===undefined,'FILE_CHANGED');
      const value=await client.call('export-file',{id:selected.id,expectedManifestSha256:selected.expectedManifestSha256,
        exportId:info.exportId,filename:file.name,expectedFileSha256:file.sha256,
        byteOffset:args.offset??0,maxBytes:Math.min(args.limit??MAX_CHUNK,MAX_CHUNK)},context);
      const part=value.file;
      need(value.id===selected.id&&value.exportId===selected.exportId&&
        value.manifestSha256===selected.expectedManifestSha256&&value.filename===file.name&&
        part?.verifiedSavedFile===true&&part.bytes===file.bytes&&part.sha256===file.sha256,
        'FILE_CHANGED');
      // This native reader verifies immutable files independently. Its exact
      // range fields map into the maintained transport's stateless-read mode.
      return {exportId:info.exportId,manifestSha256:manifest.sha256,file,
        offset:part.byteOffset,bytesRead:part.returnedBytes,encoding:part.encoding,
        nextOffset:part.nextByteOffset,data:part.data};
    }};
  }
  return createRetainedDownload({manifestName:'manifest.json',parseManifest,maximumBytes:MAX_FILE,
    stateSchema:'stellar-forge.collection-download-state.v1',
    resultSchema:'stellar-forge.collection-download.v1',toolPrefix:TOOL,errorPrefix:PREFIX,
    clientName:'starforge-collection-receiver',connect,readLease:false,
    describe:manifest=>({collectionId:manifest.id,collectionManifestSha256:manifest.manifestSha256,manifestBytes})});
}
export async function inspectNativeCollectionExport(options={}){
  return receiver(options).inspect(options);
}
export async function downloadNativeCollectionExport(options={}){
  need(HASH.test(options.expectedManifestSha256??''),'REVIEWED_EXPORT_MANIFEST_REQUIRED');
  const chunkSize=options.chunkSize??MAX_CHUNK;
  need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
  const result=await receiver(options).download({...options,chunkSize});
  return {...result,dataFiles:result.files,files:result.files+1,bytes:result.bytes+result.manifestBytes};
}
export async function reopenNativeCollectionExport(options={}){
  need(HASH.test(options.expectedManifestSha256??''),'REVIEWED_EXPORT_MANIFEST_REQUIRED');
  const transport=receiver(options);
  return transport.lockedDownload(options.directory,async context=>{
    const raw=await transport.bytesAt(join(context.root,'manifest.json'),65000);
    need(sha(raw)===options.expectedManifestSha256,'MANIFEST_CHANGED');
    await transport.loadContext(context,raw,options.exportId);
    for(const file of context.manifest.files){
      await transport.verifiedFile(join(context.root,file.name),file);
      context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    }
    await transport.checkpoint(context);
    return {schema:'stellar-forge.collection-download.v1',state:'COMPLETE',directory:context.root,
      exportId:options.exportId,collectionId:context.manifest.id,
      collectionManifestSha256:context.manifest.manifestSha256,manifestSha256:sha(raw),
      resumed:true,files:5,dataFiles:4,
      bytes:raw.length+context.manifest.files.reduce((sum,file)=>sum+file.bytes,0)};
  });
}
function argumentsFor(args){
  const [command,...rest]=args,common=['--workspace','--id','--collection-sha256','--export-id'];
  const allowed={inspect:[...common,'--url','--token-env'],
    download:[...common,'--url','--token-env','--dir','--manifest-sha256','--chunk-size'],
    reopen:[...common,'--dir','--manifest-sha256']};
  need(Object.hasOwn(allowed,command)&&rest.length%2===0,'ARGUMENTS_INVALID');
  const values={};
  for(let index=0;index<rest.length;index+=2){
    need(allowed[command].includes(rest[index])&&!Object.hasOwn(values,rest[index])&&rest[index+1],'ARGUMENTS_INVALID');
    values[rest[index]]=rest[index+1];
  }
  return {command,options:{url:values['--url'],collectionWorkspace:values['--workspace'],id:values['--id'],
    collectionManifestSha256:values['--collection-sha256'],exportId:values['--export-id'],
    directory:values['--dir'],expectedManifestSha256:values['--manifest-sha256'],tokenEnv:values['--token-env'],
    ...(values['--chunk-size']===undefined?{}:{chunkSize:Number(values['--chunk-size'])})}};
}
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&['--help','-h'].includes(args[0])){
    process.stdout.write('Original request-collection customer receiving.\n'+
      'inspect --url MCP_URL --workspace ALIAS --id COLLECTION --collection-sha256 SHA --export-id HEX32 [--token-env NAME]\n'+
      'download [same selection and URL] --dir PRIVATE --manifest-sha256 EXPORT_MANIFEST_SHA [--chunk-size 1..65536]\n'+
      'reopen --workspace ALIAS --id COLLECTION --collection-sha256 SHA --export-id HEX32 --dir PRIVATE --manifest-sha256 EXPORT_MANIFEST_SHA\n');
    return 0;
  }
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=argumentsFor(args);options.signal=controller.signal;
    const value=await(command==='inspect'?inspectNativeCollectionExport(options):
      command==='download'?downloadNativeCollectionExport(options):reopenNativeCollectionExport(options));
    process.stdout.write(JSON.stringify(value,null,2)+'\n');return 0;
  }catch(error){
    const code=controller.signal.aborted?'MCP_COLLECTION_DOWNLOAD_INTERRUPTED':
      /^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:'MCP_COLLECTION_DOWNLOAD_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');return controller.signal.aborted?130:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await main();
