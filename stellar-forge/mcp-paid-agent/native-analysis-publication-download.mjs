#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original Analysis package/source files through the maintained MCP byte writer.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRetainedDownload,openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {initializationDirectory as privateDirectory,optionalInitializationBytes,
  retainInitializationFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';

const NATIVE='stellar-forge.mcp-native-analysis.v1';
const PACKAGE='stellar-forge.analysis-dataset-publication-downloads.v1';
const SOURCE='stellar-forge.analysis-publication-source-files.v1';
const STATE='stellar-forge.analysis-dataset-download-state.v1';
const RESULT='stellar-forge.analysis-dataset-download.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_FILE=128*1024*1024,MAX_INDEX=20*1024*1024,MAX_TOTAL=512*1024*1024,MAX_CHUNK=65536;
const FILES=Object.freeze({
  'datapackage.json':['package/datapackage.json','application/json','public'],
  'data.json':['package/data.json','application/json','public'],
  'publication.zip':['publication.zip','application/zip','public'],
  'recipe.json':['recipe.json','application/json','private'],
  'manifest.json':['manifest.json','application/json','private'],
  'report.html':['report.html','text/html;charset=utf-8','private']
});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fault=code=>Object.assign(new Error('MCP_ANALYSIS_DATASET_DOWNLOAD_'+code),{code:'MCP_ANALYSIS_DATASET_DOWNLOAD_'+code});
const need=(value,code)=>{if(!value)throw fault(code);};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const validHash=value=>typeof value==='string'&&HASH.test(value);
const keys=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const identifier=value=>typeof value==='string'&&ID.test(value);
const nativeId=value=>typeof value==='string'&&UUID.test(value);
const mode=value=>{need(value===undefined||typeof value==='boolean','SOURCE_SELECTION_INVALID');return value??false;};
const indexName=source=>source?'files-index.json':'downloads.json';
const prefix=source=>source?'native_analysis_dataset_source':'native_analysis_dataset_package';
function selectedIdentity(alias,jobId){
  need(typeof alias==='string'&&NAME.test(alias)&&identifier(jobId),'SOURCE_ID_REQUIRED');
}
function sourceName(value){
  return ['manifest.json','source.tar.gz','source-edition.json','capture-inspection.json','RECEIVING.md'].includes(value)||
    typeof value==='string'&&value.startsWith('reviews/')&&value.endsWith('.json')&&nativeId(value.slice(8,-5));
}
function sourceMime(name){
  return name.endsWith('.gz')?'application/gzip':name.endsWith('.json')?'application/json':'text/markdown;charset=utf-8';
}
function validateIndex(index,jobId,source){
  const required=source?['schema','workspace_id','job_id','package_id','package_index_sha256','native_workspace_id',
    'export_id','source_hash','manifest_sha256','native_manifest_sha256','files']:
    ['schema','workspace_id','job_id','recipe_id','recipe_sha256','source','files'];
  need(keys(index,required)&&index.schema===(source?SOURCE:PACKAGE)&&identifier(index.workspace_id)&&
    identifier(index.job_id)&&(jobId===undefined||index.job_id===jobId)&&Array.isArray(index.files),'INDEX_CHANGED');
  if(source){
    need(identifier(index.package_id)&&validHash(index.package_index_sha256)&&nativeId(index.native_workspace_id)&&
      nativeId(index.export_id)&&['source_hash','manifest_sha256','native_manifest_sha256'].every(k=>validHash(index[k]))&&
      index.files.length>=2&&index.files.length<=10000,'INDEX_CHANGED');
  }else{
    need(identifier(index.recipe_id)&&validHash(index.recipe_sha256)&&
      keys(index.source,['workspace_id','query_export_id','manifest_sha256','binding_sha256','row_count','columns'])&&
      index.source.workspace_id===index.workspace_id&&identifier(index.source.query_export_id)&&
      validHash(index.source.manifest_sha256)&&validHash(index.source.binding_sha256)&&
      Number.isSafeInteger(index.source.row_count)&&index.source.row_count>=0&&
      Array.isArray(index.source.columns)&&index.source.columns.length>0&&
      index.source.columns.every(v=>typeof v==='string')&&
      new Set(index.source.columns).size===index.source.columns.length&&
      index.files.length===Object.keys(FILES).length,'INDEX_CHANGED');
  }
  let total=0;const names=new Set();
  for(const file of index.files){
    need(keys(file,source?['name','relative','bytes','sha256','mime']:
      ['name','relative','bytes','sha256','mime','visibility'])&&typeof file.name==='string'&&
      !names.has(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&
      validHash(file.sha256),'INDEX_CHANGED');
    names.add(file.name);total+=file.bytes;need(Number.isSafeInteger(total)&&total<=MAX_TOTAL,'TOTAL_TOO_LARGE');
    if(source)need(sourceName(file.name)&&file.relative==='files/'+file.name&&file.mime===sourceMime(file.name),'INDEX_CHANGED');
    else{
      const native=FILES[file.name];
      need(native&&file.relative===native[0]&&file.mime===native[1]&&file.visibility===native[2],'INDEX_CHANGED');
    }
  }
  if(source){
    need(names.has('manifest.json')&&names.has('source.tar.gz')&&
      JSON.stringify(index.files.map(v=>v.name))===JSON.stringify([...names].sort())&&
      index.files.find(v=>v.name==='manifest.json').sha256===index.native_manifest_sha256,'INDEX_CHANGED');
  }else need(JSON.stringify(index.files.map(v=>v.name))===JSON.stringify(Object.keys(FILES)),'INDEX_CHANGED');
  return index;
}
function parseIndex(raw,jobId,source){
  need(Buffer.isBuffer(raw)&&raw.length>=1&&raw.length<=MAX_INDEX,'INDEX_CHANGED');
  let index;try{index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fault('INDEX_CHANGED');}
  validateIndex(index,jobId,source);
  return {...index,index_sha256:sha(raw)};
}
function checkedExpected(index,options){
  need(validHash(options.expectedIndexSha256),'REVIEWED_DIGEST_REQUIRED');
  need(index.index_sha256===options.expectedIndexSha256,'REVIEW_CHANGED');
  if(options.expectedWorkspaceId!==undefined)
    need(identifier(options.expectedWorkspaceId)&&index.workspace_id===options.expectedWorkspaceId,'WORKSPACE_CHANGED');
}
function describe(index){
  const source=index.schema===SOURCE;
  return {jobId:index.job_id,workspaceId:index.workspace_id,source,indexSha256:index.index_sha256,
    ...(source?{packageId:index.package_id,packageIndexSha256:index.package_index_sha256,
      nativeWorkspaceId:index.native_workspace_id,nativeExportId:index.export_id,sourceHash:index.source_hash,
      nativeManifestSha256:index.native_manifest_sha256}:
      {recipeId:index.recipe_id,recipeSha256:index.recipe_sha256,queryExportId:index.source.query_export_id,
        queryManifestSha256:index.source.manifest_sha256,rowCount:index.source.row_count})};
}
function unpack(value,alias,operation){
  need(object(value)&&value.schema===NATIVE&&value.analysisWorkspace===alias&&
    value.operation===operation&&object(value.result),'NATIVE_RESPONSE_CHANGED');
  return value.result;
}

/** Use the original authenticated native MCP listener. No job is created or resumed. */
export async function openNativeAnalysisDatasetClient({url,analysisWorkspace,tokenEnv,environment,signal}={}){
  selectedIdentity(analysisWorkspace,'0'.repeat(32));
  const client=await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'MCP_ANALYSIS_DATASET',clientName:'starforge-analysis-dataset'});
  return {endpoint:client.endpoint,analysisWorkspace,async call(operation,body,options){
    return unpack(await client.call('sf43_discover_review_and_pay',{action:'analysis',analysisWorkspace,
      analysisOperation:operation,analysisRequest:body},options),analysisWorkspace,operation);
  }};
}
async function connection(options){
  selectedIdentity(options.analysisWorkspace,options.jobId);
  if(options.client!==undefined){
    need(object(options.client)&&options.client.analysisWorkspace===options.analysisWorkspace&&
      typeof options.client.call==='function'&&typeof options.client.endpoint==='string'&&options.url===undefined,
      'CLIENT_REQUIRED');
    return options.client;
  }
  return openNativeAnalysisDatasetClient(options);
}
function filePart(value,{workspaceId,jobId,source,indexSha256,file,offset,limit}){
  const part=value?.file,size=Math.min(limit,file.bytes-offset);
  need(value?.workspaceId===workspaceId&&value?.jobId===jobId&&value?.source===source&&
    value?.indexSha256===indexSha256&&value?.filename===file.name&&object(part)&&
    part.verifiedSavedFile===true&&part.bytes===file.bytes&&part.sha256===file.sha256&&
    part.contentType===file.mime&&part.byteOffset===offset&&part.returnedBytes===size&&
    part.encoding==='base64'&&part.nextByteOffset===(offset+size<file.bytes?offset+size:null)&&typeof part.data==='string',
    'CHUNK_CHANGED');
  const bytes=Buffer.from(part.data,'base64');
  need(bytes.length===size&&bytes.toString('base64')===part.data,'CHUNK_INVALID');
  return {part,bytes};
}
async function currentIndex(client,jobId,source,signal){
  signal?.throwIfAborted();
  const result=await client.call('dataset-downloads',{id:jobId,source,offset:0,limit:1},{requestSignal:signal});
  need(object(result)&&result.jobId===jobId&&result.source===source&&identifier(result.workspaceId)&&
    validHash(result.indexSha256)&&object(result.indexFile)&&
    result.indexFile.filename===indexName(source)&&result.indexFile.sha256===result.indexSha256&&
    result.indexFile.contentType==='application/json'&&Number.isSafeInteger(result.indexFile.bytes)&&
    result.indexFile.bytes>=1&&result.indexFile.bytes<=MAX_INDEX&&Number.isSafeInteger(result.fileCount)&&
    result.fileCount>=1&&result.fileCount<=10000,'INDEX_CHANGED');
  const file={name:result.indexFile.filename,bytes:result.indexFile.bytes,sha256:result.indexFile.sha256,mime:'application/json'};
  const raw=Buffer.alloc(file.bytes);
  for(let offset=0;offset<file.bytes;){
    signal?.throwIfAborted();const limit=Math.min(MAX_CHUNK,file.bytes-offset);
    const value=await client.call('dataset-file',{id:jobId,source,index_sha256:result.indexSha256,
      filename:file.name,sha256:file.sha256,byteOffset:offset,maxBytes:limit},{requestSignal:signal});
    const {bytes}=filePart(value,{workspaceId:result.workspaceId,jobId,source,indexSha256:result.indexSha256,file,offset,limit});
    bytes.copy(raw,offset);offset+=bytes.length;
  }
  need(sha(raw)===result.indexSha256,'INDEX_CHANGED');
  const index=parseIndex(raw,jobId,source);
  need(index.workspace_id===result.workspaceId&&index.files.length===result.fileCount,'INDEX_CHANGED');
  return {raw,index};
}
function directoryValue(value){
  need(typeof value==='string'&&value.length>0&&!value.includes('\0')&&resolve(value)!=='/','DIRECTORY_REQUIRED');
  return resolve(value);
}
async function savedIndex(directory,jobId,source){
  const root=resolve(directory),name=indexName(source);
  try{await privateDirectory(root);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  let raw=await optionalInitializationBytes(join(root,name),MAX_INDEX);
  if(raw===null){
    const control=join(root,'download-state');
    try{await privateDirectory(control);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    raw=await optionalInitializationBytes(join(control,name),MAX_INDEX);
  }
  return raw===null?null:{raw,index:parseIndex(raw,jobId,source)};
}
function manifestChunk(raw,file,offset,limit,jobId,manifestSha256){
  const body=raw.subarray(offset,Math.min(file.bytes,offset+limit));
  return {exportId:jobId,manifestSha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
    offset,bytesRead:body.length,encoding:'base64',data:body.toString('base64'),
    nextOffset:offset+body.length<file.bytes?offset+body.length:null};
}
function adapter(client,saved,alias,source){
  const {raw,index}=saved,manifestSha256=sha(raw),name=indexName(source);
  const manifestFile={name,bytes:raw.length,sha256:manifestSha256};
  const endpoint='urn:stellar-forge:analysis-dataset:'+index.workspace_id+':'+index.job_id+':'+
    (source?'source':'package')+':'+index.index_sha256+':'+alias;
  return {endpoint,async call(operation,args,options){
    need(object(args)&&args.exportId===index.job_id,'SOURCE_ID_REQUIRED');
    if(operation===prefix(source)+'_manifest'){
      need(keys(args,['exportId']),'ARGUMENTS_INVALID');
      return {state:'MANIFEST_RETAINED',exportId:index.job_id,manifestFile};
    }
    need(operation===prefix(source)+'_file'&&
      keys(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit'])&&
      args.expectedManifestSha256===manifestSha256&&Number.isSafeInteger(args.offset)&&args.offset>=0&&
      Number.isSafeInteger(args.limit)&&args.limit>=1&&args.limit<=MAX_CHUNK,'CHUNK_CHANGED');
    const file=args.file===name?manifestFile:index.files.find(v=>v.name===args.file);
    need(file&&args.expectedSha256===file.sha256&&args.offset<=file.bytes,'CHUNK_CHANGED');
    if(args.file===name)return manifestChunk(raw,file,args.offset,args.limit,index.job_id,manifestSha256);
    need(client,'DOWNLOAD_INCOMPLETE');
    const value=await client.call('dataset-file',{id:index.job_id,source,index_sha256:index.index_sha256,
      filename:file.name,sha256:file.sha256,byteOffset:args.offset,maxBytes:args.limit},options);
    const {part}=filePart(value,{workspaceId:index.workspace_id,jobId:index.job_id,source,
      indexSha256:index.index_sha256,file,offset:args.offset,limit:args.limit});
    return {exportId:index.job_id,manifestSha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
      offset:args.offset,bytesRead:part.returnedBytes,encoding:'base64',data:part.data,nextOffset:part.nextByteOffset};
  }};
}
const writers=new Map();
function writer(source){
  if(!writers.has(source))writers.set(source,createRetainedDownload({
    manifestName:indexName(source),parseManifest:(raw,id)=>parseIndex(raw,id,source),
    maximumBytes:MAX_FILE,maximumManifestBytes:MAX_INDEX,maximumCheckpointBytes:MAX_INDEX,
    stateSchema:STATE+(source?'.source':'.package'),resultSchema:RESULT,toolPrefix:prefix(source),
    errorPrefix:'MCP_ANALYSIS_DATASET',clientName:'starforge-analysis-dataset',readLease:false,nestedFiles:true,
    validateExportId:value=>need(identifier(value),'SOURCE_ID_REQUIRED'),describe
  }));
  return writers.get(source);
}

/** Inspect the original complete raw index; review its exact SHA before download. */
export async function inspectNativeAnalysisDataset(options={}){
  const source=mode(options.source),client=await connection(options);
  const saved=await currentIndex(client,options.jobId,source,options.signal);
  if(options.expectedWorkspaceId!==undefined)
    need(identifier(options.expectedWorkspaceId)&&saved.index.workspace_id===options.expectedWorkspaceId,'WORKSPACE_CHANGED');
  return {schema:RESULT,state:'REVIEW',analysisWorkspace:options.analysisWorkspace,...describe(saved.index),
    index:saved.index,indexFile:{name:indexName(source),bytes:saved.raw.length,sha256:sha(saved.raw)}};
}

/** Receive every original selected file through the existing locked prefix-resume writer. */
export async function downloadNativeAnalysisDataset(options={}){
  const source=mode(options.source),directory=directoryValue(options.directory);
  selectedIdentity(options.analysisWorkspace,options.jobId);
  need(validHash(options.expectedIndexSha256),'REVIEWED_DIGEST_REQUIRED');
  const chunkSize=options.chunkSize??MAX_CHUNK;
  need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
  const retained=await savedIndex(directory,options.jobId,source),client=await connection(options);
  const saved=retained??await currentIndex(client,options.jobId,source,options.signal);
  checkedExpected(saved.index,options);
  const result=await writer(source).download({client:adapter(client,saved,options.analysisWorkspace,source),
    exportId:options.jobId,directory,signal:options.signal,chunkSize,onProgress:options.onProgress,
    expectedManifestSha256:saved.index.index_sha256});
  return {...result,analysisWorkspace:options.analysisWorkspace,indexFile:join(directory,indexName(source))};
}

/** Verify the original files and finish the same local receipt without a network call. */
export async function reopenNativeAnalysisDataset(options={}){
  const source=mode(options.source),directory=directoryValue(options.directory);
  need(identifier(options.jobId),'SOURCE_ID_REQUIRED');await privateDirectory(directory);
  const saved=await savedIndex(directory,options.jobId,source);need(saved,'ORIGINAL_INDEX_REQUIRED');
  checkedExpected(saved.index,options);const transport=writer(source);
  return transport.lockedDownload(directory,async context=>{
    await transport.loadContext(context,saved.raw,options.jobId);
    for(const file of saved.index.files){
      options.signal?.throwIfAborted();context.lease.assertHeld();
      await transport.verifiedFile(join(directory,file.name),file,options.signal);
      context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    }
    await transport.checkpoint(context);context.lease.assertHeld();
    await retainInitializationFile(join(directory,indexName(source)),saved.raw,{resume:true});
    const bytes=saved.index.files.reduce((n,v)=>n+v.bytes,0);
    return {schema:RESULT,state:'COMPLETE',directory,exportId:options.jobId,...describe(saved.index),
      manifestSha256:saved.index.index_sha256,resumed:true,resumedBytes:bytes,files:saved.index.files.length,
      bytes,indexFile:join(directory,indexName(source)),offline:true};
  });
}
function argumentsFor(argv){
  const [command,...rest]=argv,allowed={
    inspect:['--url','--workspace','--job','--token-env','--workspace-id'],
    download:['--url','--workspace','--job','--dir','--index-sha256','--token-env','--chunk-size','--workspace-id'],
    reopen:['--job','--dir','--index-sha256','--workspace-id']};
  need(Object.hasOwn(allowed,command),'ARGUMENTS_INVALID');
  const selected={};let source=false,sourceSeen=false;
  for(let i=0;i<rest.length;i++){
    if(rest[i]==='--source'){need(!sourceSeen,'ARGUMENTS_INVALID');sourceSeen=true;source=true;continue;}
    need(allowed[command].includes(rest[i])&&!Object.hasOwn(selected,rest[i])&&rest[i+1]&&!rest[i+1].startsWith('--'),'ARGUMENTS_INVALID');
    selected[rest[i]]=rest[++i];
  }
  return {command,options:{url:selected['--url'],analysisWorkspace:selected['--workspace'],jobId:selected['--job'],source,
    directory:selected['--dir'],expectedIndexSha256:selected['--index-sha256'],expectedWorkspaceId:selected['--workspace-id'],
    tokenEnv:selected['--token-env'],...(selected['--chunk-size']===undefined?{}:{chunkSize:Number(selected['--chunk-size'])})}};
}
function output(stream,value){return new Promise((resolve,reject)=>stream.write(value,error=>error?reject(error):resolve()));}
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){
    await output(process.stdout,'Original Analysis package and source files over native MCP.\n'+
      'inspect --url MCP_URL --workspace ALIAS --job UUID32 [--source] [--token-env NAME] [--workspace-id UUID32]\n'+
      'download --url MCP_URL --workspace ALIAS --job UUID32 --dir PRIVATE_DIR --index-sha256 SHA256 [--source] [--token-env NAME] [--chunk-size 1..65536] [--workspace-id UUID32]\n'+
      'reopen --job UUID32 --dir PRIVATE_DIR --index-sha256 SHA256 [--source] [--workspace-id UUID32]\n');
    return 0;
  }
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=argumentsFor(argv);options.signal=controller.signal;
    const result=await(command==='inspect'?inspectNativeAnalysisDataset(options):
      command==='download'?downloadNativeAnalysisDataset(options):reopenNativeAnalysisDataset(options));
    await output(process.stdout,JSON.stringify(result,null,2)+'\n');return 0;
  }catch(error){
    const code=controller.signal.aborted?'MCP_ANALYSIS_DATASET_DOWNLOAD_INTERRUPTED':
      ['ENOSPC','EDQUOT'].includes(error?.code)?'MCP_ANALYSIS_DATASET_DOWNLOAD_STORAGE_FULL':
      /^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:'MCP_ANALYSIS_DATASET_DOWNLOAD_FAILED';
    await output(process.stderr,JSON.stringify({error:code})+'\n');return controller.signal.aborted?130:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
