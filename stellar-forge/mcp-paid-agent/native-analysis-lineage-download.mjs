#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original native Analysis files over the maintained MCP retained-download writer.
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRetainedDownload,openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {initializationDirectory as privateDirectory,optionalInitializationBytes,
  retainInitializationFile} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';

const NATIVE='stellar-forge.mcp-native-analysis.v1';
const INDEX='stellar-forge.analysis-lineage-downloads.v1';
const STATE='stellar-forge.analysis-lineage-download-state.v1';
const RESULT='stellar-forge.analysis-lineage-download.v1';
const INDEX_NAME='lineage-download-index.json';
const PREFIX='native_analysis_lineage';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/,NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_FILE=128*1024*1024,MAX_INDEX=65536,MAX_CHUNK=65536;
const MIME=Object.freeze({'events.json':'application/json','plan.json':'application/json',
  'native-bindings.json':'application/json','receipts.json':'application/json',
  'report.html':'text/html;charset=utf-8','manifest.json':'application/json','handover.zip':'application/zip'});
const FILES=Object.keys(MIME).sort();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fault=code=>Object.assign(new Error('MCP_ANALYSIS_LINEAGE_DOWNLOAD_'+code),{code:'MCP_ANALYSIS_LINEAGE_DOWNLOAD_'+code});
const need=(value,code)=>{if(!value)throw fault(code);};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const validHash=value=>typeof value==='string'&&HASH.test(value);
const sort=value=>Array.isArray(value)?value.map(sort):object(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;
const canonical=value=>Buffer.from(JSON.stringify(sort(value)));
const encodedIndex=value=>Buffer.concat([canonical(value),Buffer.from('\n')]);
const keys=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));

function selectedIdentity(analysisWorkspace,planId){
  need(typeof analysisWorkspace==='string'&&NAME.test(analysisWorkspace)&&
    typeof planId==='string'&&ID.test(planId),'SOURCE_ID_REQUIRED');
}
function validateIndex(index,planId){
  need(keys(index,['schema','workspace_id','plan_id','plan_sha256','events_sha256','manifest_sha256','files','index_sha256'])&&
    index.schema===INDEX&&ID.test(index.workspace_id??'')&&ID.test(index.plan_id??'')&&
    (planId===undefined||index.plan_id===planId)&&
    ['plan_sha256','events_sha256','manifest_sha256','index_sha256'].every(key=>validHash(index[key]))&&
    Array.isArray(index.files)&&index.files.length===FILES.length,'INDEX_CHANGED');
  need(JSON.stringify(index.files.map(file=>file?.name))===JSON.stringify(FILES),'INDEX_CHANGED');
  for(const file of index.files)need(keys(file,['name','bytes','sha256','mime'])&&
    Object.hasOwn(MIME,file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&
    validHash(file.sha256)&&file.mime===MIME[file.name],'INDEX_CHANGED');
  const {index_sha256,...binding}=index;
  need(sha(canonical(binding))===index_sha256&&
    index.files.find(file=>file.name==='manifest.json').sha256===index.manifest_sha256,'INDEX_CHANGED');
  return index;
}
function parseIndex(raw,planId){
  need(Buffer.isBuffer(raw)&&raw.length>=1&&raw.length<=MAX_INDEX,'INDEX_CHANGED');
  let index;try{index=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw fault('INDEX_CHANGED');}
  validateIndex(index,planId);need(encodedIndex(index).equals(raw),'INDEX_CHANGED');return index;
}
function reviewed(index,{expectedPlanSha256,expectedIndexSha256}){
  need(validHash(expectedPlanSha256)&&validHash(expectedIndexSha256),'REVIEWED_DIGESTS_REQUIRED');
  need(index.plan_sha256===expectedPlanSha256&&index.index_sha256===expectedIndexSha256,'REVIEW_CHANGED');
}
function description(index){
  return {planId:index.plan_id,workspaceId:index.workspace_id,planSha256:index.plan_sha256,
    indexSha256:index.index_sha256,nativeManifestSha256:index.manifest_sha256,
    handoverSha256:index.files.find(file=>file.name==='handover.zip').sha256};
}
function unpack(value,alias,operation){
  need(object(value)&&value.schema===NATIVE&&value.analysisWorkspace===alias&&value.operation===operation&&
    object(value.result),'NATIVE_RESPONSE_CHANGED');return value.result;
}

/** The existing authenticated MCP transport; this never starts or republishes a job. */
export async function openNativeAnalysisLineageClient({url,analysisWorkspace,tokenEnv,environment,signal}={}){
  selectedIdentity(analysisWorkspace,'0'.repeat(32));
  const client=await openMerchantFileClient({url,tokenEnv,environment,signal,
    errorPrefix:'MCP_ANALYSIS_LINEAGE',clientName:'starforge-analysis-lineage'});
  return {endpoint:client.endpoint,analysisWorkspace,async call(operation,body,options){
    return unpack(await client.call('sf43_discover_review_and_pay',{action:'analysis',analysisWorkspace,
      analysisOperation:operation,analysisRequest:body},options),analysisWorkspace,operation);
  }};
}
async function connection(options){
  selectedIdentity(options.analysisWorkspace,options.planId);
  if(options.client!==undefined){
    need(object(options.client)&&options.client.analysisWorkspace===options.analysisWorkspace&&
      typeof options.client.call==='function'&&typeof options.client.endpoint==='string'&&
      options.url===undefined,'CLIENT_REQUIRED');
    return options.client;
  }
  return openNativeAnalysisLineageClient(options);
}
async function currentIndex(client,planId){
  return validateIndex(await client.call('lineage-downloads',{plan_id:planId}),planId);
}
async function savedIndex(directory,planId){
  const root=resolve(directory);
  try{await privateDirectory(root);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  let raw=await optionalInitializationBytes(join(root,INDEX_NAME),MAX_INDEX);
  if(raw===null){
    const control=join(root,'download-state');
    try{await privateDirectory(control);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    raw=await optionalInitializationBytes(join(control,INDEX_NAME),MAX_INDEX);
  }
  return raw===null?null:{raw,index:parseIndex(raw,planId)};
}
function directoryValue(value){
  need(typeof value==='string'&&value.length>0&&!value.includes('\0')&&resolve(value)!=='/','DIRECTORY_REQUIRED');
  return resolve(value);
}

function chunk(raw,file,offset,limit,exportId,manifestSha256){
  const body=raw.subarray(offset,Math.min(file.bytes,offset+limit));
  return {exportId,manifestSha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
    offset,bytesRead:body.length,encoding:'base64',data:body.toString('base64'),
    nextOffset:offset+body.length<file.bytes?offset+body.length:null};
}
function adapt(client,index,analysisWorkspace){
  const raw=encodedIndex(index),manifestSha256=sha(raw);
  const manifestFile={name:INDEX_NAME,bytes:raw.length,sha256:manifestSha256};
  // A port rotation does not replace the original reviewed analytical source.
  // Every real chunk still passes the selected authenticated MCP client.
  const endpoint='urn:stellar-forge:analysis-lineage:'+index.workspace_id+':'+index.plan_id+':'+
    index.index_sha256+':'+analysisWorkspace;
  return {endpoint,async call(name,args,options){
    need(object(args)&&args.exportId===index.plan_id,'SOURCE_ID_REQUIRED');
    if(name===PREFIX+'_manifest'){
      need(keys(args,['exportId']),'ARGUMENTS_INVALID');
      return {state:'MANIFEST_RETAINED',exportId:index.plan_id,manifestFile};
    }
    need(name===PREFIX+'_file'&&keys(args,['exportId','file','expectedManifestSha256','expectedSha256','offset','limit'])&&
      args.expectedManifestSha256===manifestSha256&&Number.isSafeInteger(args.offset)&&args.offset>=0&&
      Number.isSafeInteger(args.limit)&&args.limit>=1&&args.limit<=MAX_CHUNK,'CHUNK_CHANGED');
    const file=args.file===INDEX_NAME?manifestFile:index.files.find(file=>file.name===args.file);
    need(file&&args.expectedSha256===file.sha256&&args.offset<=file.bytes,'CHUNK_CHANGED');
    if(args.file===INDEX_NAME)return chunk(raw,file,args.offset,args.limit,index.plan_id,manifestSha256);
    need(client,'DOWNLOAD_INCOMPLETE');
    const value=await client.call('lineage-file',{plan_id:index.plan_id,plan_sha256:index.plan_sha256,
      index_sha256:index.index_sha256,filename:file.name,sha256:file.sha256,
      byteOffset:args.offset,maxBytes:args.limit},options);
    const part=value?.file,size=Math.min(args.limit,file.bytes-args.offset);
    need(value?.planId===index.plan_id&&value?.workspaceId===index.workspace_id&&
      value?.planSha256===index.plan_sha256&&value?.indexSha256===index.index_sha256&&
      value?.filename===file.name&&object(part)&&part.verifiedSavedFile===true&&
      part.bytes===file.bytes&&part.sha256===file.sha256&&part.contentType===file.mime&&
      part.byteOffset===args.offset&&part.returnedBytes===size&&part.encoding==='base64'&&
      part.nextByteOffset===(args.offset+size<file.bytes?args.offset+size:null)&&typeof part.data==='string',
      'CHUNK_CHANGED');
    const body=Buffer.from(part.data,'base64');
    need(body.length===size&&body.toString('base64')===part.data,'CHUNK_INVALID');
    return {exportId:index.plan_id,manifestSha256,file:{name:file.name,bytes:file.bytes,sha256:file.sha256},
      offset:args.offset,bytesRead:size,encoding:'base64',data:part.data,nextOffset:part.nextByteOffset};
  }};
}

const transport=createRetainedDownload({manifestName:INDEX_NAME,parseManifest:parseIndex,
  maximumBytes:MAX_FILE,maximumManifestBytes:MAX_INDEX,maximumCheckpointBytes:MAX_INDEX,
  stateSchema:STATE,resultSchema:RESULT,toolPrefix:PREFIX,errorPrefix:'MCP_ANALYSIS_LINEAGE',
  clientName:'starforge-analysis-lineage',readLease:false,
  validateExportId:value=>need(typeof value==='string'&&ID.test(value),'SOURCE_ID_REQUIRED'),
  describe:description});

/** Inspect the current native file edition before selecting its original digests. */
export async function inspectNativeAnalysisLineage(options={}){
  const client=await connection(options),index=await currentIndex(client,options.planId);
  return {schema:RESULT,state:'REVIEW',analysisWorkspace:options.analysisWorkspace,...description(index),
    index,indexFile:{name:INDEX_NAME,bytes:encodedIndex(index).length,sha256:sha(encodedIndex(index))}};
}

/** Download all seven original files using the maintained resumable file writer. */
export async function downloadNativeAnalysisLineage(options={}){
  const directory=directoryValue(options.directory);
  selectedIdentity(options.analysisWorkspace,options.planId);
  need(validHash(options.expectedPlanSha256)&&validHash(options.expectedIndexSha256),'REVIEWED_DIGESTS_REQUIRED');
  const chunkSize=options.chunkSize??MAX_CHUNK;
  need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=MAX_CHUNK,'CHUNK_SIZE_INVALID');
  const retained=await savedIndex(directory,options.planId);
  const client=await connection(options),index=retained?.index??await currentIndex(client,options.planId);
  reviewed(index,options);
  const result=await transport.download({client:adapt(client,index,options.analysisWorkspace),
    exportId:index.plan_id,directory,signal:options.signal,chunkSize,onProgress:options.onProgress,
    expectedManifestSha256:sha(encodedIndex(index))});
  return {...result,analysisWorkspace:options.analysisWorkspace,indexFile:join(directory,INDEX_NAME)};
}

/** Verify and complete the original local handover without any MCP/collector call. */
export async function reopenNativeAnalysisLineage(options={}){
  const directory=directoryValue(options.directory);
  need(typeof options.planId==='string'&&ID.test(options.planId),'SOURCE_ID_REQUIRED');
  await privateDirectory(directory);
  const saved=await savedIndex(directory,options.planId);
  need(saved,'ORIGINAL_INDEX_REQUIRED');reviewed(saved.index,options);
  return transport.lockedDownload(directory,async context=>{
    await transport.loadContext(context,saved.raw,saved.index.plan_id);
    for(const file of saved.index.files){
      options.signal?.throwIfAborted();context.lease.assertHeld();
      await transport.verifiedFile(join(directory,file.name),file,options.signal);
      context.state.files[file.name]={bytes:file.bytes,sha256:file.sha256,complete:true};
    }
    await transport.checkpoint(context);context.lease.assertHeld();
    await retainInitializationFile(join(directory,INDEX_NAME),saved.raw,{resume:true});
    return {schema:RESULT,state:'COMPLETE',directory,exportId:saved.index.plan_id,...description(saved.index),
      manifestSha256:sha(saved.raw),resumed:true,
      resumedBytes:saved.index.files.reduce((sum,file)=>sum+file.bytes,0),
      files:saved.index.files.length,bytes:saved.index.files.reduce((sum,file)=>sum+file.bytes,0),
      indexFile:join(directory,INDEX_NAME),offline:true};
  });
}

function argumentsFor(argv){
  const [command,...rest]=argv,allowed={
    inspect:['--url','--workspace','--plan','--token-env'],
    download:['--url','--workspace','--plan','--dir','--plan-sha256','--index-sha256','--token-env','--chunk-size'],
    reopen:['--plan','--dir','--plan-sha256','--index-sha256']};
  need(Object.hasOwn(allowed,command)&&rest.length%2===0,'ARGUMENTS_INVALID');
  const selected={};
  for(let i=0;i<rest.length;i+=2){
    need(allowed[command].includes(rest[i])&&!Object.hasOwn(selected,rest[i])&&rest[i+1],'ARGUMENTS_INVALID');
    selected[rest[i]]=rest[i+1];
  }
  return {command,options:{url:selected['--url'],analysisWorkspace:selected['--workspace'],planId:selected['--plan'],
    directory:selected['--dir'],expectedPlanSha256:selected['--plan-sha256'],expectedIndexSha256:selected['--index-sha256'],
    tokenEnv:selected['--token-env'],...(selected['--chunk-size']===undefined?{}:{chunkSize:Number(selected['--chunk-size'])})}};
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){
    process.stdout.write('Original Analysis lineage files over native MCP.\n'+
      'inspect --url MCP_URL --workspace ALIAS --plan UUID32 [--token-env NAME]\n'+
      'download --url MCP_URL --workspace ALIAS --plan UUID32 --dir PRIVATE_DIR --plan-sha256 SHA256 --index-sha256 SHA256 [--token-env NAME] [--chunk-size 1..65536]\n'+
      'reopen --plan UUID32 --dir PRIVATE_DIR --plan-sha256 SHA256 --index-sha256 SHA256\n');
    return 0;
  }
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=argumentsFor(argv);options.signal=controller.signal;
    const result=await(command==='inspect'?inspectNativeAnalysisLineage(options):
      command==='download'?downloadNativeAnalysisLineage(options):reopenNativeAnalysisLineage(options));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
  }catch(error){
    const code=controller.signal.aborted?'MCP_ANALYSIS_LINEAGE_DOWNLOAD_INTERRUPTED':
      ['ENOSPC','EDQUOT'].includes(error?.code)?'MCP_ANALYSIS_LINEAGE_DOWNLOAD_STORAGE_FULL':
      /^[A-Z0-9_]{1,180}$/.test(error?.code??'')?error.code:'MCP_ANALYSIS_LINEAGE_DOWNLOAD_FAILED';
    process.stderr.write(JSON.stringify({error:code})+'\n');return controller.signal.aborted?130:2;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
